import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { ingestEgress } from "./box/network.js";
import { boxAvailability, readBoxStatus, type BoxStatus } from "./box/status.js";
import { AGENT_ACCESS, agentInstructions } from "./agent.js";
import { discoverSkills, resolveSkill, SKILL_STATIONS, skillProblems, skillView, type Skill, type SkillProblem, type SkillStation, type SkillView } from "./skills.js";
import { AGENT_STATIONS, editFactory, effectiveLevel, findLine, loadFactory, SiteSchema, type BoxAvailability, type EffectiveLevel, type FactoryConfig, type LineConfig, type StationName } from "./config.js";
import { SecretStore } from "./keychain.js";
import { factoryHome, type FactoryHome } from "./home.js";
import { answerJob, type Decision } from "./line/answer.js";
import { decide, type PolicyDecision, type PolicyEvent } from "./line/policy.js";
import { describeDelivery, finalizeJob, type LedgerDeps } from "./line/finish.js";
import { intakeProblemKey } from "./intake/keys.js";
import { mergeKey, watchedJobs, type MergeState } from "./line/automerge.js";
import { FINAL_STATUSES, Store, type Job, type JobSource, type JobStatus, type QuestionKind, type SpanRow } from "./state/store.js";
import { formatEgressSites, jobName } from "./format.js";
import { log } from "./log.js";
import { panelKey, panelLink, rotatePanelKey } from "./panel/key.js";
import { REMOTE_KEY, REMOTE_URL_KEY } from "./panel/tunnel.js";
import { computeMetrics, dailyBudgetReached, spentToday, startOfDay, summarizeEgress, type EgressSummary, type Metrics } from "./telemetry/metrics.js";
import { renderTrace, spanEngine, spanTime, Tracer, traceUsd } from "./telemetry/tracer.js";
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

