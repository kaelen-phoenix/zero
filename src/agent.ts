import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { FactoryConfig } from "./config.js";
import { resolveEngine, type Access, type Engine, type EngineRequest, type EngineResult, type QuotaReport } from "./engines/index.js";
import { log } from "./log.js";
import { assignedSkills, discoverSkills, resolveSkill, stageSkills, unstageSkills, withSkillText, type Skill, type StagedSkills } from "./skills.js";
import { AGENT_SPAN } from "./telemetry/metrics.js";
import type { Tracer } from "./telemetry/tracer.js";

/** Stations staffed by an agent. `verify` and `integrate` are run by zero itself. */
export type AgentStation = "spec" | "build" | "review" | "security" | "reply";

export interface AgentRun<T = unknown> {
  ok: boolean;
  /** Final text of the agent, or what went wrong when it failed. */
  text: string;
  /** Validated structured output when the request has a schema. */
  output?: T;
  costUsd: number;
  /** `reported` when the engine said what the call cost; `unknown` otherwise. */
  costSource: "reported" | "unknown";
  engine: string;
  model?: string;
  /** Billing and plan usage, when the engine reports it. */
  quota?: QuotaReport;
}

export interface AgentRequest<T = unknown> {
  station: AgentStation;
  prompt: string;
  cwd: string;
  schema?: z.ZodType<T>;
  /** Spend cap for this call, honoured by engines that support it. */
  maxBudgetUsd?: number;
  signal?: AbortSignal;
  /** The line the run is for, which may add skills to the station's own. */
  line?: string;
  /** Where to record the `gen_ai.invoke_agent` span. */
  trace?: { tracer: Tracer; jobId: string; parentId: string };
}

export type AgentRunner = <T>(req: AgentRequest<T>) => Promise<AgentRun<T>>;

/** Where an engine actually runs: on this machine by default, or inside the isolation box. */
export type EngineExecute = (engine: Engine, req: EngineRequest, trace: { tracer: Tracer; jobId: string; parentId: string } | undefined, station: AgentStation) => Promise<EngineResult>;

const runHere: EngineExecute = (engine, req) => engine.run(req);

/** Only the build station may change the work copy. */
export const AGENT_ACCESS: Readonly<Record<AgentStation, Access>> = { spec: "read", build: "write", review: "read", security: "read", reply: "read" };
const ACCESS = AGENT_ACCESS;

const promptCache = new Map<AgentStation, string>();

async function stationInstructions(station: AgentStation): Promise<string> {
  let text = promptCache.get(station);
  if (!text) {
    text = await readFile(new URL(`../agents/${station}.md`, import.meta.url), "utf8");
    promptCache.set(station, text);
  }
  return text;
}

/** The original instructions of a station, as its agent receives them. */
export function agentInstructions(station: AgentStation): Promise<string> {
  return stationInstructions(station);
}

/** The last JSON object in a free-form answer: a ```json fence if present, else the last {...} that parses. */
export function extractJson(answer: string): unknown {
  const text = answer.slice(-20_000);
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const fence of fences.reverse()) {
    try {
      return JSON.parse(fence[1]!);
    } catch {
      // try the next one
    }
  }
  for (let end = text.lastIndexOf("}"); end > 0; end = text.lastIndexOf("}", end - 1)) {
    for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // widen the candidate
      }
    }
  }
  return undefined;
}

/** How a call's plan reading is kept on its agent span, where the budget reads it back (src/budget.ts). */
export function quotaAttrs(quota: QuotaReport | undefined): Record<string, string | boolean> {
  if (!quota) return {};
  return { "zero.billing": quota.billing, "zero.quota": JSON.stringify(quota.windows), "zero.quota.limited": Boolean(quota.limited) };
}

