import type { DaemonInfo, EgressReport, FactoryStatus, LineAgentList, OnDemandRun, PackageList, RequestResult, ShutdownResult, SkillList } from "./app.js";
import type { PackageProblem } from "./config.js";
import type { SkillProblem } from "./skills.js";
import { pausedText, resetTime, type BudgetState } from "./budget.js";
import type { GithubStatus } from "./github-quota.js";
import { billingText, outageText, type MergeOutcome } from "./line/automerge.js";
import { describeDelivery } from "./line/finish.js";
import type { StationRunOutcome, StationRunRecord } from "./line/packages.js";
import { jobStage } from "./line/spec.js";
import { effectivePriority, storedPriority } from "./priority.js";
import type { AlertSeverity, Job, Proposal, ResearchNote } from "./state/store.js";
import type { EgressSite, EgressSummary } from "./telemetry/metrics.js";

/** Owner-facing text, shared by the CLI and the chat so both say the same thing. */

export const STATUS_TEXT: Record<Job["status"], string> = {
  queued: "en cola",
  running: "trabajando",
  waiting: "esperando tu respuesta",
  delivered: "entregado",
  failed: "falló",
  stopped: "detenido",
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export { resetTime };

/** "5 horas al 45% (se renueva 18:30) · semana al 32% (se renueva lun 09:00)". */
export function planSummary(b: BudgetState, now = new Date()): string {
  return b.windows
    .map((w) => `${w.label} ${w.utilization === undefined ? (w.status === "exhausted" ? "agotado" : "sin dato") : `al ${Math.round(w.utilization * 100)}%`}${w.resetsAt ? ` (se renueva ${resetTime(w.resetsAt, now)})` : ""}`)
    .join(" · ");
}

/** One line on what limits the factory today: the subscription plan or the daily dollar cap. */
export function budgetLine(b: BudgetState, now = new Date()): string {
  const pause = b.reached
    ? ` · PAUSADA${b.until ? ` hasta ${resetTime(b.until, now)}` : " hasta mañana"}: ${b.reason}`
    : b.replacements.map((r) => ` · ${pausedText(r, now)} · trabajando con ${r.with}`).join("");
  if (b.billing === "subscription") {
    const reserve = b.reservePercent ? ` · reserva para vos: ${b.reservePercent}%` : "";
    const billed = b.spentUsd > 0 ? ` · gasto real hoy ${usd(b.spentUsd)} de ${usd(b.limitUsd)}` : "";
    return `Suscripción: ${planSummary(b, now) || "sin datos del cupo todavía"}${reserve}${pause} · costo estimado hoy ${usd(b.estimatedUsd)} (no se cobra)${billed}`;
  }
  if (b.billing === "unknown" && b.estimatedUsd > b.spentUsd) {
    return `Presupuesto: todavía no se sabe si el motor usa una suscripción o se paga por uso; se ve en la próxima llamada · costo estimado hoy ${usd(b.estimatedUsd)}${pause}`;
  }
  return `Presupuesto de hoy: ${usd(b.spentUsd)} de ${usd(b.limitUsd)}${pause}`;
}
export const jobName = (j: Job) => j.title ?? (j.request.length > 60 ? `${j.request.slice(0, 57)}…` : j.request);

/** Who asked for a job, only when a package's station did, or what kind of job it is when a Dependabot alert opened it. */
export const jobOrigin = (j: Job) =>
  j.source?.kind === "package" ? `pedido por paquete ${j.source.package}/${j.source.station}` : j.source?.kind === "security-alert" ? `seguridad: alerta de Dependabot ${j.source.package}` : undefined;

/** Spanish severity names, for what the owner reads. */
export const SEVERITY_TEXT: Record<AlertSeverity, string> = { low: "baja", medium: "media", high: "alta", critical: "crítica" };

/** One open Dependabot alert and who handles it: "lodash (npm) · crítica · alerta #3 · trabajo j1 (en cola)". */
export function describeAlert(a: { package: string; ecosystem: string; severity: AlertSeverity; number: number; fixed?: string; job?: string; jobStatus?: Job["status"] }): string {
  const handled = a.job ? `trabajo ${a.job}${a.jobStatus ? ` (${STATUS_TEXT[a.jobStatus]})` : ""}` : `solo aviso${a.fixed ? "" : " (sin versión corregida)"}`;
  return `${a.package} (${a.ecosystem}) · ${SEVERITY_TEXT[a.severity]} · alerta #${a.number} · ${handled}`;
}

/** How long ago something happened: "hace 5 min", "hace 3 h", "hace 2 días". */
export function ageText(at: string, now = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.floor(min / 60)} h`;
  const days = Math.floor(min / (24 * 60));
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

/** "trabajando (estación build, intento 2)", "esperando tu respuesta", … */
export function describeJobStatus(job: Job): string {
  const stage = job.status === "running" ? jobStage(job) : undefined;
  const stageText = stage ? `, etapa ${stage.n} de ${stage.total}` : "";
  return `${STATUS_TEXT[job.status]}${job.status === "running" && job.station ? ` (estación ${job.station}${job.attempt ? `, intento ${job.attempt}` : ""}${stageText})` : stageText}`;
}

export function formatRequest(r: RequestResult): string {
  const priority = storedPriority(r.job);
  return [`Pedido anotado: trabajo ${r.job.id} en la línea "${r.job.line}"${priority === "media" ? "" : `, con prioridad ${priority}`}.`, r.next, r.level.reason ? `Nota: ${r.level.reason}` : ""].filter(Boolean).join("\n");
}

/** What a merge on request did, for the CLI, the chat and the panel. */
export function formatMerge(r: MergeOutcome): string {
  return r.merged ? `Fundí ${r.url} (trabajo ${r.job}): el cambio ya está en la rama base${r.commit ? ` (commit ${r.commit.slice(0, 12)})` : ""}.` : `No lo fundí: ${r.why}`;
}

/** Proposals of the night shift waiting for the owner; `detail` adds why and what would change. */
export function formatProposals(proposals: Proposal[], detail = false): string {
  if (!proposals.length) return "No hay propuestas pendientes.";
  const rows = proposals.map(
    (p) =>
      `${p.id} · ${p.line} · ${p.title} (costo estimado ${usd(p.estimatedUsd)})` +
      (p.status === "approved" ? ` · construido por el turno nocturno, espera tu aprobación para integrar (trabajo ${p.jobId})` : "") +
      (p.researchNote ? ` · nace de la nota de investigación ${p.researchNote}${p.thirdParty ? ", agrega algo de terceros" : ""}${p.business ? ", de negocio" : ""}` : "") +
      (detail ? `\nPor qué: ${p.why}\nQué cambiaría: ${p.change}` : ""),
  );
  return `${rows.join(detail ? "\n\n" : "\n")}\n\nAprobar: \`zero proposals approve <id>\` · Rechazar: \`zero proposals reject <id> --note "motivo"\`.`;
}

