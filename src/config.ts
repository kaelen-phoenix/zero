import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, win32 } from "node:path";
import { parse, parseDocument, type Document } from "yaml";
import { z } from "zod";
import { BUILT_IN_ENGINES } from "./engines/index.js";
import { findSecret } from "./secrets.js";

export const LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type Level = (typeof LEVELS)[number];

/** A replacement engine for when a station's own is paused by its plan: its name, or the engine with a model. */
const FallbackSchema = z.union([z.string().min(1), z.object({ engine: z.string().min(1), model: z.string().optional() }).strict()]);

const stationSchema = (defaults: { maxTurns: number; timeoutMinutes: number }) => z.object({
  /** Engine for this station; defaults to the factory engine. */
  engine: z.string().optional(),
  /** Model passed to the engine; omitted = the engine's own default. */
  model: z.string().optional(),
  /** Honoured by engines that support it (claude). */
  maxTurns: z.number().int().positive().default(defaults.maxTurns),
  /** Hard wall-clock limit, enforced by zero for every engine. */
  timeoutMinutes: z.number().positive().default(defaults.timeoutMinutes),
  /** Skills installed in the owner's Claude Code, by name (or `plugin:skill`), for every line. */
  skills: z.array(z.string().min(1)).default([]),
  /** Replacement engines for this station, in order; replaces the global list. */
  fallback: z.array(FallbackSchema).optional(),
});

/** Skills a line adds to an agent, on top of the global ones. */
const LineSkillsSchema = z.object({ skills: z.array(z.string().min(1)).default([]) }).strict();

/** Research also names which of its skills are business ones; names not in `skills` are ignored, so a removed skill never breaks the file. */
const ResearchLineSchema = z.object({ skills: z.array(z.string().min(1)).default([]), business: z.array(z.string().min(1)).default([]) }).strict();

/** `propose`: proposals wait for the owner; `build`: built but left unintegrated; `auto`: built and integrated. */
const AutonomySchema = z.enum(["propose", "build", "auto"]);
export type Autonomy = z.infer<typeof AutonomySchema>;

/** A local time window, `HH:MM-HH:MM` on a 24-hour clock; a start later than the end wraps past midnight. */
const HoursSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/, "use HH:MM-HH:MM, from 00:00 to 23:59");

/** The scout station's own work while the factory is idle, or `off`. */
const NightShiftSchema = z.union([
  z.literal("off"),
  z
    .object({
      /** Limits the night shift to these local hours; absent: any time the factory is idle. */
      hours: HoursSchema.optional(),
      /** How far proposals go on their own on lines without a `nightShift.autonomy` of their own. */
      autonomy: AutonomySchema.default("propose"),
      /** Jobs the night shift opens on its own per local day, across every line; past it, proposals wait for the owner. */
      maxAutoJobsPerDay: z.number().int().min(0).default(3),
    })
    .strict(),
]);

/** The research station's daily web reading while the factory is idle, or `off`. */
const ResearchSchema = z.union([
  z.literal("off"),
  z
    .object({
      /** Topics of interest added to every line's research. */
      topics: z.array(z.string().min(1)).default([]),
      /** Notes each line keeps per local day; 0 turns research off. */
      perLinePerDay: z.number().int().min(0).default(1),
      /**
       * How far research-born proposals that add something third party (a dependency, a skill, an MCP server or code) go on
       * their own: the stricter of this and the line's autonomy. Other research-born proposals follow the line.
       */
      autonomy: AutonomySchema.default("propose"),
    })
    .strict(),
]);

export const DEFAULT_SIGNATURE_TEXT = "— Hecho con [zero in the loop](https://zerointheloop.com)";
export const DEFAULT_SIGNATURE_TRAILER = "Built-by: zero in the loop <https://zerointheloop.com>";

