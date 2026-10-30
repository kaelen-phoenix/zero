import type { StagedSkills } from "../skills.js";

export type Access = "read" | "write";

export interface EngineRequest {
  /** Role instructions (agents/<role>.md). Engines with a system prompt use it there; others prepend it. */
  instructions: string;
  prompt: string;
  cwd: string;
  /** read = the agent must not modify the workspace; write = it may edit files and run commands. */
  access: Access;
  /** JSON Schema the final answer must match, when the role needs structured output. */
  schema?: Record<string, unknown>;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs: number;
  /** Aborted when the owner pulls the andon cord or the daemon shuts down. */
  signal?: AbortSignal;
  /** Skills zero staged for this run (a local plugin directory); only engines with `nativeSkills` read it. */
  skills?: StagedSkills;
}

export interface EngineResult {
  ok: boolean;
  /** Final message of the agent, or an error description when `ok` is false. */
  text: string;
  /** Structured output when the engine enforces the schema natively. */
  output?: unknown;
  /** Estimated cost, when the engine reports it. */
  costUsd?: number;
  /** The engine's own session id, when it reports one (for transcript and cost lookups). */
  sessionId?: string;
  /** How the engine's account is billed and how much of its plan is used, when it reports it. */
  quota?: QuotaReport;
}

/**
 * A usage window of a subscription plan (for example five hours or a week).
 * `utilization` is the used fraction, 0 to 1.
 */
export interface QuotaWindow {
  name: string;
  /** Spanish label for the owner ("5 horas", "semana"). */
  label: string;
  utilization?: number;
  status: "ok" | "warning" | "exhausted";
  /** ISO time when the window renews. */
  resetsAt?: string;
}

/**
 * `subscription`: a flat-rate plan whose real limit is its usage windows, so
 * reported costs are only estimates. `api`: pay per use, costs are real.
 */
export interface QuotaReport {
  billing: "subscription" | "api";
  windows: QuotaWindow[];
  /** True when the plan refused this call because a window is used up. */
  limited?: boolean;
}

/** A coding agent zero can drive headlessly: Claude Code, Codex, Antigravity, or any CLI. */
export interface Engine {
  name: string;
  /** True when the engine enforces `schema` itself; otherwise zero asks for JSON in the prompt and parses it. */
  nativeSchema: boolean;
  /** True when the engine loads `skills` itself; otherwise zero appends each SKILL.md to the instructions. */
  nativeSkills?: boolean;
  /** Sites the engine must reach to talk to its model; allowed by the egress gate in every mode. */
  hosts?: string[];
  run(req: EngineRequest): Promise<EngineResult>;
}
