import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { ingestEgress } from "./box/network.js";
import { boxAvailability, readBoxStatus, type BoxStatus } from "./box/status.js";
import { editFactory, effectiveLevel, findLine, loadFactory, SiteSchema, type BoxAvailability, type EffectiveLevel, type FactoryConfig } from "./config.js";
import { SecretStore } from "./keychain.js";
import { factoryHome, type FactoryHome } from "./home.js";
import { answerJob, type Decision } from "./line/answer.js";
import { finalizeJob, type LedgerDeps } from "./line/finish.js";
import { FINAL_STATUSES, Store, type Job } from "./state/store.js";
import { formatEgressSites } from "./format.js";
import { log } from "./log.js";
import { panelKey, panelLink, rotatePanelKey } from "./panel/key.js";
import { REMOTE_KEY, REMOTE_URL_KEY } from "./panel/tunnel.js";
import { computeMetrics, dailyBudgetReached, spentToday, startOfDay, summarizeEgress, type EgressSummary, type Metrics } from "./telemetry/metrics.js";
import { renderTrace, Tracer } from "./telemetry/tracer.js";
import { renderBriefing, type Briefing } from "./townhall/briefing.js";
import { createTownhall, resilient, type Townhall } from "./townhall/index.js";
import { createLocalStore } from "./townhall/store.js";

export const DAEMON_KEY = "daemon";
export const ANDON_KEY = "andon";
export const SHUTDOWN_KEY = "shutdown";
const BEAT_FRESH_MS = 15_000;

/** Everything the CLI, the MCP server and the daemon share about one factory. */
export interface FactoryContext extends LedgerDeps {
  home: FactoryHome;
  secrets: SecretStore;
}

export async function openFactory(home: FactoryHome = factoryHome(), now?: () => Date): Promise<FactoryContext> {
  const config = await loadFactory(home.config);
  await mkdir(home.root, { recursive: true });
  const store = new Store(home.db, now);
  return { home, config, store, tracer: new Tracer(store, now), townhall: openTownhall(home, now), secrets: new SecretStore(home), now };
}

/** The box as the factory last saw it, plus the credentials available now. */
export function currentBox(ctx: FactoryContext): { status?: BoxStatus; availability: BoxAvailability } {
  const status = readBoxStatus(ctx.store);
  return { status, availability: boxAvailability(ctx.config, status, ctx.secrets) };
}

export function currentLevel(ctx: FactoryContext): EffectiveLevel {
  return effectiveLevel(ctx.config, currentBox(ctx).availability);
}

export function openTownhall(home: FactoryHome, now?: () => Date): Townhall {
  return resilient(createTownhall(createLocalStore(home.townhall), now));
}

export interface DaemonInfo {
  alive: boolean;
  pid?: number;
  beatAt?: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}

export function daemonInfo(store: Store, now = new Date()): DaemonInfo {
  const raw = store.getKv(DAEMON_KEY);
  if (!raw) return { alive: false };
  const { pid, beatAt } = JSON.parse(raw) as { pid: number; beatAt: string };
  return { alive: now.getTime() - Date.parse(beatAt) < BEAT_FRESH_MS && pidAlive(pid), pid, beatAt };
}

/** Starts the daemon in the background when it is not running. Returns true if it had to start it. */
export async function ensureDaemon(ctx: FactoryContext): Promise<boolean> {
  if (daemonInfo(ctx.store).alive) return false;
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate the zero CLI to start the daemon");
  const log = openSync(ctx.home.daemonLog, "a");
  const child = spawn(process.execPath, [...process.execArgv, entry, "start"], {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
    env: { ...process.env, ZERO_HOME: ctx.home.root },
  });
  child.unref();
  return true;
}

export interface RequestResult {
  job: Job;
  level: EffectiveLevel;
  next: string;
}

export function requestWork(ctx: FactoryContext, input: { text: string; line?: string; kind?: Job["kind"] }): RequestResult {
  const text = input.text.trim();
  if (!text) throw new Error("El pedido está vacío.");
  const line = findLine(ctx.config, input.line);
  const level = currentLevel(ctx);
  const job = ctx.store.createJob({ line: line.name, kind: input.kind ?? "request", request: text, budgetUsd: ctx.config.limits.usdPerJob });
  ctx.tracer.start("zero.job", {
    id: ctx.tracer.jobSpanId(job.id),
    jobId: job.id,
    attrs: { "zero.line": line.name, "zero.kind": job.kind, "zero.level": level.level },
  });
  const integration = { merge: "lo integra en la rama base", branch: "deja una rama lista", "pull-request": "abre una solicitud de cambio" }[line.integrate];
  const next =
    level.level === "L0" || level.level === "L1"
      ? "Primero armo la especificación y te la muestro para que la apruebes."
      : `La fábrica lo especifica, lo construye, lo verifica y ${integration} sola${level.level === "L2" ? "; solo te consulta si toca algo protegido o se agota el presupuesto" : ""}.`;
  return { job, level, next };
}

