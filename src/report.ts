import { scrubLocal } from "./line/research.js";
import { esc } from "./panel/html.js";
import type { Job, SpanRow } from "./state/store.js";
import { AGENT_SPAN } from "./telemetry/metrics.js";

/**
 * The monthly report of a line, for the owner and to share with that line's
 * client. Code writes every word from what `state.db` already holds; no agent
 * takes part, nothing is written and nothing leaves the machine from here.
 */

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const LOCAL_PATH = "(ruta local)";
const NO_SUMMARY = "(sin descripción guardada)";
const NO_DELIVERY = "(sin entrega registrada)";
// Where a path written in plain text ends, like the patterns of `scrubLocal`.
const PATH_TAIL = "[^\\s\"'`<>|)\\]]*";

export interface ReportLink {
  text: string;
  /** Always http(s); without it the link is plain text. */
  url?: string;
}

export interface ReportJob {
  title: string;
  /** AAAA-MM-DD, local time. */
  requested: string;
  delivered: string;
  origin: string;
  summary: string;
  link: ReportLink;
}

export interface ReportTotals {
  delivered: number;
  failed: number;
  stopped: number;
  attempts: number;
  ms: number;
  costUsd: number;
  /** The part of `costUsd` that came from subscription calls: an estimate, never charged. */
  subscriptionUsd: number;
}

export interface LineReport {
  line: string;
  month: string;
  jobs: ReportJob[];
  totals: ReportTotals;
}

export interface MonthlyReport {
  month: string;
  lines: LineReport[];
}

const two = (n: number) => String(n).padStart(2, "0");

/** The local-time bounds of a month: `from` is included, `to` is not. */
export function parseMonth(month: string): { from: Date; to: Date } {
  const m = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`El mes "${month}" no es válido: escribilo como AAAA-MM, por ejemplo 2026-10.`);
  const [year, index] = [Number(m[1]), Number(m[2]) - 1];
  return { from: new Date(year, index, 1), to: new Date(year, index + 1, 1) };
}

/** The calendar month before `now`, in local time. */
export function previousMonth(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}`;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

const monthName = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}`;

/** A path as a pattern for any slash, including its MSYS spelling; undefined when it is not an absolute-looking path. */
function pathPattern(path: string): string | undefined {
  const parts = path.split(/[\\/]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length || !/[\\/]/.test(path)) return undefined;
  const sep = "[\\\\/]+";
  const drive = /^[a-z]:$/i.exec(parts[0]!);
  if (drive) return `(?:${parts[0]}|${sep}${parts[0]![0]})${sep}${parts.slice(1).join(sep)}`;
  return `${sep}${parts.join(sep)}`;
}

/**
 * Stored text fit to share: secrets and local paths out. `scrub` shortens the
 * home folder to `~`, so the repositories go first (a path with spaces is only
 * known whole) and the `~/...` it leaves goes last. Another line's repository
 * goes entirely; the line's own leaves the path inside it, which is the client's.
 */
export function reportText(text: string, repos: { own?: string; all: string[] }): string {
  let out = text;
  for (const repo of [...new Set(repos.all)].sort((a, b) => b.length - a.length)) {
    const pattern = pathPattern(repo);
    if (!pattern) continue;
    out = repo === repos.own ? out.replace(new RegExp(`${pattern}[\\\\/]?`, "gi"), "") : out.replace(new RegExp(pattern + PATH_TAIL, "gi"), LOCAL_PATH);
  }
  out = scrubLocal(out, { repo: repos.own ?? "" });
  return out.replace(new RegExp(`(?<![\\w~/\\\\.-])~[\\\\/]${PATH_TAIL}`, "g"), LOCAL_PATH);
}