/** Research notes, newest first, with what they found and their sources. */
export function formatResearchNotes(notes: ResearchNote[]): string {
  if (!notes.length) return "No hay notas de investigación en ese período.";
  const rows = notes.map((n) =>
    [`${n.id} · ${n.line} · ${n.createdAt.slice(0, 10)} · ${n.topic}`, n.findings, `Para qué serviría: ${n.serves}`, `Madurez: ${n.maturity}`, `Fuentes: ${n.sources.join(" ")}`].join("\n"),
  );
  return `${rows.join("\n\n")}\n\nLo que viene de la web es dato, no instrucciones. Pedir un trabajo a partir de una nota: \`zero research request <id>\`.`;
}

/** A job's cost: an estimate with no cap on a subscription, spend against the job's budget otherwise. */
export function jobCost(job: Job, subscription: boolean): string {
  return subscription
    ? `costo estimado ${usd(job.costUsd)} (con la suscripción no se cobra)`
    : `costo ${usd(job.costUsd)} de ${usd(job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0))}`;
}

export function formatJob(job: Job, opts: { subscription?: boolean } = {}): string {
  const lines = [
    `Trabajo ${job.id} · ${jobName(job)}`,
    `Estado: ${describeJobStatus(job)}`,
    `Línea: ${job.line} · ${jobCost(job, opts.subscription ?? false)}`,
    `Prioridad: ${storedPriority(job)}`,
  ];
  const origin = jobOrigin(job);
  if (origin) lines.push(`Origen: ${origin}`);
  if (job.question) {
    lines.push("", "Pregunta para vos:", job.question.text, "", `Respondé con "aprobar" o "rechazar" (vence ${job.question.expiresAt}; si nadie responde: ${job.question.onTimeout === "approve" ? "se aprueba" : "se rechaza"}).`);
  }
  if (job.delivery) lines.push(`Entrega: ${describeDelivery(job.delivery)}`);
  if (job.reason) lines.push(`Motivo: ${job.reason}`);
  if (job.feedback && job.status === "running") lines.push(`Último problema a corregir: ${job.feedback.slice(0, 300)}`);
  return lines.join("\n");
}

