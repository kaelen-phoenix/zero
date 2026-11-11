import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, win32 } from "node:path";
import { parse, parseDocument, type Document } from "yaml";
import { z } from "zod";
import { BUILT_IN_ENGINES } from "./engines/index.js";
import { SECRET_NAME } from "./keychain.js";
import { log } from "./log.js";
import { parseGitSource } from "./package-source.js";
import { findSecret } from "./secrets.js";
import type { Skill } from "./skills.js";

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
       * How far every research-born proposal goes on its own, whatever scout declares about it: the stricter of this and
       * the line's autonomy.
       */
      autonomy: AutonomySchema.default("propose"),
    })
    .strict(),
]);

/** The unjam station's diagnosis of what holds the lines up while the factory is idle, or `off`. */
const UnjamSchema = z.union([
  z.literal("off"),
  z
    .object({
      /** Fix jobs and retries the unjam station opens on its own per local day, across every line. */
      maxJobsPerDay: z.number().int().min(0).default(2),
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

/** An OTLP/HTTP collector URL: http or https, never with credentials in it. */
const OtlpEndpointSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}, "usá una URL http o https sin usuario ni contraseña (por ejemplo https://api.honeycomb.io/v1/traces)");

/** Optional export of the traces to an OpenTelemetry collector; absent, nothing leaves the machine. */
const TelemetrySchema = z
  .object({
    otlp: z
      .object({
        /** OTLP/HTTP traces endpoint, usually ending in /v1/traces. */
        endpoint: OtlpEndpointSchema,
        /** Header name → secret name, resolved from the environment or the keychain; never the value itself. */
        headers: z
          .record(
            z.string().regex(/^[A-Za-z0-9-]+$/, "nombre de encabezado inválido"),
            z.string().regex(SECRET_NAME, "va el nombre de un secreto (por ejemplo HONEYCOMB_API_KEY), no su valor: guardalo con `zero secret set NOMBRE` o en una variable de entorno"),
          )
          .default({}),
      })
      .strict()
      .optional(),
  })
  .strict();

/** A site for the egress rules: a host name (it covers its subdomains) or an IPv4 address, optionally with `:port`. */
export const SiteSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::\d{1,5})?$/, "use a site name like example.com or example.com:8443");

/**
 * Any headless agent CLI. `{prompt}` and `{model}` are substituted; without `{prompt}` the prompt goes to stdin.
 * With `protocol: acp` the command is an Agent Client Protocol agent: the prompt goes over JSON-RPC, never on argv.
 */
export const CustomEngineSchema = z
  .object({
    command: z.array(z.string()).min(1),
    readArgs: z.array(z.string()).default([]),
    writeArgs: z.array(z.string()).default([]),
    modelArgs: z.array(z.string()).default([]),
    /** Environment variables (credentials) this engine needs inside the isolation box. */
    secrets: z.array(z.string()).default([]),
    /** Sites this engine must reach (its model's API); allowed by the egress gate in every mode. */
    hosts: z.array(SiteSchema).default([]),
    /** `cli` (the default): the prompt goes in `{prompt}` or on stdin. `acp`: the agent speaks ACP on stdio. */
    protocol: z.enum(["cli", "acp"]).optional(),
  })
  .superRefine((def, ctx) => {
    if (def.protocol !== "acp") return;
    for (const key of ["command", "readArgs", "writeArgs", "modelArgs"] as const) {
      if (def[key].some((a) => a.includes("{prompt}"))) {
        ctx.addIssue({ code: "custom", path: [key], message: "un motor ACP recibe el pedido por el protocolo: sacá {prompt}" });
      }
    }
  });

/** The stations zero itself defines; a custom agent never takes one of their names. */
export const FIXED_STATIONS = ["spec", "build", "verify", "review", "security", "integrate", "reply", "scout", "research", "unjam"] as const;

/**
 * A project's own agent. `review`: a read-only reviewer that runs after review
 * and security, on the same change. `build`: it writes in the work copy, after
 * build and before verify, so all it touches goes through every check. It adds
 * to the line; it never replaces or skips a fixed station, and nothing lets one
 * that writes run after verify.
 */
