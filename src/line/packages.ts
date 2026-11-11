import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { AgentRunner } from "../agent.js";
import { addPackageLine, ANDON_KEY, removePackageLine, requestWork, type FactoryContext } from "../app.js";
import { budgetState, pickAgentEngine } from "../budget.js";
import type { LineConfig, PackageStation } from "../config.js";
import { log } from "../log.js";
import { git } from "../shell.js";
import { FACTORY_IDENTITY } from "../workspace.js";
import { isInside, packageDataDir, warnOnce } from "../packages.js";
import { REDACTED } from "../secrets.js";
import { publicText } from "../public-text.js";
import type { Job } from "../state/store.js";
import { startOfDay } from "../telemetry/metrics.js";
import { unzip } from "../unzip.js";
import { PACKAGE_AGENT_PREFIX, periodStart, scoutSpent } from "./scout.js";

const CHARS_PER_TEXT = 600;
const CHARS_PER_REQUEST = 4000;
/** How late a time of a station's `schedule` may still run. */
const SCHEDULE_REACH_MS = 2 * 60 * 60_000;

/** What a station's agent call gives back. */
export interface StationAgentRun<T> {
  ok: boolean;
  text: string;
  output?: T;
  costUsd: number;
}

export interface DeliveredJob {
  line: string;
  title: string;
  summary: string;
  /** When it was delivered, ISO 8601. */
  at: string;
}

/** A file the person in charge uploaded to a station; `path` is absolute, inside the package's data folder. */
export interface StationUpload {
  /** Its cleaned base name. */
  name: string;
  path: string;
  sizeBytes: number;
  /** When it was uploaded, ISO 8601. */
  at: string;
}

/** What `ctx.unzip` wrote, relative to its destination, or why it wrote nothing. */
export type UnzipOutcome = { files: string[] } | { reason: string };

/** All a station receives from the factory: interface 1 of the package format. */
export interface StationContext {
  package: string;
  station: string;
  now: Date;
  /** Aborted when the pass runs out of time or the factory shuts down. */
  signal: AbortSignal;
  /** The entry's `config`, through the module's `parseConfig` if it exports one. */
  config: unknown;
  /** Only the names the station declared in its manifest. */
  secrets: { get(name: string): string | undefined };
  /** A read-only agent, in an empty folder, with the station's instructions and skills. In a scheduled pass it throws. */
  runAgent<T = unknown>(req: { prompt: string; schema?: z.ZodType<T> }): Promise<StationAgentRun<T>>;
  /** zero's own zod, for `runAgent` schemas. */
  z: typeof z;
  log: { info(message: string, fields?: Record<string, unknown>): void; warn(message: string, fields?: Record<string, unknown>): void };
  /** Line names only. */
  lines: string[];
  /** The package's own data folder in ZERO_HOME, already created; its panel tabs read their JSON from here. */
  dataDir: string;
  /** Kept between passes, in keys of this station alone; any value JSON can hold. */
  state: { get<T = unknown>(name: string): T | undefined; set(name: string, value: unknown): void };
  /** No job ids, branches or local paths. */
  deliveredJobs(since: Date): DeliveredJob[];
  /**
   * Opens a normal job on one of `lines`, or on the line of one of `repos` by its name, if the manifest's `requests`
   * allows it; `maxUsd` caps its cost, never above `limits.usdPerJob`. Never throws.
   */
  requestJob(req: { line: string; text: string; maxUsd?: number } | { repo: string; text: string; maxUsd?: number }): JobRequestResult;
  /** The package's local git repositories, if the manifest's `repositories` allows creating them. */
  repos: StationRepos;
  /** A job this package opened with `requestJob`; undefined for any other id. Never throws. */
  job(id: string): PackageJobView | undefined;
  /** The file this on-demand run answers; absent in every other turn. */
  upload?: StationUpload;
  /** Unpacks a zip of `dataDir` into a folder of `dataDir` (relative paths are taken from it); refuses the whole archive on links, paths leaving it, encryption, zip64 or too much. Never throws. */
  unzip(zip: string, dest: string): Promise<UnzipOutcome>;
}

/** A package's own job as its stations may read it. */
export interface PackageJobView {
  id: string;
  line: string;
  status: Job["status"];
  costUsd: number;
  budgetUsd: number;
  /** It waits for an answer of the person in charge. */
  waiting: boolean;
  finishedAt?: string;
  /** Why it ended as it did, cleaned. */
  reason?: string;
  delivery?: { mode: "merge" | "branch" | "pull-request"; commit?: string };
}

/**
 * A package's local git repositories in ZERO_HOME, each with a line `<package>-<name>` that delivers by merging into its
 * `main`, with no remote. Every call refuses another package's repositories, and none throws.
 */
export interface StationRepos {
  /** A repository with one commit on `main`, seeded from a zip of `dataDir` when `from` says so, and its line. */
  create(name: string, opts?: { from?: string; setup?: string[]; verify?: string[] }): Promise<{ ok: true; line: string } | { reason: string }>;
  /** A zip of `main`'s tree, written to a `.zip` path of `dataDir`; `file` comes back relative to it. */
  archive(name: string, file: string): Promise<{ ok: true; file: string } | { reason: string }>;
  /** Takes out the line and the folder; refused while the line has a job that has not ended. */
  remove(name: string): Promise<{ ok: true } | { reason: string }>;
}

/** The new job, or why there is none. */
export type JobRequestResult = { id: string } | { reason: string };