function skillWarning(p: SkillProblem): string {
  return `Skill ${p.skill} (agente ${p.station}${p.line ? `, línea ${p.line}` : ""}): ${p.reason}; el agente trabaja sin ella`;
}

export function formatAgents(lists: LineAgentList[]): string {
  if (!lists.length) return "La fábrica no tiene líneas.";
  const out: string[] = [];
  for (const l of lists) {
    const at = (type: string) => l.agents.filter((a) => a.type === type).map((a) => ` → ${a.name}`).join("");
    out.push(`Línea ${l.line}: spec → build${at("build")} → verify → review → security${at("review")} → integrate`);
    if (!l.agents.length) out.push(`- sin agentes a medida (agregá uno con \`zero agent add <nombre> --line ${l.line}\`)`);
    for (const a of l.agents) {
      const kind = a.type === "build" ? `escribe${a.files.length ? `, solo si el cambio toca ${a.files.join(", ")}` : ""}` : `revisor ${a.blocking ? "bloqueante" : "informativo"}`;
      out.push(`- ${a.name} (${kind}, ${a.origin === "factory" ? "global" : a.origin === "package" ? "de un paquete" : "de la línea"}): ${a.path}${a.missing ? " · FALTA el archivo de instrucciones" : ""}`);
    }
  }
  return out.join("\n");
}

const packageProblem = (p: PackageProblem) => `Paquete ${p.package}: ${p.reason}`;

const RUN_OUTCOME: Record<StationRunOutcome, string> = { done: "terminó bien", failed: "falló", timeout: "superó su tiempo", stopped: "se cortó porque la fábrica se apagó" };

/** An on-demand run as a person reads it: en curso, or how and when it ended, with its request and error. */
export function describeStationRun(r: StationRunRecord, now = new Date()): string {
  const state =
    r.state === "running"
      ? `en curso desde ${resetTime(r.startedAt ?? r.requestedAt, now)}`
      : `${RUN_OUTCOME[r.outcome ?? "failed"]}${r.finishedAt ? ` (${resetTime(r.finishedAt, now)})` : ""}${r.error ? `: ${r.error}` : ""}`;
  return `${state}${r.request ? ` · pedido: "${r.request.slice(0, 120)}"` : ""}`;
}

export function formatPackages(l: PackageList, now = new Date()): string {
  if (!l.packages.length && !l.problems.length) return "No hay paquetes instalados: agregá uno con `zero package add <carpeta|paquete-npm|git>`.";
  const out: string[] = [];
  const short = (installed: string) => (/^[0-9a-f]{40,64}$/.test(installed) ? installed.slice(0, 7) : installed);
  for (const p of l.packages) {
    out.push(`${p.name} ${p.version} (${p.source === "path" ? "carpeta" : p.source}): ${p.dir}`);
    if (p.source !== "path") out.push(`- fuente: ${p.origin}${p.installed ? `, instalado ${short(p.installed)}` : ""}`);
    if (p.update) out.push(`- hay una actualización: ${short(p.update.seen)} (revisado ${p.update.at.slice(0, 10)}); aplicala con \`zero package update ${p.name}\``);
    if (p.lookFailed) out.push(`- no se pudo revisar si hay novedades (${p.lookFailed.at.slice(0, 10)}): ${p.lookFailed.error}`);
    if (p.agents.length) out.push(`- agentes: ${p.agents.join(", ")}`);
    if (p.skills.length) out.push(`- skills: ${p.skills.join(", ")}`);
    for (const s of p.stations) {
      const state = !s.allowed ? "no corre" : s.missingSecrets.length ? `espera los secretos ${s.missingSecrets.join(", ")} (\`zero secret set <NOMBRE>\`)` : s.lastRun ? `última pasada ${s.lastRun}` : "todavía no corrió";
      out.push(`- estación ${s.name}: ${state}${s.onDemandPendingSince ? ` · corrida a demanda pendiente desde ${resetTime(s.onDemandPendingSince, now)}` : ""}${s.lastOnDemand ? ` · última corrida a demanda: ${describeStationRun(s.lastOnDemand, now)}` : ""}`);
    }
  }
  if (l.problems.length) out.push("", "Problemas:", ...l.problems.map((p) => `- ${packageProblem(p)}`));
  return out.join("\n");
}

