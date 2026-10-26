import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Config, RoleName } from "./config.js";
import { resolveEngine, type Access } from "./engines/index.js";
import { log } from "./log.js";

export interface AgentRun<T = unknown> {
  ok: boolean;
  /** Final text of the agent, or what went wrong when it failed. */
  text: string;
  /** Validated structured output when the request has a schema. */
  output?: T;
  costUsd: number;
}

export interface AgentRequest<T = unknown> {
  role: RoleName;
  prompt: string;
  cwd: string;
  schema?: z.ZodType<T>;
}

export type AgentRunner = <T>(req: AgentRequest<T>) => Promise<AgentRun<T>>;

/** Only the coder may change the workspace. */
const ACCESS: Record<RoleName, Access> = { planner: "read", coder: "write", reviewer: "read" };

const promptCache = new Map<RoleName, string>();

async function roleInstructions(role: RoleName): Promise<string> {
  let text = promptCache.get(role);
  if (!text) {
    text = await readFile(new URL(`../agents/${role}.md`, import.meta.url), "utf8");
    promptCache.set(role, text);
  }
  return text;
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

/** Plain JSON Schema without the `$schema` meta key, which some engines (Claude Code) reject. */
export function toEngineSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export function createAgentRunner(config: Config): AgentRunner {
  return async function runAgent<T>({ role, prompt, cwd, schema }: AgentRequest<T>): Promise<AgentRun<T>> {
    const roleCfg = config.roles[role];
    const engine = resolveEngine(roleCfg.engine ?? config.engine, config);
    const jsonSchema = schema && toEngineSchema(schema);
    const fullPrompt =
      jsonSchema && !engine.nativeSchema
        ? `${prompt}\n\nEnd your answer with a single \`\`\`json fenced block containing an object that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`
        : prompt;

    log.info(`agent:${role} start`, { engine: engine.name, model: roleCfg.model });
    const result = await engine.run({
      instructions: await roleInstructions(role),
      prompt: fullPrompt,
      cwd,
      access: ACCESS[role],
      schema: jsonSchema,
      model: roleCfg.model,
      maxTurns: roleCfg.maxTurns,
      maxBudgetUsd: roleCfg.maxBudgetUsd,
      timeoutMs: roleCfg.timeoutMinutes * 60_000,
    });

    const run: AgentRun<T> = { ok: result.ok, text: result.text, costUsd: result.costUsd ?? 0 };
    if (run.ok && schema) {
      const parsed = schema.safeParse(result.output ?? extractJson(result.text));
      if (parsed.success) run.output = parsed.data;
      else {
        run.ok = false;
        run.text = `invalid structured output: ${parsed.error.message}`;
      }
    }

    log.info(`agent:${role} done`, { engine: engine.name, ok: run.ok, costUsd: run.costUsd.toFixed(3) });
    return run;
  };
}
