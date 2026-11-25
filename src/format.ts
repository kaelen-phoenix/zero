import type { Adoption, DaemonInfo, EgressReport, FactoryJob, FactoryProposal, FactoryStatus, JobMachine, SelfUpdateStatus, LineAgentList, OnDemandRun, PackageList, PackageView, PendingRemoteAction, ProposalOutcome, RemoteChatView, RequestResult, RequestSent, ShutdownResult, SkillList } from "./app.js";
import type { PackageProblem } from "./config.js";
import type { SkillProblem } from "./skills.js";
import { pausedText, resetTime, type BudgetState } from "./budget.js";
import type { GithubStatus } from "./github-quota.js";
import type { LineAway } from "./coord/lines.js";
import type { OutboxEntry } from "./coord/outbox.js";
import type { MachineView } from "./coord/protocol.js";
import { installBehind, type InstallFreshness } from "./install-freshness.js";
import { billingText, outageText, type MergeOutcome } from "./line/automerge.js";
import type { DiscardOutcome } from "./line/discard.js";
import { describeDelivery } from "./line/finish.js";
import type { Train } from "./line/train.js";
import type { StationRunOutcome, StationRunRecord } from "./line/packages.js";
import type { ResearchRequest, ResearchRunRecord } from "./line/research.js";
import type { UnjamLineResult, UnjamRequest, UnjamRunRecord } from "./line/unjam.js";
import { jobStage } from "./line/spec.js";
import { releaseTag } from "./releases.js";
import type { SelfUpdateEntry, SelfUpdateRetry, SelfUpdateTarget, UpdateRunRecord } from "./self-update.js";
import { effectivePriority, storedPriority } from "./priority.js";
import type { CatalogEntry, CatalogStatus, CatalogType } from "./catalog.js";
import { FINAL_STATUSES, type AlertSeverity, type Job, type Proposal, type ResearchNote } from "./state/store.js";
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

/** Said of a budget that counts other machines too. */
const SHARED_BUDGET = "el gasto y el límite son de toda la fábrica (todas las máquinas)";

/** One line on what limits the factory today: the subscription plan or the daily dollar cap. */
export function budgetLine(b: BudgetState, now = new Date()): string {
  const pause = b.reached
    ? ` · PAUSADA${b.until ? ` hasta ${resetTime(b.until, now)}` : " hasta mañana"}: ${b.reason}`
    : b.replacements.map((r) => ` · ${pausedText(r, now)} · trabajando con ${r.with}`).join("");
  const shared = b.shared ? ` · ${SHARED_BUDGET}` : "";
  if (b.billing === "subscription") {
    const reserve = b.reservePercent ? ` · reserva para vos: ${b.reservePercent}%` : "";
    const billed = b.spentUsd > 0 ? ` · gasto real hoy ${usd(b.spentUsd)} de ${usd(b.limitUsd)}` : "";
    return `Suscripción: ${planSummary(b, now) || "sin datos del cupo todavía"}${reserve}${pause} · costo estimado hoy ${usd(b.estimatedUsd)} (no se cobra)${billed}${shared}`;
  }
  if (b.billing === "unknown" && b.estimatedUsd > b.spentUsd) {
    return `Presupuesto: todavía no se sabe si el motor usa una suscripción o se paga por uso; se ve en la próxima llamada · costo estimado hoy ${usd(b.estimatedUsd)}${pause}${shared}`;
  }
  return `Presupuesto de hoy: ${usd(b.spentUsd)} de ${usd(b.limitUsd)}${pause}${shared}`;
}
export const jobName = (j: Pick<Job, "title" | "request">) => j.title ?? (j.request.length > 60 ? `${j.request.slice(0, 57)}…` : j.request);

/** Who asked for a job, only when a package's station did, or what kind of job it is when a Dependabot alert opened it or it updates a pull request zero took. */
export const jobOrigin = (j: Job) =>
  j.source?.kind === "package"
    ? `pedido por paquete ${j.source.package}/${j.source.station}`
    : j.source?.kind === "security-alert"
      ? `seguridad: alerta de Dependabot ${j.source.package}`
      : j.source?.kind === "pull-request"
        ? `actualiza el pull request #${j.source.number}`
        : undefined;

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
  return statusText(job, jobStage(job));
}

/** The same for a job of another machine, which comes with its stage. */
export const describeFactoryJob = (job: FactoryJob): string => statusText(job, job.stage);

function statusText(job: Pick<Job, "status" | "station"> & { attempt?: number }, at: { n: number; total: number } | undefined): string {
  const stage = job.status === "running" ? at : undefined;
  const stageText = stage ? `, etapa ${stage.n} de ${stage.total}` : "";
  return `${STATUS_TEXT[job.status]}${job.status === "running" && job.station ? ` (estación ${job.station}${job.attempt ? `, intento ${job.attempt}` : ""}${stageText})` : stageText}`;
}

export function formatRequest(r: RequestResult | RequestSent): string {
  if ("sent" in r) return r.sent;
  const priority = storedPriority(r.job);
  return [`Pedido anotado: trabajo ${r.job.id} en la línea "${r.job.line}"${priority === "media" ? "" : `, con prioridad ${priority}`}.`, r.next, r.level.reason ? `Nota: ${r.level.reason}` : ""].filter(Boolean).join("\n");
}