function originLabel(job: Job): string {
  switch (job.source?.kind) {
    case "github-issue":
      return `Issue de GitHub #${job.source.number}`;
    case "linear-issue":
      return `Issue de Linear ${job.source.identifier}`;
    case "jira-issue":
      return `Issue de Jira ${job.source.key}`;
    case "night-shift":
      return job.source.autonomy ? "Propuesta que el turno nocturno tomó por su cuenta" : "Propuesta del turno nocturno aprobada por la persona responsable";
    case "research":
      return "Investigación";
    case "package":
      return `Pedido por paquete ${job.source.package}/${job.source.station}`;
    default:
      return "Pedido de la persona responsable";
  }
}

/** Only absolute http(s) addresses become links, without any credentials they carry. */
function webUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function deliveryLink(job: Job, repository: string | undefined, clean: (text: string) => string): ReportLink {
  const { url, commit, branch } = job.delivery ?? {};
  if (url) {
    const web = webUrl(url);
    if (web) return { text: "solicitud de cambio", url: clean(web) };
    return { text: clean(url) };
  }
  if (commit && /^[0-9a-f]+$/i.test(commit)) {
    const short = commit.slice(0, 8);
    return repository ? { text: `commit ${short}`, url: `https://github.com/${repository}/commit/${commit}` } : { text: short };
  }
  const name = branch ?? job.branch;
  return { text: name ? clean(name) : NO_DELIVERY };
}

const storedSummary = (job: Job): string => {
  const summary = (job.spec as { summary?: unknown } | undefined)?.summary;
  return typeof summary === "string" ? summary : "";
};

/** What the job's subscription calls cost; a call without billing data does not count. */
function subscriptionCost(spans: SpanRow[]): number {
  return spans.filter((s) => s.name === AGENT_SPAN && s.attrs["zero.billing"] === "subscription").reduce((sum, s) => sum + (Number(s.attrs["zero.cost.usd"]) || 0), 0);
}

export interface LineReportInput {
  line: string;
  month: string;
  /** Jobs of this line that finished in the month. */
  jobs: Job[];
  spansOf: (jobId: string) => SpanRow[];
  /** The line's repository, when it is still configured. */
  repo?: string;
  /** The repositories of every configured line. */
  allRepos: string[];
  /** owner/repo when the line's remote is on GitHub. */
  repository?: string;
}

