import { bytes } from "../format.js";
import type { Job, Proposal, ResearchNote } from "../state/store.js";
import type { EgressSummary, Metrics } from "../telemetry/metrics.js";
import type { Post } from "./types.js";

/** What the night shift did in the period: new proposals, and the jobs born from one that finished. */
export interface NightShiftReport {
  proposals: Proposal[];
  jobs: Job[];
}

export interface Briefing {
  title: string;
  body: string;
}

const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const ref = (p: Post) => ` (${p.line}${p.job ? ` · ${p.job}` : ""})`;

/**
 * The owner's report: what the factory produced, what it cost, what needs a
 * human and what the network learned. Built from the shared metrics and the
 * townhall, without calling any model.
 */
export function renderBriefing(metrics: Metrics, posts: Post[], egress?: EgressSummary, unmerged: { url: string; why?: string }[] = [], night: NightShiftReport = { proposals: [], jobs: [] }, research: ResearchNote[] = []): Briefing {
  const ofKind = (kind: Post["kind"]) => posts.filter((p) => p.kind === kind);
  const day = metrics.to.slice(0, 10);
  const sections: string[] = [];
  if (night.proposals.length || night.jobs.length) {
    const outcome = (j: Job) => (j.status === "delivered" ? `entregado${j.delivery ? ` (${j.delivery.url ?? j.delivery.branch})` : ""}` : (j.reason ?? j.status));
    sections.push(
      [
        "## Turno nocturno",
        ...(night.proposals.length
          ? [
              "Propuestas nuevas:",
              ...night.proposals.map((p) => `- \`${p.id}\` (${p.line}) **${p.title}** · costo estimado ${usd(p.estimatedUsd)}`),
              "Aprobar: `zero proposals approve <id>` · Rechazar: `zero proposals reject <id>` (también desde el chat).",
            ]
          : []),
        ...(night.jobs.length ? ["Trabajos del turno nocturno:", ...night.jobs.map((j) => `- \`${j.id}\` (${j.line}) ${j.title ?? j.request.split("\n")[0]}: ${outcome(j)}`)] : []),
      ].join("\n"),
    );
  }
  if (research.length) {
    sections.push(
      [
        "## Investigación de hoy",
        ...research.map((n) => `- \`${n.id}\` (${n.line}) **${n.topic}** · ${n.serves}`),
        "Ver una nota: `zero research` · Pedir un trabajo a partir de una: `zero research request <id>` (también desde el chat).",
      ].join("\n"),
    );
  }
  sections.push(
    `Período: ${metrics.from} → ${metrics.to}`,
    [
      "## Producción",
      "| Entregados | Fallidos | Detenidos | Éxito | Duración media | Costo | Costo por entrega | Espera humana |",
      "|---|---|---|---|---|---|---|---|",
      `| ${metrics.delivered} | ${metrics.failed} | ${metrics.stopped} | ${pct(metrics.successRate)} | ${metrics.avgDurationMin === null ? "—" : `${metrics.avgDurationMin.toFixed(1)} min`} | ${usd(metrics.costUsd)} | ${usd(metrics.costPerDeliveryUsd)} | ${metrics.humanWaitMin.toFixed(0)} min |`,
    ].join("\n"),
  );

  const engines = Object.entries(metrics.byEngine);
  if (engines.length) {
    sections.push(
      ["## Por motor", "| Motor | Llamadas | Costo | Sin costo informado |", "|---|---|---|---|", ...engines.map(([name, e]) => `| ${name} | ${e.calls} | ${usd(e.costUsd)} | ${e.unknownCostCalls} |`)].join("\n"),
    );
  }

  const decisions = [
    ...(metrics.pendingQuestions ? [`- **${metrics.pendingQuestions} consulta(s) esperando tu respuesta.**`] : []),
    ...ofKind("blocker").map((p) => `- **Bloqueado**${ref(p)}: ${p.topic}. ${p.body}`),
    ...ofKind("proposal").map((p) => `- **Propuesta**${ref(p)}: ${p.body}`),
    ...unmerged.map((m) => `- **Sin fundir**: ${m.url}: ${m.why ?? "no se puede fundir"}.`),
    ...(egress?.sites ?? [])
      .filter((s) => s.suspicious)
      .map((s) => `- **Salida sospechosa bloqueada**: ${s.host}:${s.port}${s.jobs.length ? ` (${s.jobs.join(", ")})` : ""}: ${s.reason}. Si es legítima: \`zero egress allow ${s.host}\`.`),
  ];
  sections.push(`## Necesita al dueño\n${decisions.length ? decisions.join("\n") : "Nada. La fábrica funcionó sola."}`);

  if (egress?.connections) {
    const fresh = egress.sites.filter((s) => s.isNew && !s.blocked).map((s) => s.host);
    const sent = egress.sites.reduce((n, s) => n + s.bytesUp, 0);
    sections.push(
      [
        "## Salidas a internet",
        `${egress.connections} conexiones a ${egress.sites.length} sitios · ${egress.blocked} bloqueadas${egress.suspicious ? ` (${egress.suspicious} sospechosas)` : ""} · enviado ${bytes(sent)}.`,
        ...(fresh.length ? [`Sitios nuevos: ${fresh.join(", ")}.`] : []),
      ].join("\n"),
    );
  }

  const knowledge = [...ofKind("lesson"), ...ofKind("finding")].map((p) => `- [${p.kind}] **${p.topic}**: ${p.body}${ref(p)}`);
  if (knowledge.length) sections.push(`## Lo que aprendió la red\n${knowledge.join("\n")}`);

  const delivered = ofKind("run").filter((p) => p.kind === "run" && p.data.status === "delivered");
  if (delivered.length) {
    sections.push(`## Entregado\n${delivered.map((p) => `- ${p.topic}${ref(p)}${p.kind === "run" && p.data.delivery ? `: ${p.data.delivery}` : ""}`).join("\n")}`);
  }

  return { title: `Informe zero — ${day}`, body: sections.join("\n\n") };
}