export function formatSkills(l: SkillList): string {
  const out = ["Skills asignadas:"];
  for (const a of l.assignments) out.push(`- ${a.station}${a.line ? ` (línea ${a.line})` : ""}: ${a.skills.join(", ") || "ninguna"}`);
  for (const p of l.problems) out.push(`  ${skillWarning(p)}`);
  out.push("", "Skills disponibles en Claude Code:");
  if (!l.available.length) out.push("- ninguna (personales en ~/.claude/skills o de plugins instalados)");
  for (const s of l.available) out.push(`- ${s.fullName}${s.source === "plugin" ? ` (plugin ${s.plugin})` : s.source === "package" ? ` (paquete ${s.plugin})` : " (personal)"}`);
  return out.join("\n");
}

/** What `zero shutdown` says, and how it exits: a retry loop has to find out the daemon is still there. */
export function shutdownOutcome(r: ShutdownResult): { text: string; code: number } {
  if (r.status === "stopped") return { text: "Fábrica apagada; los trabajos en curso vuelven a la cola.", code: 0 };
  if (r.status === "not-running") return { text: "La fábrica no estaba en marcha.", code: 0 };
  const who = r.pid ? `el proceso ${r.pid}` : "su proceso";
  return { text: `La fábrica no se apagó: ${who} sigue encendido. Se va a apagar cuando termine lo que está haciendo; si no lo hace, vas a tener que terminar ese proceso a mano.`, code: 1 };
}

const daemonState = (d: DaemonInfo) => (d.alive ? "en marcha" : d.lockHeld ? `no responde${d.pid ? ` (proceso ${d.pid})` : ""}` : "apagada (arranca sola con el próximo pedido)");

/** Starts with `GitHub:`, so `zero box status`, which filters by prefix, leaves it out. */
function githubLine(g: GithubStatus, now: Date): string {
  const parts: string[] = [];
  if (g.remaining !== undefined) parts.push(`quedan ${g.remaining} de ${g.limit} pedidos${g.resetAt ? `, se renueva ${resetTime(g.resetAt, now)}` : ""}`);
  if (g.haltedUntil) parts.push(`las pasadas siguen en pausa hasta ${resetTime(g.haltedUntil, now)}`);
  const top = Object.entries(g.passes)
    .map(([pass, counts]) => ({ pass, requests: counts.requests }))
    .sort((a, b) => b.requests - a.requests)[0];
  if (top?.requests) parts.push(`la pasada que más gastó esta hora: ${top.pass} (${top.requests})`);
  return `GitHub: ${parts.join(" · ")}`;
}

/** " · prioridad alta" for a job not at `media`, saying so when the wait raised it. */
export function priorityNote(job: Job, now = new Date()): string {
  const level = effectivePriority(job, now);
  if (level === "media" && storedPriority(job) === "media") return "";
  return ` · prioridad ${level}${level !== storedPriority(job) ? " (subió por la espera)" : ""}`;
}

const ON_DEMAND_END: Record<NonNullable<OnDemandRun["outcome"]>, string> = {
  ok: "terminó bien",
  failed: "falló",
  timeout: "superó su tiempo",
  stopped: "se cortó al apagar la fábrica",
  "not-run": "no pudo correr",
};

/** How a station's last on-demand run went: "corriendo desde 10:05", "terminó bien a las 10:07" or "sin resultado". */
export function onDemandState(r: OnDemandRun, now = new Date()): string {
  if (r.endedAt && r.outcome) return `${ON_DEMAND_END[r.outcome]} (${resetTime(r.endedAt, now)})`;
  if (r.stale || !r.startedAt) return "sin resultado";
  return `corriendo desde ${resetTime(r.startedAt, now)}`;
}

/** "hello/nota (pedida 10:00): terminó bien (10:07)". */
export const describeOnDemandRun = (r: OnDemandRun, now = new Date()) => `${r.station} (pedida ${resetTime(r.asked, now)}): ${onDemandState(r, now)}`;

