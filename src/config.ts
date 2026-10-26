import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parse, parseDocument, type Document } from "yaml";
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

/** A site for the egress rules: a host name (it covers its subdomains) or an IPv4 address, optionally with `:port`. */
export const SiteSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::\d{1,5})?$/, "use a site name like example.com or example.com:8443");

/** Any headless agent CLI. `{prompt}` and `{model}` are substituted; without `{prompt}` the prompt goes to stdin. */
export const CustomEngineSchema = z.object({
  command: z.array(z.string()).min(1),
  readArgs: z.array(z.string()).default([]),
  writeArgs: z.array(z.string()).default([]),
  modelArgs: z.array(z.string()).default([]),
  /** Environment variables (credentials) this engine needs inside the isolation box. */
  secrets: z.array(z.string()).default([]),
  /** Sites this engine must reach (its model's API); allowed by the egress gate in every mode. */
  hosts: z.array(SiteSchema).default([]),
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
    /** `container` runs setup, agents and verification inside the isolation box; `worktree` runs them on this machine. */
    isolation: z.enum(["worktree", "container"]).default("container"),
    box: z
      .object({
        /** Container runtime; `auto` prefers Podman, then Docker. */
        runtime: z.enum(["auto", "podman", "docker"]).default("auto"),
        cpus: z.number().positive().default(2),
        memoryGb: z.number().positive().default(4),
        pids: z.number().int().positive().default(512),
      })
      .prefault({}),
    /** What the isolation box may reach on the internet. Every connection goes through zero's gate and is recorded. */
    egress: z
      .object({
        /** `blocklist`: everything leaves except suspicious and blocked sites. `allowlist`: only allowed sites and the engines' own. */
        mode: z.enum(["blocklist", "allowlist"]).default("blocklist"),
        allow: z.array(SiteSchema).default([]),
        block: z.array(SiteSchema).default([]),
      })
      .prefault({}),
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

/** Edits `zero.factory.yaml` keeping its comments; never writes a definition the factory would refuse to load. */
export async function editFactory(path: string, edit: (doc: Document) => void): Promise<FactoryConfig> {
  const doc = parseDocument(await readFile(path, "utf8"));
  edit(doc);
  const text = doc.toString();
  const config = parseFactory(text);
  await writeFile(path, text);
  return config;
}

export interface EffectiveLevel {
  level: Level;
  configured: Level;
  /** Why the effective level is lower than the configured one. */
  reason?: string;
}

/** Whether the isolation box can take work right now, and if not, what is missing in the owner's words. */
export interface BoxAvailability {
  ready: boolean;
  problems: string[];
}

export const BOX_NOT_CHECKED: BoxAvailability = { ready: false, problems: ["la caja todavía no se revisó: corré `zero box status`"] };

const AT_L2 = "la fábrica trabaja en L2 (solo consulta si se toca algo protegido o se agota el presupuesto)";

/** L3 means nobody is watching, so it requires a ready isolation box; without it the factory runs at L2 and says exactly why. */
export function effectiveLevel(cfg: Pick<FactoryConfig, "level" | "isolation">, box: BoxAvailability = BOX_NOT_CHECKED): EffectiveLevel {
  if (cfg.level !== "L3") return { level: cfg.level, configured: cfg.level };
  if (cfg.isolation !== "container") return { level: "L2", configured: "L3", reason: `L3 requiere la caja de aislamiento (isolation: container): ${AT_L2}.` };
  if (box.ready && !box.problems.length) return { level: "L3", configured: "L3" };
  return { level: "L2", configured: "L3", reason: `L3 necesita la caja lista: ${box.problems.join("; ")}. Mientras tanto ${AT_L2}.` };
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