/** zero in the loop's signature on what the factory builds, or `off`. */
const SignatureSchema = z.union([
  z.literal("off"),
  z
    .object({
      /** Last paragraph of pull requests, issues and comments. */
      text: z.string().min(1).default(DEFAULT_SIGNATURE_TEXT),
      /** Trailer at the end of every commit: one line, `Token: value`. */
      trailer: z.string().regex(/^[A-Za-z0-9-]+: [^\r\n]+$/, "use one line like `Built-by: value`").default(DEFAULT_SIGNATURE_TRAILER),
    })
    .strict(),
]);
export type Signature = { text: string; trailer: string };

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

/** The stations zero itself defines; a custom agent never takes one of their names. */
export const FIXED_STATIONS = ["spec", "build", "verify", "review", "security", "integrate", "reply", "scout", "research"] as const;

/**
 * A project's own agent: for now a read-only reviewer that runs after review
 * and security, on the same change. It adds to the line; it never replaces or
 * skips a fixed station.
 */
export const CustomAgentSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "usá minúsculas, dígitos y guiones"),
    /** Its instructions, relative to the line's repository (line agents) or to the factory folder (global agents). */
    instructions: z.string().min(1).optional(),
    /** Where it runs in the line; only after review (and security) for now. */
    after: z.enum(["review"], { error: "por ahora un agente a medida solo puede correr después de review" }).default("review"),
    /** Only read-only agents for now; whatever they write is discarded. */
    access: z.literal("read", { error: "por ahora un agente a medida solo puede ser de lectura (access: read)" }).default("read"),
    /** True: its verified high or critical findings send the change back to build, like review. False: it only reports. */
    blocking: z.boolean().default(true),
    engine: z.string().optional(),
    model: z.string().optional(),
    maxTurns: z.number().int().positive().default(40),
    timeoutMinutes: z.number().positive().default(15),
    skills: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .transform((a) => ({ ...a, instructions: a.instructions ?? `.zero/agents/${a.name}.md` }));

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
  /** Take GitHub issues carrying this label as requests (polled from the line's remote). Off when absent. */
  issues: z.object({ label: z.string().min(1).default("zero") }).optional(),
  /** With `pull-request`: merge it once every GitHub check passed and it has no conflicts. */
  autoMerge: z.boolean().default(false),
  /** Per-agent additions for this line only; unknown agents are refused. */
  stations: z
    .object({ spec: LineSkillsSchema, build: LineSkillsSchema, review: LineSkillsSchema, security: LineSkillsSchema, reply: LineSkillsSchema, scout: LineSkillsSchema, research: ResearchLineSchema })
    .partial()
    .strict()
    .optional(),
  /** How far the night shift goes on its own on this line; absent: the global `nightShift.autonomy`. */
  nightShift: z.object({ autonomy: AutonomySchema }).strict().optional(),
  /** This line's signature; replaces the global one entirely. */
  signature: SignatureSchema.optional(),
  /** This line's own agents, after the global ones. */
  agents: z.array(CustomAgentSchema).default([]),
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
    /** Replacement engines, in order, for stations whose engine is paused by its plan. Only these are ever used. */
    fallback: z.array(FallbackSchema).default([]),
    /** Jobs running at once across all lines; each line runs one job at a time. */
    concurrency: z.number().int().min(1).default(2),
    limits: z
      .object({
        /** 0 = only free engines. */
        /** Calls billed per use only; subscription plans are limited by their own usage windows. 0 = only free engines. */
        usdPerDay: z.number().nonnegative().default(10),
        /** Per-use billing only, like `usdPerDay`. */
        usdPerJob: z.number().positive().default(3),
        /** Share of each subscription window (5 hours, week) the factory leaves to the owner, in percent. 0 = use the whole plan. */
        reservePercent: z.number().min(0).max(99).default(0),
        /** What the scout and research stations may spend together per night shift period; per-use billing only. */
        usdPerNight: z.number().nonnegative().default(1),
        protectedPaths: z.array(z.string()).default([".github/**", ".zero/**", ".env", ".env.*", "**/*.pem", "**/*.key"]),
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
        spec: stationSchema({ maxTurns: 40, timeoutMinutes: 15 }).prefault({}),
        build: stationSchema({ maxTurns: 150, timeoutMinutes: 45 }).prefault({}),
        review: stationSchema({ maxTurns: 40, timeoutMinutes: 15 }).prefault({}),
        /** A second, security-only read; give it another engine for an independent look. */
        security: stationSchema({ maxTurns: 40, timeoutMinutes: 15 }).prefault({}),
        /** Answers the owner's comments on an issue; no repository, only the facts zero computes. */
        reply: stationSchema({ maxTurns: 5, timeoutMinutes: 5 }).prefault({}),
        /** Proposes work on its own while the factory is idle; read-only, never builds anything. */
        scout: stationSchema({ maxTurns: 40, timeoutMinutes: 15 }).prefault({}),
        /** Reads the web once a day for skills, MCP servers and technologies; read-only, never installs anything. */
        research: stationSchema({ maxTurns: 40, timeoutMinutes: 15 }).prefault({}),
      })
      .prefault({}),
    /** Absent: on, at any hour the factory is idle. */
    nightShift: NightShiftSchema.default({ autonomy: "propose", maxAutoJobsPerDay: 3 }),
    /** Absent: on, one note per line with a research skill per day. */
    research: ResearchSchema.default({ topics: [], perLinePerDay: 1, autonomy: "propose" }),
    /** Absent: on, with the default texts. */
    signature: SignatureSchema.default({ text: DEFAULT_SIGNATURE_TEXT, trailer: DEFAULT_SIGNATURE_TRAILER }),
    townhall: z.object({ recallLimit: z.number().int().min(0).default(30) }).prefault({}),
    /** The control panel, served by the daemon on 127.0.0.1; 0 turns it off. */
    panel: z.object({ port: z.number().int().min(0).max(65535).default(4848) }).prefault({}),
    /** Custom agents for every line, before each line's own. */
    agents: z.array(CustomAgentSchema).default([]),
    lines: z.array(LineSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    const known = [...BUILT_IN_ENGINES, ...Object.keys(cfg.engines)];
    const lists = [
      { path: ["fallback"], list: cfg.fallback },
      ...Object.entries(cfg.stations).map(([name, s]) => ({ path: ["stations", name, "fallback"], list: s.fallback ?? [] })),
    ];
    for (const { path, list } of lists) {
      for (const [i, item] of list.entries()) {
        const engine = typeof item === "string" ? item : item.engine;
        if (!known.includes(engine)) {
          ctx.addIssue({ code: "custom", path: [...path, i], message: `el motor de reemplazo "${engine}" no existe; motores conocidos: ${known.join(", ")}` });
        }
      }
    }
    const checkAgents = (agents: CustomAgent[], path: (string | number)[], taken: Set<string>) => {
      for (const [i, agent] of agents.entries()) {
        const at = [...path, i];
        const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [...at, field], message });
        if ((FIXED_STATIONS as readonly string[]).includes(agent.name)) issue("name", `el agente "${agent.name}" usa el nombre de una estación fija de zero; elegí otro`);
        else if (taken.has(agent.name)) issue("name", `el agente "${agent.name}" está repetido para la misma línea`);
        taken.add(agent.name);
        const problem = instructionsProblem(agent.instructions);
        if (problem) issue("instructions", `el agente "${agent.name}": ${problem}`);
        if (agent.engine && !known.includes(agent.engine)) issue("engine", `el agente "${agent.name}" usa el motor "${agent.engine}", que no existe; motores conocidos: ${known.join(", ")}`);
      }
    };
    checkAgents(cfg.agents, ["agents"], new Set());
    const seen = new Set<string>();
    for (const [i, line] of cfg.lines.entries()) {
      checkAgents(line.agents, ["lines", i, "agents"], new Set(cfg.agents.map((a) => a.name)));
      if (seen.has(line.name)) ctx.addIssue({ code: "custom", path: ["lines", i, "name"], message: `duplicate line "${line.name}"` });
      seen.add(line.name);
      if (line.autoMerge && line.integrate !== "pull-request") {
        ctx.addIssue({ code: "custom", path: ["lines", i, "autoMerge"], message: `autoMerge needs integrate: pull-request (line "${line.name}")` });
      }
    }
  });

