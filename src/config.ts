import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const RoleSchema = z.object({
  /** Engine for this role; defaults to the top-level `engine`. */
  engine: z.string().optional(),
  /** Model passed to the engine; omitted = the engine's own default. */
  model: z.string().optional(),
  /** Honoured by engines that support it (claude). */
  maxTurns: z.number().int().positive().optional(),
  /** Honoured by engines that support it (claude). */
  maxBudgetUsd: z.number().positive().optional(),
  /** Hard wall-clock limit, enforced by zero for every engine. */
  timeoutMinutes: z.number().positive(),
});

/** Any headless agent CLI. `{prompt}` and `{model}` are substituted; without `{prompt}` the prompt goes to stdin. */
export const CustomEngineSchema = z.object({
  command: z.array(z.string()).min(1),
  readArgs: z.array(z.string()).default([]),
  writeArgs: z.array(z.string()).default([]),
  modelArgs: z.array(z.string()).default([]),
});

export const ConfigSchema = z.object({
  engine: z.string().default("claude"),
  engines: z.record(z.string(), CustomEngineSchema).default({}),
  baseBranch: z.string().default("main"),
  branchPrefix: z.string().default("zero/"),
  /** How many coder→verify→review rounds before a task is marked failed. */
  maxAttempts: z.number().int().min(1).default(3),
  /** Shell commands that must all pass before a change goes to review. */
  verify: z.array(z.string()).default(["npm run typecheck", "npm test"]),
  labels: z
    .object({
      ready: z.string().default("zero:ready"),
      working: z.string().default("zero:working"),
      review: z.string().default("zero:review"),
      failed: z.string().default("zero:failed"),
    })
    .prefault({}),
  /** The agent network's shared space: collective memory plus the periodic briefing for humans. */
  townhall: z
    .object({
      /** github = JSONL on an orphan branch of the repo; local = JSONL under `localDir`; off = no memory. */
      store: z.enum(["github", "local", "off"]).default("github"),
      branch: z.string().default("zero-townhall"),
      localDir: z.string().optional(),
      /** How many notes from previous runs are given to planner and coder. */
      recallLimit: z.number().int().min(0).default(30),
      briefing: z
        .object({
          /** issue = open a GitHub issue per briefing; stdout = only print it. */
          sink: z.enum(["issue", "stdout"]).default("issue"),
          label: z.string().default("zero:townhall"),
          days: z.number().positive().default(1),
        })
        .prefault({}),
    })
    .prefault({}),
  roles: z
    .object({
      planner: RoleSchema.prefault({ maxTurns: 40, maxBudgetUsd: 2, timeoutMinutes: 15 }),
      coder: RoleSchema.prefault({ maxTurns: 120, maxBudgetUsd: 10, timeoutMinutes: 45 }),
      reviewer: RoleSchema.prefault({ maxTurns: 40, maxBudgetUsd: 2, timeoutMinutes: 15 }),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type RoleName = keyof Config["roles"];
export type CustomEngine = z.infer<typeof CustomEngineSchema>;

export const CONFIG_FILE = "zero.config.json";

export async function loadConfig(cwd: string): Promise<Config> {
  const path = resolve(cwd, CONFIG_FILE);
  const raw = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : {};
  return ConfigSchema.parse(raw);
}
