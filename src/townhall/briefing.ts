import type { BillingHold, FactoryStatus, OnDemandRun, Outage } from "../app.js";
import { bytes, describeAlert, describeJobStatus, describeOnDemandRun, jobOrigin, resetTime } from "../format.js";
import { billingText, outageText } from "../line/automerge.js";
import { FINAL_STATUSES, type AlertSeverity, type Job, type Proposal, type ResearchNote } from "../state/store.js";
import type { EgressSummary, Metrics } from "../telemetry/metrics.js";
import type { Post } from "./types.js";

/**
 * What the night shift did in the period: new proposals left for the owner,
 * jobs it built on its own that wait to be integrated, jobs it integrated on
 * its own, and the other jobs born from a proposal that finished.
 */
export interface NightShiftReport {
  proposals: Proposal[];
  built?: Job[];
  integrated?: Job[];
  jobs: Job[];
}

/** An open Dependabot alert of a line and the job that handles it, if any. */
export interface BriefingAlert {
  line: string;
  number: number;
  package: string;
  ecosystem: string;
  severity: AlertSeverity;
  fixed?: string;
  job?: string;
  jobStatus?: Job["status"];
}

/** On-demand station runs: the ones still pending and the ones that started or ended in the period. */
export interface BriefingOnDemand {
  pending: FactoryStatus["onDemand"];
  runs: OnDemandRun[];
}

export interface Briefing {
  title: string;
  body: string;
}

const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const ref = (p: Post) => ` (${p.line}${p.job ? ` · ${p.job}` : ""})`;

/** A subheading with its research notes, or nothing when there are none. */
const researchGroup = (title: string, notes: ResearchNote[]) => (notes.length ? [`### ${title}`, ...notes.map((n) => `- \`${n.id}\` (${n.line}) **${n.topic}** · ${n.serves}`)] : []);

const outcome = (j: Job) => (j.status === "delivered" ? `entregado${j.delivery ? ` (${j.delivery.url ?? j.delivery.branch})` : ""}` : (j.reason ?? j.status));
const jobLabel = (j: Job) => `\`${j.id}\` (${j.line}) ${j.title ?? j.request.split("\n")[0]}`;

/**
 * The owner's report: what the factory produced, what it cost, what needs a
 * human and what the network learned. Built from the shared metrics and the
 * townhall, without calling any model.
 */
export function renderBriefing(metrics: Metrics, posts: Post[], egress?: EgressSummary, unmerged: { url: string; why?: string }[] = [], night: NightShiftReport = { proposals: [], jobs: [] }, research: ResearchNote[] = [], packages: Job[] = [], alerts: BriefingAlert[] = [], onDemand: BriefingOnDemand = { pending: [], runs: [] }, outages: Outage[] = [], billing: BillingHold[] = []): Briefing {
  const ofKind = (kind: Post["kind"]) => posts.filter((p) => p.kind === kind);
  const day = metrics.to.slice(0, 10);
  const sections: string[] = [];
  const built = night.built ?? [];
  const integrated = night.integrated ?? [];
  if (night.proposals.length || built.length || integrated.length || night.jobs.length) {
    const proposalOf = (j: Job) => (j.source?.kind === "night-shift" ? j.source.proposal : j.id);
    sections.push(
      [
        "## Turno nocturno",
        ...(night.proposals.length
          ? [
              "### Propuesto (espera tu decisión)",
              ...night.proposals.map((p) => `- \`${p.id}\` (${p.line}) **${p.title}** · costo estimado ${usd(p.estimatedUsd)}${p.researchNote ? ` · nace de la nota \`${p.researchNote}\`` : ""}`),
              "Aprobar: `zero proposals approve <id>` · Rechazar: `zero proposals reject <id>` (también desde el chat).",
            ]
          : []),
        ...(built.length
          ? [
              "### Construido solo (espera tu aprobación para integrar)",
              ...built.map((j) => `- ${jobLabel(j)} · propuesta \`${proposalOf(j)}\``),
              "Integrar: `zero proposals approve <propuesta>` · Descartar: `zero proposals reject <propuesta>`.",
            ]
          : []),
        ...(integrated.length ? ["### Integrado solo", ...integrated.map((j) => `- ${jobLabel(j)}: ${outcome(j)}`)] : []),
        ...(night.jobs.length ? ["### Otros trabajos del turno nocturno", ...night.jobs.map((j) => `- ${jobLabel(j)}: ${outcome(j)}`)] : []),
      ].join("\n"),
    );
  }
  if (research.length) {
    sections.push(
      [
        "## Investigación de hoy",
        ...researchGroup("Negocio", research.filter((n) => n.business)),
        ...researchGroup("Técnica", research.filter((n) => !n.business)),
        "Ver una nota: `zero research` · Pedir un trabajo a partir de una: `zero research request <id>` (también desde el chat).",
      ].join("\n"),
    );
  }
  if (packages.length) {
    sections.push(["## Pedidos de paquetes", ...packages.map((j) => `- ${jobLabel(j)} · ${jobOrigin(j)}: ${FINAL_STATUSES.includes(j.status) ? outcome(j) : describeJobStatus(j)}`)].join("\n"));
  }
  if (alerts.length) {
    sections.push(["## Alertas de seguridad", ...alerts.map((a) => `- (${a.line}) ${describeAlert(a)}`)].join("\n"));
  }
  if (onDemand.pending.length || onDemand.runs.length) {
    const now = new Date(metrics.to);
    sections.push(
      [
        "## Corridas a demanda",
        ...onDemand.pending.map((d) => `- ${d.station}: pendiente desde ${resetTime(d.since, now)}`),
        ...onDemand.runs.map((r) => `- ${describeOnDemandRun(r, now)}`),
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
    ...outages.map((o) => `- **E${outageText(o.repository, o.since, o.checks).slice(1)}**: no se gasta nada en sus pull requests hasta que vuelva.`),
    ...billing.map((b) => `- **${billingText(b.repository, b.since)}**.`),
    ...unmerged.map((m) => `- **Sin fundir**: ${m.url}: ${m.why ?? "no se puede fundir"}.`),
    ...(egress?.sites ?? [])
      .filter((s) => s.suspicious)
      .map((s) => `- **Salida sospechosa bloqueada**: ${s.host}:${s.port}${s.jobs.length ? ` (${s.jobs.join(", ")})` : ""}: ${s.reason}. Si es legítima: \`zero egress allow ${s.host}\`.`),
  ];
  sections.push(`## Te necesita\n${decisions.length ? decisions.join("\n") : "Nada. La fábrica funcionó sola."}`);

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