/** Plain JSON Schema without the `$schema` meta key, which some engines (Claude Code) reject. */
export function toEngineSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** The station's skills on the line that resolve; the others are logged and skipped (`zero status` lists them). */
function resolvedSkills(config: FactoryConfig, station: AgentStation, line: string | undefined, claudeHome?: string): { skills: Skill[]; missing: string[] } {
  const refs = assignedSkills(config, station, line);
  if (!refs.length) return { skills: [], missing: [] };
  const available = discoverSkills(claudeHome);
  const skills: Skill[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const { skill, problem } = resolveSkill(ref, available);
    if (skill) skills.push(skill);
    else {
      missing.push(ref);
      log.warn(`agent:${station} skill ${ref} skipped`, { reason: problem });
    }
  }
  return { skills, missing };
}

export function createAgentRunner(config: FactoryConfig, opts: { execute?: EngineExecute; claudeHome?: string } = {}): AgentRunner {
  const execute = opts.execute ?? runHere;
  return async function runAgent<T>({ station, prompt, cwd, schema, maxBudgetUsd, signal, trace, line }: AgentRequest<T>): Promise<AgentRun<T>> {
    const stationCfg = config.stations[station];
    const engine = resolveEngine(stationCfg.engine ?? config.engine, config);
    const jsonSchema = schema && toEngineSchema(schema);
    const fullPrompt =
      jsonSchema && !engine.nativeSchema
        ? `${prompt}\n\nEnd your answer with a single \`\`\`json fenced block containing an object that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`
        : prompt;

    const span = trace?.tracer.start(AGENT_SPAN, {
      jobId: trace.jobId,
      parentId: trace.parentId,
      attrs: { "gen_ai.agent.name": station, "gen_ai.request.model": stationCfg.model, "zero.engine": engine.name },
    });
    log.info(`agent:${station} start`, { engine: engine.name, model: stationCfg.model });
    let skills: StagedSkills | undefined;
    let result: EngineResult;
    try {
      const { skills: wanted, missing } = resolvedSkills(config, station, line, opts.claudeHome);
      span?.set({
        "zero.skills": wanted.length ? wanted.map((s) => s.fullName).join(", ") : undefined,
        "zero.skills.missing": missing.length ? missing.join(", ") : undefined,
      });
      if (wanted.length) skills = await stageSkills(wanted);
      const instructions = await stationInstructions(station);
      result = await execute(engine, {
        instructions: engine.nativeSkills ? instructions : withSkillText(instructions, skills?.skills ?? []),
        prompt: fullPrompt,
        cwd,
        access: ACCESS[station],
        schema: jsonSchema,
        model: stationCfg.model,
        maxTurns: stationCfg.maxTurns,
        maxBudgetUsd,
        timeoutMs: stationCfg.timeoutMinutes * 60_000,
        signal,
        ...(skills && { skills }),
      }, span && trace && { tracer: trace.tracer, jobId: trace.jobId, parentId: span.id }, station);
    } finally {
      await unstageSkills(skills);
    }

    const run: AgentRun<T> = {
      ok: result.ok,
      text: result.text,
      costUsd: result.costUsd ?? 0,
      costSource: result.costUsd === undefined ? "unknown" : "reported",
      engine: engine.name,
      model: stationCfg.model,
      ...(result.quota && { quota: result.quota }),
    };
    if (run.ok && schema) {
      const parsed = schema.safeParse(result.output ?? extractJson(result.text));
      if (parsed.success) run.output = parsed.data;
      else {
        run.ok = false;
        run.text = `invalid structured output: ${parsed.error.message}`;
      }
    }

    span?.end(run.ok ? "ok" : "error", {
      "zero.cost.usd": run.costUsd,
      "zero.cost.source": run.costSource,
      "gen_ai.conversation.id": result.sessionId,
      ...quotaAttrs(result.quota),
      ...(!run.ok && { "error.message": run.text.slice(0, 300) }),
    });
    log.info(`agent:${station} done`, { engine: engine.name, ok: run.ok, costUsd: run.costUsd.toFixed(3) });
    return run;
  };
}