interface StationModule {
  /** Called as `pass(ctx)`, or `pass(ctx, { onDemand: true, request? })` for a run the person in charge asked for. */
  pass?: unknown;
  scheduled?: unknown;
  parseConfig?: unknown;
}

/** A module's `pass` or `scheduled`; an on-demand `pass` gets `{ onDemand: true }`, plus the person in charge's `request` when there is one. */
type StationHook = (ctx: StationContext, slot?: { at: string } | { onDemand: true; request?: string }) => unknown;

const stationKey = (station: Pick<PackageStation, "package" | "name">) => `${PACKAGE_AGENT_PREFIX}${station.package}/${station.name}`;

/** Where the time of a station's last pass is kept. */
export const stationLastKey = (pkg: string, name: string) => `${stationKey({ package: pkg, name })}:last`;

/** When the person in charge asked for a run of a station's `pass` outside its period, ISO 8601; at most one pending per station. */
export const stationOnDemandKey = (pkg: string, name: string) => `${stationKey({ package: pkg, name })}:on-demand`;

/** Where a station's last on-demand run is kept, as an `OnDemandRecord`. */
export const stationOnDemandLastKey = (pkg: string, name: string) => `${stationKey({ package: pkg, name })}:on-demand:last`;

/** How an on-demand run ended: `not-run` when its module could not be imported, had no `pass` or refused its config. */
export type OnDemandOutcome = "ok" | "failed" | "timeout" | "stopped" | "not-run";

/** A station's last on-demand run; times in ISO 8601. */
export interface OnDemandRecord {
  /** When the person in charge asked for it. */
  asked: string;
  /** When the call started; absent for a run that could not start. */
  startedAt?: string;
  endedAt?: string;
  outcome?: OnDemandOutcome;
}

/** A station's last on-demand run, if one was recorded and can be read. */
export function onDemandRecord(ctx: FactoryContext, pkg: string, name: string): OnDemandRecord | undefined {
  const raw = ctx.store.getKv(stationOnDemandLastKey(pkg, name));
  if (raw === undefined) return undefined;
  try {
    const record = JSON.parse(raw) as OnDemandRecord;
    return typeof record?.asked === "string" ? record : undefined;
  } catch {
    return undefined;
  }
}

/** The text the person in charge sent with a pending on-demand run, already cleaned; absent without one. */
export const stationOnDemandRequestKey = (pkg: string, name: string) => `${stationOnDemandKey(pkg, name)}:request`;

/** How an on-demand run ended. */
export type StationRunOutcome = "done" | "failed" | "timeout" | "stopped";

/** The last on-demand run of a station, JSON in `stationRunKey`. */
export interface StationRunRecord {
  /** The `stationOnDemandKey` value it answered. */
  requestedAt: string;
  request?: string;
  startedAt?: string;
  state: "running" | "ended";
  outcome?: StationRunOutcome;
  finishedAt?: string;
  error?: string;
}

/** Where the state and outcome of a station's last on-demand run are kept. */
export const stationRunKey = (pkg: string, name: string) => `${stationOnDemandKey(pkg, name)}:run`;

/** The last on-demand run of a station, if one was recorded. */
export function readStationRun(ctx: FactoryContext, pkg: string, name: string): StationRunRecord | undefined {
  const raw = ctx.store.getKv(stationRunKey(pkg, name));
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as StationRunRecord;
  } catch {
    return undefined;
  }
}

/** The file a pending on-demand run answers, as a `StationUpload`; written only with the request itself. */
export const stationUploadKey = (pkg: string, name: string) => `${stationOnDemandKey(pkg, name)}:upload`;

/** The upload a pending on-demand run answers, if there is one and it can be read. */
export function readStationUpload(ctx: FactoryContext, pkg: string, name: string): StationUpload | undefined {
  const raw = ctx.store.getKv(stationUploadKey(pkg, name));
  if (raw === undefined) return undefined;
  try {
    const u = JSON.parse(raw) as StationUpload;
    return typeof u?.name === "string" && typeof u.path === "string" && typeof u.sizeBytes === "number" && typeof u.at === "string" ? { name: u.name, path: u.path, sizeBytes: u.sizeBytes, at: u.at } : undefined;
  } catch {
    return undefined;
  }
}

/** The last local day (`YYYY-MM-DD`) a time of a station's `schedule` ran; out of reach of `ctx.state`. */
export const stationScheduleKey = (pkg: string, name: string, at: string) => `${stationKey({ package: pkg, name })}:schedule:${at}`;

