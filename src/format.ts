import type { FactoryStatus, RequestResult } from "./app.js";
import { describeDelivery } from "./line/finish.js";
import type { Job } from "./state/store.js";

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
const name = (j: Job) => j.title ?? (j.request.length > 60 ? `${j.request.slice(0, 57)}…` : j.request);

export function formatRequest(r: RequestResult): string {
  return [`Pedido anotado: trabajo ${r.job.id} en la línea "${r.job.line}".`, r.next, r.level.reason ? `Nota: ${r.level.reason}` : ""].filter(Boolean).join("\n");
}

export function formatJob(job: Job): string {
  const lines = [
    `Trabajo ${job.id} · ${name(job)}`,
    `Estado: ${STATUS_TEXT[job.status]}${job.status === "running" && job.station ? ` (estación ${job.station}${job.attempt ? `, intento ${job.attempt}` : ""})` : ""}`,
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
        : `Caja de aislamiento: no lista; los trabajos corren en copias locales. ${s.box.availability.problems.join("; ")}`,
    );
  } else {
    out.push("Caja de aislamiento: desactivada (isolation: worktree)");
  }
  out.push(`Presupuesto de hoy: ${usd(s.budget.spentUsd)} de ${usd(s.budget.limitUsd)}${s.budget.reached ? " · ALCANZADO: los trabajos nuevos esperan a mañana" : ""}`);
  out.push(`Hoy: ${t.delivered} entregados · ${t.failed} fallidos · éxito ${t.successRate === null ? "—" : `${Math.round(t.successRate * 100)}%`} · costo ${usd(t.costUsd)}`);
  const list = (title: string, jobs: Job[]) => {
    if (!jobs.length) return;
    out.push("", `${title}:`);
    for (const j of jobs) out.push(`- ${j.id} · ${j.line} · ${name(j)}${j.station && j.status === "running" ? ` · ${j.station}` : ""}`);
  };
  list("Esperando tu respuesta", s.waiting);
  list("Trabajando", s.running);
  list("En cola", s.queued);
  if (s.recent.length) {
    out.push("", "Últimos terminados:");
    for (const j of s.recent) out.push(`- ${j.id} · ${STATUS_TEXT[j.status]} · ${name(j)}${j.delivery ? ` · ${describeDelivery(j.delivery)}` : ""}`);
  }
  return out.join("\n");
}
