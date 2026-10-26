import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const RoleSchema = z.object({
  model: z.string().optional(),
  maxTurns: z.number().int().positive(),
  maxBudgetUsd: z.number().positive(),
});

export const ConfigSchema = z.object({
  model: z.string().default("claude-opus-5-5"),
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
  roles: z
    .object({
      planner: RoleSchema.prefault({ maxTurns: 40, maxBudgetUsd: 2 }),
      coder: RoleSchema.prefault({ maxTurns: 120, maxBudgetUsd: 10 }),
      reviewer: RoleSchema.prefault({ maxTurns: 40, maxBudgetUsd: 2 }),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type RoleName = keyof Config["roles"];

export const CONFIG_FILE = "zero.config.json";

export async function loadConfig(cwd: string): Promise<Config> {
  const path = resolve(cwd, CONFIG_FILE);
  const raw = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : {};
  return ConfigSchema.parse(raw);
}