const two = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** Text out of a station without the values of what it declared. */
export function withoutSecrets(text: string, ctx: FactoryContext, station: PackageStation): string {
  return station.secrets.reduce((out, name) => {
    const value = ctx.secrets.get(name);
    return value ? out.replaceAll(value, REDACTED) : out;
  }, text);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Text for or from a station as it may be kept: no declared secret, no local path, trimmed and cut. */
export function stationText(text: string, ctx: FactoryContext, station: PackageStation, max = CHARS_PER_REQUEST): string {
  return publicText(withoutSecrets(text, ctx, station), ctx.config.lines.map((l) => l.repo)).text.trim().slice(0, max);
}

/** A job's text as a station may read it: no secret, path or id. */
function jobText(text: string, job: Job, repos: string[]): string {
  let out = publicText(text, repos).text;
  for (const branch of [job.branch, job.delivery?.branch]) if (branch) out = out.replaceAll(branch, "");
  out = out.replaceAll(job.id, "");
  return out.replace(/\bzero[/-][0-9a-f]{8}\b/g, "").replace(/\b[0-9a-f]{8}\b/g, "").replace(/[ \t]{2,}/g, " ").trim().slice(0, CHARS_PER_TEXT);
}

/** What was delivered since then. Jobs born from business material stay out: a third party's code may publish what it reads. */
function deliveredJobs(ctx: FactoryContext, since: Date): DeliveredJob[] {
  const repos = ctx.config.lines.map((l) => l.repo);
  const fromBusiness = (job: Job) => {
    const source = job.source;
    if (source?.kind === "night-shift") return ctx.store.getProposal(source.proposal)?.business ?? false;
    if (source?.kind === "research") return ctx.store.getResearchNote(source.note)?.business ?? false;
    return false;
  };
  return ctx.store
    .finishedSince(since)
    .filter((j) => j.status === "delivered" && !fromBusiness(j))
    .map((j) => {
      const summary = (j.spec as { summary?: unknown } | undefined)?.summary;
      return {
        line: j.line,
        title: jobText(j.title ?? j.request.split("\n")[0]!, j, repos),
        summary: typeof summary === "string" ? jobText(summary, j, repos) : "",
        at: j.finishedAt!,
      };
    });
}

/** `ctx.job`: only jobs the station's own package opened. */
function packageJob(ctx: FactoryContext, station: PackageStation, id: unknown): PackageJobView | undefined {
  try {
    if (typeof id !== "string") return undefined;
    const job = ctx.store.getJob(id);
    const source = job?.source;
    if (!job || source?.kind !== "package" || source.package !== station.package) return undefined;
    const repos = ctx.config.lines.map((l) => l.repo);
    return {
      id: job.id,
      line: job.line,
      status: job.status,
      costUsd: job.costUsd,
      budgetUsd: job.budgetUsd,
      waiting: job.status === "waiting",
      ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
      ...(job.reason ? { reason: jobText(withoutSecrets(job.reason, ctx, station), job, repos) } : {}),
      ...(job.delivery ? { delivery: { mode: job.delivery.mode, ...(job.delivery.commit ? { commit: job.delivery.commit } : {}) } } : {}),
    };
  } catch {
    return undefined;
  }
}

/** `ctx.runAgent`: read-only and recorded under the station's name; without an engine or night cap left, the engine is never called. */
function stationAgent(ctx: FactoryContext, runAgent: AgentRunner, station: PackageStation, now: Date, signal: AbortSignal): StationContext["runAgent"] {
  const key = stationKey(station);
  return async <T>(req: { prompt: string; schema?: z.ZodType<T> }): Promise<StationAgentRun<T>> => {
    const refused = (text: string): StationAgentRun<T> => ({ ok: false, text, costUsd: 0 });
    if (signal.aborted) return refused("la pasada ya terminó");
    if (ctx.store.getKv(ANDON_KEY) === "on") return refused("la fábrica está detenida");
    if (!station.instructions) return refused("la estación no declara instrucciones en su manifiesto");
    const own = { engine: station.entry.engine, model: station.entry.model };
    const choice = pickAgentEngine(ctx.store, ctx.config, own, now);
    if (!choice.available) return refused("no hay ningún motor disponible");
    let maxBudgetUsd: number | undefined;
    if (choice.billing !== "subscription") {
      const left = ctx.config.limits.usdPerNight - scoutSpent(ctx.store, periodStart(ctx.config.nightShift, now), now);
      if (left <= 0) return refused("ya se gastó el tope de limits.usdPerNight");
      maxBudgetUsd = Math.round(left * 1e6) / 1e6;
    }
    // No repository and nothing left from another call: what the agent knows is what the station wrote in the prompt.
    const parent = join(ctx.home.jobs, "package-stations", station.package, station.name);
    await mkdir(parent, { recursive: true });
    const cwd = await mkdtemp(join(parent, "run-"));
    try {
      const run = await runAgent<T>({
        station: "scout",
        prompt: req.prompt,
        cwd,
        schema: req.schema,
        engine: { name: choice.engine, model: choice.model, replaces: choice.replaces, reason: choice.reason },
        maxBudgetUsd,
        signal,
        trace: { tracer: ctx.tracer },
        custom: { name: key, instructions: await readFile(station.instructions, "utf8"), access: "read", ...own, maxTurns: station.maxTurns, timeoutMinutes: station.timeoutMinutes, skills: station.skills },
      });
      if (!run.ok) return { ok: false, text: run.text, costUsd: run.costUsd };
      if (!req.schema) return { ok: true, text: run.text, output: run.output, costUsd: run.costUsd };
      // Checked here as well: the guarantee is zero's, whatever the engine validated.
      const parsed = req.schema.safeParse(run.output);
      return parsed.success ? { ok: true, text: run.text, output: parsed.data, costUsd: run.costUsd } : { ok: false, text: `invalid structured output: ${parsed.error.message}`, costUsd: run.costUsd };
    } catch (err) {
      return refused(withoutSecrets(errorText(err), ctx, station));
    } finally {
      await rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  };
}

/** A station's request as it came; reading it runs the station's code when it is not a plain object. */
function readRequest(req: unknown): { line?: unknown; repo?: unknown; text?: unknown; maxUsd?: unknown } {
  try {
    const { line, repo, text, maxUsd } = req as { line?: unknown; repo?: unknown; text?: unknown; maxUsd?: unknown };
    return { line, repo, text, maxUsd };
  } catch {
    return {};
  }
}

/** The line of a package's own repository. */
export const packageLineName = (pkg: string, repo: string) => `${pkg}-${repo}`;

/** The lines a station may see and ask for: the owner's and its own package's, never another package's. */
const visibleLines = (ctx: FactoryContext, station: PackageStation) => ctx.config.lines.filter((l) => !l.package || l.package === station.package);

/** How many jobs the station opened on a line that day; one key per line and station, out of reach of `ctx.state`. */
function requestsUsed(raw: string | undefined, day: string): number {
  if (raw === undefined) return 0;
  const used = JSON.parse(raw) as { day: string; count: number };
  return used.day === day ? used.count : 0;
}

/** `ctx.requestJob`: a third party's way into the line. What it refuses leaves no job and spends no quota. */
function stationRequest(ctx: FactoryContext, station: PackageStation, now: Date, signal: AbortSignal): StationContext["requestJob"] {
  const key = stationKey(station);
  return (req) => {
    try {
      if (signal.aborted) return { reason: "la pasada ya terminó" };
      if (!station.requests) return { reason: "la estación no declara requests en su manifiesto" };
      const asked = readRequest(req);
      const { text, maxUsd } = asked;
      if (asked.line !== undefined && asked.repo !== undefined) return { reason: "el pedido lleva line o repo, no los dos" };
      const line = typeof asked.repo === "string" ? packageLineName(station.package, asked.repo) : asked.line;
      if (typeof line !== "string" || typeof text !== "string") return { reason: "el pedido necesita line (o repo) y text, como texto" };
      const cap = ctx.config.limits.usdPerJob;
      if (maxUsd !== undefined && (typeof maxUsd !== "number" || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > cap)) {
        return { reason: `maxUsd tiene que ser un número mayor que 0 y no mayor que limits.usdPerJob (${cap})` };
      }
      // Another package's line is as unknown to this station as a line that does not exist.
      if (!visibleLines(ctx, station).some((l) => l.name === line)) return { reason: `no existe la línea "${withoutSecrets(line, ctx, station)}"` };
      if (ctx.store.getKv(ANDON_KEY) === "on") return { reason: "la fábrica está detenida" };
      if (budgetState(ctx.store, ctx.config, now).reached) return { reason: "se alcanzó el presupuesto" };
      const quotaKey = `${key}:requests:${line}`;
      const day = startOfDay(now).toISOString();
      const used = requestsUsed(ctx.store.getKv(quotaKey), day);
      if (used >= station.requests.perLinePerDay) return { reason: `ya pidió ${used} de ${station.requests.perLinePerDay} trabajos de hoy en la línea "${line}"` };
      const clean = stationText(text, ctx, station);
      if (!clean) return { reason: "el pedido está vacío" };
      const { job } = requestWork(ctx, { text: clean, line, source: { kind: "package", package: station.package, station: station.name }, budgetUsd: maxUsd });
      ctx.store.setKv(quotaKey, JSON.stringify({ day, count: used + 1 }));
      log.info(`${key} requested a job`, { job: job.id, line });
      return { id: job.id };
    } catch (err) {
      try {
        return { reason: `no se pudo abrir el trabajo: ${publicText(withoutSecrets(errorText(err), ctx, station), ctx.config.lines.map((l) => l.repo)).text}` };
      } catch {
        return { reason: "no se pudo abrir el trabajo" };
      }
    }
  };
}

/** A path segment that names a repository's git folder, also by its Windows short name. */
const gitSegment = (path: string) => path.split(/[\\/]/).some((part) => /^(?:\.git|git~\d+)$/i.test(part));

/** A zip of `dataDir` as a real regular file there, or why not. */
function dataZip(root: string, zip: unknown): { real: string } | { reason: string } {
  if (typeof zip !== "string" || !zip) return { reason: "falta la ruta del zip, como texto" };
  const from = resolve(root, zip);
  if (!isInside(from, root)) return { reason: "el zip tiene que estar en la carpeta de datos del paquete" };
  let real: string;
  try {
    real = realpathSync(from);
  } catch {
    return { reason: "el zip no existe" };
  }
  return isInside(real, root) && statSync(real).isFile() ? { real } : { reason: "el zip tiene que ser un archivo de la carpeta de datos del paquete" };
}

/**
 * `ctx.unzip`: the zip a real regular file of the data folder; the destination inside the data folder or inside one of
 * the package's own repositories, never in their git folder.
 */
async function stationUnzip(dataDir: string, reposDir: string, zip: unknown, dest: unknown): Promise<UnzipOutcome> {
  try {
    if (typeof zip !== "string" || typeof dest !== "string" || !zip || !dest) return { reason: "unzip necesita la ruta del zip y la del destino, como texto" };
    const root = realpathSync(dataDir);
    const source = dataZip(root, zip);
    if ("reason" in source) return source;
    const to = resolve(root, dest);
    let base = root;
    if (!isInside(to, root)) {
      const repos = existsSync(reposDir) ? realpathSync(reposDir) : undefined;
      if (!repos || !isInside(to, repos) || to === repos) return { reason: "el destino tiene que estar en la carpeta de datos del paquete o en uno de sus repositorios" };
      // The repository's own folder is the root: a link on the way to the destination is refused from there.
      base = join(repos, relative(repos, to).split(sep)[0]!);
      if (gitSegment(relative(base, to))) return { reason: "el destino no puede estar en la carpeta .git del repositorio" };
      const r = await unzip(source.real, to, base, { noGit: true });
      return r.ok ? { files: r.files } : { reason: r.reason };
    }
    const r = await unzip(source.real, to, base);
    return r.ok ? { files: r.files } : { reason: r.reason };
  } catch (err) {
    return { reason: `no se pudo descomprimir: ${errorText(err)}` };
  }
}

/** A package's repository name: what `ctx.repos` accepts. */
const REPO_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Where a package's repositories live. */
export const packageReposDir = (home: Pick<FactoryContext["home"], "packageRepos">, pkg: string) => join(home.packageRepos, pkg);

/** How many repositories a station created on a local day; one key per day, out of reach of `ctx.state`. */
const reposKey = (station: PackageStation, day: string) => `${stationKey(station)}:repos:${day}`;

/** A command list as a station gave it, or undefined when it is not one. */
function commands(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((c) => typeof c === "string" && c.trim() !== "") ? [...(value as string[])] : undefined;
}

/** `ctx.repos.*` option objects as they came; reading them runs the station's code when they are not plain objects. */
function readCreate(opts: unknown): { from?: unknown; setup?: unknown; verify?: unknown } {
  try {
    if (opts === undefined) return {};
    const { from, setup, verify } = opts as { from?: unknown; setup?: unknown; verify?: unknown };
    return { from, setup, verify };
  } catch {
    return {};
  }
}

/** Jobs of a line that have not ended. */
const unfinished = (ctx: FactoryContext, line: string) => ctx.store.listJobs({ status: ["queued", "running", "waiting"] }).some((j) => j.line === line);

/** `ctx.repos`: local git repositories with lines of their own, only the station's package's. Never throws. */
function stationRepos(ctx: FactoryContext, station: PackageStation, now: Date, signal: AbortSignal, dataDir: string): StationRepos {
  const key = stationKey(station);
  const reposDir = packageReposDir(ctx.home, station.package);
  const failed = (what: string, err: unknown) => ({ reason: `${what}: ${publicText(withoutSecrets(errorText(err), ctx, station), ctx.config.lines.map((l) => l.repo)).text}` });
  /** The package's own line for a repository name, or why there is none. */
  const own = (name: unknown): { line: LineConfig } | { reason: string } => {
    if (typeof name !== "string" || !REPO_NAME.test(name)) return { reason: "el nombre del repositorio va en minúsculas, dígitos y guiones, hasta 40 caracteres" };
    const line = ctx.config.lines.find((l) => l.name === packageLineName(station.package, name));
    return line && line.package === station.package ? { line } : { reason: `el paquete no tiene un repositorio "${name}"` };
  };
  return {
    create: async (name, opts) => {
      try {
        if (signal.aborted) return { reason: "la pasada ya terminó" };
        if (!station.repositories) return { reason: "la estación no declara repositories en su manifiesto" };
        if (typeof name !== "string" || !REPO_NAME.test(name)) return { reason: "el nombre del repositorio va en minúsculas, dígitos y guiones, hasta 40 caracteres" };
        const asked = readCreate(opts);
        const setup = commands(asked.setup);
        const verify = commands(asked.verify);
        if (!setup || !verify) return { reason: "setup y verify van como listas de comandos" };
        if (asked.from !== undefined && typeof asked.from !== "string") return { reason: "from va como la ruta de un zip de la carpeta de datos" };
        const lineName = packageLineName(station.package, name);
        if (ctx.config.lines.some((l) => l.name === lineName)) return { reason: `ya existe la línea "${lineName}"` };
        const day = localDay(now);
        const used = Number(ctx.store.getKv(reposKey(station, day)) ?? 0) || 0;
        if (used >= station.repositories.perDay) return { reason: `ya creó ${used} de ${station.repositories.perDay} repositorios de hoy` };
        const repo = join(reposDir, name);
        if (existsSync(repo)) return { reason: `ya existe la carpeta del repositorio "${name}"` };
        const source = asked.from === undefined ? undefined : dataZip(realpathSync(dataDir), asked.from);
        if (source && "reason" in source) return source;
        await mkdir(repo, { recursive: true });
        try {
          if (source) {
            const r = await unzip(source.real, repo, realpathSync(repo), { noGit: true });
            if (!r.ok) throw new Refusal(r.reason);
          }
          git(["init", "-q", "-b", "main"], repo);
          // Files go back out in a zip as they came in, whatever this machine's line endings.
          git(["config", "core.autocrlf", "false"], repo);
          git(["add", "-A"], repo);
          git([...FACTORY_IDENTITY, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "--no-verify", "-m", `zero: ${lineName}`], repo);
          await addPackageLine(ctx, { name: lineName, repo, package: station.package, setup, verify });
        } catch (err) {
          await rm(repo, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
          return err instanceof Refusal ? { reason: err.message } : failed("no se pudo crear el repositorio", err);
        }
        // Counted once the line exists: what goes wrong before spends nothing.
        ctx.store.setKv(reposKey(station, day), String(used + 1));
        log.info(`${key} created a repository`, { line: lineName });
        return { ok: true, line: lineName };
      } catch (err) {
        return failed("no se pudo crear el repositorio", err);
      }
    },
    archive: async (name, file) => {
      try {
        if (signal.aborted) return { reason: "la pasada ya terminó" };
        const found = own(name);
        if ("reason" in found) return found;
        if (typeof file !== "string" || !file || !/\.zip$/i.test(file)) return { reason: "el archivo va como una ruta .zip de la carpeta de datos" };
        const root = realpathSync(dataDir);
        const out = resolve(root, file);
        if (!isInside(out, root) || out === root) return { reason: "el archivo tiene que estar en la carpeta de datos del paquete" };
        await mkdir(dirname(out), { recursive: true });
        // Checked after the folder exists: a link on the way could take the file out.
        if (!isInside(realpathSync(dirname(out)), root)) return { reason: "el archivo tiene que estar en la carpeta de datos del paquete" };
        if (existsSync(out) && lstatSync(out).isSymbolicLink()) return { reason: "el archivo no puede ser un enlace" };
        git(["archive", "--format=zip", "-o", out, found.line.baseBranch], found.line.repo);
        return { ok: true, file: relative(root, out).split(sep).join("/") };
      } catch (err) {
        return failed("no se pudo exportar el repositorio", err);
      }
    },
    remove: async (name) => {
      try {
        if (signal.aborted) return { reason: "la pasada ya terminó" };
        const found = own(name);
        if ("reason" in found) return found;
        if (unfinished(ctx, found.line.name)) return { reason: `la línea "${found.line.name}" tiene trabajos sin terminar` };
        await removePackageLine(ctx, { name: found.line.name, package: station.package });
        // Only a folder of this package's repositories goes, whatever the line said.
        const repo = resolve(found.line.repo);
        if (isInside(repo, resolve(reposDir)) && repo !== resolve(reposDir)) await rm(repo, { recursive: true, force: true, maxRetries: 3 });
        log.info(`${key} removed a repository`, { line: found.line.name });
        return { ok: true };
      } catch (err) {
        return failed("no se pudo quitar el repositorio", err);
      }
    },
  };
}

class Refusal extends Error {}

function stationContext(ctx: FactoryContext, runAgent: StationContext["runAgent"], station: PackageStation, config: unknown, now: Date, signal: AbortSignal, upload?: StationUpload): StationContext {
  const key = stationKey(station);
  const stateKey = (name: string) => `${key}:state:${name}`;
  const dataDir = packageDataDir(ctx.home, station.package);
  mkdirSync(dataDir, { recursive: true });
  const clean = (fields?: Record<string, unknown>) => (fields ? (JSON.parse(JSON.stringify(fields, (_k, v: unknown) => (typeof v === "string" ? withoutSecrets(v, ctx, station) : v))) as Record<string, unknown>) : undefined);
  return {
    package: station.package,
    station: station.name,
    now,
    signal,
    config,
    secrets: { get: (name) => (station.secrets.includes(name) ? ctx.secrets.get(name) : undefined) },
    runAgent,
    z,
    log: {
      info: (message, fields) => log.info(`${key}: ${withoutSecrets(message, ctx, station)}`, clean(fields)),
      warn: (message, fields) => log.warn(`${key}: ${withoutSecrets(message, ctx, station)}`, clean(fields)),
    },
    // Read when asked: a repository created in this turn shows up.
    get lines() {
      return visibleLines(ctx, station).map((l) => l.name);
    },
    dataDir,
    state: {
      get: <T>(name: string) => {
        const raw = ctx.store.getKv(stateKey(name));
        return raw === undefined ? undefined : (JSON.parse(raw) as T);
      },
      set: (name, value) => ctx.store.setKv(stateKey(name), JSON.stringify(value)),
    },
    deliveredJobs: (since) => deliveredJobs(ctx, since),
    requestJob: stationRequest(ctx, station, now, signal),
    job: (id) => packageJob(ctx, station, id),
    repos: stationRepos(ctx, station, now, signal, dataDir),
    ...(upload && { upload: { ...upload } }),
    unzip: (zip, dest) => (signal.aborted ? Promise.resolve({ reason: "la pasada ya terminó" }) : stationUnzip(dataDir, packageReposDir(ctx.home, station.package), zip, dest)),
  };
}

/** What sets a station's `pass` and a scheduled pass apart. */
interface StationTurn {
  /** The module's export it runs. */
  hook: "pass" | "scheduled";
  /** How the log names this turn. */
  label: string;
  /** Records that the turn was used; it runs right before the call, and again when time ran out. */
  mark(): void;
  /** Whether a module without the export is normal for this station. */
  optional: boolean;
  /** Runs when the module cannot be imported, lacks the export or refuses its config. */
  failed?(): void;
  /** Runs once when the turn ends, however it ended; `error` is raw, to be cleaned before it is kept. */
  ended?(outcome: StationRunOutcome, error?: string): void;
  call(hook: StationHook, config: unknown, signal: AbortSignal): unknown;
}

/** Stations with a turn under way in this process; the daemon is the only process that runs them. */
const busyStations = new Set<string>();

/** One station's turn; it never throws, and an end by time leaves its signal aborted and the pass behind. A busy station is left alone. */
async function runTurn(ctx: FactoryContext, station: PackageStation, now: Date, turn: StationTurn, outer?: AbortSignal): Promise<void> {
  const key = stationKey(station);
  const missing = station.secrets.filter((s) => !ctx.secrets.has(s));
  if (missing.length) {
    warnOnce(`${key}: no corre porque faltan los secretos ${missing.join(", ")}`);
    return;
  }
  if (busyStations.has(key)) {
    log.info(`${turn.label}: la estación ya está corriendo; espera a la próxima pasada`);
    return;
  }
  busyStations.add(key);
  try {
    await runOwnTurn(ctx, station, turn, outer);
  } finally {
    busyStations.delete(key);
  }
}

async function runOwnTurn(ctx: FactoryContext, station: PackageStation, turn: StationTurn, outer?: AbortSignal): Promise<void> {
  const key = stationKey(station);
  let over = false;
  const ended = (outcome: StationRunOutcome, error?: string) => {
    if (over) return;
    over = true;
    turn.ended?.(outcome, error);
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  const work = (async () => {
    let mod: StationModule;
    try {
      mod = (await import(/* @vite-ignore */ pathToFileURL(station.module).href)) as StationModule;
    } catch (err) {
      warnOnce(`${key}: no corre porque su módulo no se pudo importar: ${withoutSecrets(errorText(err), ctx, station)}`);
      turn.failed?.();
      ended("failed", `su módulo no se pudo importar: ${errorText(err)}`);
      return;
    }
    const hook = mod[turn.hook];
    if (typeof hook !== "function") {
      if (!turn.optional) warnOnce(`${key}: no corre porque su módulo no exporta una función ${turn.hook}`);
      turn.failed?.();
      ended("failed", `su módulo no exporta una función ${turn.hook}`);
      return;
    }
    let config: unknown = station.entry.config;
    if (typeof mod.parseConfig === "function") {
      try {
        config = await mod.parseConfig(config);
      } catch (err) {
        warnOnce(`${key}: no corre porque su configuración no es válida: ${withoutSecrets(errorText(err), ctx, station)}`);
        turn.failed?.();
        ended("failed", `su configuración no es válida: ${errorText(err)}`);
        return;
      }
    }
    // Before running, so a pass that crashes the process or hangs waits for its next period like any other.
    turn.mark();
    log.info(`${turn.label} start`);
    await turn.call(hook as StationHook, config, controller.signal);
    log.info(`${turn.label} done`);
  })();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), station.timeoutMinutes * 60_000);
  });
  const shutdown = new Promise<"shutdown">((done) => {
    if (controller.signal.aborted) done("shutdown");
    else controller.signal.addEventListener("abort", () => done("shutdown"), { once: true });
  });
  try {
    const end = await Promise.race([work.then(() => "done" as const), expired, shutdown]);
    if (end === "timeout") {
      // A module that hangs while importing would otherwise be retried on every idle pass.
      turn.mark();
      log.warn(`${turn.label}: superó su tiempo de ${station.timeoutMinutes} minutos`);
      ended("timeout", `superó su tiempo de ${station.timeoutMinutes} minutos`);
    } else if (end === "shutdown") ended("stopped", "la fábrica se apagó");
    else ended("done");
  } catch (err) {
    log.warn(`${turn.label}: falló`, { error: withoutSecrets(errorText(err), ctx, station) });
    ended("failed", errorText(err));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
    // Whatever it left running is told to stop; it runs in this process, so nothing else can stop it.
    controller.abort();
    work.catch(() => undefined);
  }
}