/** What a merge on request did, for the CLI, the chat and the panel. */
export function formatMerge(r: MergeOutcome): string {
  return r.merged ? `Fundí ${r.url}${r.job ? ` (trabajo ${r.job})` : ""}:el cambio ya está en la rama base${r.commit ? ` (commit ${r.commit.slice(0, 12)})` : ""}.` : `No lo fundí: ${r.why}`;
}

/** What discarding a job did: its final status, its pull request and its branch. */
export function formatDiscard(r: DiscardOutcome): string {
  const pr = r.pullRequest;
  const places = [r.branch.local && "en el repositorio de la línea", r.branch.remote && "en GitHub"].filter(Boolean).join(" y ");
  return [
    `Descarté el trabajo ${r.job.id}: quedó ${STATUS_TEXT[r.job.status]}. ${r.job.reason ?? ""}`.trim(),
    pr ? `Pull request ${pr.url}: ${pr.closed ? "cerrado" : pr.was === "merged" ? "ya estaba fundido" : pr.was === "closed" ? "ya estaba cerrado" : "no se cerró"}.` : "No tenía un pull request que cerrar.",
    `Rama ${r.branch.name}: ${r.branch.kept ? `no la borré porque ${r.branch.kept}` : places ? `borrada ${places}` : "no borré ninguna"}.`,
    ...r.problems.map((p) => `Problema: ${p}`),
  ].join("\n");
}

/** One line per pull request of `zero actualizar-pr`. */
export function formatAdoptions(list: Adoption[]): string {
  return list
    .map((a) => (a.job ? `#${a.number.replace("#", "")}: trabajo ${a.job.id} en cola, actualiza la rama ${a.job.branch} con ${a.job.base}.` : `#${a.number.replace("#", "")}: no lo tomé: ${a.why}`))
    .join("\n");
}

/** What `zero tren` started: the pull requests in merge order. */
export function formatTrain(t: Train): string {
  return [`Tren de ${t.line} con ${t.entries.length} ${t.entries.length === 1 ? "pull request" : "pull requests"}, en este orden:`, ...t.entries.map((e, i) => `${i + 1}. ${e.url} (trabajo ${e.job})`), "La fábrica los funde de a uno, solo con los checks en verde, y actualiza el siguiente recién después."].join("\n");
}

/** The remote chat for `zero mcp clients`: the switch, the address and each connected client. */
export function formatRemoteChat(v: RemoteChatView, now = new Date()): string {
  const state = v.on
    ? v.url
      ? `Chat remoto encendido: conectá tu chat a ${v.url}${v.stable ? " (dirección fija)" : " (dirección temporal: cambia si el túnel se reinicia)"}`
      : "Chat remoto encendido, pero el túnel del panel no está abierto: abrilo con `zero panel remote on`."
    : "Chat remoto apagado: se enciende con `zero mcp remote on`.";
  if (!v.clients.length) return `${state}
No hay chats conectados.`;
  const rows = v.clients.map(
    (c) =>
      `${c.id} · ${c.name} · ${c.scope.includes("zero:act") ? "leer y actuar" : "solo leer"} · aprobado ${ageText(c.approvedAt, now)}` +
      ` · ${c.lastUsedAt ? `último uso ${ageText(c.lastUsedAt, now)}` : "sin uso todavía"}`,
  );
  return [state, "Chats conectados (revocá uno con `zero mcp revoke <cliente>`):", ...rows].join("\n");
}

/** The chat's held actions for `zero mcp pendientes`. */
export function formatPendingActions(list: PendingRemoteAction[]): string {
  if (!list.length) return "No hay acciones del chat esperando tu confirmación.";
  const rows = list.map((a) => `${a.id} · ${a.text} · pedido por ${a.clientName ?? a.client ?? "un chat de esta máquina"} · vence ${a.expiresAt.slice(11, 16)} UTC`);
  return ["Acciones del chat para confirmar (con `zero mcp confirmar <id>`):", ...rows].join("\n");
}

/** What deciding a proposal did, for the CLI and the chat. */
export function formatProposalDecision(id: string, r: ProposalOutcome): string {
  if ("sent" in r) return r.sent;
  return "rejected" in r ? `Propuesta ${r.rejected.id} rechazada y archivada.` : `Propuesta ${id} aprobada.\n${formatRequest(r.approved)}`;
}

/** Where a decision or a request for another machine stands. */
export function sentState(e: OutboxEntry): string {
  if (e.kind === "request") return e.state === "pending" ? "todavía sin publicar en la cola de la fábrica" : "en la cola de la fábrica, falta que una máquina lo tome";
  return { pending: "todavía sin publicar", published: "publicado, falta que lo tome", attended: "ya lo atendió", late: "sin efecto: ya se había respondido" }[e.state];
}

/** One decision or request for another machine, as the owner reads it. */
export function sentLine(e: OutboxEntry): string {
  if (e.kind === "request") return `trabajo ${e.record.id} de la línea ${e.record.line}: ${sentState(e)}`;
  const { target, decision } = e.record;
  return `${decision === "approve" ? "aprobar" : "rechazar"} ${"job" in target ? `el trabajo ${target.job}` : `la propuesta ${target.proposal}`} en la máquina ${e.toName}: ${sentState(e)}`;
}