export function getJob(ctx: FactoryContext, id: string): Job {
  const job = ctx.store.getJob(id);
  if (!job) throw new Error(`No existe el trabajo ${id}.`);
  return job;
}

export async function answer(ctx: FactoryContext, id: string, decision: Decision, note?: string): Promise<Job> {
  return answerJob(ctx, getJob(ctx, id), decision, note);
}

/** The andon cord: stops one job, or the whole factory when no job is given. */
export async function stop(ctx: FactoryContext, id?: string): Promise<{ job?: Job; factory?: boolean }> {
  if (!id) {
    ctx.store.setKv(ANDON_KEY, "on");
    return { factory: true };
  }
  const job = getJob(ctx, id);
  if (FINAL_STATUSES.includes(job.status)) return { job };
  if (job.status === "running") return { job: ctx.store.updateJob(id, { stopRequested: true }) };
  return { job: await finalizeJob(ctx, job, "stopped", { reason: "Detenido por el dueño." }) };
}

export function resume(ctx: FactoryContext) {
  ctx.store.deleteKv(ANDON_KEY);
}

export interface FactoryStatus {
  level: EffectiveLevel;
  isolation: FactoryConfig["isolation"];
  egressMode: FactoryConfig["egress"]["mode"];
  box: { status?: BoxStatus; availability: BoxAvailability };
  daemon: DaemonInfo;
  andon: boolean;
  budget: { spentUsd: number; limitUsd: number; reached: boolean };
  today: Metrics;
  running: Job[];
  queued: Job[];
  waiting: Job[];
  recent: Job[];
}

export function factoryStatus(ctx: FactoryContext): FactoryStatus {
  readGate(ctx);
  const now = (ctx.now ?? (() => new Date()))();
  const spentUsd = spentToday(ctx.store, now);
  const box = currentBox(ctx);
  return {
    level: effectiveLevel(ctx.config, box.availability),
    isolation: ctx.config.isolation,
    egressMode: ctx.config.egress.mode,
    box,
    daemon: daemonInfo(ctx.store, now),
    andon: ctx.store.getKv(ANDON_KEY) === "on",
    budget: { spentUsd, limitUsd: ctx.config.limits.usdPerDay, reached: dailyBudgetReached(spentUsd, ctx.config.limits.usdPerDay) },
    today: computeMetrics(ctx.store, startOfDay(now), now),
    running: ctx.store.listJobs({ status: ["running"] }),
    queued: ctx.store.listJobs({ status: ["queued"] }),
    waiting: ctx.store.listJobs({ status: ["waiting"] }),
    recent: ctx.store.finishedSince(new Date(now.getTime() - 7 * 86_400_000)).slice(-5).reverse(),
  };
}

export async function briefing(ctx: FactoryContext, days = 1): Promise<Briefing> {
  readGate(ctx);
  const to = (ctx.now ?? (() => new Date()))();
  const from = new Date(to.getTime() - days * 86_400_000);
  const posts = await ctx.townhall.recall({ since: from, limit: Number.MAX_SAFE_INTEGER });
  return renderBriefing(computeMetrics(ctx.store, from, to), posts, summarizeEgress(ctx.store, { from, to }));
}

export function trace(ctx: FactoryContext, id: string): string {
  const job = getJob(ctx, id);
  readGate(ctx);
  const steps = renderTrace(ctx.store.spansForJob(id)) || "(sin trazas todavía)";
  const egress = summarizeEgress(ctx.store, { job: id, from: new Date(job.createdAt) });
  return egress.connections ? `${steps}

${formatEgressSites(egress)}` : steps;
}

/** The gate's latest records, so every view is current even when the daemon is off. Never throws. */
export function readGate(ctx: FactoryContext) {
  if (ctx.config.isolation !== "container") return;
  try {
    ingestEgress(ctx.store, ctx.home.gate);
  } catch (err) {
    log.warn("cannot read the egress gate's records", { error: String(err) });
  }
}

export interface EgressReport {
  mode: FactoryConfig["egress"]["mode"];
  from: string;
  to: string;
  job?: string;
  summary: EgressSummary;
  /** Why the gate is not seeing the factory's work right now, if it is not. */
  note?: string;
}

