import { readFile } from "node:fs/promises";
import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Config, RoleName } from "./config.js";
import { log } from "./log.js";

export interface AgentRun<T = unknown> {
  ok: boolean;
  /** Final text of the agent, or the error subtype when it failed. */
  text: string;
  /** Parsed structured output when the role declares a JSON schema. */
  output?: T;
  costUsd: number;
  turns: number;
}

export interface AgentRequest {
  role: RoleName;
  prompt: string;
  cwd: string;
  /** JSON Schema for structured output. */
  schema?: Record<string, unknown>;
}

export type AgentRunner = <T>(req: AgentRequest) => Promise<AgentRun<T>>;

/**
 * Tool surface per role. Planner and reviewer are read-only; only the coder
 * may edit files and run arbitrary commands. Anything not listed is denied
 * (`dontAsk`), so no run ever blocks waiting for a human.
 */
const ROLE_TOOLS: Record<RoleName, string[]> = {
  planner: ["Read", "Glob", "Grep", "Bash(git log:*)", "Bash(git show:*)", "Bash(ls:*)"],
  coder: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
  reviewer: ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"],
};

const promptCache = new Map<RoleName, string>();

async function rolePrompt(role: RoleName): Promise<string> {
  let text = promptCache.get(role);
  if (!text) {
    text = await readFile(new URL(`../agents/${role}.md`, import.meta.url), "utf8");
    promptCache.set(role, text);
  }
  return text;
}

export function createAgentRunner(config: Config): AgentRunner {
  return async function runAgent<T>({ role, prompt, cwd, schema }: AgentRequest): Promise<AgentRun<T>> {
    const roleCfg = config.roles[role];
    const options: Options = {
      cwd,
      model: roleCfg.model ?? config.model,
      maxTurns: roleCfg.maxTurns,
      maxBudgetUsd: roleCfg.maxBudgetUsd,
      systemPrompt: { type: "preset", preset: "claude_code", append: await rolePrompt(role) },
      // Load the target repo's CLAUDE.md and project settings, never the runner's user settings.
      settingSources: ["project"],
      allowedTools: ROLE_TOOLS[role],
      permissionMode: "dontAsk",
      ...(schema && { outputFormat: { type: "json_schema", schema } }),
    };

    log.info(`agent:${role} start`, { cwd });
    let result: SDKResultMessage | undefined;
    for await (const message of query({ prompt, options })) {
      if (message.type === "result") result = message;
    }
    if (!result) throw new Error(`agent:${role} ended without a result message`);

    const run: AgentRun<T> =
      result.subtype === "success"
        ? {
            ok: !result.is_error,
            text: result.result,
            output: result.structured_output as T | undefined,
            costUsd: result.total_cost_usd,
            turns: result.num_turns,
          }
        : { ok: false, text: result.subtype, costUsd: result.total_cost_usd, turns: result.num_turns };

    log.info(`agent:${role} done`, { ok: run.ok, turns: run.turns, costUsd: run.costUsd.toFixed(3) });
    return run;
  };
}