export function buildLineReport(input: LineReportInput): LineReport {
  const clean = (text: string) => reportText(text, { own: input.repo, all: input.allRepos });
  const count = (status: Job["status"]) => input.jobs.filter((j) => j.status === status).length;
  const totals: ReportTotals = { delivered: count("delivered"), failed: count("failed"), stopped: count("stopped"), attempts: 0, ms: 0, costUsd: 0, subscriptionUsd: 0 };
  for (const job of input.jobs) {
    totals.attempts += job.attempt;
    totals.ms += Math.max(0, Date.parse(job.finishedAt!) - Date.parse(job.createdAt));
    totals.costUsd += job.costUsd;
    totals.subscriptionUsd += subscriptionCost(input.spansOf(job.id));
  }
  const jobs = input.jobs
    .filter((j) => j.status === "delivered")
    .map((j): ReportJob => ({
      title: j.title ? clean(j.title) : clean(j.request.split("\n")[0]!).slice(0, 80),
      requested: localDay(j.createdAt),
      delivered: localDay(j.finishedAt!),
      origin: originLabel(j),
      summary: clean(storedSummary(j)).trim() || NO_SUMMARY,
      link: deliveryLink(j, input.repository, clean),
    }));
  return { line: clean(input.line), month: input.month, jobs, totals };
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The month's cost, saying which part was an estimate that nobody charged. */
function costText(t: ReportTotals): string {
  const cost = usd(t.costUsd);
  if (t.subscriptionUsd < 0.005) return cost;
  if (t.subscriptionUsd >= t.costUsd - 0.005) return `${cost} (costo estimado con suscripción; no se cobró)`;
  return `${cost}, de los cuales ${usd(t.subscriptionUsd)} son estimados con suscripción y no se cobraron`;
}

const totalRows = (t: ReportTotals): [string, string][] => [
  ["Trabajos entregados", String(t.delivered)],
  ["Intentos", String(t.attempts)],
  ["Tiempo", duration(t.ms)],
  ["Costo del mes", costText(t)],
];
const INFORMATIVE = (t: ReportTotals) => `Aparte, como información y no como trabajo hecho: fallidos: ${t.failed}, detenidos: ${t.stopped}.`;
const SUMS_NOTE = "Intentos, tiempo y costo suman todos los trabajos terminados en el mes, incluidos los fallidos y los detenidos. El tiempo va del pedido al cierre e incluye las esperas.";
const NOTHING = "No hubo trabajos entregados en este mes.";
const reportTitle = (l: LineReport) => `Informe mensual de ${l.line}: ${monthName(l.month)}`;

/** One line of Markdown that renders as the text it says: no line breaks, tags or links of its own. */
const mdText = (text: string) => text.replace(/\s+/g, " ").trim().replace(/[\\`<>[\]|]/g, "\\$&");
const mdUrl = (url: string) => url.replace(/\(/g, "%28").replace(/\)/g, "%29");
const mdLink = (link: ReportLink) => (link.url ? `[${mdText(link.text)}](${mdUrl(link.url)})` : mdText(link.text));

export function reportMarkdown(l: LineReport): string {
  const jobs = l.jobs.map((j) => `- **${mdText(j.title)}**: pedido ${j.requested}, entregado ${j.delivered} · Origen: ${j.origin} · Qué cambió: ${mdText(j.summary)} · Entrega: ${mdLink(j.link)}`);
  return [
    `# ${mdText(reportTitle(l))}`,
    "## Trabajos entregados",
    jobs.length ? jobs.join("\n") : NOTHING,
    "## Totales",
    totalRows(l.totals).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
    INFORMATIVE(l.totals),
    SUMS_NOTE,
  ].join("\n\n");
}

/** Every line of a report, in the same Markdown the CLI prints and the chat returns. */
export const monthlyMarkdown = (report: MonthlyReport) => report.lines.map(reportMarkdown).join("\n\n---\n\n");

const htmlLink = (link: ReportLink) => (link.url ? `<a href="${esc(link.url)}" rel="noopener noreferrer">${esc(link.text)}</a>` : esc(link.text));

/** A line's report as an HTML fragment: the body of the exported file and of the panel's tab. */
export function reportSection(l: LineReport): string {
  const jobs = l.jobs.map(
    (j) =>
      `<li><b>${esc(j.title)}</b><br>Pedido ${esc(j.requested)}, entregado ${esc(j.delivered)}. Origen: ${esc(j.origin)}.<br>Qué cambió: ${esc(j.summary)}<br>Entrega: ${htmlLink(j.link)}</li>`,
  );
  return `<h1>${esc(reportTitle(l))}</h1>
<h2>Trabajos entregados</h2>
${jobs.length ? `<ul>${jobs.join("")}</ul>` : `<p>${NOTHING}</p>`}
<h2>Totales</h2>
<ul>${totalRows(l.totals).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>
<p>${esc(INFORMATIVE(l.totals))}</p>
<p>${esc(SUMS_NOTE)}</p>`;
}

/** A document that stands alone: no scripts, no outside resources, ready to send. */
export function reportHtml(l: LineReport): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(reportTitle(l))}</title>
<style>body { max-width:760px; margin:0 auto; padding:16px; color:#16181d; font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; } li { margin:8px 0; overflow-wrap:anywhere; }</style></head>
<body>${reportSection(l)}</body></html>
`;
}

/** The export's file name, with nothing a header or a file system could trip on. */
export const reportFileName = (l: LineReport, format: "md" | "html") => `informe-${l.line}-${l.month}.${format}`.replace(/[^A-Za-z0-9._-]/g, "-");
