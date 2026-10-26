import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { effectiveLevel, findLine, loadFactory, type EffectiveLevel, type FactoryConfig } from "./config.js";
import { factoryHome, type FactoryHome } from "./home.js";
import { answerJob, type Decision } from "./line/answer.js";
import { finalizeJob, type LedgerDeps } from "./line/finish.js";
import { FINAL_STATUSES, Store, type Job } from "./state/store.js";
import { computeMetrics, dailyBudgetReached, spentToday, startOfDay, type Metrics } from "./telemetry/metrics.js";
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
}

export async function openFactory(home: FactoryHome = factoryHome(), now?: () => Date): Promise<FactoryContext> {
  const config = await loadFactory(home.config);
  await mkdir(home.root, { recursive: true });
  const store = new Store(home.db, now);
  return { home, config, store, tracer: new Tracer(store, now), townhall: openTownhall(home, now), now };
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
  const level = effectiveLevel(ctx.config);
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
  const now = (ctx.now ?? (() => new Date()))();
  const spentUsd = spentToday(ctx.store, now);
  return {
    level: effectiveLevel(ctx.config),
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
  const to = (ctx.now ?? (() => new Date()))();
  const from = new Date(to.getTime() - days * 86_400_000);
  const posts = await ctx.townhall.recall({ since: from, limit: Number.MAX_SAFE_INTEGER });
  return renderBriefing(computeMetrics(ctx.store, from, to), posts);
}

export function trace(ctx: FactoryContext, id: string): string {
  getJob(ctx, id);
  return renderTrace(ctx.store.spansForJob(id)) || "(sin trazas todavía)";
}

export function lines(config: FactoryConfig) {
  return config.lines.map((l) => ({ name: l.name, repo: l.repo, baseBranch: l.baseBranch, integrate: l.integrate, verify: l.verify }));
}