export type FactoryConfig = z.infer<typeof FactorySchema>;
export type LineConfig = z.infer<typeof LineSchema>;
export type CustomEngine = z.infer<typeof CustomEngineSchema>;
export type StationName = keyof FactoryConfig["stations"];
export type CustomAgent = z.output<typeof CustomAgentSchema>;

/** Why an agent's instructions path is refused: it must be a relative .md path that stays inside its folder. */
export function instructionsProblem(path: string): string | undefined {
  if (isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path)) return `las instrucciones tienen que ser una ruta relativa, no "${path}"`;
  if (path.split(/[\\/]/).includes("..")) return `las instrucciones no pueden salir de su carpeta con ".." ("${path}")`;
  if (!/\.md$/i.test(path)) return `las instrucciones tienen que ser un archivo .md ("${path}")`;
  return undefined;
}

/** A custom agent that applies to a line, and where its instructions live: the line's repository or the factory folder. */
export type LineAgent = CustomAgent & { origin: "factory" | "line" };

/** The custom agents of a line, in the order they run: the global ones, then the line's own, each in file order. */
export function lineAgents(config: Pick<FactoryConfig, "agents">, line: Pick<LineConfig, "agents">): LineAgent[] {
  return [...config.agents.map((a) => ({ ...a, origin: "factory" as const })), ...line.agents.map((a) => ({ ...a, origin: "line" as const }))];
}

