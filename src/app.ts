import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ingestEgress } from "./box/network.js";
import { boxAvailability, readBoxStatus, type BoxStatus } from "./box/status.js";
import { AGENT_ACCESS, agentInstructions, createAgentRunner, type AgentRunner } from "./agent.js";
import type { Access } from "./engines/index.js";
import { availableSkills, resolveSkill, SKILL_STATIONS, skillProblems, skillView, type Skill, type SkillProblem, type SkillStation, type SkillView } from "./skills.js";
import { billedUsd, budgetState, type BudgetState, type PlanWindow } from "./budget.js";
import { githubStatus, type GithubStatus } from "./github-quota.js";
import { daemonLockHeld } from "./daemon-lock.js";
import { AGENT_STATIONS, agentInstructionsPath, editFactory, effectiveLevel, findLine, FIXED_STATIONS, lineAgents, lineAutonomy, NPM_NAME, SiteSchema, type Autonomy, type BoxAvailability, type EffectiveLevel, type FactoryConfig, type LineConfig, type LoadedPackage, type PackageEntry, type PackageProblem, type StationName } from "./config.js";
import { SecretStore } from "./keychain.js";
import { factoryHome, inContainer, type FactoryHome } from "./home.js";
import { cleanText, declaredSecrets, fetchRef, folderLockProblem, lockKey, lockPrint, lockProblemAt, MANIFEST_NOT_A_FILE, manifestAt, manifestNotAFile, npmInstalledVersion, npmSpecProblem, PACKAGE_LOCK, readSeen, realDependencies, realGit, realNpmLatest, recordLookFailed, recordSeen, resolveAndCheckout, runNpm, updateKey, validVersion, widening, widens, type DependencyInstaller, type GitRunner, type NpmLatest } from "./package-install.js";
import { isGitSource, parseGitSource } from "./package-source.js";
import { entryName, factoryConfig, isInside, loadPackages, MANIFEST, packageDataDir, packageFolder, readManifest, withPackages, type PackageManifest } from "./packages.js";
import { readTabData, type TabData, type TabItem } from "./package-tabs.js";
import { answerJob, approveJob, type Decision } from "./line/answer.js";
import { decide, type PolicyDecision, type PolicyEvent } from "./line/policy.js";
import { pendingCleanups } from "./line/cleanup.js";
import { describeDelivery, finalizeJob, rejectedByYou, STOPPED_BY_YOU, type LedgerDeps } from "./line/finish.js";
import { lineRepository } from "./intake/github.js";
import { intakeProblemKey, jiraProblemKey, linearProblemKey, securityAlertsKey, securityAlertsProblemKey } from "./intake/keys.js";
import type { AlertEntry } from "./intake/security-alerts.js";
import { mergeKey, watchedJobs, type MergeState } from "./line/automerge.js";
import { onDemandRecord, readStationRun, stationLastKey, stationOnDemandKey, stationOnDemandRequestKey, stationText, type OnDemandRecord, type StationRunRecord } from "./line/packages.js";
import { drillFiles, runDrill, specPath, type DrillDeps, type DrillResult } from "./line/drill.js";
import { jobStage } from "./line/spec.js";
import { isPriority, PRIORITIES, storedPriority, type JobPriority } from "./priority.js";
import { FINAL_STATUSES, Store, type Job, type JobSource, type JobStatus, type Proposal, type ProposalStatus, type QuestionKind, type ResearchNote, type SpanRow } from "./state/store.js";
import { ageText, formatEgressSites, jobName, jobOrigin } from "./format.js";
import { log } from "./log.js";
import { panelKey, panelLink, rotatePanelKey } from "./panel/key.js";
import { REMOTE_KEY, REMOTE_URL_KEY } from "./panel/tunnel.js";
import { buildLineReport, parseMonth, previousMonth, reportFileName, reportHtml, reportMarkdown, type LineReport, type MonthlyReport } from "./report.js";
import { tryGit } from "./shell.js";
import { AGENT_SPAN, computeMetrics, startOfDay, summarizeEgress, type EgressSummary, type Metrics } from "./telemetry/metrics.js";
import { renderTrace, spanEngineWhy, spanTime, Tracer, traceUsd } from "./telemetry/tracer.js";
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
  const config = await factoryConfig(home);
  await mkdir(home.root, { recursive: true });
  const store = new Store(home.db, now);
  return { home, config, store, tracer: new Tracer(store, now), townhall: openTownhall(home, now), secrets: new SecretStore(home), now };
}

/** The box as the factory last saw it, plus the credentials available now. */
export function currentBox(ctx: FactoryContext): { status?: BoxStatus; availability: BoxAvailability } {
  const status = readBoxStatus(ctx.store);
  return { status, availability: boxAvailability(ctx.config, status, ctx.secrets) };
}

/** In a container, with the box configured and not ready, work waits in the queue instead of moving to local copies next to the secrets. */
export function waitsForBox(ctx: FactoryContext): boolean {
  return inContainer() && ctx.config.isolation === "container" && !currentBox(ctx).availability.ready;
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
  /** Some process holds the daemon lock, even if its heartbeat is stale. Only `factoryStatus` fills it in. */
  lockHeld?: boolean;
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
  if (daemonInfo(ctx.store).alive || daemonLockHeld(ctx.home)) return false;
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

export interface ShutdownResult {
  status: "stopped" | "not-running" | "timeout";
  /** The daemon still running when the wait ran out. */
  pid?: number;
}

/** Asks the daemon to stop and waits until it has really gone: lock released and no live heartbeat left. */
export async function shutdownFactory(ctx: FactoryContext, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<ShutdownResult> {
  const { timeoutMs = 60_000, pollMs = 250 } = opts;
  const now = () => (ctx.now ?? (() => new Date()))();
  const running = () => daemonLockHeld(ctx.home) || daemonInfo(ctx.store, now()).alive;
  if (!running()) return { status: "not-running" };
  ctx.store.setKv(SHUTDOWN_KEY, now().toISOString());
  // On timeout the request stays, so the daemon still stops when it wakes up.
  for (const deadline = Date.now() + timeoutMs; running(); await new Promise((r) => setTimeout(r, pollMs))) {
    if (Date.now() >= deadline) return { status: "timeout", pid: daemonInfo(ctx.store, now()).pid };
  }
  return { status: "stopped" };
}

export interface ProcessEntry {
  pid: number;
  ppid: number;
  command: string;
}

/** The output of the Win32_Process query: one object, or an array of them, or nothing. */
export function parseWindowsProcesses(json: string): ProcessEntry[] {
  if (!json.trim()) return [];
  const rows = [JSON.parse(json) as { ProcessId: number; ParentProcessId: number; CommandLine: string | null }].flat();
  return rows.map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, command: r.CommandLine ?? "" }));
}

/** The output of `ps`: pid, parent pid and the command line, one process per line. */
export function parsePosixProcesses(text: string): ProcessEntry[] {
  return text.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]!.trim() }] : [];
  });
}

/** The machine's processes that could be daemons. Throws when they cannot be listed. */
export function listDaemonCandidates(): ProcessEntry[] {
  const windows = process.platform === "win32";
  const r = windows
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true, timeout: 10_000 })
    : spawnSync("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "args="], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (r.error || r.status !== 0) throw r.error ?? new Error(`process listing exited with ${r.status}`);
  return windows ? parseWindowsProcesses(r.stdout) : parsePosixProcesses(r.stdout);
}

