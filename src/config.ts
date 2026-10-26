import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { findSecret } from "./secrets.js";

export const LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type Level = (typeof LEVELS)[number];

const StationSchema = z.object({
  /** Engine for this station; defaults to the factory engine. */
  engine: z.string().optional(),
  /** Model passed to the engine; omitted = the engine's own default. */
  model: z.string().optional(),
  /** Honoured by engines that support it (claude). */
  maxTurns: z.number().int().positive().optional(),
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

export const LineSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  /** Local git repository the line works on. */
  repo: z.string().min(1),
  baseBranch: z.string().default("main"),
  /** Run once in every fresh work copy, e.g. `npm ci`. */
  setup: z.array(z.string()).default([]),
  /** Must all pass before a change goes to review. */
  verify: z.array(z.string()).default([]),
  integrate: z.enum(["merge", "branch", "pull-request"]).default("merge"),
  remote: z.string().default("origin"),
  maxAttempts: z.number().int().min(1).default(3),
});

export const FactorySchema = z
  .object({
    version: z.literal(1).default(1),
    level: z.enum(LEVELS).default("L3"),
    /** `container` is reserved for the isolation box; until it ships, work copies are git worktrees. */
    isolation: z.enum(["worktree", "container"]).default("worktree"),
    engine: z.string().default("claude"),
    engines: z.record(z.string(), CustomEngineSchema).default({}),
    /** Jobs running at once across all lines; each line runs one job at a time. */
    concurrency: z.number().int().min(1).default(2),
    limits: z
      .object({
        /** 0 = only free engines. */
        usdPerDay: z.number().nonnegative().default(10),
        usdPerJob: z.number().positive().default(3),
        protectedPaths: z.array(z.string()).default([".github/**", ".env", ".env.*", "**/*.pem", "**/*.key"]),
      })
      .prefault({}),
    approvals: z
      .object({
        timeoutHours: z.number().positive().default(24),
        onTimeout: z.enum(["approve", "reject"]).default("reject"),
      })
      .prefault({}),
    stations: z
      .object({
        spec: StationSchema.prefault({ maxTurns: 40, timeoutMinutes: 15 }),
        build: StationSchema.prefault({ maxTurns: 150, timeoutMinutes: 45 }),
        review: StationSchema.prefault({ maxTurns: 40, timeoutMinutes: 15 }),
      })
      .prefault({}),
    townhall: z.object({ recallLimit: z.number().int().min(0).default(30) }).prefault({}),
    lines: z.array(LineSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const [i, line] of cfg.lines.entries()) {
      if (seen.has(line.name)) ctx.addIssue({ code: "custom", path: ["lines", i, "name"], message: `duplicate line "${line.name}"` });
      seen.add(line.name);
    }
  });

export type FactoryConfig = z.infer<typeof FactorySchema>;
export type LineConfig = z.infer<typeof LineSchema>;
export type CustomEngine = z.infer<typeof CustomEngineSchema>;
export type StationName = keyof FactoryConfig["stations"];

export class ConfigError extends Error {}

export function parseFactory(text: string): FactoryConfig {
  const secret = findSecret(text);
  if (secret) {
    throw new ConfigError(
      `zero.factory.yaml contiene algo con forma de credencial (${secret.slice(0, 8)}…). Los secretos no se guardan en la definición de la fábrica: usá variables de entorno o la sesión de cada cliente.`,
    );
  }
  const result = FactorySchema.safeParse(parse(text) ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`);
    throw new ConfigError(`zero.factory.yaml no es válido:\n- ${issues.join("\n- ")}`);
  }
  return result.data;
}

export async function loadFactory(path: string): Promise<FactoryConfig> {
  if (!existsSync(path)) throw new ConfigError(`No hay fábrica en ${path}. Creala con \`zero init\`.`);
  return parseFactory(await readFile(path, "utf8"));
}

export interface EffectiveLevel {
  level: Level;
  configured: Level;
  /** Why the effective level is lower than the configured one. */
  reason?: string;
}

/** Whether the isolation box is available on this machine. It does not exist yet in this version. */
export function isolationBoxAvailable(): boolean {
  return false;
}

/** L3 means nobody is watching, so it requires the isolation box; without it the factory runs at L2 and says why. */
export function effectiveLevel(cfg: Pick<FactoryConfig, "level" | "isolation">, boxAvailable = isolationBoxAvailable()): EffectiveLevel {
  if (cfg.level !== "L3") return { level: cfg.level, configured: cfg.level };
  if (cfg.isolation === "container" && boxAvailable) return { level: "L3", configured: "L3" };
  const reason =
    cfg.isolation === "container"
      ? "L3 requiere la caja de aislamiento, que todavía no está disponible en esta versión: la fábrica trabaja en L2 (solo consulta si se toca algo protegido o se agota el presupuesto)."
      : "L3 requiere la caja de aislamiento (isolation: container): la fábrica trabaja en L2 (solo consulta si se toca algo protegido o se agota el presupuesto).";
  return { level: "L2", configured: "L3", reason };
}

export function findLine(cfg: FactoryConfig, name?: string): LineConfig {
  if (name) {
    const line = cfg.lines.find((l) => l.name === name);
    if (!line) throw new ConfigError(`No existe la línea "${name}". Líneas: ${cfg.lines.map((l) => l.name).join(", ") || "ninguna"}.`);
    return line;
  }
  if (cfg.lines.length === 1) return cfg.lines[0]!;
  if (!cfg.lines.length) throw new ConfigError("La fábrica no tiene líneas. Agregá un repositorio con `zero line add <ruta>`.");
  throw new ConfigError(`Hay varias líneas; indicá cuál: ${cfg.lines.map((l) => l.name).join(", ")}.`);
}