/** The engines a custom agent may run on: its own (or the factory's), then the global replacements. */
export function customAgentChain(config: Pick<FactoryConfig, "engine" | "fallback">, agent: Pick<CustomAgent, "engine" | "model">): ChainLink[] {
  const chain: ChainLink[] = [{ engine: agent.engine ?? config.engine, ...(agent.model && { model: agent.model }) }];
  for (const item of config.fallback ?? []) {
    const link = typeof item === "string" ? { engine: item } : { engine: item.engine, ...(item.model && { model: item.model }) };
    if (!chain.some((l) => l.engine === link.engine)) chain.push(link);
  }
  return chain;
}

/** Every station that runs an agent, in line order. */
export const AGENT_STATIONS: readonly StationName[] = ["spec", "build", "review", "security", "reply", "scout", "research"];

/** How far the night shift goes on its own on a line: the line's own setting, else the global one. */
export function lineAutonomy(config: Pick<FactoryConfig, "nightShift">, line: Pick<LineConfig, "nightShift">): Autonomy {
  return line.nightShift?.autonomy ?? (config.nightShift === "off" ? "propose" : config.nightShift.autonomy);
}

/** The signature on what the factory builds for a line: the line's own, else the global one; undefined when off. */
export function lineSignature(config: Pick<FactoryConfig, "signature">, line: Pick<LineConfig, "signature">): Signature | undefined {
  const sig = line.signature ?? config.signature;
  return sig === "off" ? undefined : sig;
}

/** The line's business research skills: names in `business` that are also among its research `skills`. */
export function businessSkills(line: Pick<LineConfig, "stations">): string[] {
  const research = line.stations?.research;
  return research ? research.business.filter((s) => research.skills.includes(s)) : [];
}

/** One engine a station may run on, with its model (absent: the engine's own default). */
export interface ChainLink {
  engine: string;
  model?: string;
}

/**
 * The engines a station may run on, in order: its own first, then its
 * replacements (the station's list, or else the global one). Only the owner's
 * configuration adds engines here.
 */
export function stationChain(config: Pick<FactoryConfig, "engine" | "stations" | "fallback">, station: StationName): ChainLink[] {
  const own = config.stations[station];
  const chain: ChainLink[] = [{ engine: own.engine ?? config.engine, ...(own.model && { model: own.model }) }];
  for (const item of own.fallback ?? config.fallback ?? []) {
    const link = typeof item === "string" ? { engine: item } : { engine: item.engine, ...(item.model && { model: item.model }) };
    if (!chain.some((l) => l.engine === link.engine)) chain.push(link);
  }
  return chain;
}

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