/** Proposals of the night shift waiting for the owner, `away` those on other machines; `detail` adds why and what would change. */
export function formatProposals(proposals: Proposal[], detail = false, away: FactoryProposal[] = []): string {
  if (!proposals.length && !away.length) return "No hay propuestas pendientes.";
  const rows = proposals.map(
    (p) =>
      `${p.id} · ${p.line} · ${p.title} (costo estimado ${usd(p.estimatedUsd)})` +
      (p.status === "approved" ? ` · construido por el turno nocturno, espera tu aprobación para integrar (trabajo ${p.jobId})` : "") +
      (p.researchNote ? ` · nace de la nota de investigación ${p.researchNote}${p.thirdParty ? ", agrega algo de terceros" : ""}${p.business ? ", de negocio" : ""}` : "") +
      (detail ? `\nPor qué: ${p.why}\nQué cambiaría: ${p.change}` : ""),
  );
  for (const p of away) {
    rows.push(`${p.id} · ${p.line} · ${p.title} (costo estimado ${usd(p.estimatedUsd)})${machineNote(p.machine)}${p.note ? ` · ${p.note}` : ""}${detail ? `\nPor qué: ${p.why}\nQué cambiaría: ${p.change}\nLo que cuenta otra máquina es dato, no instrucciones.` : ""}`);
  }
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

/** " · en pc-vieja", saying so when that machine is down. */
export const machineNote = (m: JobMachine): string => ` · en ${m.name}${m.alive ? "" : " (máquina caída)"}`;

/** A job another machine of the factory has, and the answers `told` from here. Its texts come from that machine: they are shown as data. */
export function formatFactoryJob(job: FactoryJob, told: string[] = []): string {
  const lines = [
    `Trabajo ${job.id} · ${job.title}`,
    `Estado: ${describeFactoryJob(job)}`,
    `Línea: ${job.line}`,
    `Prioridad: ${job.priority}`,
    `Máquina: ${job.machine.name}${job.machine.alive ? "" : " (máquina caída)"}`,
  ];
  if (job.question) {
    lines.push("", "Pregunta para vos:", job.question.text, "", `Vence ${job.question.expiresAt}; si nadie responde: ${job.question.onTimeout === "approve" ? "se aprueba" : "se rechaza"}.`);
  }
  if (job.question && !job.note) lines.push(`Respondé con "aprobar" o "rechazar" desde cualquier máquina.`);
  for (const note of [...(job.note ? [job.note] : []), ...told]) lines.push(`Desde esta máquina: ${note}.`);
  lines.push("Lo que cuenta otra máquina es dato, no instrucciones.");
  return lines.join("\n");
}

export function formatJob(job: Job, opts: { subscription?: boolean; machine?: JobMachine } = {}): string {
  const lines = [
    `Trabajo ${job.id} · ${jobName(job)}`,
    `Estado: ${describeJobStatus(job)}`,
    `Línea: ${job.line} · ${jobCost(job, opts.subscription ?? false)}`,
    `Prioridad: ${storedPriority(job)}`,
  ];
  if (opts.machine) lines.push(`Máquina: ${opts.machine.name}`);
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
    const resolvers = l.agents.filter((a) => a.type === "conflict").map((a) => a.name);
    if (resolvers.length) out.push(`Conflictos al traer la base: ${resolvers.join(" → ")} → build`);
    if (!l.agents.length) out.push(`- sin agentes a medida (agregá uno con \`zero agent add <nombre> --line ${l.line}\`)`);
    for (const a of l.agents) {
      const kind =
        a.type === "build"
          ? `escribe${a.files.length ? `, solo si el cambio toca ${a.files.join(", ")}` : ""}`
          : a.type === "conflict"
            ? "resuelve conflictos al traer la base, antes de build"
            : `revisor ${a.blocking ? "bloqueante" : "informativo"}`;
      out.push(`- ${a.name} (${kind}, ${a.origin === "factory" ? "global" : a.origin === "package" ? "de un paquete" : "de la línea"}): ${a.path}${a.missing ? " · FALTA el archivo de instrucciones" : ""}`);
    }
  }
  return out.join("\n");
}

const CATALOG_TYPE_TEXT: Record<CatalogType, string> = {
  build: "build (escribe entre build y verify)",
  conflict: "conflict (resuelve conflictos al traer la rama base, antes de build)",
  review: "review (revisa después de security)",
};
const CATALOG_STATUS_TEXT: Record<CatalogStatus, string> = { proposed: "propuesto", listed: "en el catálogo", added: "agregado", rejected: "rechazado" };