/** Whether the person in charge asked for a run of this station that has not started yet. */
const pendingOnDemand = (ctx: FactoryContext, station: PackageStation) => station.onDemand && ctx.store.getKv(stationOnDemandKey(station.package, station.name)) !== undefined;

/**
 * A run the person in charge asked for, in its own turn: the period stays as it was, and the request goes right before
 * the call so it never runs twice. The record of the run is written with it, and again when the call ends.
 */
async function runOnDemand(ctx: FactoryContext, runAgent: AgentRunner, station: PackageStation, now: Date, outer?: AbortSignal): Promise<void> {
  const onDemandKey = stationOnDemandKey(station.package, station.name);
  const requestKey = stationOnDemandRequestKey(station.package, station.name);
  const runKey = stationRunKey(station.package, station.name);
  const recordKey = stationOnDemandLastKey(station.package, station.name);
  const clock = () => (ctx.now ?? (() => new Date()))().toISOString();
  const asked = ctx.store.getKv(onDemandKey) ?? now.toISOString();
  const request = ctx.store.getKv(requestKey) || undefined;
  const uploadKey = stationUploadKey(station.package, station.name);
  const upload = readStationUpload(ctx, station.package, station.name);
  const base = { requestedAt: asked, ...(request && { request }) };
  let startedAt: string | undefined;
  const clear = () => {
    ctx.store.deleteKv(onDemandKey);
    ctx.store.deleteKv(requestKey);
    ctx.store.deleteKv(uploadKey);
  };
  const write = (record: OnDemandRecord) => ctx.store.setKv(recordKey, JSON.stringify(record));
  await runTurn(
    ctx,
    station,
    now,
    {
      hook: "pass",
      label: `${stationKey(station)} a demanda`,
      // Called again when time runs out; the run started only once.
      mark: () => {
        clear();
        if (startedAt) return;
        startedAt = clock();
        write({ asked, startedAt });
        ctx.store.setKv(runKey, JSON.stringify({ ...base, startedAt, state: "running" } satisfies StationRunRecord));
      },
      optional: false,
      failed: () => {
        clear();
        write({ asked, endedAt: clock(), outcome: "not-run" });
      },
      ended: (outcome, error) => {
        const finishedAt = clock();
        if (startedAt) write({ asked, startedAt, endedAt: finishedAt, outcome: outcome === "done" ? "ok" : outcome });
        const record: StationRunRecord = { ...base, ...(startedAt && { startedAt }), state: "ended", outcome, finishedAt };
        if (error) record.error = stationText(error, ctx, station, CHARS_PER_TEXT);
        ctx.store.setKv(runKey, JSON.stringify(record));
      },
      call: (hook, config, signal) => hook(stationContext(ctx, stationAgent(ctx, runAgent, station, now, signal), station, config, now, signal, upload), { onDemand: true, ...(request && { request }) }),
    },
    outer,
  );
}