/** What the box reached in the last `days`, or during one job. */
export function egressReport(ctx: FactoryContext, opts: { job?: string; days?: number } = {}): EgressReport {
  const to = (ctx.now ?? (() => new Date()))();
  const job = opts.job ? getJob(ctx, opts.job) : undefined;
  const from = job ? new Date(job.createdAt) : new Date(to.getTime() - (opts.days ?? 1) * 86_400_000);
  readGate(ctx);
  const box = currentBox(ctx);
  const note =
    ctx.config.isolation !== "container"
      ? "Los trabajos corren fuera de la caja (isolation: worktree): sus salidas no pasan por la puerta y no se ven."
      : job && job.isolation === "worktree"
        ? "Este trabajo corrió fuera de la caja: sus salidas no pasaron por la puerta."
        : !box.availability.ready
          ? `La caja no está lista, así que los trabajos corren en copias locales y sus salidas no se ven: ${box.availability.problems.join("; ")}`
          : undefined;
  const summary = summarizeEgress(ctx.store, job ? { job: job.id, from } : { from, to });
  return { mode: ctx.config.egress.mode, from: from.toISOString(), to: to.toISOString(), job: job?.id, summary, note };
}

export type EgressAction = "allow" | "block" | "remove";

/** Puts a site in the allow or block list (taking it out of the other), or out of both. */
export async function setEgressRule(ctx: FactoryContext, input: string, action: EgressAction): Promise<string> {
  const parsed = SiteSchema.safeParse(input);
  if (!parsed.success) throw new Error(`"${input}" no es un sitio válido. Usá un nombre como ejemplo.com o ejemplo.com:8443.`);
  const site = parsed.data;
  const { egress } = ctx.config;
  const listed = egress.allow.includes(site) || egress.block.includes(site);
  ctx.config = await editFactory(ctx.home.config, (doc) => {
    const allow = egress.allow.filter((s) => s !== site);
    const block = egress.block.filter((s) => s !== site);
    if (action === "allow") allow.push(site);
    if (action === "block") block.push(site);
    doc.setIn(["egress", "allow"], doc.createNode(allow));
    doc.setIn(["egress", "block"], doc.createNode(block));
  });
  const next = "Rige desde la próxima ejecución en la caja.";
  if (action === "allow") return `Permitido: la caja puede conectarse a ${site}${ctx.config.egress.mode === "blocklist" ? " aunque parezca sospechoso" : ""}. ${next}`;
  if (action === "block") return `Bloqueado: la caja ya no puede conectarse a ${site}. ${next}`;
  return listed ? `${site} ya no está en tus listas: vale la regla general (modo ${ctx.config.egress.mode}).` : `${site} no estaba en tus listas.`;
}

export async function setEgressMode(ctx: FactoryContext, mode: string): Promise<string> {
  if (mode !== "blocklist" && mode !== "allowlist") throw new Error('El modo es "blocklist" (sale todo salvo lo sospechoso y lo bloqueado) o "allowlist" (solo lo permitido).');
  ctx.config = await editFactory(ctx.home.config, (doc) => doc.setIn(["egress", "mode"], mode));
  return mode === "allowlist"
    ? `Modo allowlist: la caja solo sale a tus sitios permitidos (${ctx.config.egress.allow.join(", ") || "ninguno todavía"}) y a los de tus motores.`
    : "Modo blocklist: la caja sale a todo salvo lo sospechoso y lo que bloquees.";
}

export function lines(config: FactoryConfig) {
  return config.lines.map((l) => ({ name: l.name, repo: l.repo, baseBranch: l.baseBranch, integrate: l.integrate, verify: l.verify }));
}

export interface PanelLinks {
  /** Opens on this machine only. */
  local?: string;
  /** Through the tunnel, when it is open. */
  remote?: string;
  remoteOn: boolean;
}

/** The panel's links, each carrying the key. Whoever has one gets into the factory. */
export function panelLinks(ctx: FactoryContext, opts: { rotate?: boolean } = {}): PanelLinks {
  const key = opts.rotate ? rotatePanelKey(ctx.secrets) : panelKey(ctx.secrets);
  const remoteUrl = ctx.store.getKv(REMOTE_URL_KEY);
  return {
    local: ctx.config.panel.port ? panelLink(`http://127.0.0.1:${ctx.config.panel.port}`, key) : undefined,
    remote: remoteUrl ? panelLink(remoteUrl, key) : undefined,
    remoteOn: ctx.store.getKv(REMOTE_KEY) === "on",
  };
}

/** Asks the daemon to open or close the tunnel to the panel. */
export function setRemotePanel(ctx: FactoryContext, on: boolean) {
  if (on) ctx.store.setKv(REMOTE_KEY, "on");
  else ctx.store.deleteKv(REMOTE_KEY);
}