export const CustomAgentSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "usá minúsculas, dígitos y guiones"),
    /** Its instructions, relative to the line's repository (line agents) or to the factory folder (global agents). */
    instructions: z.string().min(1).optional(),
    type: z.enum(["review", "build"], { error: "el tipo de un agente a medida tiene que ser review o build" }).default("review"),
    /** Where it runs in the line, derived from its type; a reviewer may still say `review`. */
    after: z.string({ error: "after tiene que ser un texto" }).optional(),
    /** Derived from its type: whatever a reviewer writes is discarded. */
    access: z.string({ error: "access tiene que ser un texto" }).optional(),
    /** Reviewers only. True: its verified high or critical findings send the change back to build, like review. False: it only reports. */
    blocking: z.boolean().optional(),
    /** `build` only: run only when the change touches one of these globs. Empty: on every job. */
    files: z.array(z.string().min(1, "los patrones de files no pueden estar vacíos")).optional(),
    engine: z.string().optional(),
    model: z.string().optional(),
    maxTurns: z.number().int().positive().default(40),
    timeoutMinutes: z.number().positive().default(15),
    skills: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((a, ctx) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
    if (a.type === "build") {
      if (a.after !== undefined) issue("after", `el agente "${a.name}" escribe: un agente que escribe corre entre build y verify, sin after`);
      if (a.access !== undefined && a.access !== "write") issue("access", `el agente "${a.name}" escribe: su access solo puede ser write`);
      if (a.blocking === false) issue("blocking", `el agente "${a.name}" escribe: si falla, falla el intento, así que no puede ser blocking: false`);
    } else {
      if (a.after !== undefined && a.after !== "review") issue("after", `un agente de revisión solo puede correr después de review; para escribir antes de verify usá type: build`);
      if (a.access !== undefined && a.access !== "read") issue("access", `un agente de revisión solo puede ser de lectura (access: read); para escribir usá type: build`);
      if (a.files !== undefined) issue("files", `el agente "${a.name}" es de revisión: files solo vale con type: build`);
    }
  })
  .transform((a) => {
    const writes = a.type === "build";
    return {
      ...a,
      instructions: a.instructions ?? `.zero/agents/${a.name}.md`,
      after: (writes ? "build" : "review") as "build" | "review",
      access: (writes ? "write" : "read") as "write" | "read",
      blocking: writes || (a.blocking ?? true),
      files: a.files ?? [],
    };
  });

/** A package name as npm accepts it, optionally scoped; nothing a shell or npm could read as something else. */
export const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * An installed agent package: where it is, and what the owner lets it do. The
 * engine and the model are chosen here, never by the package's own manifest.
 */