/**
 * The runs the person in charge asked for, whatever the line is doing: they wait for no job, take no job's place and
 * start none themselves. Only the andon, the budget and a missing secret hold a request back, which then stays pending.
 * One at a time; a failure or a hang stays in the log and in the run's record, and the next one still runs.
 */
export async function onDemandPass(ctx: FactoryContext, runAgent: AgentRunner, now: Date, opts: { signal?: AbortSignal } = {}): Promise<void> {
  for (const station of ctx.config.loadedPackages?.stations ?? []) {
    if (!pendingOnDemand(ctx, station)) continue;
    if (opts.signal?.aborted) return;
    if (ctx.store.getKv(ANDON_KEY) === "on") return;
    if (budgetState(ctx.store, ctx.config, now).reached) return;
    await runOnDemand(ctx, runAgent, station, now, opts.signal);
  }
}

/** A station's `pass`, once its `everyMinutes` are over. */
async function runStation(ctx: FactoryContext, runAgent: AgentRunner, station: PackageStation, now: Date, outer?: AbortSignal): Promise<void> {
  const lastKey = stationLastKey(station.package, station.name);
  const last = ctx.store.getKv(lastKey);
  if (last && now.getTime() - Date.parse(last) < station.everyMinutes * 60_000) return;
  await runTurn(
    ctx,
    station,
    now,
    {
      hook: "pass",
      label: stationKey(station),
      mark: () => ctx.store.setKv(lastKey, now.toISOString()),
      optional: station.schedule.length > 0,
      call: (hook, config, signal) => hook(stationContext(ctx, stationAgent(ctx, runAgent, station, now, signal), station, config, now, signal)),
    },
    outer,
  );
}