/** `node [flags] <zero entry> start`, and nothing after it: `--detach` only launches, and other commands end soon. */
function isDaemonCommand(command: string): boolean {
  const exe = /^\s*("[^"]+"|\S+)\s*(.*)$/s.exec(command);
  if (!exe || !/^node(\.exe)?$/i.test(exe[1]!.replaceAll('"', "").split(/[\\/]/).pop()!)) return false;
  const args = exe[2]!.replace(/^(?:(?:(?:--import|--require|-r|--loader|--experimental-loader)\s+(?:"[^"]*"|\S+)|-\S+)\s+)*/, "");
  return /^"?(?:[^"]*[\\/])?(?:cli\.js|cli\.ts|cli\.mjs|zero)"?\s+start\s*$/i.test(args);
}

/**
 * The pids of zero daemons on this machine, of any factory: a command line does not say its ZERO_HOME.
 * Never throws: not being able to list them must not get in the way of the status. It starts a process, so only `zero status` calls it.
 */
export function daemonProcesses(list: () => ProcessEntry[] = listDaemonCandidates): number[] {
  try {
    const daemons = list().filter((p) => p.pid !== process.pid && isDaemonCommand(p.command));
    // A development wrapper and the process it runs are one daemon.
    return daemons.filter((p) => !daemons.some((parent) => parent.pid === p.ppid)).map((p) => p.pid);
  } catch (err) {
    log.warn("cannot list processes", { error: String(err) });
    return [];
  }
}

export interface RequestResult {
  job: Job;
  level: EffectiveLevel;
  next: string;
}

/** The kinds of request the panel's "Pedidos" form offers, with the label the factory reads in the request. */
export const REQUEST_TYPES = {
  feature: "función nueva",
  fix: "arreglo",
  security: "seguridad",
  design: "diseño",
  docs: "documentación",
  other: "otro",
} as const;
export type RequestType = keyof typeof REQUEST_TYPES;

/** A typed request's text: title, its type, then the description when there is one. */
function typedRequest(type: string, title = "", description = ""): string {
  if (!Object.hasOwn(REQUEST_TYPES, type)) throw new Error(`Tipo de pedido desconocido: ${type}. Usá ${Object.keys(REQUEST_TYPES).join(", ")}.`);
  const head = title.trim();
  if (!head) throw new Error("El pedido necesita un título.");
  const body = description.trim();
  return `${head}\n\nTipo de pedido: ${REQUEST_TYPES[type as RequestType]}${body ? `\n\n${body}` : ""}`;
}

const PRIORITY_NAMES = PRIORITIES.join(", ");

function checkPriority(name: string): JobPriority {
  if (!isPriority(name)) throw new Error(`No conozco la prioridad "${name}". Las prioridades son: ${PRIORITY_NAMES}.`);
  return name;
}

export function requestWork(
  ctx: FactoryContext,
  input: { text?: string; type?: string; title?: string; description?: string; line?: string; kind?: Job["kind"]; source?: JobSource; priority?: string },
): RequestResult {
  const text = input.type !== undefined ? typedRequest(input.type, input.title, input.description) : (input.text ?? "").trim();
  if (!text) throw new Error("El pedido está vacío.");
  const priority = input.priority === undefined ? undefined : checkPriority(input.priority);
  // Urgent pauses other work, so only the person in charge, asking directly, may choose it.
  if (priority === "urgente" && input.source) throw new Error("Solo vos podés marcar un trabajo como urgente.");
  const line = findLine(ctx.config, input.line);
  const level = currentLevel(ctx);
  const job = ctx.store.createJob({ line: line.name, kind: input.kind ?? "request", request: text, budgetUsd: ctx.config.limits.usdPerJob, source: input.source, priority });
  ctx.tracer.start("zero.job", {
    id: ctx.tracer.jobSpanId(job.id),
    jobId: job.id,
    attrs: {
      "zero.line": line.name,
      "zero.kind": job.kind,
      "zero.level": level.level,
      "zero.priority": storedPriority(job),
      ...((input.source?.kind === "github-issue" || input.source?.kind === "linear-issue" || input.source?.kind === "jira-issue") && { "zero.source": input.source.url }),
      ...(input.source?.kind === "night-shift" && { "zero.night_shift": true, "zero.proposal": input.source.proposal }),
      ...(input.source?.kind === "research" && { "zero.research_note": input.source.note }),
      ...(input.source?.kind === "package" && { "zero.package": `${input.source.package}/${input.source.station}` }),
      ...(input.source?.kind === "security-alert" && { "zero.security_alert": input.source.package, "zero.severity": input.source.severity }),
    },
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

/** Changes the priority of a job that has not finished; the daemon orders by it on its next pass. */
export function setPriority(ctx: FactoryContext, id: string, level: string): Job {
  const priority = checkPriority(level);
  const job = getJob(ctx, id);
  if (FINAL_STATUSES.includes(job.status)) throw new Error(`El trabajo ${id} ya terminó: no se le puede cambiar la prioridad.`);
  return ctx.store.updateJob(id, { priority });
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
  return { job: await finalizeJob(ctx, job, "stopped", { reason: STOPPED_BY_YOU }) };
}

export function resume(ctx: FactoryContext) {
  ctx.store.deleteKv(ANDON_KEY);
}

export interface FactoryStatus {
  level: EffectiveLevel;
  isolation: FactoryConfig["isolation"];
  egressMode: FactoryConfig["egress"]["mode"];
  /** Where Codex runs with `codex.sandbox: off`; absent with the option on or a custom engine named codex. */
  codexUnsandboxed?: "machine" | "box";
  /** Lines taking GitHub issues, and the last problem reaching GitHub. */
  intake: { line: string; label: string; problem?: string }[];
  /** Lines taking Linear issues, and the last problem reaching Linear. */
  linear: { line: string; team: string; label: string; problem?: string }[];
  /** Lines taking Jira issues, and the last problem reaching Jira. */
  jira: { line: string; site: string; project: string; label: string; problem?: string }[];
  /** Open Dependabot alerts per line (only lines with alerts or a read problem), each with the job that handles it. */
  securityAlerts: LineAlerts[];
  /** Pull requests the factory will merge once GitHub says they are ready. */
  merges: { job: string; url: string; status: "waiting" | "blocked"; why?: string }[];
  /** The GitHub quota, only while it is low or the factory's passes are paused. */
  github?: GithubStatus;
  box: { status?: BoxStatus; availability: BoxAvailability };
  /** Jobs wait for the box instead of running in local copies (see waitsForBox). */
  boxWait?: boolean;
  /** Assigned skills that do not resolve; agents run without them. */
  skills: SkillProblem[];
  /** Packages left out, whole or only their stations; the factory works without them. */
  packages: PackageProblem[];
  /** On-demand station runs asked for and not run yet, as `<package>/<station>`. */
  onDemand: { station: string; since: string; request?: string }[];
  /** The last on-demand run of each station, when it started or ended in the last 24 hours or is still running. */
  onDemandRuns: OnDemandRun[];
  /** The last on-demand run of each onDemand station that has one: running, or how it ended. */
  stationRuns: ({ station: string } & StationRunRecord)[];
  /** Work copies of finished jobs that could not be removed yet; the daemon retries them. */
  cleanups: { job: string; path: string; since: string }[];
  daemon: DaemonInfo;
  /** Zero daemons found on the machine; only `zero status` looks for them. */
  daemonProcesses?: number[];
  andon: boolean;
  budget: BudgetState;
  today: Metrics;
  running: Job[];
  queued: Job[];
  waiting: Job[];
  recent: Job[];
}

/** A station's last on-demand run, as `<package>/<station>`; `stale` when it never ended and is past the station's time limit. */
export interface OnDemandRun extends OnDemandRecord {
  station: string;
  stale?: boolean;
}

/** The recorded last on-demand run of each loaded `onDemand` station that started or ended at or after `since`, or still runs. */
export function onDemandRuns(ctx: FactoryContext, since: Date, now: Date): OnDemandRun[] {
  return (ctx.config.loadedPackages?.stations ?? []).flatMap((s) => {
    if (!s.onDemand) return [];
    const record = onDemandRecord(ctx, s.package, s.name);
    if (!record) return [];
    const stale = Boolean(record.startedAt && !record.endedAt && now.getTime() - Date.parse(record.startedAt) > s.timeoutMinutes * 60_000);
    const recent = [record.startedAt, record.endedAt].some((t) => t !== undefined && Date.parse(t) >= since.getTime() && Date.parse(t) <= now.getTime());
    const running = Boolean(record.startedAt && !record.endedAt && !stale);
    if (!recent && !running) return [];
    return [{ station: `${s.package}/${s.name}`, ...record, ...(stale && { stale }) }];
  });
}

/** On-demand station runs asked for and not run yet. */
function pendingOnDemand(ctx: FactoryContext): FactoryStatus["onDemand"] {
  return (ctx.config.loadedPackages?.stations ?? []).flatMap((s) => {
    const since = s.onDemand ? ctx.store.getKv(stationOnDemandKey(s.package, s.name)) : undefined;
    if (since === undefined) return [];
    const request = ctx.store.getKv(stationOnDemandRequestKey(s.package, s.name));
    return [{ station: `${s.package}/${s.name}`, since, ...(request && { request }) }];
  });
}

export interface LineAlerts {
  line: string;
  alerts: (AlertEntry & { jobStatus?: Job["status"] })[];
  problem?: string;
}

/** What the security-alerts pass last saw on each line that reads alerts, with the status of each handling job now. */
export function securityAlerts(ctx: FactoryContext): LineAlerts[] {
  return ctx.config.lines.flatMap((l) => {
    if (l.securityAlerts.mode === "off") return [];
    const problem = ctx.store.getKv(securityAlertsProblemKey(l.name));
    let alerts: AlertEntry[] = [];
    try {
      alerts = JSON.parse(ctx.store.getKv(securityAlertsKey(l.name)) ?? "[]") as AlertEntry[];
    } catch {
      // A broken snapshot is replaced on the next read.
    }
    if (!alerts.length && !problem) return [];
    return [{ line: l.name, alerts: alerts.map((a) => ({ ...a, ...(a.job && { jobStatus: ctx.store.getJob(a.job)?.status }) })), ...(problem && { problem }) }];
  });
}

export function factoryStatus(ctx: FactoryContext): FactoryStatus {
  readGate(ctx);
  const now = (ctx.now ?? (() => new Date()))();
  const box = currentBox(ctx);
  return {
    level: effectiveLevel(ctx.config, box.availability),
    isolation: ctx.config.isolation,
    egressMode: ctx.config.egress.mode,
    ...(ctx.config.codex.sandbox === "off" && !ctx.config.engines.codex && { codexUnsandboxed: ctx.config.isolation === "container" && box.availability.ready ? ("box" as const) : ("machine" as const) }),
    intake: ctx.config.lines.flatMap((l) => (l.issues ? [{ line: l.name, label: l.issues.label, problem: ctx.store.getKv(intakeProblemKey(l.name)) }] : [])),
    linear: ctx.config.lines.flatMap((l) => (l.linear ? [{ line: l.name, team: l.linear.team, label: l.linear.label, problem: ctx.store.getKv(linearProblemKey(l.name)) }] : [])),
    jira: ctx.config.lines.flatMap((l) => (l.jira ? [{ line: l.name, site: l.jira.site, project: l.jira.project, label: l.jira.label, problem: ctx.store.getKv(jiraProblemKey(l.name)) }] : [])),
    securityAlerts: securityAlerts(ctx),
    merges: watchedJobs(ctx).map((job) => {
      const raw = ctx.store.getKv(mergeKey(job.id));
      const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting", why: "esperando la próxima revisión" };
      return { job: job.id, url: job.delivery!.url!, status: state.status === "blocked" ? "blocked" : "waiting", why: state.why };
    }),
    github: githubStatus(ctx.store, now),
    box,
    boxWait: waitsForBox(ctx),
    skills: skillProblems(ctx.config, availableSkills(ctx.config)),
    packages: ctx.config.loadedPackages?.problems ?? [],
    onDemand: pendingOnDemand(ctx),
    onDemandRuns: onDemandRuns(ctx, new Date(now.getTime() - 86_400_000), now),
    stationRuns: (ctx.config.loadedPackages?.stations ?? []).flatMap((s) => {
      const run = s.onDemand ? readStationRun(ctx, s.package, s.name) : undefined;
      return run ? [{ station: `${s.package}/${s.name}`, ...run }] : [];
    }),
    cleanups: pendingCleanups(ctx.store).map(({ job, cleanup }) => ({ job, path: cleanup.path, since: cleanup.since })),
    daemon: { ...daemonInfo(ctx.store, now), lockHeld: daemonLockHeld(ctx.home) },
    andon: ctx.store.getKv(ANDON_KEY) === "on",
    budget: budgetState(ctx.store, ctx.config, now),
    today: computeMetrics(ctx.store, startOfDay(now), now),
    running: ctx.store.listJobs({ status: ["running"] }),
    queued: ctx.store.listJobs({ status: ["queued"] }),
    waiting: ctx.store.listJobs({ status: ["waiting"] }),
    recent: ctx.store.finishedSince(new Date(now.getTime() - 7 * 86_400_000)).slice(-5).reverse(),
  };
}

export interface AgentGuide {
  station: StationName;
  engine: string;
  /** Absent: the engine's own default model. */
  model?: string;
  maxTurns?: number;
  timeoutMinutes: number;
  access: Access;
  instructions: string;
  skills: Pick<AgentSkills, "general" | "lines">;
}

/** What the read-only "Qué es zero" and "Agentes" pages show: configuration only, never a secret. */
export interface FactoryGuide {
  level: EffectiveLevel;
  engine: string;
  limits: { usdPerDay: number; usdPerJob: number; reservePercent: number; protectedPaths: string[] };
  approvals: FactoryConfig["approvals"];
  isolation: FactoryConfig["isolation"];
  box: BoxAvailability;
  boxWait?: boolean;
  /** What each policy event does at the effective level. */
  policy: { event: PolicyEvent; decision: PolicyDecision }[];
  agents: AgentGuide[];
  lines: (Pick<LineConfig, "name" | "repo" | "baseBranch" | "verify" | "integrate" | "autoMerge" | "issues"> & { agents: AgentListEntry[] })[];
}

const POLICY_EVENTS: PolicyEvent[] = ["spec-ready", "before-integrate", "protected-path", "budget-exceeded", "egress-suspicious"];

export async function factoryGuide(ctx: FactoryContext): Promise<FactoryGuide> {
  const cfg = ctx.config;
  const box = currentBox(ctx).availability;
  const level = effectiveLevel(cfg, box);
  // Box problems may name a custom engine's secrets; these pages never show them.
  const names = Object.values(cfg.engines).flatMap((e) => e.secrets);
  const hide = (text: string) => names.reduce((t, n) => t.split(n).join("(credencial)"), text);
  const skills = agentSkills(cfg);
  return {
    level: level.reason ? { ...level, reason: hide(level.reason) } : level,
    engine: cfg.engine,
    limits: { usdPerDay: cfg.limits.usdPerDay, usdPerJob: cfg.limits.usdPerJob, reservePercent: cfg.limits.reservePercent, protectedPaths: cfg.limits.protectedPaths },
    approvals: cfg.approvals,
    isolation: cfg.isolation,
    box,
    boxWait: waitsForBox(ctx),
    policy: POLICY_EVENTS.map((event) => ({ event, decision: decide(level.level, event) })),
    agents: await Promise.all(
      AGENT_STATIONS.map(async (station) => {
        const s = cfg.stations[station];
        const { general, lines } = skills.find((k) => k.station === station) ?? { general: [], lines: [] };
        return {
          station,
          engine: s.engine ?? cfg.engine,
          model: s.model,
          maxTurns: s.maxTurns,
          timeoutMinutes: s.timeoutMinutes,
          access: AGENT_ACCESS[station],
          instructions: await agentInstructions(station),
          skills: { general, lines },
        };
      }),
    ),
    lines: cfg.lines.map(({ name, repo, baseBranch, verify, integrate, autoMerge, issues }) => ({ name, repo, baseBranch, verify, integrate, autoMerge, issues, agents: agentList(ctx, name)[0]!.agents })),
  };
}

export async function briefing(ctx: FactoryContext, days = 1): Promise<Briefing> {
  readGate(ctx);
  const to = (ctx.now ?? (() => new Date()))();
  const from = new Date(to.getTime() - days * 86_400_000);
  const posts = await ctx.townhall.recall({ since: from, limit: Number.MAX_SAFE_INTEGER });
  const unmerged = factoryStatus(ctx).merges.filter((m) => m.status === "blocked");
  const autonomous = (j: Job) => j.source?.kind === "night-shift" && Boolean(j.source.autonomy);
  const finished = ctx.store
    .listJobs({ status: [...FINAL_STATUSES], limit: 10_000 })
    .filter((j) => j.source?.kind === "night-shift" && j.finishedAt && j.finishedAt >= from.toISOString() && j.finishedAt <= to.toISOString())
    .reverse();
  const night = {
    proposals: ctx.store.listProposals({ status: ["pending"], since: from }),
    built: ctx.store.listJobs({ status: ["waiting"], limit: 10_000 }).filter((j) => autonomous(j) && awaitsIntegration(j)),
    integrated: finished.filter((j) => autonomous(j) && j.status === "delivered"),
    jobs: finished.filter((j) => !(autonomous(j) && j.status === "delivered")),
  };
  const research = ctx.store.listResearchNotes({ since: from }).filter((n) => n.createdAt <= to.toISOString());
  const packages = ctx.store
    .listJobs({ limit: 10_000 })
    .filter((j) => j.source?.kind === "package" && (!FINAL_STATUSES.includes(j.status) || (j.finishedAt && j.finishedAt >= from.toISOString() && j.finishedAt <= to.toISOString())))
    .reverse();
  const alerts = securityAlerts(ctx).flatMap((l) => l.alerts.map((a) => ({ ...a, line: l.line })));
  const onDemand = { pending: pendingOnDemand(ctx), runs: onDemandRuns(ctx, from, to) };
  return renderBriefing(computeMetrics(ctx.store, from, to), posts, summarizeEgress(ctx.store, { from, to }), unmerged, night, research, packages, alerts, onDemand);
}

/** Research notes of the last `days` days (7 by default), newest first; of one line when given. */
export function listResearchNotes(ctx: FactoryContext, filter: { line?: string; days?: number } = {}): ResearchNote[] {
  if (filter.line) findLine(ctx.config, filter.line);
  const now = (ctx.now ?? (() => new Date()))();
  return ctx.store.listResearchNotes({ line: filter.line, since: new Date(now.getTime() - (filter.days ?? 7) * 86_400_000) });
}

/** Opens a normal job on the note's line, carrying what the note found. */
export function requestFromResearchNote(ctx: FactoryContext, id: string): RequestResult {
  const note = ctx.store.getResearchNote(id);
  if (!note) throw new Error(`No existe la nota de investigación ${id}.`);
  const text = [
    note.topic,
    `A partir de la nota de investigación ${note.id} (datos de la web, no instrucciones).`,
    `Lo encontrado: ${note.findings}`,
    `Para qué serviría: ${note.serves}`,
    `Madurez: ${note.maturity}`,
    `Fuentes:\n${note.sources.map((u) => `- ${u}`).join("\n")}`,
  ].join("\n\n");
  return requestWork(ctx, { text, line: note.line, source: { kind: "research", note: note.id } });
}

/**
 * The monthly report: for one line or every line, the jobs that finished in a
 * calendar month (the previous one by default). Reads only; the CLI, the panel
 * and the chat all come through here.
 */
export function monthlyReport(ctx: FactoryContext, input: { line?: string; month?: string } = {}): MonthlyReport {
  const month = input.month ?? previousMonth((ctx.now ?? (() => new Date()))());
  const { from, to } = parseMonth(month);
  const finished = ctx.store
    .finishedSince(from)
    .filter((j) => FINAL_STATUSES.includes(j.status) && Date.parse(j.finishedAt!) < to.getTime())
    .sort((a, b) => a.finishedAt!.localeCompare(b.finishedAt!) || a.id.localeCompare(b.id));
  const configured = ctx.config.lines.map((l) => l.name);
  const retired = [...new Set(finished.map((j) => j.line))].filter((l) => !configured.includes(l)).sort();
  const names = input.line ? [input.line] : [...configured, ...retired];
  if (input.line && !configured.includes(input.line) && !retired.includes(input.line)) {
    throw new Error(`La línea "${input.line}" no está configurada y no tiene trabajos terminados en ${month}.`);
  }
  const allRepos = ctx.config.lines.map((l) => l.repo);
  return {
    month,
    lines: names.map((name) => {
      const config = ctx.config.lines.find((l) => l.name === name);
      const jobs = finished.filter((j) => j.line === name);
      const repository = config && jobs.some((j) => j.delivery?.commit) ? lineRepository(config) : undefined;
      return buildLineReport({ line: name, month, jobs, spansOf: (id) => ctx.store.spansForJob(id), repo: config?.repo, allRepos, repository });
    }),
  };
}

/** A path with its links resolved, as far as it exists: a repository's real folder may be spelled differently from ZERO_HOME's. */
function realPath(path: string): string {
  const parent = dirname(path);
  try {
    return realpathSync.native(path);
  } catch {
    return parent === path ? path : join(realPath(parent), basename(path));
  }
}

/** The repository a folder of ZERO_HOME falls inside, a line's or the current folder's, in words; undefined when none. */
function versionedAt(ctx: FactoryContext, folder: string, cwd: string): string | undefined {
  const real = realPath(folder);
  for (const line of ctx.config.lines) {
    if (isInside(real, realPath(line.repo))) return `repositorio de la línea "${line.name}" (${line.repo})`;
  }
  const here = tryGit(["rev-parse", "--show-toplevel"], cwd);
  if (here && isInside(real, realPath(resolve(here)))) return `repositorio de la carpeta actual (${here})`;
  return undefined;
}

/**
 * Saves a report in `<ZERO_HOME>/reports` and returns the file's path. What the
 * factory produces is never versioned, so it refuses to write when that folder
 * falls inside a line's repository or the current folder's.
 */
export function saveReport(ctx: FactoryContext, report: LineReport, format: "md" | "html", cwd = process.cwd()): string {
  const where = versionedAt(ctx, ctx.home.reports, cwd);
  if (where) throw new Error(`No guardé el informe: ${ctx.home.reports} queda dentro del ${where}, y lo que la fábrica produce no se versiona. Mové ZERO_HOME fuera de ese repositorio.`);
  mkdirSync(ctx.home.reports, { recursive: true });
  const path = join(ctx.home.reports, reportFileName(report, format));
  writeFileSync(path, format === "md" ? reportMarkdown(report) : reportHtml(report));
  return path;
}

export interface DrillRequest {
  line: string;
  capability: string;
  patterns: string[];
  /** Spend cap of the agent call; `limits.usdPerJob` when absent. */
  usd?: number;
  /** Keep the working copy (`--conservar`); it is deleted at the end otherwise. */
  keep?: boolean;
}

/**
 * A regeneration drill (see line/drill.ts): rebuilds a line's files from its
 * specification in a copy under `<ZERO_HOME>/drills` and runs the line's tests
 * against it. Every refusal comes before anything is created or spent.
 */
export async function regenerationDrill(ctx: FactoryContext, input: DrillRequest, deps: { runAgent?: AgentRunner; sh?: DrillDeps["sh"]; removeCopy?: DrillDeps["removeCopy"]; cwd?: string } = {}): Promise<DrillResult> {
  const line = ctx.config.lines.find((l) => l.name === input.line);
  if (!line) throw new Error(`No hay una línea llamada "${input.line}". Líneas: ${ctx.config.lines.map((l) => l.name).join(", ") || "(ninguna)"}.`);
  if (ctx.config.isolation === "container") {
    throw new Error("El simulacro de regeneración todavía no corre en la caja de aislamiento (isolation: container); en esta versión solo corre en la máquina, con isolation: worktree.");
  }
  if (ctx.store.getKv(ANDON_KEY) === "on") throw new Error("La fábrica está detenida (andon). Reanudala con zero resume antes del simulacro.");
  const budget = budgetState(ctx.store, ctx.config, ctx.now?.());
  if (budget.reached) throw new Error(`No hay presupuesto para el simulacro: ${budget.reason ?? "se llegó al límite"}.`);
  const cap = ctx.config.limits.usdPerJob;
  const usd = input.usd ?? cap;
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("--usd tiene que ser un número positivo.");
  if (usd > cap) throw new Error(`--usd (${usd}) supera el tope por trabajo (limits.usdPerJob: ${cap}).`);
  if (!line.verify.length) throw new Error(`La línea "${line.name}" no tiene comandos de verify: no habría tests contra los que medir lo regenerado.`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.capability) || tryGit(["cat-file", "-e", `${line.baseBranch}:${specPath(input.capability)}`], line.repo) === undefined) {
    throw new Error(`La capacidad "${input.capability}" no tiene ${specPath(input.capability)} en la rama ${line.baseBranch} de la línea "${line.name}".`);
  }
  const where = versionedAt(ctx, ctx.home.drills, deps.cwd ?? process.cwd());
  if (where) throw new Error(`No hice el simulacro: ${ctx.home.drills} queda dentro del ${where}, y lo que la fábrica produce no se versiona. Mové ZERO_HOME fuera de ese repositorio.`);
  const files = drillFiles(line, input.patterns);
  if (!files.length) throw new Error(`Ningún archivo de código de la rama ${line.baseBranch} coincide con ${input.patterns.join(", ") || "(sin patrones)"}: los tests y lo que está bajo openspec/ nunca se quitan. Indicá qué quitar con --archivos.`);
  const runAgent = deps.runAgent ?? createAgentRunner(ctx.config, { secrets: ctx.secrets });
  return runDrill({ home: ctx.home, config: ctx.config, store: ctx.store, tracer: ctx.tracer, runAgent, sh: deps.sh, now: ctx.now, removeCopy: deps.removeCopy }, { line, capability: input.capability, files, usd, keep: input.keep });
}

/** Status groups of the "Pedidos" list's filter. */
export const REQUEST_FILTERS: Record<"todos" | "activos" | "esperando" | "terminados", JobStatus[] | undefined> = {
  todos: undefined,
  activos: ["queued", "running"],
  esperando: ["waiting"],
  terminados: ["delivered", "failed", "stopped"],
};
export type RequestFilter = keyof typeof REQUEST_FILTERS;
/** Most rows the "Pedidos" list shows. */
export const REQUESTS_VIEW_MAX = 200;

export interface RequestsView {
  lines: string[];
  /** The filter as applied: an unknown line or estado is dropped. */
  line?: string;
  estado: RequestFilter;
  rows: { job: Job; age: string }[];
}

/** The panel's "Pedidos" list: every job (not only the store's first 1000), filtered, newest first, at most 200. */
export function requestsView(ctx: FactoryContext, filter: { line?: string; estado?: string } = {}, now = new Date()): RequestsView {
  const lines = ctx.config.lines.map((l) => l.name);
  const line = filter.line && lines.includes(filter.line) ? filter.line : undefined;
  const estado: RequestFilter = filter.estado && Object.hasOwn(REQUEST_FILTERS, filter.estado) ? (filter.estado as RequestFilter) : "todos";
  const rows = ctx.store
    .listJobs({ line, status: REQUEST_FILTERS[estado], limit: -1 })
    .reverse()
    .slice(0, REQUESTS_VIEW_MAX)
    .map((job) => ({ job, age: ageText(job.createdAt, now) }));
  return { lines, line, estado, rows };
}

/** Notes of the panel's "Investigación" tab, per line. */
export const RESEARCH_VIEW_DAYS = 30;

export interface ResearchLine {
  line: string;
  notes: ResearchNote[];
  /** The same notes, split: those of the line's business skills and the technical ones. */
  business: ResearchNote[];
  technical: ResearchNote[];
}

/** Every configured line (and any line that still has notes) with its research notes of the last 30 days, newest first. */
export function researchView(ctx: FactoryContext, now = new Date()): ResearchLine[] {
  const notes = ctx.store.listResearchNotes({ since: new Date(now.getTime() - RESEARCH_VIEW_DAYS * 86_400_000) });
  const names = [...new Set([...ctx.config.lines.map((l) => l.name), ...notes.map((n) => n.line)])];
  return names.map((line) => {
    const own = notes.filter((n) => n.line === line);
    return { line, notes: own, business: own.filter((n) => n.business), technical: own.filter((n) => !n.business) };
  });
}

/** The monitor's time filter: since local midnight, or the last 7 or 30 days. */
export type MonitorPeriod = "hoy" | "7" | "30";

/** The period a `periodo` parameter asks for; anything else is 7 days. */
export const parsePeriod = (value: string | null | undefined): MonitorPeriod => (value === "hoy" || value === "30" ? value : "7");

export interface MonitorAgent {
  name: string;
  /** Input plus output tokens; absent when no call of the period reported them. */
  tokens?: number;
  costUsd: number;
  workedMs: number;
  calls: number;
  /** Calls ended `ok` over those that ended; absent when none ended. */
  successRate?: number;
  /** Distinct delivered jobs it worked on. */
  deliveries: number;
  engines: string[];
  models: string[];
  lines: string[];
}

export interface MonitorLine {
  line: string;
  jobs: number;
  deliveries: number;
  last?: { id: string; name: string; status: JobStatus };
  openPullRequests: number;
}

export interface MonitorView {
  period: MonitorPeriod;
  since: string;
  /** Jobs created per local day of the period, oldest first. */
  days: { day: string; jobs: number }[];
  /** Jobs created per week, only for the 30-day period. */
  weeks?: { week: string; jobs: number }[];
  created: number;
  delivered: number;
  failed: number;
  stopped: number;
  queued: number;
  /** `running` and `waiting` jobs now. */
  running: number;
  successRate?: number;
  avgJobMs?: number;
  stations: { station: string; avgMs: number; count: number }[];
  avgAttempts?: number;
  plans: PlanWindow[];
  /** Really billed this calendar month, per engine. */
  monthUsd: { engine: string; usd: number }[];
  tokens?: number;
  agents: MonitorAgent[];
  lines: MonitorLine[];
}

/** The fixed agents the monitor always shows, even without activity. */
const MONITOR_AGENTS = ["spec", "build", "verify", "review", "security", "scout", "research"];
const OPEN_PR_GONE = new Set<MergeState["status"]>(["merged", "closed", "expired"]);

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const spanMs = (s: SpanRow) => (s.end ? Math.max(0, Date.parse(s.end) - Date.parse(s.start)) : 0);
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);
const spanTokens = (s: SpanRow) => {
  const input = s.attrs["gen_ai.usage.input_tokens"];
  const output = s.attrs["gen_ai.usage.output_tokens"];
  if (typeof input !== "number" && typeof output !== "number") return undefined;
  return (Number(input) || 0) + (Number(output) || 0);
};
const sumTokens = (spans: SpanRow[]) => {
  const counted = spans.map(spanTokens).filter((n): n is number => n !== undefined);
  return counted.length ? counted.reduce((a, b) => a + b, 0) : undefined;
};

/**
 * The panel's "Monitor" tab: factory totals, plan use, month spend, one card
 * per agent and per line, for a period. Read-only: built from jobs, spans and
 * kv as they are, without asking GitHub or writing anything.
 */
export function monitorView(ctx: FactoryContext, period: MonitorPeriod, now = new Date()): MonitorView {
  const since = period === "hoy" ? startOfDay(now) : new Date(now.getTime() - Number(period) * 86_400_000);
  const after = (iso: string | undefined) => iso !== undefined && Date.parse(iso) >= since.getTime() && Date.parse(iso) <= now.getTime();
  // LIMIT -1 is no limit in SQLite: the monitor counts every job.
  const jobs = ctx.store.listJobs({ limit: -1 });
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const created = jobs.filter((j) => after(j.createdAt));
  const finished = jobs.filter((j) => FINAL_STATUSES.includes(j.status) && after(j.finishedAt));
  const count = (status: JobStatus) => finished.filter((j) => j.status === status).length;
  const delivered = count("delivered");
  const failed = count("failed");

  const days: MonitorView["days"] = [];
  for (let d = startOfDay(since); d <= now; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push({ day: dayKey(d), jobs: 0 });
  for (const j of created) {
    const day = days.find((d) => d.day === dayKey(new Date(j.createdAt)));
    if (day) day.jobs++;
  }
  const weeks = period === "30" ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => {
    const chunk = days.slice(i * 7, i * 7 + 7);
    return { week: chunk[0]!.day, jobs: chunk.reduce((n, d) => n + d.jobs, 0) };
  }) : undefined;

  const spans = ctx.store.spansSinceAny(since).filter((s) => Date.parse(s.start) <= now.getTime());
  const agentSpans = spans.filter((s) => s.name === AGENT_SPAN);
  const stationSpans = spans.filter((s) => s.name.startsWith("zero.station.") && s.end && !s.attrs["zero.skipped"]);
  const stationNames = [...new Set(stationSpans.map((s) => s.name.slice("zero.station.".length)))];

  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthSpans = ctx.store.spansSince(AGENT_SPAN, month);
  const engines = [...new Set([ctx.config.engine, ...monthSpans.map((s) => String(s.attrs["zero.engine"] ?? "")).filter(Boolean)])];

  const card = (name: string, own: SpanRow[]): MonitorAgent => {
    const ended = own.filter((s) => s.status);
    const jobsOf = [...new Set(own.map((s) => s.jobId).filter((id): id is string => !!id))].map((id) => byId.get(id)).filter((j): j is Job => !!j);
    const tokens = sumTokens(own);
    return {
      name,
      ...(tokens !== undefined && { tokens }),
      costUsd: own.reduce((sum, s) => sum + (Number(s.attrs["zero.cost.usd"]) || 0), 0),
      workedMs: own.reduce((sum, s) => sum + spanMs(s), 0),
      calls: own.length,
      ...(ended.length > 0 && { successRate: ended.filter((s) => s.status === "ok").length / ended.length }),
      deliveries: jobsOf.filter((j) => j.status === "delivered").length,
      engines: [...new Set(own.map((s) => String(s.attrs["zero.engine"] ?? "")).filter(Boolean))],
      models: [...new Set(own.map((s) => String(s.attrs["gen_ai.response.model"] ?? s.attrs["gen_ai.request.model"] ?? "")).filter(Boolean))],
      lines: [...new Set(jobsOf.map((j) => j.line))],
    };
  };
  const agentNames = [
    ...new Set([
      ...MONITOR_AGENTS,
      ...ctx.config.lines.flatMap((l) => lineAgents(ctx.config, l).map((a) => a.name)),
      ...agentSpans.map((s) => String(s.attrs["gen_ai.agent.name"] ?? "")).filter(Boolean),
    ]),
  ];
  const avgJobMs = average(finished.filter((j) => j.status !== "stopped").map((j) => Date.parse(j.finishedAt!) - Date.parse(j.createdAt)));
  const tokens = sumTokens(agentSpans);

  return {
    period,
    since: since.toISOString(),
    days,
    ...(weeks && { weeks }),
    created: created.length,
    delivered,
    failed,
    stopped: count("stopped"),
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter((j) => j.status === "running" || j.status === "waiting").length,
    ...(delivered + failed > 0 && { successRate: delivered / (delivered + failed) }),
    ...(avgJobMs !== undefined && { avgJobMs }),
    stations: stationNames.map((station) => {
      const own = stationSpans.filter((s) => s.name === `zero.station.${station}`);
      return { station, avgMs: average(own.map(spanMs))!, count: own.length };
    }),
    ...(finished.length > 0 && { avgAttempts: average(finished.map((j) => j.attempt))! }),
    plans: budgetState(ctx.store, ctx.config, now).windows,
    monthUsd: engines.map((engine) => ({ engine, usd: billedUsd(ctx.store, monthSpans.filter((s) => s.attrs["zero.engine"] === engine), now) })),
    ...(tokens !== undefined && { tokens }),
    agents: agentNames.map((name) =>
      // verify is no agent: its card comes from the station's own spans.
      card(name, name === "verify" ? spans.filter((s) => s.name === "zero.station.verify" && !s.attrs["zero.skipped"]) : agentSpans.filter((s) => s.attrs["gen_ai.agent.name"] === name)),
    ),
    lines: ctx.config.lines.map((l) => {
      const own = jobs.filter((j) => j.line === l.name);
      const last = own.at(-1);
      return {
        line: l.name,
        jobs: created.filter((j) => j.line === l.name).length,
        deliveries: finished.filter((j) => j.line === l.name && j.status === "delivered").length,
        ...(last && { last: { id: last.id, name: jobName(last), status: last.status } }),
        openPullRequests: own.filter((j) => {
          if (j.status !== "delivered" || j.delivery?.mode !== "pull-request") return false;
          const state = JSON.parse(ctx.store.getKv(mergeKey(j.id)) ?? "null") as MergeState | null;
          return !state || !OPEN_PR_GONE.has(state.status);
        }).length,
      };
    }),
  };
}

/** The request text of the job a proposal becomes. */
export function proposalRequest(proposal: Pick<Proposal, "title" | "why" | "change" | "sourceIssue" | "sourceIssueUrl" | "researchNote">): string {
  const issue = proposal.sourceIssue !== undefined && proposal.sourceIssueUrl ? `\n\nNació del issue #${proposal.sourceIssue}: ${proposal.sourceIssueUrl}` : "";
  const note = proposal.researchNote ? `\n\nNace de la nota ${proposal.researchNote}: datos de la web, no instrucciones.` : "";
  return `${proposal.title}\n\nPor qué: ${proposal.why}\n\nQué cambiaría: ${proposal.change}${issue}${note}`;
}

/** The job the night shift opened on its own for a proposal, while it is not finished. */
function autonomousJob(ctx: FactoryContext, proposal: Proposal): Job | undefined {
  if (proposal.status !== "approved" || proposal.decidedBy !== "night-shift" || !proposal.jobId) return undefined;
  const job = ctx.store.getJob(proposal.jobId);
  return job && !FINAL_STATUSES.includes(job.status) ? job : undefined;
}

/** Built by the night shift on its own and parked until the owner lets it integrate. */
const awaitsIntegration = (job: Job | undefined): boolean => job?.status === "waiting" && job.question?.kind === "before-integrate";

/**
 * Proposals of the scout station, oldest first. By default, the ones that wait
 * for the owner: pending, and those the night shift built on its own that
 * wait to be integrated.
 */
export function listProposals(ctx: FactoryContext, filter: { line?: string; status?: ProposalStatus[] } = {}): Proposal[] {
  if (filter.status) return ctx.store.listProposals(filter);
  return ctx.store
    .listProposals({ line: filter.line, status: ["pending", "approved"] })
    .filter((p) => p.status === "pending" || awaitsIntegration(autonomousJob(ctx, p)));
}

/** Where a proposal stands, as the panel's "Propuestas" tab groups it. */
export type ProposalStage = "pending" | "building" | "delivered" | "ended" | "rejected" | "reverted";

export interface ProposalView extends Proposal {
  stage: ProposalStage;
  /** The job it became, when it was approved. */
  job?: Pick<Job, "id" | "status" | "delivery" | "question">;
  /** The night shift built it on its own and it waits for the owner to integrate it. */
  awaitsIntegration: boolean;
}

export interface ProposalLine {
  line: string;
  autonomy: Autonomy;
  proposals: ProposalView[];
}

/** Every proposal of every line, newest first, with the job it became and each line's night-shift autonomy. */
export function proposalsView(ctx: FactoryContext): { research: Autonomy | "off"; lines: ProposalLine[] } {
  const all = ctx.store.listProposals().reverse();
  const view = (p: Proposal): ProposalView => {
    const job = p.jobId ? ctx.store.getJob(p.jobId) : undefined;
    const stage: ProposalStage =
      p.status === "pending" ? "pending" : p.status === "rejected" ? "rejected" : p.status === "reverted" ? "reverted" : !job || !FINAL_STATUSES.includes(job.status) ? "building" : job.status === "delivered" ? "delivered" : "ended";
    return { ...p, stage, job: job && { id: job.id, status: job.status, delivery: job.delivery, question: job.question }, awaitsIntegration: p.decidedBy === "night-shift" && awaitsIntegration(job) };
  };
  const names = [...new Set([...ctx.config.lines.map((l) => l.name), ...all.map((p) => p.line)])];
  return {
    research: ctx.config.research === "off" ? "off" : ctx.config.research.autonomy,
    lines: names.map((name) => {
      const line = ctx.config.lines.find((l) => l.name === name);
      return { line: name, autonomy: line ? lineAutonomy(ctx.config, line) : "propose", proposals: all.filter((p) => p.line === name).map(view) };
    }),
  };
}

function pendingProposal(ctx: FactoryContext, id: string): Proposal {
  const proposal = ctx.store.getProposal(id);
  if (!proposal) throw new Error(`No existe la propuesta ${id}.`);
  if (proposal.status !== "pending") throw new Error(`La propuesta ${id} ya fue ${{ approved: "aprobada", rejected: "rechazada", reverted: "revertida" }[proposal.status]}.`);
  return proposal;
}

/**
 * Turns a pending proposal into a normal job of its line, marked as born from
 * the night shift. On a proposal the night shift already built on its own and
 * parked before integrating, approving lets that job integrate.
 */
export function approveProposal(ctx: FactoryContext, id: string): RequestResult {
  return ctx.store.transaction(() => {
    const proposal = ctx.store.getProposal(id);
    const built = proposal && autonomousJob(ctx, proposal);
    if (built) {
      if (!awaitsIntegration(built)) throw new Error(`La propuesta ${id} ya fue aprobada por el turno nocturno: el trabajo ${built.id} se está construyendo.`);
      const job = approveJob(ctx, built);
      return { job, level: currentLevel(ctx), next: "Vuelve a la cola y se integra según la configuración de la línea." };
    }
    pendingProposal(ctx, id);
    const result = requestWork(ctx, { text: proposalRequest(proposal!), line: proposal!.line, source: { kind: "night-shift", proposal: id } });
    ctx.store.updateProposal(id, { status: "approved", jobId: result.job.id, decidedBy: "owner" });
    return result;
  });
}

/**
 * Archives a pending proposal, with the owner's reason when given, and leaves
 * the lesson in the townhall so scout does not propose it again. On a proposal
 * the night shift took on its own, it also stops that job (its branch is kept).
 */
export async function rejectProposal(ctx: FactoryContext, id: string, note?: string): Promise<Proposal> {
  const reason = note?.trim() || undefined;
  const existing = ctx.store.getProposal(id);
  const built = existing && autonomousJob(ctx, existing);
  if (built) {
    if (built.status === "waiting") await answerJob(ctx, built, "reject", reason);
    else if (built.status === "running") ctx.store.updateJob(built.id, { stopRequested: true });
    else await finalizeJob(ctx, built, "stopped", { reason: rejectedByYou(reason) });
  }
  const proposal = ctx.store.transaction(() => {
    if (!built) pendingProposal(ctx, id);
    if (!ctx.store.updateProposal(id, { status: "rejected", note: reason, ...(built ? { from: "approved" as const } : { decidedBy: "owner" as const }) })) {
      throw new Error(`La propuesta ${id} ya fue decidida.`);
    }
    return ctx.store.getProposal(id)!;
  });
  try {
    await ctx.townhall.publish([{ kind: "lesson", line: proposal.line, topic: "propuesta rechazada", source: "", body: `"${proposal.title}": ${proposal.note ?? "sin motivo"}` }]);
  } catch (err) {
    log.warn("cannot record the rejection in the townhall", { proposal: id, error: String(err) });
  }
  return proposal;
}

export function trace(ctx: FactoryContext, id: string): string {
  const job = getJob(ctx, id);
  readGate(ctx);
  const steps = renderTrace(ctx.store.spansForJob(id)) || "(sin trazas todavía)";
  const egress = summarizeEgress(ctx.store, { job: id, from: new Date(job.createdAt) });
  return egress.connections ? `${steps}

${formatEgressSites(egress)}` : steps;
}

/** The stations of the production line, in the order a job goes through them. */
export const LINE_STATIONS = ["setup", "spec", "build", "verify", "review", "security", "integrate"] as const;
export type LineStation = (typeof LINE_STATIONS)[number];
export type StationState = "pending" | "active" | "done" | "error" | "waiting";

export interface StationView {
  name: LineStation;
  state: StationState;
  /** Why it failed, in one short line. */
  reason?: string;
  /** What `zero trace` says about its last run; absent when it never ran. */
  detail?: { time: string; cost?: string; engines: string[]; error?: string };
}

export interface LineRow {
  id: string;
  line: string;
  title: string;
  /** Who asked for it, when that is worth saying. */
  origin?: string;
  status: JobStatus;
  /** Where the piece is: the station working or waiting, or the one that failed. */
  at?: LineStation;
  attempt: number;
  maxAttempts: number;
  /** What made the factory build again, when this is not the first attempt. */
  retryError?: string;
  /** The stage being built, for an unfinished job whose spec has stages. */
  stage?: { n: number; total: number; title: string };
  delivery?: { text: string; url?: string; merge?: string };
  reason?: string;
  stations: StationView[];
}

export interface ProductionLine {
  counts: { active: number; waiting: number; failed: number; delivered: number };
  rows: LineRow[];
}

/** Where a parked job waits, by the question it asked. */
const WAITING_AT: Partial<Record<QuestionKind, LineStation>> = { "spec-ready": "spec", "before-integrate": "integrate", "integration-blocked": "integrate", "protected-path": "verify" };
const ATTEMPT_STATIONS: readonly LineStation[] = ["build", "verify", "review", "security"];

/** One line, at most `max` characters, for a reason shown inside a station. */
const brief = (text: unknown, max = 140) => {
  const first = String(text ?? "").trim().split("\n")[0]!.trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

/** Each job of `factoryStatus` as a piece on the production line, derived only from its record and its spans. */
export function productionLine(ctx: FactoryContext): ProductionLine {
  const s = factoryStatus(ctx);
  const jobs = [...s.running, ...s.waiting, ...s.queued, ...s.recent];
  return {
    counts: { active: s.running.length + s.queued.length, waiting: s.waiting.length, failed: s.today.failed, delivered: s.today.delivered },
    rows: jobs.map((job) => lineRow(ctx, job)),
  };
}

function lineRow(ctx: FactoryContext, job: Job): LineRow {
  const spans = ctx.store.spansForJob(job.id);
  const maxAttempts = ctx.config.lines.find((l) => l.name === job.line)?.maxAttempts ?? 3;
  const children = new Map<string, SpanRow[]>();
  for (const sp of spans) if (sp.parentId) children.set(sp.parentId, [...(children.get(sp.parentId) ?? []), sp]);
  const descendants = (sp: SpanRow): SpanRow[] => (children.get(sp.id) ?? []).flatMap((c) => [c, ...descendants(c)]);
  const attempts = spans.filter((sp) => sp.name === "zero.attempt");
  const current = attempts.at(-1);
  const last = (station: LineStation) =>
    spans.filter((sp) => sp.name === (station === "setup" ? "zero.setup" : `zero.station.${station}`) && (!ATTEMPT_STATIONS.includes(station) || sp.parentId === current?.id)).at(-1);

  const final = FINAL_STATUSES.includes(job.status);
  const setupOpen = spans.some((sp) => sp.name === "zero.setup" && !sp.end);
  // Until the line view shows a line's custom agents, their pieces sit where they run: those that write at build, the reviewers at security.
  const line = ctx.config.lines.find((l) => l.name === job.line);
  const writing = line && lineAgents(ctx.config, line).some((a) => a.type === "build" && a.name === job.station);
  const station = job.station && ((LINE_STATIONS as readonly string[]).includes(job.station) ? (job.station as LineStation) : writing ? "build" : "security");
  const here: LineStation | undefined = job.status === "waiting" ? (job.question && WAITING_AT[job.question.kind]) ?? station : (station ?? (setupOpen ? "setup" : undefined));
  // The last station an attempt reached carries the attempt's failure, since verify and the reviews end well and report.
  const failedIn = current?.status === "error" ? ATTEMPT_STATIONS.filter((st) => last(st)).at(-1) : undefined;

  const stations = LINE_STATIONS.map((name): StationView => {
    const sp = last(name);
    const below = sp ? descendants(sp) : [];
    const costs = [sp!, ...below].filter((x) => x && typeof x.attrs["zero.cost.usd"] === "number");
    const engines = [...new Set(below.filter((x) => x.attrs["zero.engine"]).map((x) => spanEngineWhy(x.attrs)))];
    const spanError = sp?.status === "error" ? brief(sp.attrs["error.message"] || job.reason) : name === failedIn && final ? brief(current!.attrs["error.message"] || job.reason) : undefined;
    const detail = sp && {
      time: spanTime(sp),
      cost: costs.length ? traceUsd(costs.reduce((sum, x) => sum + (x.attrs["zero.cost.usd"] as number), 0)) : undefined,
      engines,
      error: spanError,
    };
    let state: StationState = "pending";
    if (name === here && job.status === "running") state = "active";
    else if (name === here && job.status === "waiting") state = "waiting";
    else if (spanError) state = "error";
    else if (sp?.status === "ok") state = "done";
    return { name, state, reason: state === "error" ? spanError : undefined, detail };
  });
  // A job that failed without any station span saying so fails where it stood.
  if (job.status === "failed" && !stations.some((st) => st.state === "error") && here) {
    const st = stations.find((x) => x.name === here)!;
    st.state = "error";
    st.reason = brief(job.reason);
  }

  const previous = attempts.filter((a) => a.status === "error" && Number(a.attrs["zero.attempt"]) < job.attempt).at(-1);
  const merge = job.delivery?.mode === "pull-request" ? (JSON.parse(ctx.store.getKv(mergeKey(job.id)) ?? "null") as MergeState | null) : undefined;
  return {
    id: job.id,
    line: job.line,
    title: jobName(job),
    origin: jobOrigin(job),
    status: job.status,
    at: stations.find((st) => st.state === "active" || st.state === "waiting" || st.state === "error")?.name ?? here,
    attempt: job.attempt,
    maxAttempts,
    retryError: job.attempt > 1 ? brief(previous?.attrs["error.message"] || job.feedback) || undefined : undefined,
    stage: final ? undefined : jobStage(job),
    delivery: job.delivery && {
      text: describeDelivery(job.delivery),
      url: job.delivery.url,
      merge: job.delivery.mode === "merge" ? "ya integrado" : merge?.status === "merged" ? "ya fundido" : job.delivery.mode === "pull-request" ? "sin fundir todavía" : undefined,
    },
    reason: job.reason ? brief(job.reason) : undefined,
    stations,
  };
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
          ? `${waitsForBox(ctx) ? "La caja no está lista, así que los trabajos esperan en la cola" : "La caja no está lista, así que los trabajos corren en copias locales y sus salidas no se ven"}: ${box.availability.problems.join("; ")}`
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
  ctx.config = await editConfig(ctx, (doc) => {
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
  ctx.config = await editConfig(ctx, (doc) => doc.setIn(["egress", "mode"], mode));
  return mode === "allowlist"
    ? `Modo allowlist: la caja solo sale a tus sitios permitidos (${ctx.config.egress.allow.join(", ") || "ninguno todavía"}) y a los de tus motores.`
    : "Modo blocklist: la caja sale a todo salvo lo sospechoso y lo que bloquees.";
}

export function lines(config: FactoryConfig) {
  return config.lines.map((l) => ({ name: l.name, repo: l.repo, baseBranch: l.baseBranch, integrate: l.integrate, verify: l.verify }));
}

export interface AgentSkills {
  station: SkillStation;
  general: SkillView[];
  /** Only lines that add skills to this agent. */
  lines: { line: string; skills: SkillView[] }[];
}

/** Read-only: each agent's skills, general and per line, as the panel and the chat show them. */
export function agentSkills(config: FactoryConfig, available: Skill[] = availableSkills(config)): AgentSkills[] {
  return SKILL_STATIONS.map((station) => ({
    station,
    general: config.stations[station].skills.map((s) => skillView(s, available)),
    lines: config.lines.flatMap((l) => {
      const skills = l.stations?.[station]?.skills ?? [];
      return skills.length ? [{ line: l.name, skills: skills.map((s) => skillView(s, available)) }] : [];
    }),
  }));
}

/** What the chat's zero_lines returns: the lines and what each agent is given. */
export function linesWithSkills(config: FactoryConfig) {
  const agents = agentSkills(config);
  return {
    lines: lines(config).map((l) => ({
      ...l,
      skills: Object.fromEntries(agents.flatMap((a) => a.lines.filter((x) => x.line === l.name).map((x) => [a.station, x.skills]))),
    })),
    skills: Object.fromEntries(agents.map((a) => [a.station, a.general])),
  };
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

/** Turns a line's GitHub issue intake on (with its label) or off, keeping the file's comments. */
export async function setIssueIntake(ctx: FactoryContext, input: { line?: string; on: boolean; label?: string }): Promise<{ line: string; label?: string }> {
  const line = findLine(ctx.config, input.line);
  const index = ctx.config.lines.findIndex((l) => l.name === line.name);
  const label = input.on ? (input.label ?? line.issues?.label ?? "zero") : undefined;
  ctx.config = await editConfig(ctx, (doc) => {
    if (label) doc.setIn(["lines", index, "issues"], doc.createNode({ label }));
    else doc.deleteIn(["lines", index, "issues"]);
  });
  return { line: line.name, label };
}

export interface SkillAssignment {
  station: SkillStation;
  line?: string;
  skills: string[];
}

export interface SkillList {
  assignments: SkillAssignment[];
  available: Skill[];
  problems: SkillProblem[];
}

function skillTarget(ctx: FactoryContext, station: string, lineName?: string): { station: SkillStation; path: (string | number)[] } {
  if (!(SKILL_STATIONS as readonly string[]).includes(station)) {
    throw new Error(`No existe el agente "${station}". Agentes: ${SKILL_STATIONS.join(", ")}.`);
  }
  const s = station as SkillStation;
  if (lineName === undefined) return { station: s, path: ["stations", s, "skills"] };
  const index = ctx.config.lines.findIndex((l) => l.name === lineName);
  if (index < 0) throw new Error(`No existe la línea "${lineName}". Líneas: ${ctx.config.lines.map((l) => l.name).join(", ") || "ninguna"}.`);
  return { station: s, path: ["lines", index, "stations", s, "skills"] };
}

function currentSkills(ctx: FactoryContext, station: SkillStation, lineName?: string): string[] {
  if (lineName === undefined) return ctx.config.stations[station].skills;
  return ctx.config.lines.find((l) => l.name === lineName)?.stations?.[station]?.skills ?? [];
}

/** Assigns a skill to an agent, for every line or only one; never from the chat. */
export async function addSkill(ctx: FactoryContext, input: { skill: string; station: string; line?: string }): Promise<string> {
  const skill = input.skill.trim();
  if (!skill) throw new Error("Indicá la skill: zero skill add <skill> --station <agente>");
  const { station, path } = skillTarget(ctx, input.station, input.line);
  const where = input.line ? `${station} en la línea ${input.line}` : `${station} en todas las líneas`;
  const current = currentSkills(ctx, station, input.line);
  if (current.includes(skill)) return `La skill ${skill} ya estaba asignada a ${where}.`;
  ctx.config = await editConfig(ctx, (doc) => doc.setIn(path, doc.createNode([...current, skill])));
  const { problem } = resolveSkill(skill, availableSkills(ctx.config));
  return `Skill ${skill} asignada a ${where}.${problem ? ` Ojo: ${problem}; el agente trabaja sin ella hasta que esté.` : ""}`;
}

export async function removeSkill(ctx: FactoryContext, input: { skill: string; station: string; line?: string }): Promise<string> {
  const { station, path } = skillTarget(ctx, input.station, input.line);
  const where = input.line ? `${station} en la línea ${input.line}` : `${station}`;
  const current = currentSkills(ctx, station, input.line);
  if (!current.includes(input.skill)) return `La skill ${input.skill} no estaba asignada a ${where}.`;
  ctx.config = await editConfig(ctx, (doc) => doc.setIn(path, doc.createNode(current.filter((s) => s !== input.skill))));
  return `Skill ${input.skill} quitada de ${where}.`;
}

export function skillList(ctx: FactoryContext): SkillList {
  const available = availableSkills(ctx.config);
  const assignments: SkillAssignment[] = [];
  for (const station of SKILL_STATIONS) {
    assignments.push({ station, skills: ctx.config.stations[station].skills });
    for (const line of ctx.config.lines) {
      const skills = line.stations?.[station]?.skills ?? [];
      if (skills.length) assignments.push({ station, line: line.name, skills });
    }
  }
  return { assignments, available, problems: skillProblems(ctx.config, available) };
}

/** Edits the factory file and keeps `ctx.config` with what its packages bring. */
async function editConfig(ctx: FactoryContext, edit: Parameters<typeof editFactory>[1]): Promise<FactoryConfig> {
  return withPackages(await editFactory(ctx.home.config, edit), ctx.home);
}

export interface AgentListEntry {
  name: string;
  /** `factory`: a global agent, for every line; `line`: the line's own; `package`: it came with an installed package, for every line. */
  origin: "factory" | "line" | "package";
  /** `build`: it writes, between build and verify. `review`: read-only, after security. */
  type: "review" | "build";
  /** With `build`: it runs only when the change touches one of these globs; empty, on every job. */
  files: string[];
  blocking: boolean;
  /** Where zero reads its instructions. */
  path: string;
  /** True when that file does not exist. */
  missing: boolean;
}

export interface LineAgentList {
  line: string;
  agents: AgentListEntry[];
}

/** The custom agents that apply to each line (or one), in the order they run. */
export function agentList(ctx: FactoryContext, lineName?: string): LineAgentList[] {
  const targets = lineName ? [findLine(ctx.config, lineName)] : ctx.config.lines;
  return targets.map((line) => ({
    line: line.name,
    // Those that write run first, whatever the file's order between the two types.
    agents: [...lineAgents(ctx.config, line).filter((a) => a.type === "build"), ...lineAgents(ctx.config, line).filter((a) => a.type === "review")].map((a) => {
      const path = agentInstructionsPath(a, line.repo, dirname(ctx.home.config));
      return { name: a.name, origin: a.origin, type: a.type, files: a.files, blocking: a.blocking, path, missing: !existsSync(path) };
    }),
  }));
}

const agentTemplate = (name: string, blocking: boolean) => `# Agent: ${name}

You are the "${name}" agent of this project, a read-only reviewer that runs after zero's review and security stations, on the same change. ${blocking ? "Your verified high and critical findings send the change back to build." : "You only report: your findings never stop the change."}

## What to check
- Describe here what this agent looks for in every change (for example accessibility, translations, SEO or documentation).
- Only look at what the change touched, with \`git diff\` against the base branch.

## How to report
- Report each concrete problem once, as a finding with its \`severity\` (\`low\`, \`medium\`, \`high\`, \`critical\`), the exact \`file\` and \`line\`, the \`problem\`, the expected \`fix\` and your \`confidence\` from 1 to 10 that it is real. Findings that cite files or lines that do not exist are discarded, and only findings with confidence 8 or more can block.
- Use \`high\` or \`critical\` only for problems that must be fixed before delivering.
- You are read-only: do not modify anything.
`;

const writerTemplate = (name: string) => `# Agent: ${name}

You are the "${name}" agent of this project. You run after zero's build station and before verify, on the change build committed, and you write in the work copy. What you write goes through verify, protected paths, review and security like the rest of the change.

## What to do
- Describe here the work this agent does on every change (for example translations, accessibility fixes or documentation).
- Only work on what the change touched, with \`git diff\` against the base branch. If it needs nothing from you, change nothing.

## Rules
- Leave your changes uncommitted: zero commits them under your name.
- Do not push, change branches, or touch credentials or CI configuration.
- If you end abnormally, zero discards your changes and the attempt goes back to build.
`;

/**
 * Adds a custom agent to a line: creates its instructions from a template in
 * the line's repository (never overwriting them) and adds it to the factory
 * file, keeping the file's comments.
 */
export async function addAgent(ctx: FactoryContext, input: { name: string; line: string; blocking?: boolean; type?: string; files?: string[] }): Promise<string> {
  const name = input.name.trim();
  const blocking = input.blocking ?? true;
  const type = input.type ?? "review";
  const files = input.files ?? [];
  if (type !== "review" && type !== "build") throw new Error(`El tipo "${type}" no existe: usá review o build.`);
  if (type === "build" && !blocking) throw new Error("Un agente que escribe no puede ser informativo: si falla, falla el intento.");
  if (type === "review" && files.length) throw new Error("--archivos solo vale con --tipo build: un agente de revisión corre en cada trabajo.");
  if (files.some((f) => !f.trim())) throw new Error("Los patrones de --archivos no pueden estar vacíos.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`El nombre "${name}" no sirve para un agente: usá minúsculas, dígitos y guiones.`);
  if ((FIXED_STATIONS as readonly string[]).includes(name)) throw new Error(`"${name}" es una estación fija de zero; elegí otro nombre para el agente.`);
  const line = findLine(ctx.config, input.line);
  if (lineAgents(ctx.config, line).some((a) => a.name === name)) throw new Error(`La línea ${line.name} ya tiene un agente "${name}".`);
  const index = ctx.config.lines.findIndex((l) => l.name === line.name);
  const instructions = `.zero/agents/${name}.md`;
  const path = join(line.repo, instructions);
  await mkdir(dirname(path), { recursive: true });
  let created = true;
  try {
    await writeFile(path, type === "build" ? writerTemplate(name) : agentTemplate(name, blocking), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    created = false;
  }
  const entry = type === "build" ? { name, type, ...(files.length && { files }) } : { name, blocking };
  ctx.config = await editConfig(ctx, (doc) => {
    const node = doc.createNode(entry);
    if (doc.hasIn(["lines", index, "agents"])) doc.addIn(["lines", index, "agents"], node);
    else doc.setIn(["lines", index, "agents"], doc.createNode([entry]));
  });
  const kind = type === "build" ? `tipo build, escribe entre build y verify${files.length ? `, solo si el cambio toca ${files.join(", ")}` : ""}` : blocking ? "bloqueante" : "informativo";
  return `Agente ${name} agregado a la línea ${line.name} (${kind}). ${created ? `Escribí sus instrucciones en ${path}.` : `Usa las instrucciones que ya estaban en ${path}.`}`;
}

/** Takes a custom agent out of a line's configuration; its instructions file stays. */
export async function removeAgent(ctx: FactoryContext, input: { name: string; line: string }): Promise<string> {
  const line = findLine(ctx.config, input.line);
  const index = ctx.config.lines.findIndex((l) => l.name === line.name);
  const at = line.agents.findIndex((a) => a.name === input.name);
  if (at < 0) {
    const packaged = ctx.config.loadedPackages?.agents.find((a) => a.name === input.name);
    if (packaged) return `El agente ${input.name} viene del paquete ${packaged.package}: quitalo con \`zero package remove ${packaged.package}\`.`;
    const global = ctx.config.agents.some((a) => a.name === input.name);
    return global
      ? `El agente ${input.name} es global (vale para todas las líneas): quitalo de \`agents\` en ${ctx.home.config}.`
      : `La línea ${line.name} no tiene un agente ${input.name}.`;
  }
  const path = join(line.repo, line.agents[at]!.instructions);
  ctx.config = await editConfig(ctx, (doc) => doc.deleteIn(["lines", index, "agents", at]));
  return `Agente ${input.name} quitado de la línea ${line.name}. Sus instrucciones siguen en ${path}.`;
}

export interface PackageStationView {
  name: string;
  /** Whether its pass may run: its entry allows the code and its folder is fine. */
  allowed: boolean;
  /** Declared secrets not saved yet, by name; the pass waits for them. */
  missingSecrets: string[];
  lastRun?: string;
  /** When the pending on-demand run was asked for (ISO); only on `onDemand` stations. */
  onDemandPendingSince?: string;
  /** The text sent with the pending on-demand run, when there is one. */
  onDemandRequest?: string;
  /** The station's last on-demand run: running, or how it ended. */
  lastOnDemand?: StationRunRecord;
}

/** A package's tab as the panel's menu links it. */
export interface PackageTabLink {
  package: string;
  name: string;
  title: string;
  href: string;
}

/** The tabs of the loaded packages, in the file's order. */
export function packageTabs(ctx: FactoryContext): PackageTabLink[] {
  return (ctx.config.loadedPackages?.packages ?? []).flatMap((p) =>
    p.tabs.map((t) => ({ package: p.name, name: t.name, title: t.title, href: `/packages/${encodeURIComponent(p.name)}/${encodeURIComponent(t.name)}` })),
  );
}

export interface PackageTabView extends PackageTabLink {
  /** `missing`: the package wrote nothing yet; `invalid`: what it wrote does not pass the schema or the folder's limits. */
  state: TabData["state"];
  /** The manifest's categories, or else those of the items. */
  categories: string[];
  /** The chosen category; absent: all of them. */
  category?: string;
  items: TabItem[];
}

/** A package tab's data, read only through its schema; undefined when the package did not load or does not declare it. */
export function packageTabView(ctx: FactoryContext, pkg: string, tab: string, category?: string): PackageTabView | undefined {
  const p = ctx.config.loadedPackages?.packages.find((x) => x.name === pkg);
  const t = p?.tabs.find((x) => x.name === tab);
  if (!p || !t) return undefined;
  const data = readTabData(packageDataDir(ctx.home, p.name), t);
  const categories = t.categories ?? [...new Set(data.items.flatMap((i) => (i.category ? [i.category] : [])))];
  return {
    package: p.name,
    name: t.name,
    title: t.title,
    href: `/packages/${encodeURIComponent(p.name)}/${encodeURIComponent(t.name)}`,
    state: data.state,
    categories,
    ...(category && { category }),
    items: category ? data.items.filter((i) => i.category === category) : data.items,
  };
}

export interface PackageView extends Pick<LoadedPackage, "name" | "version" | "dir" | "agents" | "skills"> {
  source: "path" | "npm" | "git";
  /** Where it comes from, as the factory file says it. */
  origin: string;
  /** The commit or npm version installed; a folder has none. */
  installed?: string;
  /** What was last seen on the remote, when it differs from `installed`. */
  update?: { seen: string; at: string };
  /** The last look at the remote failed. */
  lookFailed?: { at: string; error: string };
  allowCode: boolean;
  stations: PackageStationView[];
}

export interface PackageList {
  packages: PackageView[];
  problems: PackageProblem[];
}

/** What is installed, what each package brings and what keeps part of it from working; never a secret's value. It only reads what is on record: no network, no git, no npm. */
export function packageList(ctx: FactoryContext): PackageList {
  const loaded = ctx.config.loadedPackages ?? { packages: [], stations: [], problems: [] };
  return {
    problems: loaded.problems,
    packages: loaded.packages.map((p) => {
      const installed = p.entry.git ? p.entry.commit : p.entry.npm ? (npmInstalledVersion(p.dir) ?? p.version) : undefined;
      const seen = installed ? readSeen(ctx.store, p.name) : undefined;
      return {
        name: p.name,
        version: p.version,
        dir: p.dir,
        agents: p.agents,
        skills: p.skills,
        source: p.entry.git ? "git" : p.entry.npm ? "npm" : "path",
        origin: p.entry.git ?? p.entry.npm ?? p.entry.path!,
        ...(installed && { installed }),
        ...(seen?.seen && seen.seen !== installed && { update: { seen: seen.seen, at: seen.at } }),
        ...(seen?.error && { lookFailed: { at: seen.at, error: seen.error } }),
        allowCode: p.entry.allowCode,
        stations: p.stations.map((name) => {
          const station = loaded.stations.find((s) => s.package === p.name && s.name === name);
          const pendingSince = station?.onDemand ? ctx.store.getKv(stationOnDemandKey(p.name, name)) : undefined;
          const pendingRequest = pendingSince !== undefined ? ctx.store.getKv(stationOnDemandRequestKey(p.name, name)) : undefined;
          const lastOnDemand = station?.onDemand ? readStationRun(ctx, p.name, name) : undefined;
          return {
            name,
            allowed: Boolean(station),
            missingSecrets: (station?.secrets ?? []).filter((s) => !ctx.secrets.has(s)),
            lastRun: station && ctx.store.getKv(stationLastKey(p.name, name)),
            ...(pendingSince !== undefined && { onDemandPendingSince: pendingSince }),
            ...(pendingRequest && { onDemandRequest: pendingRequest }),
            ...(lastOnDemand && { lastOnDemand }),
          };
        }),
      };
    }),
  };
}

/** `requestedAt` is the pending request's time, the one its run record will carry. */
export type StationRunResult = { ok: true; text: string; requestedAt: string } | { ok: false; reason: string };

/**
 * Asks the daemon for one run of a station's `pass` as soon as it can, outside its
 * period. Only for stations that declare `onDemand: true`, at most one pending per
 * station; the daemon runs it in its own pass, whatever the line is doing, and keeps every gate.
 */
export function requestStationRun(ctx: FactoryContext, ref: string, now = new Date(), request?: string): StationRunResult {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(ref.trim());
  if (!match) return { ok: false, reason: `"${ref}" no es <paquete>/<estación>` };
  const [, pkg, name] = match as unknown as [string, string, string];
  const loaded = ctx.config.loadedPackages ?? { packages: [], stations: [], problems: [] };
  const known = loaded.packages.find((p) => p.name === pkg);
  if (!known) return { ok: false, reason: `no hay un paquete instalado que se llame "${pkg}"` };
  if (!known.stations.includes(name)) return { ok: false, reason: `el paquete ${pkg} no tiene una estación "${name}"` };
  const station = loaded.stations.find((s) => s.package === pkg && s.name === name);
  if (!station) return { ok: false, reason: `la estación ${pkg}/${name} no puede correr: mirá los problemas en zero package list` };
  if (!station.onDemand) return { ok: false, reason: `la estación ${pkg}/${name} no acepta corridas a demanda: su manifiesto no declara onDemand: true` };
  const key = stationOnDemandKey(pkg, name);
  const pending = ctx.store.getKv(key);
  if (pending !== undefined) return { ok: false, reason: `ya hay una corrida a demanda pendiente de ${pkg}/${name}, pedida el ${pending}` };
  if (ctx.store.getKv(ANDON_KEY) === "on") return { ok: false, reason: "la fábrica está detenida (andon); volvé a pedirla cuando la reanudes" };
  if (budgetState(ctx.store, ctx.config, now).reached) return { ok: false, reason: "se alcanzó el presupuesto" };
  // Cleaned like a station's own request: it reaches third-party code.
  const text = request === undefined ? "" : stationText(request, ctx, station);
  const requestKey = stationOnDemandRequestKey(pkg, name);
  // The text goes first: the daemon reads it only once the request itself is there.
  if (text) ctx.store.setKv(requestKey, text);
  else ctx.store.deleteKv(requestKey);
  const requestedAt = now.toISOString();
  ctx.store.setKv(key, requestedAt);
  return { ok: true, text: `Corrida a demanda de ${pkg}/${name} pedida: corre una vez en la próxima pasada, sin esperar a los trabajos en cola.`, requestedAt };
}

export interface StationWait {
  timeoutMs: number;
  pollMs?: number;
  /** Tests inject it; by default a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Waits until the daemon starts the on-demand run asked for at `requestedAt`
 * (its run record carries that time and a `startedAt`), or the limit passes.
 * Shared by the CLI and the chat, so both answer the same way.
 */
export async function waitStationStart(ctx: FactoryContext, ref: string, requestedAt: string, wait: StationWait): Promise<{ started: boolean; text: string }> {
  const [pkg = "", name = ""] = ref.trim().split("/");
  const sleep = wait.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const pollMs = wait.pollMs ?? 1000;
  let waited = 0;
  for (;;) {
    const run = readStationRun(ctx, pkg, name);
    if (run?.requestedAt === requestedAt && run.startedAt) {
      return { started: true, text: `La corrida a demanda de ${pkg}/${name} empezó (${hourMinute(run.startedAt)}). Mirá su resultado en zero status.` };
    }
    if (waited >= wait.timeoutMs) break;
    const step = Math.min(pollMs, wait.timeoutMs - waited);
    await sleep(step);
    waited += step;
  }
  return { started: false, text: `La corrida a demanda de ${pkg}/${name} sigue pendiente: corre en la próxima pasada del daemon.` };
}

function hourMinute(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Installs a package from npm into `dir`; tests inject a fake. */
export type PackageInstaller = (dir: string, name: string) => Promise<void>;

/** Install scripts never run; what `--ignore-scripts` does not reach, a git dependency, `npmInstall` refuses first. */
export function npmInstallArgs(dir: string, name: string): string[] {
  return ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", dir, name];
}

const npmInstall: PackageInstaller = async (dir, name) => {
  try {
    const problem = await npmSpecProblem(name);
    if (problem) throw new Error(problem);
    await runNpm(npmInstallArgs(dir, name), 600_000);
  } catch (err) {
    throw new Error(`npm no pudo instalar ${name}: ${errorText(err)}`);
  }
};

const looksLikePath = (source: string) => /^[.~/\\]|^[a-z]:/i.test(source) || /[\\]/.test(source) || (source.includes("/") && !source.startsWith("@"));

/** Yes/no for the owner. Without one nobody can consent, so the answer is no. */
type Confirm = (question: string) => Promise<boolean>;
const nobodyConsents: Confirm = async () => false;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const shortSha = (sha: string) => sha.slice(0, 7);

/** Why a package does not load next to the others, reading `packages` from the disk as they are now: it stays out, or it pushes out one that was in. Undefined when all is well. */
function fitProblem(ctx: FactoryContext, packages: PackageEntry[], index: number, name: string): string | undefined {
  const fit = loadPackages({ ...ctx.config, packages }, ctx.home);
  const left = (i: number) => !fit.packages.some((p) => p.index === i);
  if (left(index)) return fit.problems.find((p) => p.package === name)?.reason ?? "no carga junto a los demás paquetes";
  const pushedOut = ctx.config.loadedPackages?.packages.find((p) => left(p.index));
  if (!pushedOut) return undefined;
  const reason = fit.problems.find((p) => p.package === pushedOut.name)?.reason ?? "ya no carga";
  return `deja afuera al paquete ${pushedOut.name}: ${reason}`;
}

/** What a package brings, for the owner to read before it comes in. */
function packageSummary(manifest: PackageManifest, source: string, commit: string, dir: string): string {
  const names = (items: { name: string }[]) => items.map((i) => cleanText(i.name)).join(", ");
  const secrets = declaredSecrets(manifest);
  return [
    `${cleanText(manifest.name)} ${cleanText(manifest.version)}, de ${source} (commit ${shortSha(commit)}), en ${dir}:`,
    `- agentes: ${names(manifest.agents) || "ninguno"}`,
    `- skills: ${manifest.skills.map(cleanText).join(", ") || "ninguna"}`,
    `- estaciones: ${names(manifest.stations) || "ninguna"}`,
    `- secretos que declara: ${secrets.join(", ") || "ninguno"}`,
    manifest.stations.length ? "- pide permiso de código: sí, sus estaciones corren con los permisos de tu usuario si lo das con --permitir-codigo" : "- pide permiso de código: no",
  ].join("\n");
}

/** The closing message of an add: what is there now and what it still needs. */
function addedText(ctx: FactoryContext, name: string, source: string, already: boolean, allowCode: boolean): string {
  const added = ctx.config.loadedPackages?.packages.find((p) => p.name === name);
  const stations = added?.stations ?? [];
  const lines = [`Paquete ${name}${added ? ` ${cleanText(added.version)}` : ""} ${already ? "ya estaba declarado" : "agregado"}.`];
  if (added?.agents.length) lines.push(`Agentes: ${added.agents.join(", ")}.`);
  if (added?.skills.length) lines.push(`Skills: ${added.skills.join(", ")}.`);
  if (stations.length && !allowCode && !added?.entry.allowCode) lines.push(`Sus estaciones (${stations.join(", ")}) no corren hasta que des el permiso: \`zero package add ${source} --permitir-codigo\`. Ese código corre con los permisos de tu usuario, así que dalo solo si confiás en el paquete.`);
  else if (stations.length) lines.push(`Sus estaciones (${stations.join(", ")}) corren con los permisos de tu usuario cuando la fábrica está libre.`);
  for (const p of ctx.config.loadedPackages?.problems ?? []) if (p.package === name && added?.entry.allowCode) lines.push(`Ojo: ${p.reason}.`);
  return lines.join("\n");
}

/** A rename right after git and npm wrote in the folder; on Windows something may still hold it for a moment. */
async function renameFolder(from: string, to: string): Promise<void> {
  for (let tries = 5; ; tries--) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (tries <= 1) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

const removeFolder = (dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 3 });

/**
 * Installs from a git source: a temporary clone inside `packages/git`, the manifest
 * and the fit checked there, the owner's word, and only then its folder, its
 * dependencies and the file. Every way out leaves nothing behind.
 */
async function packageAddGit(ctx: FactoryContext, source: string, input: PackageAddInput): Promise<string> {
  const parsed = parseGitSource(source);
  if ("error" in parsed) throw new Error(`No se puede agregar esa fuente git: ${parsed.error}.`);
  const allowCode = input.allowCode ?? false;
  const declared = ctx.config.packages.findIndex((p) => p.git === source);
  if (declared >= 0) {
    const name = entryName(ctx.config.packages[declared]!, ctx.home);
    ctx.config = await editConfig(ctx, (doc) => {
      if (allowCode) doc.setIn(["packages", declared, "allowCode"], true);
    });
    return addedText(ctx, name, source, true, allowCode);
  }
  const git = input.git ?? realGit;
  const root = join(ctx.home.packages, "git");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".tmp-"));
  let target: string | undefined;
  try {
    await git(["clone", "--no-checkout", "--", parsed.url, temp], { cwd: root });
    const commit = await resolveAndCheckout(git, temp, parsed.ref);
    if (await manifestNotAFile(git, temp, commit)) throw new Error(`No se puede agregar ${source}: ${MANIFEST_NOT_A_FILE}.`);
    let manifest: PackageManifest;
    try {
      manifest = readManifest(temp);
    } catch (err) {
      throw new Error(`No se puede agregar ${source}: ${errorText(err)}`);
    }
    const lock = folderLockProblem(temp);
    if (lock) throw new Error(`No se puede agregar ${source}: ${lock}.`);
    const dir = join(root, manifest.name);
    if (existsSync(dir)) throw new Error(`No se puede agregar ${source}: ya existe la carpeta ${dir} y ningún paquete la declara con esa fuente. Quitala o movela si ya no la usás.`);
    const others = ctx.config.packages;
    const problem = fitProblem(ctx, [...others, { git: source, path: temp, commit, allowCode }], others.length, manifest.name);
    if (problem) throw new Error(`No se puede agregar ${manifest.name}: ${problem}`);
    input.say?.(packageSummary(manifest, source, commit, dir));
    if (!(await (input.confirm ?? nobodyConsents)(`¿Instalo ${manifest.name}?`))) return "No instalé nada.";
    await renameFolder(temp, dir);
    target = dir;
    if (existsSync(join(dir, PACKAGE_LOCK))) await (input.deps ?? realDependencies)(dir);
    ctx.config = await editConfig(ctx, (doc) => {
      const node = { git: source, path: dir, commit, ...(allowCode && { allowCode }) };
      if (doc.hasIn(["packages"])) doc.addIn(["packages"], doc.createNode(node));
      else doc.setIn(["packages"], doc.createNode([node]));
    });
    target = undefined;
    ctx.store.deleteKv(updateKey(manifest.name));
    return addedText(ctx, manifest.name, source, false, allowCode);
  } finally {
    await removeFolder(temp);
    if (target) await removeFolder(target);
  }
}

export interface PackageAddInput {
  source: string;
  allowCode?: boolean;
  install?: PackageInstaller;
  git?: GitRunner;
  deps?: DependencyInstaller;
  confirm?: Confirm;
  /** What the owner reads before answering. */
  say?: (text: string) => void;
}

/**
 * Adds a package to the factory file, keeping its comments. The manifest, and
 * whether it fits among the others, is checked before touching the file. Adding
 * one already declared only updates its permission.
 */
export async function packageAdd(ctx: FactoryContext, input: PackageAddInput): Promise<string> {
  const source = input.source.trim();
  if (!source) throw new Error("Indicá la carpeta, el paquete o el repositorio: zero package add <carpeta|paquete-npm|git>");
  if (isGitSource(source)) return packageAddGit(ctx, source, { ...input, source });
  const folder = looksLikePath(source) || (existsSync(source) && statSync(source).isDirectory());
  if (!folder && !NPM_NAME.test(source)) throw new Error(`"${source}" no es una carpeta ni un nombre válido de paquete npm.`);
  if (!folder) {
    await mkdir(ctx.home.packages, { recursive: true });
    await (input.install ?? npmInstall)(ctx.home.packages, source);
  }
  const allowCode = input.allowCode ?? false;
  const entry: PackageEntry = folder ? { path: resolve(source), allowCode } : { npm: source, allowCode };
  let name: string;
  try {
    name = readManifest(packageFolder(entry, ctx.home)).name;
  } catch (err) {
    throw new Error(`No se puede agregar ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const declared = ctx.config.packages.findIndex((p) => (folder ? p.path && resolve(dirname(ctx.home.config), p.path) === entry.path : p.npm === source));
  if (declared < 0) {
    const others = ctx.config.packages;
    const fit = loadPackages({ ...ctx.config, packages: [...others, entry] }, ctx.home);
    const problem = fit.problems.find((p) => p.package === name || p.package === source);
    if (problem && !fit.packages.some((p) => p.index === others.length)) throw new Error(`No se puede agregar ${name}: ${problem.reason}`);
  }
  ctx.config = await editConfig(ctx, (doc) => {
    if (declared >= 0) {
      if (allowCode) doc.setIn(["packages", declared, "allowCode"], true);
      return;
    }
    const node = { ...(entry.path ? { path: entry.path } : { npm: entry.npm }), ...(allowCode && { allowCode }) };
    if (doc.hasIn(["packages"])) doc.addIn(["packages"], doc.createNode(node));
    else doc.setIn(["packages"], doc.createNode([node]));
  });
  if (declared < 0 && folder) {
    const print = lockPrint(entry.path!);
    if (print) ctx.store.setKv(lockKey(entry.path!), print);
  }
  return addedText(ctx, name, source, declared >= 0, allowCode);
}

/** Takes a package out of the factory file; its files stay. */
export async function packageRemove(ctx: FactoryContext, input: { name: string }): Promise<string> {
  const loaded = ctx.config.loadedPackages?.packages.find((p) => p.name === input.name);
  // A package left out by a problem is still named by its manifest, when that can be read.
  const index = loaded?.index ?? ctx.config.packages.findIndex((p) => p.npm === input.name || p.path === input.name || p.git === input.name || entryName(p, ctx.home) === input.name);
  if (index < 0) return `La fábrica no tiene un paquete ${input.name}.`;
  const dir = loaded?.dir ?? packageFolder(ctx.config.packages[index]!, ctx.home);
  ctx.config = await editConfig(ctx, (doc) => doc.deleteIn(["packages", index]));
  return `Paquete ${input.name} quitado de la fábrica. Sus archivos siguen en ${dir}.`;
}

export interface PackageUpdateInput {
  /** Absent: every package. */
  name?: string;
  git?: GitRunner;
  deps?: DependencyInstaller;
  install?: PackageInstaller;
  latest?: NpmLatest;
  confirm?: Confirm;
  /** Each line of the outcome as it happens; `text` has them all too. */
  say?: (text: string) => void;
  /** Tests inject these: the real start launches `process.argv[1]`. */
  daemon?: { shutdown: () => Promise<ShutdownResult>; start: () => Promise<unknown> };
}

interface UpdateSteps extends PackageUpdateInput {
  git: GitRunner;
  deps: DependencyInstaller;
  say: (text: string) => void;
}

/** What is left to do with the factory off; it throws to report a package that could not be updated. */
type ApplyUpdate = () => Promise<void>;

/** Why zero must not touch this entry's folder; only a clone of its own, clean, inside `packages/git`. */
async function gitFolderProblem(ctx: FactoryContext, git: GitRunner, dir: string): Promise<string | undefined> {
  const root = join(ctx.home.packages, "git");
  let real: string;
  try {
    real = realpathSync(dir);
    if (real === realpathSync(root) || !isInside(real, realpathSync(root))) return `su carpeta ${dir} no está dentro de ${root}, donde zero guarda sus clones`;
  } catch {
    return `su carpeta ${dir} no está dentro de ${root}, donde zero guarda sus clones`;
  }
  const own = join(real, ".git");
  if (!existsSync(own) || !statSync(own).isDirectory() || (await git(["rev-parse", "--show-cdup"], { cwd: real }))) return `su carpeta ${dir} no es la raíz de su propio repositorio git`;
  if (await git(["status", "--porcelain", "--untracked-files=no"], { cwd: real })) return `su carpeta ${dir} tiene cambios locales en archivos versionados; guardalos o descartalos antes de actualizar`;
  return undefined;
}

async function planGitUpdate(ctx: FactoryContext, steps: UpdateSteps, index: number, name: string): Promise<ApplyUpdate | undefined> {
  const { git, deps, say } = steps;
  const entry = ctx.config.packages[index]!;
  const dir = packageFolder(entry, ctx.home);
  const problem = await gitFolderProblem(ctx, git, dir);
  if (problem) throw new Error(`no se actualiza: ${problem}.`);
  const source = parseGitSource(entry.git!);
  if ("error" in source) throw new Error(source.error);
  const run = (args: string[]) => git(args, { cwd: dir });
  const now = (ctx.now ?? (() => new Date()))();
  let to: string;
  try {
    to = await fetchRef(git, dir, source.ref);
  } catch (err) {
    recordLookFailed(ctx.store, name, errorText(err), now);
    throw err;
  }
  recordSeen(ctx.store, name, to, now);
  const from = entry.commit!;
  if (to === from && (await run(["rev-parse", "HEAD"])) === from) {
    say(`${name}: está al día (${shortSha(from)}).`);
    return undefined;
  }
  say(`${name}: de ${shortSha(from)} a ${shortSha(to)}.`);
  const shown = 20;
  const commits = (await run(["log", "--format=%H%x09%s", "-n", String(shown + 1), `${from}..${to}`])).split("\n").filter(Boolean);
  for (const commit of commits.slice(0, shown)) {
    const [sha, ...subject] = commit.split("\t");
    say(`- ${shortSha(sha!)} ${cleanText(subject.join(" "))}`);
  }
  if (commits.length > shown) say(`- y más commits`);
  const ancestor = await run(["merge-base", "--is-ancestor", from, to]).then(() => true, () => false);
  if (!ancestor) say(`Ojo: la historia cambió, ${shortSha(from)} ya no es parte de lo que trae el remoto.`);
  // What it asks for can only be judged on a manifest that can be read: anything else stops here, before asking or touching anything.
  if (await manifestNotAFile(git, dir, to)) throw new Error(`no se aplicó ${shortSha(to)}: ${MANIFEST_NOT_A_FILE}.`);
  const before = await manifestAt(git, dir, from);
  const after = await manifestAt(git, dir, to);
  if (!after) throw new Error(`no se aplicó ${shortSha(to)}: su ${MANIFEST} falta, no es válido o no se pudo leer, así que no se sabe qué pide.`);
  const lock = await lockProblemAt(git, dir, to);
  if (lock) throw new Error(`no se aplicó ${shortSha(to)}: ${lock}.`);
  const wider = widening(before, after);
  const lost = declaredSecrets(before ?? { stations: [] }).filter((s) => !declaredSecrets(after).includes(s));
  if (wider.secrets.length) say(`Secreto nuevo: ${wider.secrets.join(", ")}`);
  if (lost.length) say(`Secreto que ya no declara: ${lost.join(", ")}`);
  if (wider.stations.length) say(`Estación nueva: ${wider.stations.join(", ")}`);
  if (wider.requests.length) say(`Puede pedir más trabajos: ${wider.requests.join(", ")}`);
  if (wider.buildAgents.length) say(`Agente que escribe: ${wider.buildAgents.join(", ")}`);
  if (widens(wider) && !(await (steps.confirm ?? nobodyConsents)(`${name} pide más que antes. ¿Aplico la actualización?`))) {
    say(`${name}: no se aplicó; sigue en ${shortSha(from)}.`);
    return undefined;
  }
  return async () => {
    const hasLock = () => existsSync(join(dir, PACKAGE_LOCK));
    try {
      await run(["checkout", "--detach", to]);
      const manifest = readManifest(dir);
      // The owner's word was about what the commit says; what loads is what is on disk.
      if (!isDeepStrictEqual(manifest, after)) throw new Error(`${MANIFEST} en la carpeta no es el que se mostró`);
      if (before && manifest.name !== before.name) throw new Error(`el commit nuevo le cambia el nombre de "${before.name}" a "${cleanText(manifest.name)}", y eso se hace quitándolo y volviéndolo a agregar`);
      if (hasLock()) await deps(dir);
      const reason = fitProblem(ctx, ctx.config.packages, index, manifest.name);
      if (reason) throw new Error(reason);
      ctx.config = await editConfig(ctx, (doc) => doc.setIn(["packages", index, "commit"], to));
      say(`${name}: actualizado a ${shortSha(to)}.`);
    } catch (err) {
      let back = `volvió a ${shortSha(from)}`;
      try {
        await run(["checkout", "--force", "--detach", from]);
        if (hasLock()) await deps(dir);
      } catch (undo) {
        back = `no pudo terminar de volver a ${shortSha(from)} (${errorText(undo)})`;
      }
      throw new Error(`no se aplicó ${shortSha(to)} y ${back}: ${errorText(err)}`);
    }
  };
}

function planFolderUpdate(ctx: FactoryContext, steps: UpdateSteps, index: number, name: string): ApplyUpdate | undefined {
  const dir = packageFolder(ctx.config.packages[index]!, ctx.home);
  const print = lockPrint(dir);
  if (!print) {
    steps.say(`${name}: está al día (carpeta sin ${PACKAGE_LOCK}).`);
    return undefined;
  }
  if (ctx.store.getKv(lockKey(dir)) === print) {
    steps.say(`${name}: está al día.`);
    return undefined;
  }
  const lock = folderLockProblem(dir);
  if (lock) throw new Error(`no se reinstalan sus dependencias: ${lock}.`);
  steps.say(`${name}: cambió ${PACKAGE_LOCK}, hay que reinstalar sus dependencias.`);
  return async () => {
    await steps.deps(dir);
    ctx.store.setKv(lockKey(dir), print);
    steps.say(`${name}: dependencias reinstaladas.`);
  };
}

async function planNpmUpdate(ctx: FactoryContext, steps: UpdateSteps, index: number, name: string): Promise<ApplyUpdate | undefined> {
  const entry = ctx.config.packages[index]!;
  const npm = entry.npm!;
  const dir = packageFolder(entry, ctx.home);
  const now = (ctx.now ?? (() => new Date()))();
  let version: string;
  try {
    version = await (steps.latest ?? realNpmLatest)(npm);
    if (!validVersion(version)) throw new Error("npm respondió una versión que no se entiende");
  } catch (err) {
    recordLookFailed(ctx.store, name, errorText(err), now);
    throw err;
  }
  recordSeen(ctx.store, name, version, now);
  const installed = npmInstalledVersion(dir) ?? entryVersion(entry, ctx.home);
  if (installed === version) {
    steps.say(`${name}: está al día (${version}).`);
    return undefined;
  }
  steps.say(`${name}: de ${installed ?? "(desconocida)"} a ${version}.`);
  return async () => {
    await (steps.install ?? npmInstall)(ctx.home.packages, `${npm}@${version}`);
    try {
      const reason = fitProblem(ctx, ctx.config.packages, index, readManifest(dir).name);
      if (reason) throw new Error(reason);
      steps.say(`${name}: actualizado a ${version}.`);
    } finally {
      ctx.config = withPackages(ctx.config, ctx.home);
    }
  };
}

const entryVersion = (entry: PackageEntry, home: FactoryHome) => {
  try {
    return readManifest(packageFolder(entry, home)).version;
  } catch {
    return undefined;
  }
};

/**
 * Brings packages up to date. First it only looks: guards, fetch, what changed and
 * the owner's word when a package asks for more than before. With something to
 * apply it turns the factory off once and waits for its process to end (on Windows
 * native modules stay held), applies each package with its own way back, and turns
 * one factory on again only if it was running.
 */
export async function packageUpdate(ctx: FactoryContext, input: PackageUpdateInput = {}): Promise<{ text: string; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  const say = (line: string) => {
    out.push(line);
    input.say?.(line);
  };
  const fail = (line: string) => {
    failed = true;
    say(line);
  };
  const steps: UpdateSteps = { ...input, git: input.git ?? realGit, deps: input.deps ?? realDependencies, say };
  const entries = ctx.config.packages.map((entry, index) => ({ entry, index, name: entryName(entry, ctx.home) }));
  const chosen = input.name === undefined ? entries : entries.filter((e) => [e.name, e.entry.npm, e.entry.git, e.entry.path].includes(input.name));
  if (input.name !== undefined && !chosen.length) fail(`No existe un paquete ${input.name} en la fábrica.`);
  else if (!chosen.length) say("No hay paquetes instalados.");

  const plans: { name: string; apply: ApplyUpdate }[] = [];
  for (const { entry, index, name } of chosen) {
    try {
      const apply = entry.git ? await planGitUpdate(ctx, steps, index, name) : entry.npm ? await planNpmUpdate(ctx, steps, index, name) : planFolderUpdate(ctx, steps, index, name);
      if (apply) plans.push({ name, apply });
    } catch (err) {
      fail(`${name}: ${errorText(err)}`);
    }
  }
  if (!plans.length) return { text: out.join("\n"), failed };

  const daemon = input.daemon ?? { shutdown: () => shutdownFactory(ctx), start: () => ensureDaemon(ctx) };
  const stopped = await daemon.shutdown();
  if (stopped.status === "timeout") {
    fail(`La fábrica sigue en marcha (proceso ${stopped.pid ?? "desconocido"}) y no toqué ningún paquete. El pedido de apagado queda vigente: se va a apagar cuando termine, sin volver a encenderse. Entonces corré \`zero package update\` de nuevo y \`zero start\`.`);
    return { text: out.join("\n"), failed };
  }
  try {
    for (const { name, apply } of plans) {
      try {
        await apply();
      } catch (err) {
        fail(`${name}: ${errorText(err)}`);
      }
    }
  } finally {
    if (stopped.status === "stopped") {
      try {
        await daemon.start();
        say("La fábrica estaba en marcha: la volví a encender.");
      } catch (err) {
        fail(`No pude volver a encender la fábrica: ${errorText(err)}. Encendela con \`zero start\`.`);
      }
    }
  }
  return { text: out.join("\n"), failed };
}
