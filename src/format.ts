import type { EgressReport, FactoryStatus, RequestResult, SkillList } from "./app.js";
import type { SkillProblem } from "./skills.js";
import { pausedText, resetTime, type BudgetState } from "./budget.js";
import { describeDelivery } from "./line/finish.js";
import type { Job, Proposal, ResearchNote } from "./state/store.js";
import type { EgressSite, EgressSummary } from "./telemetry/metrics.js";

/** Owner-facing text, shared by the CLI and the chat so both say the same thing. */

const STATUS_TEXT: Record<Job["status"], string> = {
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

/** "trabajando (estación build, intento 2)", "esperando tu respuesta", … */
export function describeJobStatus(job: Job): string {
  return `${STATUS_TEXT[job.status]}${job.status === "running" && job.station ? ` (estación ${job.station}${job.attempt ? `, intento ${job.attempt}` : ""})` : ""}`;
}

export function formatRequest(r: RequestResult): string {
  return [`Pedido anotado: trabajo ${r.job.id} en la línea "${r.job.line}".`, r.next, r.level.reason ? `Nota: ${r.level.reason}` : ""].filter(Boolean).join("\n");
}

/** Proposals of the night shift waiting for the owner; `detail` adds why and what would change. */
export function formatProposals(proposals: Proposal[], detail = false): string {
  if (!proposals.length) return "No hay propuestas pendientes.";
  const rows = proposals.map(
    (p) => `${p.id} · ${p.line} · ${p.title} (costo estimado ${usd(p.estimatedUsd)})${detail ? `\nPor qué: ${p.why}\nQué cambiaría: ${p.change}` : ""}`,
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
  ];
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

export function formatSkills(l: SkillList): string {
  const out = ["Skills asignadas:"];
  for (const a of l.assignments) out.push(`- ${a.station}${a.line ? ` (línea ${a.line})` : ""}: ${a.skills.join(", ") || "ninguna"}`);
  for (const p of l.problems) out.push(`  ${skillWarning(p)}`);
  out.push("", "Skills disponibles en Claude Code:");
  if (!l.available.length) out.push("- ninguna (personales en ~/.claude/skills o de plugins instalados)");
  for (const s of l.available) out.push(`- ${s.fullName}${s.source === "plugin" ? ` (plugin ${s.plugin})` : " (personal)"}`);
  return out.join("\n");
}

export function formatStatus(s: FactoryStatus, now = new Date()): string {
  const t = s.today;
  const out = [
    `Fábrica: ${s.andon ? "DETENIDA (andon)" : s.daemon.alive ? "en marcha" : "apagada (arranca sola con el próximo pedido)"} · nivel ${s.level.level}${s.level.configured !== s.level.level ? ` (configurado ${s.level.configured})` : ""}`,
  ];
  if (s.level.reason) out.push(`  ${s.level.reason}`);
  if (s.isolation === "container") {
    const st = s.box.status;
    out.push(
      s.box.availability.ready && st
        ? `Caja de aislamiento: lista (${st.runtime} · ${st.image})`
        : `Caja de aislamiento: no lista; los trabajos corren en copias locales.${s.level.reason ? "" : ` ${s.box.availability.problems.join("; ")}`}`,
    );
  } else {
    out.push("Caja de aislamiento: desactivada (isolation: worktree)");
  }
  if (s.isolation === "container" && s.box.availability.ready) {
    const e = s.today.egress;
    out.push(`Salidas a internet hoy: ${e.connections} conexiones · ${e.blocked} bloqueadas${e.suspicious ? ` (${e.suspicious} sospechosas: \`zero egress\`)` : ""} · modo ${s.egressMode}`);
  }
  for (const i of s.intake) out.push(`Issues de GitHub: la línea ${i.line} toma los issues con la etiqueta "${i.label}"${i.problem ? ` · PROBLEMA: ${i.problem}` : ""}`);
  for (const p of s.skills) out.push(skillWarning(p));
  for (const m of s.merges) out.push(`Fusión automática: ${m.url} (${m.job}) · ${m.status === "blocked" ? `NO SE FUNDE: ${m.why}` : (m.why ?? "esperando")}`);
  out.push(budgetLine(s.budget, now));
  out.push(`Hoy: ${t.delivered} entregados · ${t.failed} fallidos · éxito ${t.successRate === null ? "—" : `${Math.round(t.successRate * 100)}%`} · costo${s.budget.billing === "subscription" ? " estimado" : ""} ${usd(t.costUsd)}`);
  const list = (title: string, jobs: Job[]) => {
    if (!jobs.length) return;
    out.push("", `${title}:`);
    for (const j of jobs) out.push(`- ${j.id} · ${j.line} · ${jobName(j)}${j.station && j.status === "running" ? ` · ${j.station}` : ""}`);
  };
  list("Esperando tu respuesta", s.waiting);
  list("Trabajando", s.running);
  list("En cola", s.queued);
  if (s.recent.length) {
    out.push("", "Últimos terminados:");
    for (const j of s.recent) out.push(`- ${j.id} · ${STATUS_TEXT[j.status]} · ${jobName(j)}${j.delivery ? ` · ${describeDelivery(j.delivery)}` : ""}`);
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