/** A time of a station's `schedule` on a given local day. */
interface ScheduleSlot {
  at: string;
  day: string;
  time: Date;
}

/** The times not yet run that are still within reach, oldest first; yesterday's count, for a time before midnight. */
function dueSlots(ctx: FactoryContext, station: PackageStation, now: Date): ScheduleSlot[] {
  const today = startOfDay(now);
  const days = [new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), today];
  return station.schedule
    .flatMap((at) => {
      const [hours, minutes] = at.split(":").map(Number) as [number, number];
      const done = ctx.store.getKv(stationScheduleKey(station.package, station.name, at));
      return days.map((d): ScheduleSlot => ({ at, day: localDay(d), time: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes) })).filter((slot) => {
        const late = now.getTime() - slot.time.getTime();
        return late >= 0 && late <= SCHEDULE_REACH_MS && !(done && done >= slot.day);
      });
    })
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

/** `ctx.runAgent` in a scheduled pass: these passes never reach a model, whatever the station does. */
const noAgent: StationContext["runAgent"] = () => {
  throw new Error("ctx.runAgent no está disponible en una pasada con horario: scheduled no puede llamar a un modelo; hacelo en pass");
};

/**
 * The stations' `schedule`, with the factory busy or not: these passes call no
 * model, so neither jobs nor the budget hold them back, only the andon. Each time
 * runs at most once per local day, marked before the call, and only within 2 hours
 * of it. One at a time; a failure or a hang stays in the log and the next one still runs.
 */