export function requestWork(ctx: FactoryContext, input: { text: string; line?: string; kind?: Job["kind"]; source?: JobSource }): RequestResult {
  const text = input.text.trim();
  if (!text) throw new Error("El pedido está vacío.");
  const line = findLine(ctx.config, input.line);
  const level = currentLevel(ctx);
  const job = ctx.store.createJob({ line: line.name, kind: input.kind ?? "request", request: text, budgetUsd: ctx.config.limits.usdPerJob, source: input.source });
  ctx.tracer.start("zero.job", {
    id: ctx.tracer.jobSpanId(job.id),
    jobId: job.id,
    attrs: { "zero.line": line.name, "zero.kind": job.kind, "zero.level": level.level, ...(input.source && { "zero.source": input.source.url }) },
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
  /** Lines taking GitHub issues, and the last problem reaching GitHub. */
  intake: { line: string; label: string; problem?: string }[];
  /** Pull requests the factory will merge once GitHub says they are ready. */
  merges: { job: string; url: string; status: "waiting" | "blocked"; why?: string }[];
  box: { status?: BoxStatus; availability: BoxAvailability };
  /** Assigned skills that do not resolve; agents run without them. */
  skills: SkillProblem[];
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
    intake: ctx.config.lines.flatMap((l) => (l.issues ? [{ line: l.name, label: l.issues.label, problem: ctx.store.getKv(intakeProblemKey(l.name)) }] : [])),
    merges: watchedJobs(ctx).map((job) => {
      const raw = ctx.store.getKv(mergeKey(job.id));
      const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting", why: "esperando la próxima revisión" };
      return { job: job.id, url: job.delivery!.url!, status: state.status === "blocked" ? "blocked" : "waiting", why: state.why };
    }),
    box,
    skills: skillProblems(ctx.config, discoverSkills()),
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

export interface AgentGuide {
  station: StationName;
  engine: string;
  /** Absent: the engine's own default model. */
  model?: string;
  maxTurns?: number;
  timeoutMinutes: number;
  access: "read" | "write";
  instructions: string;
  skills: Pick<AgentSkills, "general" | "lines">;
}

/** What the read-only "Qué es zero" and "Agentes" pages show: configuration only, never a secret. */
export interface FactoryGuide {
  level: EffectiveLevel;
  engine: string;
  limits: { usdPerDay: number; usdPerJob: number; protectedPaths: string[] };
  approvals: FactoryConfig["approvals"];
  isolation: FactoryConfig["isolation"];
  box: BoxAvailability;
  /** What each policy event does at the effective level. */
  policy: { event: PolicyEvent; decision: PolicyDecision }[];
  agents: AgentGuide[];
  lines: Pick<LineConfig, "name" | "repo" | "baseBranch" | "verify" | "integrate" | "autoMerge" | "issues">[];
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
    limits: { usdPerDay: cfg.limits.usdPerDay, usdPerJob: cfg.limits.usdPerJob, protectedPaths: cfg.limits.protectedPaths },
    approvals: cfg.approvals,
    isolation: cfg.isolation,
    box,
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
    lines: cfg.lines.map(({ name, repo, baseBranch, verify, integrate, autoMerge, issues }) => ({ name, repo, baseBranch, verify, integrate, autoMerge, issues })),
  };
}

export async function briefing(ctx: FactoryContext, days = 1): Promise<Briefing> {
  readGate(ctx);
  const to = (ctx.now ?? (() => new Date()))();
  const from = new Date(to.getTime() - days * 86_400_000);
  const posts = await ctx.townhall.recall({ since: from, limit: Number.MAX_SAFE_INTEGER });
  const unmerged = factoryStatus(ctx).merges.filter((m) => m.status === "blocked");
  return renderBriefing(computeMetrics(ctx.store, from, to), posts, summarizeEgress(ctx.store, { from, to }), unmerged);
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
  status: JobStatus;
  /** Where the piece is: the station working or waiting, or the one that failed. */
  at?: LineStation;
  attempt: number;
  maxAttempts: number;
  /** What made the factory build again, when this is not the first attempt. */
  retryError?: string;
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
  const here: LineStation | undefined = job.status === "waiting" ? (job.question && WAITING_AT[job.question.kind]) ?? job.station : (job.station ?? (setupOpen ? "setup" : undefined));
  // The last station an attempt reached carries the attempt's failure, since verify and the reviews end well and report.
  const failedIn = current?.status === "error" ? ATTEMPT_STATIONS.filter((st) => last(st)).at(-1) : undefined;

  const stations = LINE_STATIONS.map((name): StationView => {
    const sp = last(name);
    const below = sp ? descendants(sp) : [];
    const costs = [sp!, ...below].filter((x) => x && typeof x.attrs["zero.cost.usd"] === "number");
    const engines = [...new Set(below.filter((x) => x.attrs["zero.engine"]).map((x) => spanEngine(x.attrs)))];
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
    status: job.status,
    at: stations.find((st) => st.state === "active" || st.state === "waiting" || st.state === "error")?.name ?? here,
    attempt: job.attempt,
    maxAttempts,
    retryError: job.attempt > 1 ? brief(previous?.attrs["error.message"] || job.feedback) || undefined : undefined,
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

export interface AgentSkills {
  station: SkillStation;
  general: SkillView[];
  /** Only lines that add skills to this agent. */
  lines: { line: string; skills: SkillView[] }[];
}

/** Read-only: each agent's skills, general and per line, as the panel and the chat show them. */
export function agentSkills(config: FactoryConfig, available: Skill[] = discoverSkills()): AgentSkills[] {
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
  ctx.config = await editFactory(ctx.home.config, (doc) => {
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
  ctx.config = await editFactory(ctx.home.config, (doc) => doc.setIn(path, doc.createNode([...current, skill])));
  const { problem } = resolveSkill(skill, discoverSkills());
  return `Skill ${skill} asignada a ${where}.${problem ? ` Ojo: ${problem}; el agente trabaja sin ella hasta que esté.` : ""}`;
}

export async function removeSkill(ctx: FactoryContext, input: { skill: string; station: string; line?: string }): Promise<string> {
  const { station, path } = skillTarget(ctx, input.station, input.line);
  const where = input.line ? `${station} en la línea ${input.line}` : `${station}`;
  const current = currentSkills(ctx, station, input.line);
  if (!current.includes(input.skill)) return `La skill ${input.skill} no estaba asignada a ${where}.`;
  ctx.config = await editFactory(ctx.home.config, (doc) => doc.setIn(path, doc.createNode(current.filter((s) => s !== input.skill))));
  return `Skill ${input.skill} quitada de ${where}.`;
}

export function skillList(ctx: FactoryContext): SkillList {
  const available = discoverSkills();
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