export function formatStatus(s: FactoryStatus, now = new Date()): string {
  const t = s.today;
  const out = [
    `Fábrica: ${s.andon ? "DETENIDA (andon)" : daemonState(s.daemon)} · nivel ${s.level.level}${s.level.configured !== s.level.level ? ` (configurado ${s.level.configured})` : ""}`,
  ];
  if (s.level.reason) out.push(`  ${s.level.reason}`);
  if ((s.daemonProcesses?.length ?? 0) > 1) out.push(`AVISO: hay ${s.daemonProcesses!.length} procesos daemon de zero en esta máquina (${s.daemonProcesses!.join(", ")}). Pueden tomar el mismo trabajo, salvo que uno sea de otra fábrica porque usás otro ZERO_HOME; si no, terminá a mano el que sobra.`);
  if (s.isolation === "container") {
    const st = s.box.status;
    out.push(
      s.box.availability.ready && st
        ? `Caja de aislamiento: lista (${st.runtime} · ${st.image})`
        : s.boxWait
          ? `Caja de aislamiento: no lista; los trabajos esperan la caja en la cola. Corré \`zero box setup\` o elegí otra cosa con \`zero setup\`. ${s.box.availability.problems.join("; ")}`
          : `Caja de aislamiento: no lista; los trabajos corren en copias locales.${s.level.reason ? "" : ` ${s.box.availability.problems.join("; ")}`}`,
    );
  } else {
    out.push("Caja de aislamiento: desactivada (isolation: worktree)");
  }
  if (s.isolation === "container" && s.box.availability.ready) {
    const e = s.today.egress;
    out.push(`Salidas a internet hoy: ${e.connections} conexiones · ${e.blocked} bloqueadas${e.suspicious ? ` (${e.suspicious} sospechosas: \`zero egress\`)` : ""} · modo ${s.egressMode}`);
  }
  if (s.codexUnsandboxed === "machine") out.push("AVISO: Codex corre sin su sandbox (codex.sandbox: off). zero solo comprueba la carpeta de trabajo y su repositorio en las estaciones de lectura; no cubre los archivos ignorados por git, el resto de la máquina ni la salida a internet.");
  if (s.codexUnsandboxed === "box") out.push("Codex corre dentro de la caja de aislamiento (codex.sandbox: off), con los límites de la caja.");
  for (const i of s.intake) out.push(`Issues de GitHub: la línea ${i.line} toma los issues con la etiqueta "${i.label}"${i.problem ? ` · PROBLEMA: ${i.problem}` : ""}`);
  for (const i of s.linear) out.push(`Issues de Linear: la línea ${i.line} toma los issues del equipo ${i.team} con la etiqueta "${i.label}"${i.problem ? ` · PROBLEMA: ${i.problem}` : ""}`);
  for (const j of s.jira) out.push(`Issues de Jira: la línea ${j.line} toma los issues de ${j.project} (${j.site}) con la etiqueta "${j.label}"${j.problem ? ` · PROBLEMA: ${j.problem}` : ""}`);
  for (const l of s.securityAlerts) {
    if (l.problem) out.push(`Alertas de seguridad: la línea ${l.line} · PROBLEMA: ${l.problem}`);
    for (const a of l.alerts) out.push(`Alertas de seguridad: la línea ${l.line} · ${describeAlert(a)}`);
  }
  for (const p of s.skills) out.push(skillWarning(p));
  for (const p of s.packages) out.push(packageProblem(p));
  if (s.onDemand.length) out.push(`Corridas a demanda pendientes: ${s.onDemand.map((d) => `${d.station} (desde ${resetTime(d.since, now)}${d.request ? `, pedido: "${d.request.slice(0, 120)}"` : ""})`).join(", ")}`);
  if (s.onDemandRuns.length) out.push(`Corridas a demanda recientes: ${s.onDemandRuns.map((r) => describeOnDemandRun(r, now)).join(", ")}`);
  for (const r of s.stationRuns) out.push(`Corrida a demanda de ${r.station}: ${describeStationRun(r, now)}`);
  if (s.cleanups.length) out.push(`Limpiezas pendientes: ${s.cleanups.length} ${s.cleanups.length === 1 ? "copia" : "copias"} de trabajo (se reintenta en segundo plano)`);
  for (const o of s.outages) out.push(outageLine(o));
  for (const b of s.billing) out.push(billingLine(b));
  for (const m of s.merges) out.push(`Fusión automática: ${m.url} (${m.job}) · ${m.status === "blocked" ? `NO SE FUNDE: ${m.why}` : (m.why ?? "esperando")}`);
  if (s.github) out.push(githubLine(s.github, now));
  out.push(budgetLine(s.budget, now));
  out.push(`Hoy:${t.delivered} entregados · ${t.failed} fallidos · éxito ${t.successRate === null ? "—" : `${Math.round(t.successRate * 100)}%`} · costo${s.budget.billing === "subscription" ? " estimado" : ""} ${usd(t.costUsd)}`);
  const origin = (j: Job) => (jobOrigin(j) ? ` · ${jobOrigin(j)}` : "");
  const list = (title: string, jobs: Job[]) => {
    if (!jobs.length) return;
    out.push("", `${title}:`);
    for (const j of jobs) out.push(`- ${j.id} · ${j.line} · ${jobName(j)}${origin(j)}${j.station && j.status === "running" ? ` · ${j.station}` : ""}${priorityNote(j, now)}`);
  };
  list("Esperando tu respuesta", s.waiting);
  list("Trabajando", s.running);
  list("En cola", s.queued);
  if (s.recent.length) {
    out.push("", "Últimos terminados:");
    for (const j of s.recent) out.push(`- ${j.id} · ${STATUS_TEXT[j.status]} · ${jobName(j)}${origin(j)}${j.delivery ? ` · ${describeDelivery(j.delivery)}` : ""}`);
  }
  return out.join("\n");
}

const MODE_TEXT: Record<EgressReport["mode"], string> = {
  blocklist: "sale todo salvo lo sospechoso y lo que bloquees",
  allowlist: "solo salen tus sitios permitidos y los de tus motores",
};

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function siteLine(s: EgressSite): string {
  const where = [s.stations.join(", "), s.jobs.length ? `trabajo${s.jobs.length > 1 ? "s" : ""} ${s.jobs.join(", ")}` : ""].filter(Boolean).join(" · ");
  if (s.blocked) {
    const tries = s.blocked === s.connections ? `${s.blocked} ${s.blocked === 1 ? "intento" : "intentos"}` : `${s.blocked} de ${s.connections} bloqueadas`;
    return `- ${s.host}:${s.port} · ${tries}${where ? ` · ${where}` : ""}${s.isNew ? " · nuevo" : ""}\n  ${s.rule === "suspicious" ? "SOSPECHOSO: " : ""}${s.reason ?? "bloqueado"}`;
  }
  const n = `${s.connections} ${s.connections === 1 ? "conexión" : "conexiones"}`;
  return `- ${s.host}:${s.port} · ${n} · envió ${bytes(s.bytesUp)}, recibió ${bytes(s.bytesDown)}${where ? ` · ${where}` : ""}${s.isNew ? " · nuevo" : ""}`;
}

/** The sites the box reached, refusals first. Shared by `zero egress`, the trace and the chat. */
export function formatEgressSites(e: EgressSummary): string {
  const blocked = e.sites.filter((s) => s.blocked);
  const allowed = e.sites.filter((s) => !s.blocked);
  const out = [`Salidas a internet: ${e.connections} conexiones a ${e.sites.length} sitios · ${e.blocked} bloqueadas${e.suspicious ? ` (${e.suspicious} sospechosas)` : ""}`];
  if (blocked.length) out.push("", "Bloqueadas:", ...blocked.map(siteLine));
  if (allowed.length) out.push("", "Permitidas:", ...allowed.map(siteLine));
  return out.join("\n");
}

export function formatEgress(r: EgressReport): string {
  const since = r.from.slice(0, 16).replace("T", " ");
  const out = [
    r.job ? `Salidas a internet del trabajo ${r.job}` : `Salidas a internet de la caja desde ${since} UTC`,
    `Modo ${r.mode}: ${MODE_TEXT[r.mode]}.`,
  ];
  if (r.note) out.push(`Nota: ${r.note}`);
  out.push("", r.summary.connections ? formatEgressSites(r.summary) : "Ninguna conexión en el período.");
  out.push("", "Para cambiar las reglas: `zero egress allow <sitio>`, `zero egress block <sitio>`, `zero egress remove <sitio>` o `zero egress mode allowlist|blocklist`.");
  return out.join("\n");
}

/** One line per repository whose checks GitHub does not start over billing, with how many pull requests wait. */
export function billingLine(b: FactoryStatus["billing"][number]): string {
  return `${billingText(b.repository, b.since)}${b.pulls.length ? ` · ${b.pulls.length} ${b.pulls.length === 1 ? "pull request espera" : "pull requests esperan"}` : ""}`;
}

/** One line per environment outage: «Entorno caído en <repo> desde HH:MM (checks: a, b) · N pull requests esperan». */
export function outageLine(o: FactoryStatus["outages"][number]): string {
  const text = outageText(o.repository, o.since, o.checks);
  const waiting = o.pulls.length ? ` · ${o.pulls.length} ${o.pulls.length === 1 ? "pull request espera" : "pull requests esperan"}` : "";
  return `${text[0]!.toUpperCase()}${text.slice(1)}${waiting}`;
}