export async function scheduledPass(ctx: FactoryContext, now: Date, opts: { signal?: AbortSignal } = {}): Promise<void> {
  for (const station of ctx.config.loadedPackages?.stations ?? []) {
    for (const { at, day } of dueSlots(ctx, station, now)) {
      if (opts.signal?.aborted) return;
      if (ctx.store.getKv(ANDON_KEY) === "on") return;
      await runTurn(
        ctx,
        station,
        now,
        {
          hook: "scheduled",
          label: `${stationKey(station)} ${at}`,
          mark: () => ctx.store.setKv(stationScheduleKey(station.package, station.name, at), day),
          optional: false,
          call: (hook, config, signal) => hook(stationContext(ctx, noAgent, station, config, now, signal), { at }),
        },
        opts.signal,
      );
    }
  }
}

/** Whether some loaded station has a run asked for by the person in charge still pending. */
export function onDemandPending(ctx: FactoryContext): boolean {
  return (ctx.config.loadedPackages?.stations ?? []).some((s) => pendingOnDemand(ctx, s));
}

/**
 * The installed packages' stations, one at a time and each at most once per its
 * `everyMinutes`, only while the factory has nothing else to do. A station with an on-demand
 * run pending waits for `onDemandPass` instead of also running its regular turn. A failure or a
 * hang stays in the log and the next station still runs.
 */
export async function packagesPass(ctx: FactoryContext, runAgent: AgentRunner, now: Date, opts: { signal?: AbortSignal } = {}): Promise<void> {
  for (const station of ctx.config.loadedPackages?.stations ?? []) {
    if (opts.signal?.aborted) return;
    if (ctx.store.getKv(ANDON_KEY) === "on") return;
    if (ctx.store.listJobs({ status: ["queued", "running"], limit: 1 }).length) return;
    if (budgetState(ctx.store, ctx.config, now).reached) return;
    if (pendingOnDemand(ctx, station)) continue;
    await runStation(ctx, runAgent, station, now, opts.signal);
  }
}
