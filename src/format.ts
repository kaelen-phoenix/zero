import type { EgressReport, FactoryStatus, RequestResult, SkillList } from "./app.js";
import type { SkillProblem } from "./skills.js";
import { describeDelivery } from "./line/finish.js";
import type { Job } from "./state/store.js";
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
export const jobName = (j: Job) => j.title ?? (j.request.length > 60 ? `${j.request.slice(0, 57)}…` : j.request);

/** "trabajando (estación build, intento 2)", "esperando tu respuesta", … */
export function describeJobStatus(job: Job): string {
  return `${STATUS_TEXT[job.status]}${job.status === "running" && job.station ? ` (estación ${job.station}${job.attempt ? `, intento ${job.attempt}` : ""})` : ""}`;
}

export function formatRequest(r: RequestResult): string {
  return [`Pedido anotado: trabajo ${r.job.id} en la línea "${r.job.line}".`, r.next, r.level.reason ? `Nota: ${r.level.reason}` : ""].filter(Boolean).join("\n");
}

export function formatJob(job: Job): string {
  const lines = [
    `Trabajo ${job.id} · ${jobName(job)}`,
    `Estado: ${describeJobStatus(job)}`,
    `Línea: ${job.line} · Costo: ${usd(job.costUsd)} de ${usd(job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0))}`,
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

export function formatStatus(s: FactoryStatus): string {
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
  out.push(`Presupuesto de hoy: ${usd(s.budget.spentUsd)} de ${usd(s.budget.limitUsd)}${s.budget.reached ? " · ALCANZADO: los trabajos nuevos esperan a mañana" : ""}`);
  out.push(`Hoy: ${t.delivered} entregados · ${t.failed} fallidos · éxito ${t.successRate === null ? "—" : `${Math.round(t.successRate * 100)}%`} · costo ${usd(t.costUsd)}`);
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