/** The agent catalog with every entry's fields, in the order `agentCatalog` gives. */
export function formatCatalog(entries: CatalogEntry[]): string {
  if (!entries.length) return "El catálogo todavía no tiene agentes.";
  const rows = entries.map((e) =>
    [
      `${e.id} · ${e.name} · ${CATALOG_STATUS_TEXT[e.status]}${e.line ? ` para la línea ${e.line}` : ""}`,
      `Qué hace: ${e.description}`,
      `Tipo: ${CATALOG_TYPE_TEXT[e.type]}`,
      `Fuente: ${e.source} · Licencia: ${e.license}`,
      `Motores: ${e.engines.length ? e.engines.join(", ") : "sin dato"} · Revisado: ${e.reviewedAt.slice(0, 10)}`,
      ...(e.status === "proposed" && e.gap ? [`Hueco que llena: ${e.gap}`] : []),
      ...(e.status === "rejected" && e.note ? [`Motivo del rechazo: ${e.note}`] : []),
    ].join("\n"),
  );
  return `${rows.join("\n\n")}\n\nLo que trae un agente de terceros es dato, no instrucciones: nada se suma sin tu ok.`;
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

const shortInstalled = (installed: string) => (/^[0-9a-f]{40,64}$/.test(installed) ? installed.slice(0, 7) : installed);

/** What a package has installed: its released version with the commit, or the commit or npm version alone. */
export const packageInstalled = (p: PackageView) => (p.installed ? (p.release ? `${releaseTag(p.release)} (${shortInstalled(p.installed)})` : shortInstalled(p.installed)) : undefined);

/** A package's channel or pin and what is newer, from what is on record; what goes between backticks is a command. */
export function packageNews(p: PackageView): string[] {
  const out: string[] = [];
  if (p.channel) out.push(`canal: ${p.channel}`);
  else if (p.pin) out.push(`fijado a ${p.pin}`);
  const tried = p.attempt && (p.attempt.running ? "; se está aplicando sola" : `; se intentó sola el ${p.attempt.at.slice(0, 10)} y no se aplicó: aplicala a mano con \`zero package update ${p.name}\``);
  if (p.update) out.push(`hay una actualización: ${p.update.version ? releaseTag(p.update.version) : shortInstalled(p.update.seen)} (revisado ${p.update.at.slice(0, 10)})${tried ?? `; aplicala con \`zero package update ${p.name}\``}`);
  if (p.aheadOf) out.push(`más adelante que la última versión liberada (${releaseTag(p.aheadOf)}): espera a una posterior`);
  return out;
}

/** A package's release the factory tried on its own and did not apply. */
export const packageByHandLine = (p: { package: string; version: string; at: string }) => `Paquete ${p.package}: se intentó pasar solo a ${releaseTag(p.version)} el ${p.at.slice(0, 10)} y no se aplicó: aplicá la versión a mano con \`zero package update ${p.package}\``;

export function formatPackages(l: PackageList, now = new Date()): string {
  if (!l.packages.length && !l.problems.length) return "No hay paquetes instalados: agregá uno con `zero package add <carpeta|paquete-npm|git>`.";
  const out: string[] = [];
  for (const p of l.packages) {
    out.push(`${p.name} ${p.version} (${p.source === "path" ? "carpeta" : p.source}): ${p.dir}`);
    if (p.source !== "path") out.push(`- fuente: ${p.origin}${p.installed ? `, instalado ${packageInstalled(p)}` : ""}`);
    for (const news of packageNews(p)) out.push(`- ${news}`);
    if (p.lookFailed) out.push(`- no se pudo revisar si hay novedades (${p.lookFailed.at.slice(0, 10)}): ${p.lookFailed.error}`);
    if (p.agents.length) out.push(`- agentes: ${p.agents.join(", ")}`);
    if (p.skills.length) out.push(`- skills: ${p.skills.join(", ")}`);
    for (const s of p.stations) {
      const state = !s.allowed ? "no corre" : s.elsewhere ? "no corre en esta máquina" : s.missingSecrets.length ? `espera los secretos ${s.missingSecrets.join(", ")} (\`zero secret set <NOMBRE>\`)` : s.lastRun ? `última pasada ${s.lastRun}` : "todavía no corrió";
      out.push(`- estación ${s.name}: ${state}${s.machine !== undefined ? ` · fijada a la máquina ${s.machine}` : ""}${s.whenBusy ? " · corre aunque la fábrica esté ocupada" : ""}${s.onDemandPendingSince ? ` · corrida a demanda pendiente desde ${resetTime(s.onDemandPendingSince, now)}` : ""}${s.lastOnDemand ? ` · última corrida a demanda: ${describeStationRun(s.lastOnDemand, now)}` : ""}`);
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

/** "14:37", or "10/11 14:37" when it was not today. */
function clock(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, "0");
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? time : `${two(d.getDate())}/${two(d.getMonth() + 1)} ${time}`;
}

/** The `Túnel:` line: fixed or temporary address, connected or not, failures and the problem. */
export function tunnelLine(t: NonNullable<FactoryStatus["tunnel"]>, now = new Date()): string {
  const kind = t.mode === "named" ? `fijo (${t.hostname ?? "subdominio propio"})` : "temporal (cambia al reiniciar)";
  const parts = [kind, t.connectedSince ? `conectado desde ${clock(t.connectedSince, now)}` : "desconectado"];
  if (t.failures) parts.push(`${t.failures} ${t.failures === 1 ? "caída seguida" : "caídas seguidas"}`);
  if (t.problem) parts.push(`PROBLEMA: ${t.problem}`);
  return `Túnel: ${parts.join(" · ")}`;
}

function daemonState(d: DaemonInfo, running: number, now: Date): string {
  const state = d.state ?? (d.alive ? "running" : d.lockHeld ? "unresponsive" : "stopped");
  if (state === "running") return "en marcha";
  if (state === "unresponsive") return `no responde${d.pid ? ` (proceso ${d.pid})` : ""}`;
  if (state === "crashed") {
    const jobs = running ? ` con ${running} ${running === 1 ? "trabajo" : "trabajos"} en curso que nadie hace` : "";
    return `se cayó (último latido ${d.since ? clock(d.since, now) : "desconocido"})${jobs}; se vuelve a encender con el próximo comando de zero si hay trabajo pendiente`;
  }
  return `apagada${d.since ? ` a propósito desde ${clock(d.since, now)}` : ""} (arranca sola con el próximo pedido)`;
}

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

/** "Instalación atrasada: le faltan 2 commits fundidos de origin/main …", or an empty string while the installed copy is up to date. */
export function installLine(r: InstallFreshness, now = new Date()): string {
  if (!installBehind(r)) return "";
  const parts: string[] = [];
  const behind = r.behind ?? 0;
  if (behind > 0) parts.push(`le ${behind === 1 ? "falta 1 commit fundido" : `faltan ${behind} commits fundidos`}${r.upstream ? ` de ${r.upstream}` : ""}`);
  if (r.staleBuild) parts.push("la compilación (dist) es más vieja que el código (src); falta `npm run build`");
  return `Instalación atrasada: ${parts.join(" y ")} (revisado ${resetTime(r.checkedAt, now)}).`;
}

/** One machine of a distributed factory: "pc-vieja · viva · último latido 10:05 · trabajos abc12345". */
export function machineLine(m: MachineView, now = new Date()): string {
  return `${m.name} · ${m.alive ? "viva" : "caída"} · último latido ${resetTime(m.at, now)} · ${m.jobs.length ? `trabajos ${m.jobs.join(", ")}` : "sin trabajos"}`;
}

/** A published line that is not on this machine: "ios · no se atiende en esta máquina por la plataforma: …". */
export function lineAwayLine(l: LineAway): string {
  if (l.state === "failed") return `${l.name} · no se pudo clonar${l.why ? `: ${l.why}` : ""}`;
  return `${l.name} · no se atiende en esta máquina${l.why ? ` ${l.why}` : ""}`;
}

/** The last jobs of the factory to end, newest first. */
export const recentJobs = (jobs: FactoryJob[]): FactoryJob[] =>
  jobs.filter((j) => FINAL_STATUSES.includes(j.status)).sort((a, b) => Date.parse(b.finishedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.createdAt)).slice(0, 5);

/** " · prioridad alta" for a job not at `media`, saying so when the wait raised it. */
export function priorityNote(job: Pick<Job, "priority" | "source" | "createdAt">, now = new Date()): string {
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

const UNJAM_END: Record<NonNullable<UnjamRunRecord["outcome"]>, string> = {
  ok: "terminó bien",
  failed: "falló",
  stopped: "se cortó",
  "not-run": "no pudo correr",
};

/** A past time as `resetTime`, with its date too once the weekday no longer tells which day it was. */
function pastTime(iso: string, now: Date): string {
  const at = new Date(iso);
  return now.getTime() - at.getTime() < 6 * 86_400_000 ? resetTime(iso, now) : `${at.toLocaleDateString("es-AR")} ${resetTime(iso, at)}`;
}

/** "tienda: 2 trabas, 1 causa", "blog: sin trabas" or "web: 1 traba, sin diagnóstico válido". */
function unjamLineText(l: UnjamLineResult): string {
  if (!l.jams) return `${l.line}: sin trabas`;
  return `${l.line}: ${l.jams} ${l.jams === 1 ? "traba" : "trabas"}, ${l.failed ? "sin diagnóstico válido" : `${l.causes} ${l.causes === 1 ? "causa" : "causas"}`}`;
}

/** The unjam run asked for and not started: "pendiente para tienda desde 10:05". */
export const unjamPendingText = (r: UnjamRequest, now = new Date()) => `pendiente para ${r.line ?? "todas las líneas"} desde ${pastTime(r.requestedAt, now)}`;

/** The last on-demand unjam run: "pedida para tienda 10:00, empezó 10:05, terminó bien (10:07) · tienda: 2 trabas, 1 causa". */
export function describeUnjamRun(r: UnjamRunRecord, now = new Date()): string {
  const asked = `pedida para ${r.line ?? "todas las líneas"} ${pastTime(r.asked, now)}`;
  if (!r.endedAt) return `${asked}, corriendo${r.startedAt ? ` desde ${pastTime(r.startedAt, now)}` : ""}`;
  const started = r.startedAt ? `, empezó ${pastTime(r.startedAt, now)}` : "";
  // A run that ended well needs no reason: its lines tell it.
  const reason = r.reason && r.outcome !== "ok" ? `: ${r.reason}` : "";
  return [`${asked}${started}, ${UNJAM_END[r.outcome ?? "failed"]} (${pastTime(r.endedAt, now)})${reason}`, ...r.lines.map(unjamLineText)].join(" · ");
}

/** How an express research run ended, as the person in charge reads it. */
export const RESEARCH_END: Record<NonNullable<ResearchRunRecord["outcome"]>, string> = {
  ok: "terminó bien",
  failed: "falló",
  stopped: "se cortó",
  "not-run": "no pudo correr",
};

/** Characters of an express run's topic where it is only mentioned. */
const TOPIC_SHOWN = 120;

const shownTopic = (topic: string) => {
  const line = topic.replace(/\s+/g, " ");
  return line.length > TOPIC_SHOWN ? `${line.slice(0, TOPIC_SHOWN - 1)}…` : line;
};

const noteCount = (n: number) => (n ? `${n} ${n === 1 ? "nota" : "notas"}` : "sin notas");

/** The express research run asked for and not started: `pendiente para tienda desde 10:05 · "reels"`. */
export const researchPendingText = (r: ResearchRequest, now = new Date()) => `pendiente para ${r.line} desde ${pastTime(r.requestedAt, now)} · "${shownTopic(r.topic)}"`;

/** An express research run: `pedida para tienda 10:00, empezó 10:05, terminó bien (10:07) · 2 notas · "reels"`. */
export function describeResearchRun(r: ResearchRunRecord, now = new Date()): string {
  const asked = `pedida para ${r.line} ${pastTime(r.asked, now)}`;
  if (!r.endedAt) return `${asked}, corriendo${r.startedAt ? ` desde ${pastTime(r.startedAt, now)}` : ""} · "${shownTopic(r.topic)}"`;
  const started = r.startedAt ? `, empezó ${pastTime(r.startedAt, now)}` : "";
  return `${asked}${started}, ${RESEARCH_END[r.outcome ?? "failed"]} (${pastTime(r.endedAt, now)})${r.reason ? `: ${r.reason}` : ""} · ${noteCount(r.notes.length)} · "${shownTopic(r.topic)}"`;
}

/** What the chat says once of an express research run that ended. */
export function researchNotice(r: ResearchRunRecord): string {
  const how = `${RESEARCH_END[r.outcome ?? "failed"]}${r.reason ? ` (${r.reason})` : ""}`;
  return `Aviso de la fábrica: la investigación a demanda sobre "${shownTopic(r.topic)}" en ${r.line} ${how}: ${noteCount(r.notes.length)}.${r.notes.length ? " Se leen con zero_research." : ""}`;
}

export function formatStatus(s: FactoryStatus, now = new Date()): string {
  const t = s.today;
  const out = [
    `Fábrica: ${s.andon ? "DETENIDA (andon)" : daemonState(s.daemon, s.running.length, now)} · nivel ${s.level.level}${s.level.configured !== s.level.level ? ` (configurado ${s.level.configured})` : ""}`,
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
  for (const p of s.packagesByHand ?? []) out.push(packageByHandLine(p));
  if (s.onDemand.length) out.push(`Corridas a demanda pendientes: ${s.onDemand.map((d) => `${d.station} (desde ${resetTime(d.since, now)}${d.request ? `, pedido: "${d.request.slice(0, 120)}"` : ""})`).join(", ")}`);
  if (s.onDemandRuns.length) out.push(`Corridas a demanda recientes: ${s.onDemandRuns.map((r) => describeOnDemandRun(r, now)).join(", ")}`);
  for (const r of s.stationRuns) out.push(`Corrida a demanda de ${r.station}: ${describeStationRun(r, now)}`);
  if (s.unjam.pending) out.push(`Corrida a demanda del destrabador: ${unjamPendingText(s.unjam.pending, now)}`);
  if (s.unjam.last) out.push(`Última corrida a demanda del destrabador: ${describeUnjamRun(s.unjam.last, now)}`);
  if (s.research.pending) out.push(`Investigación a demanda: ${researchPendingText(s.research.pending, now)}`);
  if (s.research.runs[0]) out.push(`Última investigación a demanda: ${describeResearchRun(s.research.runs[0], now)}`);
  if (s.whenBusy.length) out.push(`Estaciones que corren aunque la fábrica esté ocupada: ${s.whenBusy.join(", ")}`);
  if (s.install) out.push(installLine(s.install, now));
  if (s.tunnel) out.push(tunnelLine(s.tunnel, now));
  if (s.cleanups.length) out.push(`Limpiezas pendientes: ${s.cleanups.length} ${s.cleanups.length === 1 ? "copia" : "copias"} de trabajo (se reintenta en segundo plano)`);
  for (const o of s.outages) out.push(outageLine(o));
  for (const b of s.billing) out.push(billingLine(b));
  for (const t of s.trains) out.push(trainLine(t));
  if (s.selfUpdate) for (const l of selfUpdateLines(s.selfUpdate, now)) out.push(l.text);
  for (const m of s.merges) out.push(`Fusión automática: ${m.url} (${m.job}) · ${m.status === "blocked" ? `NO SE FUNDE: ${m.why}` : (m.why ?? "esperando")}`);
  if (s.github) out.push(githubLine(s.github, now));
  if (s.machines) {
    out.push(`Máquinas:${s.machines.length ? "" : " todavía sin latidos"}`);
    for (const m of s.machines) out.push(`- ${machineLine(m, now)}`);
  }
  if (s.linesAway?.length) out.push("Líneas que no están en esta máquina:", ...s.linesAway.map((l) => `- ${lineAwayLine(l)}`));
  if (s.sent?.length) out.push("Para otras máquinas:", ...s.sent.map((e) => `- ${sentLine(e)}`));
  out.push(budgetLine(s.budget, now));
  out.push(`Hoy:${t.delivered} entregados · ${t.failed} fallidos · éxito ${t.successRate === null ? "—" : `${Math.round(t.successRate * 100)}%`} · costo${s.budget.billing === "subscription" ? " estimado" : ""} ${usd(t.costUsd)}`);
  const origin = (j: Job) => (jobOrigin(j) ? ` · ${jobOrigin(j)}` : "");
  // With other machines in the factory, every list is of all of them, and each job says where it is.
  const row = (j: Job | FactoryJob) => `- ${j.id} · ${j.line} · ${"machine" in j ? j.title : `${jobName(j)}${origin(j)}`}${j.station && j.status === "running" ? ` · ${j.station}` : ""}${priorityNote(j, now)}`;
  const list = (title: string, status: Job["status"], local: Job[]) => {
    const rows = s.jobs ? s.jobs.filter((j) => j.status === status).map((j) => row(j.local ?? j) + machineNote(j.machine)) : local.map(row);
    if (rows.length) out.push("", `${title}:`, ...rows);
  };
  if (s.jams.length) out.push("", "Trabas:", ...s.jams.map((j) => `- ${jamLine(j)}`));
  list("Esperando tu respuesta", "waiting", s.waiting);
  list("Trabajando", "running", s.running);
  list("En cola", "queued", s.queued);
  const ended = (j: Job) => `- ${j.id} · ${STATUS_TEXT[j.status]} · ${jobName(j)}${origin(j)}${j.delivery ? ` · ${describeDelivery(j.delivery)}` : ""}`;
  const recent = s.jobs ? recentJobs(s.jobs).map((j) => (j.local ? ended(j.local) : `- ${j.id} · ${STATUS_TEXT[j.status]} · ${j.title}`) + machineNote(j.machine)) : s.recent.map(ended);
  if (recent.length) out.push("", "Últimos terminados:", ...recent);
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

/** The kinds of cause the unjam station tells apart, as the person in charge reads them. */
export const JAM_KIND_TEXT: Record<FactoryStatus["jams"][number]["kind"], string> = {
  code: "código",
  "flaky-test": "test intermitente",
  ci: "CI",
  "github-account": "cuenta de GitHub",
  machine: "máquina",
};

/** Who has to act, as the person in charge reads it (with the author's login when GitHub said it). */
export function whoText(who: NonNullable<FactoryStatus["jams"][number]["who"]>, author?: string): string {
  if (who === "author") return `quien abrió el pull request${author ? ` (${author})` : ""}`;
  return { owner: "vos", github: "GitHub", factory: "la fábrica" }[who];
}

/** What is missing and who has to do it: «qué falta: <todo> · lo tiene que hacer: <who>». */
export function missingText(todo: string, who: NonNullable<FactoryStatus["jams"][number]["who"]>, author?: string): string {
  return `qué falta: ${todo} · lo tiene que hacer: ${whoText(who, author)}`;
}

/** One cause of a line's jams: «<line> · <title> · N trabas · <kind> · trabajo <id> | propuesta <id> | qué falta y quién». */
export function jamLine(j: FactoryStatus["jams"][number]): string {
  const next = j.job ? `trabajo ${j.job}` : j.proposal ? `propuesta ${j.proposal} (esperando tu decisión)` : j.todo ? missingText(j.todo, j.who ?? "owner") : undefined;
  return [j.line, j.title, `${j.jams} ${j.jams === 1 ? "traba" : "trabas"}`, JAM_KIND_TEXT[j.kind], next].filter(Boolean).join(" · ");
}

/** A line's integration train: «Tren de <línea>: N pull requests; ahora <url> (<why>)», and where it stopped. */
export function trainLine(t: FactoryStatus["trains"][number]): string {
  const now = `${t.pulls} ${t.pulls === 1 ? "pull request" : "pull requests"}; ahora ${t.head}${t.why ? ` (${t.why})` : ""}`;
  return `Tren de ${t.line}: ${now}${t.block ? ` · detenido en ${t.block.pull} · ${missingText(t.block.what, t.block.who, t.block.author)}` : ""}`;
}

/** One line per repository whose checks GitHub does not start over billing, with how many pull requests wait. */
export function billingLine(b: FactoryStatus["billing"][number]): string {
  return `${billingText(b.repository, b.since)}${b.pulls.length ? ` · ${b.pulls.length} ${b.pulls.length === 1 ? "pull request espera" : "pull requests esperan"}` : ""}`;
}

const commit = (sha: string) => sha.slice(0, 12);

/** One self-update: «de <from> a <to> el HH:MM», a rollback to the previous version, or a preparation that failed. */
export function selfUpdateEntryText(e: SelfUpdateEntry, now = new Date()): string {
  const when = resetTime(e.at, now);
  if (e.outcome === "updated") return `de ${commit(e.from)} a ${commit(e.to)} el ${when}`;
  if (e.outcome === "rolled-back") return `volvió a la versión anterior ${commit(e.from)} (no arrancó ${commit(e.to)}) el ${when}${e.reason ? `: ${e.reason}` : ""}`;
  return `no pudo pasar a ${commit(e.to)}, sigue en ${commit(e.from)} (${when})${e.reason ? `: ${e.reason}` : ""}`;
}

/** A retry after a machine failure: «vuelve a intentar pasar a <commit> a las HH:MM (intento N)». */
export function selfUpdateRetryText(r: SelfUpdateRetry, now = new Date()): string {
  return `vuelve a intentar pasar a ${commit(r.commit)} a las ${resetTime(r.at, now)} (intento ${r.tries + 1})`;
}

/** A version as the person in charge reads it: its release with the short commit, or only the commit. */
export const selfUpdateTargetText = (t: SelfUpdateTarget) => (t.version ? `${releaseTag(t.version)} (${commit(t.commit)})` : commit(t.commit));

/** The «Canal:» line: the channel, the installed version and whether there is a newer one, as the last look left it. */
function channelLine(s: SelfUpdateStatus, now: Date): string {
  if (!s.look) return `Canal: ${s.channel} · todavía no se comprobó si hay una versión nueva`;
  const { current, available, checkedAt } = s.look;
  const unreleased = s.channel === "estable" && !current.version ? " (no es una versión liberada)" : "";
  // A version already prepared has a line of its own, which says when it goes in.
  const how = available && s.ready?.to !== available.commit ? "; para pasar a ella: zero actualizar" : "";
  const news = available ? `hay una versión nueva: ${selfUpdateTargetText(available)}${how}` : "no hay una versión nueva";
  return `Canal: ${s.channel} · versión actual: ${selfUpdateTargetText(current)}${unreleased} · ${news} (comprobado ${pastTime(checkedAt, now)})`;
}

/** The last update asked for: «pedida 10:00, preparando v1.1.0 (…) desde 10:01», or how it ended, with what its switch did. */
export function describeUpdateRun(r: UpdateRunRecord, last?: SelfUpdateEntry, now = new Date()): string {
  const asked = `pedida ${pastTime(r.asked, now)}`;
  const version = r.target ? selfUpdateTargetText(r.target) : "la versión nueva";
  if (!r.endedAt) return `${asked}, ${r.target ? "preparando" : "buscando"} ${version} desde ${pastTime(r.startedAt, now)}`;
  if (r.outcome === "ready") {
    const switched = last && last.to === r.target?.commit && last.at >= r.startedAt ? last : undefined;
    if (!switched) return `${asked}, ${version} quedó lista (${pastTime(r.endedAt, now)})`;
    return `${asked}, ${switched.outcome === "updated" ? "pasó" : "no pudo pasar"} a ${version} (${pastTime(switched.at, now)})`;
  }
  const how = r.outcome === "up-to-date" ? "no había una versión nueva" : r.outcome === "stopped" ? "quedó sin terminar" : "falló";
  return `${asked}, ${how} (${pastTime(r.endedAt, now)})${r.reason ? `: ${r.reason}` : ""}`;
}

/**
 * The lines of status and the panel about zero's own version, `bad` when they warn: «Canal:» with a channel, the update
 * asked for, and the «Autoactualización:» ones (a version waiting to switch, the last update, a pending retry and a problem).
 */
export function selfUpdateLines(s: SelfUpdateStatus, now = new Date()): { text: string; bad: boolean }[] {
  return [
    ...(s.channel ? [{ text: channelLine(s, now), bad: false }] : []),
    ...(s.pending ? [{ text: `Actualización a pedido: pendiente desde ${pastTime(s.pending.requestedAt, now)}`, bad: false }] : []),
    ...(s.run ? [{ text: `Última actualización a pedido: ${describeUpdateRun(s.run, s.last, now)}`, bad: s.run.outcome === "failed" || s.run.outcome === "stopped" }] : []),
    ...(s.ready ? [{ text: `Autoactualización: ${commit(s.ready.to)} está lista; cambia de versión cuando no haya trabajos corriendo (ahora ${commit(s.ready.from)})`, bad: false }] : []),
    ...(s.last ? [{ text: `Autoactualización: ${selfUpdateEntryText(s.last, now)}`, bad: s.last.outcome !== "updated" }] : []),
    ...(s.retry ? [{ text: `Autoactualización: ${selfUpdateRetryText(s.retry, now)}`, bad: false }] : []),
    ...(s.problem ? [{ text: `Autoactualización: PROBLEMA: ${s.problem}`, bad: true }] : []),
  ];
}

/** One line per environment outage: «Entorno caído en <repo> desde HH:MM (checks: a, b) · N pull requests esperan». */
export function outageLine(o: FactoryStatus["outages"][number]): string {
  const text = outageText(o.repository, o.since, o.checks);
  const waiting = o.pulls.length ? ` · ${o.pulls.length} ${o.pulls.length === 1 ? "pull request espera" : "pull requests esperan"}` : "";
  return `${text[0]!.toUpperCase()}${text.slice(1)}${waiting}`;
}
