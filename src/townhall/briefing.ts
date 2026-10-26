import type { Metrics } from "../telemetry/metrics.js";
import type { Post } from "./types.js";

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
export function renderBriefing(metrics: Metrics, posts: Post[]): Briefing {
  const ofKind = (kind: Post["kind"]) => posts.filter((p) => p.kind === kind);
  const day = metrics.to.slice(0, 10);
  const sections: string[] = [
    `Período: ${metrics.from} → ${metrics.to}`,
    [
      "## Producción",
      "| Entregados | Fallidos | Detenidos | Éxito | Duración media | Costo | Costo por entrega | Espera humana |",
      "|---|---|---|---|---|---|---|---|",
      `| ${metrics.delivered} | ${metrics.failed} | ${metrics.stopped} | ${pct(metrics.successRate)} | ${metrics.avgDurationMin === null ? "—" : `${metrics.avgDurationMin.toFixed(1)} min`} | ${usd(metrics.costUsd)} | ${usd(metrics.costPerDeliveryUsd)} | ${metrics.humanWaitMin.toFixed(0)} min |`,
    ].join("\n"),
  ];

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
  ];
  sections.push(`## Necesita al dueño\n${decisions.length ? decisions.join("\n") : "Nada. La fábrica funcionó sola."}`);

  const knowledge = [...ofKind("lesson"), ...ofKind("finding")].map((p) => `- [${p.kind}] **${p.topic}**: ${p.body}${ref(p)}`);
  if (knowledge.length) sections.push(`## Lo que aprendió la red\n${knowledge.join("\n")}`);

  const delivered = ofKind("run").filter((p) => p.kind === "run" && p.data.status === "delivered");
  if (delivered.length) {
    sections.push(`## Entregado\n${delivered.map((p) => `- ${p.topic}${ref(p)}${p.kind === "run" && p.data.delivery ? `: ${p.data.delivery}` : ""}`).join("\n")}`);
  }

  return { title: `Informe zero — ${day}`, body: sections.join("\n\n") };
}