export const PackageEntrySchema = z
  .object({
    /** A local folder: relative to the factory file's folder, or absolute. */
    path: z.string().min(1).optional(),
    /** A package installed in `<ZERO_HOME>/packages/node_modules`. */
    npm: z.string().regex(NPM_NAME, "usá un nombre de paquete npm válido").optional(),
    /** The git source it came from; `path` is its clone and `commit` what is checked out there. */
    git: z
      .string()
      .refine((s) => !("error" in parseGitSource(s)), "usá una fuente git válida, https o ssh y sin credenciales en la URL")
      .optional(),
    commit: z.string().regex(/^[0-9a-f]{40,64}$/, "va el SHA completo del commit instalado").optional(),
    /** True: zero may import the package's stations, which run with the owner's permissions. */
    allowCode: z.boolean().default(false),
    /** What its stations receive as `ctx.config`. */
    config: z.unknown().optional(),
    engine: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .strict()
  .refine((p) => (p.path === undefined) !== (p.npm === undefined), "cada paquete lleva exactamente uno de path o npm")
  .refine((p) => (p.git === undefined ? p.commit === undefined : p.path !== undefined && p.commit !== undefined && p.npm === undefined), "git va junto a path y commit, y sin npm");
export type PackageEntry = z.output<typeof PackageEntrySchema>;

/** `zero`: the factory authors its commits. `owner`: the identity git config resolves in the line's repository does; zero stays the committer. */
export const COMMIT_AUTHORS = ["zero", "owner"] as const;
export type CommitAuthor = (typeof COMMIT_AUTHORS)[number];

/** A Jira Cloud site: an https origin with no credentials or path, kept without its trailing slash. */
const JiraSiteSchema = z
  .string()
  .refine((raw) => {
    try {
      const u = new URL(raw);
      return u.protocol === "https:" && !u.username && !u.password && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash && !raw.includes("@");
    } catch {
      return false;
    }
  }, "an https address with no credentials or path, such as https://acme.atlassian.net")
  .transform((raw) => new URL(raw).origin);

export const LineSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  /** Local git repository the line works on. */
  repo: z.string().min(1),
  baseBranch: z.string().default("main"),
  /** Run once in every fresh work copy, e.g. `npm ci`. */
  setup: z.array(z.string()).default([]),
  /** Must all pass before a change goes to review. */
  verify: z.array(z.string()).default([]),
  /** Minutes each verify command may take (20 when absent). Zero raises it on its own to twice what the slowest recent passing run took. */
  verifyTimeoutMinutes: z.number().positive().optional(),
  integrate: z.enum(["merge", "branch", "pull-request"]).default("merge"),
  remote: z.string().default("origin"),
  maxAttempts: z.number().int().min(1).default(3),
  /** Take GitHub issues carrying this label as requests (polled from the line's remote). Off when absent. */
  issues: z.object({ label: z.string().min(1).default("zero") }).optional(),
  /**
   * Take issues of this Linear team (its key, e.g. `ENG`) carrying the label as requests. Off when absent.
   * Strict: the key never goes here, only in the secret LINEAR_API_KEY.
   */
  linear: z.object({ team: z.string().min(1), label: z.string().min(1).default("zero") }).strict().optional(),
  /** Take the issues of a Jira Cloud project carrying this label as requests. Strict: its credentials live in the secret store, never here. */
  jira: z
    .object({ site: JiraSiteSchema, project: z.string().regex(/^[A-Z][A-Z0-9_]+$/, "a Jira project key, such as ABC"), label: z.string().min(1).default("zero") })
    .strict()
    .optional(),
  /** With `pull-request`: merge it once every GitHub check passed and it has no conflicts. */
  autoMerge: z.boolean().default(false),
  /**
   * Dependabot alerts of the line's GitHub repository: `off`, `notify` (only shown) or `jobs` (one job per package
   * for open alerts at or above `minSeverity`; the rest are only shown).
   */
  securityAlerts: z
    .object({ mode: z.enum(["off", "notify", "jobs"]).default("jobs"), minSeverity: z.enum(["low", "medium", "high", "critical"]).default("high") })
    .strict()
    .prefault({}),
  /**
   * The external services the line's app uses, for the monthly report's costs. Strict: only identifiers go here,
   * their tokens live in the secret store (GITHUB_BILLING_TOKEN, VERCEL_TOKEN, SUPABASE_ACCESS_TOKEN).
   */
  services: z
    .object({
      /** GitHub Actions of the line's repository; account and repository come from the line's remote when absent. */
      github: z
        .object({
          account: z.string().min(1).optional(),
          type: z.enum(["user", "organization"]).default("user"),
          repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/repo").optional(),
        })
        .strict(),
      vercel: z.object({ project: z.string().min(1), team: z.string().min(1).optional() }).strict(),
      supabase: z.object({ project: z.string().min(1), organization: z.string().min(1).optional() }).strict(),
    })
    .partial()
    .strict()
    .optional(),
  /** Per-agent additions for this line only; unknown agents are refused. */
  stations: z
    .object({ spec: LineSkillsSchema, build: LineSkillsSchema, review: LineSkillsSchema, security: LineSkillsSchema, reply: LineSkillsSchema, scout: LineSkillsSchema, research: ResearchLineSchema, unjam: LineSkillsSchema })
    .partial()
    .strict()
    .optional(),
  /** How far the night shift goes on its own on this line; absent: the global `nightShift.autonomy`. */
  nightShift: z.object({ autonomy: AutonomySchema }).strict().optional(),
  /** This line's signature; replaces the global one entirely. */
  signature: SignatureSchema.optional(),
  /** This line's own agents, after the global ones. */
  agents: z.array(CustomAgentSchema).default([]),
  /** Who authors this line's commits; absent: the global `commitAuthor`. */
  commitAuthor: z.enum(COMMIT_AUTHORS).optional(),
  /** Globs of files this line versions on purpose, though they are shaped like the factory's operation output (`operationArtifacts`). */
  allowedArtifacts: z.array(z.string()).default([]),
  /** Ask OSV and deps.dev about the npm dependencies each attempt adds, before review. Off: it tells them the dependencies' names. */
  checkDependencies: z.boolean().default(false),
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
    /** `off` starts Codex without its own sandbox, where it does not work; zero then checks read-only calls itself. Only the owner decides it: in this file, never from the chat. */
    codex: z.object({ sandbox: z.enum(["on", "off"]).default("on") }).strict().prefault({}),
    /** Start the factory when the owner logs in (a user-level entry, see autostart.ts). Only the owner decides it: `zero autostart`, `zero setup` or this file, never the chat. */
    autostart: z.boolean().default(false),
    /** Replacement engines, in order, for stations whose engine is paused by its plan. Only these are ever used. */
    fallback: z.array(FallbackSchema).default([]),
    /** Jobs running at once across all lines; each line runs one job at a time. */
    concurrency: z.number().int().min(1).default(2),
    /** Setup and verify commands running on this machine at once, across jobs (the box has its own limits). The rest wait their turn. */
    commandConcurrency: z.number().int().min(1).default(1),
    limits: z
      .object({
        /** 0 = only free engines. */
        /** Calls billed per use only; subscription plans are limited by their own usage windows. 0 = only free engines. */
        usdPerDay: z.number().nonnegative().default(10),
        /** Per-use billing only, like `usdPerDay`. */
        usdPerJob: z.number().positive().default(3),
        /** Share of each subscription window (5 hours, week) the factory leaves to the owner, in percent. 0 = use the whole plan. */
        reservePercent: z.number().min(0).max(99).default(0),
        /** What the idle-time stations (scout, research and the packages' stations) may spend together per night shift period; per-use billing only. */
        usdPerNight: z.number().nonnegative().default(1),
        protectedPaths: z.array(z.string()).default([".github/**", ".zero/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]),
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
        /** Diagnoses what holds the lines up while the factory is idle; read-only, never fixes anything itself. */
        unjam: stationSchema({ maxTurns: 40, timeoutMinutes: 15 }).prefault({}),
      })
      .prefault({}),
    /** Absent: on, at any hour the factory is idle. */
    nightShift: NightShiftSchema.default({ autonomy: "propose", maxAutoJobsPerDay: 3 }),
    /** Absent: on, one note per line with a research skill per day. */
    research: ResearchSchema.default({ topics: [], perLinePerDay: 1, autonomy: "propose" }),
    /** Absent: on, with the night shift's gates, at most two jobs a day. */
    unjam: UnjamSchema.default({ maxJobsPerDay: 2 }),
    /** Absent: on, with the default texts. */
    signature: SignatureSchema.default({ text: DEFAULT_SIGNATURE_TEXT, trailer: DEFAULT_SIGNATURE_TRAILER }),

    /** Absent: traces stay only in state.db. */
    telemetry: TelemetrySchema.optional(),
    townhall: z.object({ recallLimit: z.number().int().min(0).default(30) }).prefault({}),
    /** The control panel, served by the daemon; port 0 turns it off. Inside a container, 0.0.0.0 lets compose publish it. */
    panel: z.object({ port: z.number().int().min(0).max(65535).default(4848), host: z.string().min(1).default("127.0.0.1") }).prefault({}),
    /** Custom agents for every line, before each line's own. */
    agents: z.array(CustomAgentSchema).default([]),
    /** Installed agent packages; what they bring is loaded by `src/packages.ts`, never written here. */
    packages: z.array(PackageEntrySchema).default([]),
    /** Who authors the factory's commits on lines that do not say; zero is always the committer. */
    commitAuthor: z.enum(COMMIT_AUTHORS).default("zero"),
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
        // An agent with a bad field never went through its transform; that problem is already reported.
        if (!agent.instructions) continue;
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
    for (const [i, entry] of cfg.packages.entries()) {
      if (entry.engine && !known.includes(entry.engine)) ctx.addIssue({ code: "custom", path: ["packages", i, "engine"], message: `el paquete usa el motor "${entry.engine}", que no existe; motores conocidos: ${known.join(", ")}` });
    }
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

/** A custom agent a package brought, already with its entry's engine and model. */
export type PackageAgent = CustomAgent & { package: string; packageDir: string };

/** A station whose code may run: its entry allows it and its folder is outside the factory's work. */
export interface PackageStation {
  package: string;
  name: string;
  /** Absolute path of the module. */
  module: string;
  /** Absolute path of its agent's instructions; absent: `ctx.runAgent` has nothing to run. */
  instructions?: string;
  /** Full names (`<package>:<skill>`). */
  skills: string[];
  secrets: string[];
  everyMinutes: number;
  /** Local times, `HH:MM`, at which `scheduled` runs; empty: never. */
  schedule: string[];
  timeoutMinutes: number;
  maxTurns: number;
  /** Absent: `ctx.requestJob` refuses every request. */
  requests?: { perLinePerDay: number };
  /** Whether the person in charge may ask for a run of its `pass` outside its period (`zero package run`). */
  onDemand: boolean;
  entry: PackageEntry;
}

/** A read-only panel tab a package declared; `data` is relative to the package's data folder. */
export interface PackageTab {
  name: string;
  title: string;
  data: string;
  categories?: string[];
}

export interface LoadedPackage {
  name: string;
  version: string;
  dir: string;
  /** Its position in `packages`. */
  index: number;
  entry: PackageEntry;
  agents: string[];
  skills: string[];
  /** Every station of its manifest, whether or not its code may run. */
  stations: string[];
  /** Its panel tabs; they show data only, so they need no `allowCode`. */
  tabs: PackageTab[];
}

export interface PackageProblem {
  /** The package's name, or its path or npm name when the manifest cannot be read. */
  package: string;
  reason: string;
}

/** What `src/packages.ts` found on disk for the file's `packages`. */
export interface LoadedPackages {
  packages: LoadedPackage[];
  agents: PackageAgent[];
  skills: Skill[];
  stations: PackageStation[];
  problems: PackageProblem[];
}

/** `loadedPackages` never comes from the file: the schema drops that key, and only `src/packages.ts` sets it. */
export type FactoryConfig = z.infer<typeof FactorySchema> & { loadedPackages?: LoadedPackages };
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

/** A custom agent that applies to a line, and where its instructions live: the line's repository, the factory folder or its package. */
export type LineAgent = CustomAgent & { origin: "factory" | "line" | "package"; package?: string; packageDir?: string };

/** The custom agents of a line, in order: the file's global ones, those of the packages, then the line's own. Each type runs in this order at its own point of the line. */
export function lineAgents(config: Pick<FactoryConfig, "agents" | "loadedPackages">, line: Pick<LineConfig, "agents">): LineAgent[] {
  return [
    ...config.agents.map((a) => ({ ...a, origin: "factory" as const })),
    ...(config.loadedPackages?.agents ?? []).map((a) => ({ ...a, origin: "package" as const })),
    ...line.agents.map((a) => ({ ...a, origin: "line" as const })),
  ];
}

/** Where zero reads a custom agent's instructions: never the job's work copy. */
export function agentInstructionsPath(agent: LineAgent, repo: string, factoryDir: string): string {
  return join(agent.origin === "package" ? agent.packageDir! : agent.origin === "line" ? repo : factoryDir, agent.instructions);
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
export const AGENT_STATIONS: readonly StationName[] = ["spec", "build", "review", "security", "reply", "scout", "research", "unjam"];

/** How far the night shift goes on its own on a line: the line's own setting, else the global one. */
export function lineAutonomy(config: Pick<FactoryConfig, "nightShift">, line: Pick<LineConfig, "nightShift">): Autonomy {
  return line.nightShift?.autonomy ?? (config.nightShift === "off" ? "propose" : config.nightShift.autonomy);
}

/** Who authors a line's commits: the line's own setting, else the global one. */
export function commitAuthor(config: Pick<FactoryConfig, "commitAuthor">, line: Pick<LineConfig, "commitAuthor">): CommitAuthor {
  return line.commitAuthor ?? config.commitAuthor ?? "zero";
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

const warnedKeys = new Set<string>();

/** Takes out keys that no longer mean anything, so older files keep loading. `lines[].stations` is strict; the rest of the schema drops them by itself. */
function dropRetiredKeys(raw: unknown): unknown {
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isRecord(raw)) return raw;
  const found: string[] = [];
  if ("social" in raw) found.push("social");
  if (isRecord(raw.stations) && "community" in raw.stations) found.push("stations.community");
  for (const line of Array.isArray(raw.lines) ? raw.lines : []) {
    if (!isRecord(line)) continue;
    if ("social" in line) found.push("lines[].social");
    if (isRecord(line.stations) && "community" in line.stations) {
      found.push("lines[].stations.community");
      delete line.stations.community;
    }
  }
  // The daemon reloads the file on every turn, so each key is only mentioned once per process.
  const fresh = [...new Set(found)].filter((key) => !warnedKeys.has(key));
  if (fresh.length) {
    for (const key of fresh) warnedKeys.add(key);
    log.warn(`zero.factory.yaml: se ignora configuración que ya no existe (${fresh.join(", ")}); podés borrarla del archivo`);
  }
  return raw;
}

export function parseFactory(text: string): FactoryConfig {
  const secret = findSecret(text);
  if (secret) {
    throw new ConfigError(
      `zero.factory.yaml contiene algo con forma de credencial (${secret.slice(0, 8)}…). Los secretos no se guardan en la definición de la fábrica: usá variables de entorno o la sesión de cada cliente.`,
    );
  }
  const result = FactorySchema.safeParse(dropRetiredKeys(parse(text)) ?? {});
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
