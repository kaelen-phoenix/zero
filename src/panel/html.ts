import { createHash } from "node:crypto";
import { REQUEST_TYPES, type AgentGuide, type EgressReport, type FactoryGuide, type FactoryStatus, type LineRow, type LineStation, type MonitorPeriod, type MonitorView, type PackageList, type PackageTabLink, type PackageTabView, type ProductionLine, type ProposalLine, type ProposalStage, type ProposalView, type RequestFilter, type RequestsView, type ResearchLine, type StationState, type StationView } from "../app.js";
import type { Autonomy, StationName } from "../config.js";
import { budgetLine, bytes, describeJobStatus, describeStationRun, jobCost, jobName, jobOrigin, onDemandState, outageLine, planSummary, selfUpdateLines, resetTime, STATUS_TEXT } from "../format.js";
import { describeDelivery } from "../line/finish.js";
import { bars, gauge, lineChart } from "./charts.js";
import type { PolicyEvent } from "../line/policy.js";
import { safeUrl } from "../package-tabs.js";
import { reportSection, type MonthlyReport } from "../report.js";
import { FINAL_STATUSES, type Job, type JobStatus, type ResearchNote } from "../state/store.js";
import type { EgressSite } from "../telemetry/metrics.js";
import type { SkillView } from "../skills.js";

/** Pages of the control panel: plain HTML rendered on the server, made for a phone first. */

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const usd = (n: number) => `$${n.toFixed(2)}`;

const STYLE = `
:root { color-scheme:light dark; --bg:#fbfbf9; --fg:#111111; --muted:#5c5c58; --accent:#a8360b; --on-accent:#ffffff; --surface:#ffffff; --surface-2:#f3f3ef; --rule:#dcdcd6; --code-bg:#f0f0eb;
  --st-queued:#6b6b66; --st-active:#1f5fbf; --st-waiting:#9a5b00; --st-ok:#1f7a45; --st-bad:#b42318; --st-stopped:#6d5a8a;
  --warn:var(--st-waiting); --bad:var(--st-bad); --ok:var(--st-ok); --side-w:232px; --side-min:64px;
  --sans:system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; --mono:ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e0e0f; --fg:#ececea; --muted:#a3a3a0; --accent:#ff8a5c; --on-accent:#0e0e0f; --surface:#161618; --surface-2:#121214; --rule:#2c2c2f; --code-bg:#19191b;
  --st-queued:#9a9a96; --st-active:#7aa7ff; --st-waiting:#f0b35e; --st-ok:#5fd394; --st-bad:#ff7b7b; --st-stopped:#b8a3dd; } }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 var(--sans); overflow-wrap:break-word; }
body.shell { display:flex; min-height:100vh; }
a { color:var(--accent); text-underline-offset:.2em; }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:4px; }
code, pre { font-family:var(--mono); }
:not(pre) > code { background:var(--code-bg); padding:.1em .35em; border-radius:4px; font-size:.9em; }
.brand { display:inline-flex; align-items:center; gap:10px; font:600 1.2rem/1 var(--mono); letter-spacing:-.02em; color:var(--fg); }
.brand .logo { width:26px; height:26px; flex:none; }
header.top { padding:14px 20px; border-bottom:1px solid var(--rule); background:var(--surface); }
.nav-toggle { position:absolute; opacity:0; width:1px; height:1px; pointer-events:none; }
.side { position:sticky; top:0; height:100vh; width:var(--side-w); flex:none; display:flex; flex-direction:column; gap:6px; padding:14px 10px; background:var(--surface); border-right:1px solid var(--rule); overflow-y:auto; transition:width .2s ease; }
.side .brand-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 6px 12px; }
.side .toggle { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:8px; color:var(--muted); cursor:pointer; margin:0; }
.side .toggle:hover { background:var(--surface-2); color:var(--fg); }
#nav-toggle:focus-visible ~ .side .toggle { outline:2px solid var(--accent); }
.side ul.links { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.side ul.links a { display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:8px; color:var(--muted); text-decoration:none; font-weight:500; white-space:nowrap; }
.side ul.links a:hover { background:var(--surface-2); color:var(--fg); }
.side ul.links a[aria-current="page"] { background:var(--surface-2); color:var(--accent); box-shadow:inset 3px 0 0 var(--accent); }
.side svg, .ic svg { width:20px; height:20px; flex:none; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
#nav-toggle:checked ~ .side { width:var(--side-min); }
#nav-toggle:checked ~ .side .lb, #nav-toggle:checked ~ .side .word { display:none; }
#nav-toggle:checked ~ .side .brand-row { flex-direction:column; padding:4px 0 12px; }
#nav-toggle:checked ~ .side ul.links a { justify-content:center; padding:9px 0; }
main { flex:1; min-width:0; padding:22px 28px 40px; }
main > :not(#line) { max-width:980px; }
body.plain main { max-width:480px; margin:0 auto; }
.card { background:var(--surface); border:1px solid var(--rule); border-radius:12px; padding:14px 16px; margin:0 0 14px; }
h1 { font-size:1.35rem; line-height:1.25; margin:0 0 10px; letter-spacing:-.01em; } h2 { font-size:1.08rem; margin:20px 0 8px; } h3 { font-size:1rem; margin:0 0 6px; }
.card > h2:first-child { margin-top:0; }
.muted { color:var(--muted); font-size:.92rem; } .warn { color:var(--warn); } .bad { color:var(--bad); } .ok { color:var(--ok); }
pre { white-space:pre-wrap; word-break:break-word; background:var(--code-bg); border:1px solid var(--rule); border-radius:8px; padding:10px; font:13px/1.45 var(--mono); margin:8px 0; }
form { margin:8px 0 0; } form.inline { display:inline; }
button { font:inherit; font-weight:500; padding:8px 14px; border-radius:8px; border:1px solid var(--rule); background:var(--surface); color:var(--fg); cursor:pointer; margin:4px 6px 0 0; }
button:hover { border-color:var(--muted); }
button.primary { background:var(--accent); border-color:var(--accent); color:var(--on-accent); } button.danger { border-color:var(--bad); color:var(--bad); }
textarea, input, select { font:inherit; width:100%; padding:9px 10px; border-radius:8px; border:1px solid var(--rule); background:var(--bg); color:var(--fg); }
textarea { min-height:90px; } label { display:block; margin:8px 0 4px; font-size:.92rem; color:var(--muted); }
ul.jobs { list-style:none; padding:0; margin:0; } ul.jobs li { padding:10px 0; border-top:1px solid var(--rule); } ul.jobs li:first-child { border-top:0; }
ul.jobs .top { display:flex; gap:8px; align-items:center; justify-content:space-between; }
a.job { color:var(--fg); text-decoration:none; } a.job:hover { text-decoration:underline; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; }
.stat { border-left:3px solid var(--rule); padding:2px 0 2px 10px; }
.stat b { display:block; font:600 1.4rem/1.2 var(--mono); }
.flash { border-color:var(--accent); box-shadow:inset 3px 0 0 var(--accent); }
table { border-collapse:collapse; width:100%; font-size:.9rem; display:block; overflow-x:auto; } td, th { border:1px solid var(--rule); padding:4px 6px; text-align:left; }
[data-status="queued"], [data-state="pending"] { --st:var(--st-queued); }
[data-status="running"], [data-state="active"] { --st:var(--st-active); }
[data-status="waiting"], [data-state="waiting"] { --st:var(--st-waiting); }
[data-status="delivered"], [data-state="done"] { --st:var(--st-ok); }
[data-status="failed"], [data-state="error"] { --st:var(--st-bad); }
[data-status="stopped"] { --st:var(--st-stopped); }
.chip { display:inline-flex; align-items:center; gap:5px; flex:none; font-size:.75rem; font-weight:600; line-height:1; padding:4px 8px; border-radius:999px; color:var(--st); border:1px solid var(--st); background:var(--surface); white-space:nowrap; }
.chip::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--st); }
.badge { display:inline-block; font-size:.8rem; padding:1px 8px; border-radius:9px; border:1px solid currentColor; }
.board-note:empty { display:none; }
.board { display:grid; grid-template-columns:repeat(8, minmax(0, 1fr)); gap:8px; height:calc(100vh - 13rem); min-height:22rem; }
.lane { display:flex; flex-direction:column; min-width:0; background:var(--surface-2); border:1px solid var(--rule); border-radius:10px; overflow-y:auto; }
.lane-head { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:6px; padding:8px; background:var(--surface-2); border-bottom:1px solid var(--rule); font-size:.8rem; font-weight:600; }
.lane-head .ic svg { width:16px; height:16px; }
.lane-head .ln { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lane-head .n { font-family:var(--mono); color:var(--muted); }
.lane[data-count="0"] .lane-head .n { opacity:.5; }
.lane .cards { display:flex; flex-direction:column; gap:6px; padding:6px; }
.card.job { margin:0; padding:8px; border-radius:8px; border-left:3px solid var(--st); font-size:.82rem; transition:border-color .3s; }
.card.job .jh { display:flex; flex-direction:column; align-items:flex-start; gap:4px; margin:0; font-size:.85rem; }
.card.job .jh a { font-weight:600; overflow-wrap:anywhere; }
.card.job .meta { margin:4px 0 0; font-size:.75rem; overflow-wrap:anywhere; }
.card.job .retry, .card.job .out { margin:6px 0 0; font-size:.78rem; overflow-wrap:anywhere; }
ol.stations { list-style:none; margin:6px 0 0; padding:0; display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:2px; }
.st { min-width:0; color:var(--st); border-radius:5px; }
.st[data-state="pending"] { color:var(--muted); opacity:.6; }
.st summary { list-style:none; cursor:pointer; display:flex; justify-content:center; padding:2px 0; border-radius:5px; } .st summary::-webkit-details-marker { display:none; }
.st summary:hover { background:var(--surface-2); }
.st .ic { display:inline-flex; } .st .ic svg { width:15px; height:15px; }
.st .nm, .st .mk, .st .tx { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.st:has(details[open]) { grid-column:1 / -1; order:9; }
.st .dt { color:var(--fg); text-align:left; padding:6px; margin-top:2px; background:var(--surface-2); border-radius:6px; overflow-wrap:anywhere; font-size:.75rem; }
.st .why { display:block; color:var(--bad); }
@keyframes spin { to { transform:rotate(360deg); } }
@keyframes glow { 0%,100% { opacity:1; } 50% { opacity:.4; } }
@keyframes bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-2px); } }
.job:not(.final) .st[data-state="active"] .ic { animation:bob 1.4s ease-in-out infinite; }
.job:not(.final) .st[data-state="active"][data-station="build"] .ic { animation:spin 2.4s linear infinite; }
.job:not(.final) .st[data-state="waiting"] .ic { animation:glow 2.2s ease-in-out infinite; }
ol.route { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px 22px; counter-reset:step; }
ol.route li { position:relative; flex:1 1 150px; border:1px solid var(--rule); border-radius:9px; padding:8px 10px; counter-increment:step; }
ol.route li b::before { content:counter(step) ". "; color:var(--muted); }
ol.route li:not(:last-child)::after { content:"→"; position:absolute; right:-17px; top:50%; transform:translateY(-50%); color:var(--accent); }
ol.route li span { display:block; font-size:.88rem; color:var(--muted); }
.kv { margin:6px 0 0; padding:0; list-style:none; } .kv li { margin:3px 0; overflow-wrap:anywhere; } .kv code { overflow-wrap:anywhere; white-space:pre-wrap; }
details.ins summary { cursor:pointer; color:var(--accent); margin-top:8px; }
@media (max-width: 600px) { ol.route { flex-direction:column; gap:22px; } ol.route li { flex-basis:auto; } ol.route li:not(:last-child)::after { content:"↓"; right:auto; left:50%; top:auto; bottom:-21px; transform:none; } }
.monitor { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin:0 0 14px; } .monitor .card { margin:0; }
.monitor .big { display:block; font-size:2rem; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
.monitor .wide { grid-column:1 / -1; } .monitor svg { width:100%; height:auto; display:block; }
.gauges { display:flex; flex-wrap:wrap; gap:10px; } figure.gauge { margin:0; width:110px; text-align:center; font-size:.85rem; color:var(--muted); } figure.gauge svg { color:var(--text); }
.periods a { margin-right:10px; } .periods a[aria-current] { font-weight:700; text-decoration:none; }
@media (max-width: 600px) { .monitor { grid-template-columns:1fr; } }
@media (max-width: 760px) {
  body.shell { display:block; }
  .side { position:sticky; top:0; z-index:5; width:auto; height:auto; max-height:100vh; padding:8px 12px; flex-direction:column; border-right:0; border-bottom:1px solid var(--rule); }
  .side .brand-row { padding:0; }
  .side ul.links { display:none; }
  #nav-toggle:checked ~ .side { width:auto; }
  #nav-toggle:checked ~ .side .brand-row { flex-direction:row; padding:0; }
  #nav-toggle:checked ~ .side ul.links { display:flex; flex-direction:column; padding:8px 0 4px; }
  #nav-toggle:checked ~ .side .lb, #nav-toggle:checked ~ .side .word { display:inline; }
  #nav-toggle:checked ~ .side ul.links a { justify-content:flex-start; padding:10px; }
  main { padding:16px 14px 32px; }
  .board { grid-template-columns:1fr; height:auto; min-height:0; }
  .lane { overflow-y:visible; }
  .lane[data-count="0"] { display:none; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

/** Draws an icon from its inline SVG paths, so the panel's policy needs no outside resource. */
const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

/** The site's symbol (site/favicon.svg): a ring and an orange dot, next to the word in the mono font. */
const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="25" cy="7" r="3.5" fill="#ff8a5c"/></svg><span class="word">zero</span>`;

const MENU_ICON = `<path d="M4 6h16M4 12h16M4 18h16"/>`;

/** The panel's sections, in the side menu's order. */
const NAV: [href: string, label: string, icon: string][] = [
  ["/", "Resumen", `<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>`],
  ["/line", "Línea", `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>`],
  ["/requests", "Pedidos", `<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>`],
  ["/egress", "Salidas", `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>`],
  ["/proposals", "Propuestas", `<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>`],
  ["/research", "Investigación", `<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`],
  ["/monitor", "Monitor", `<path d="M3 12h4l2.5-7 4 14 2.5-7h5"/>`],
  ["/briefing", "Informe", `<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3"/>`],
  ["/report", "Informe mensual", `<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>`],
  ["/about", "Qué es zero", `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>`],
  ["/agents", "Agentes", `<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13v1M15 13v1M2 13v3M22 13v3"/>`],
  ["/packages", "Paquetes", `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>`],
];

/** Where the packages' tabs go in the side menu; `send` in server.ts fills it, since pages do not get the context. Escaped text can never contain it. */
export const TABS_MARK = "<!--zero:tabs-->";

const TAB_ICON = `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>`;

/** The side menu's entries of the packages' tabs, every title escaped; `active` is the address of the tab being shown. */
export const tabLinks = (tabs: PackageTabLink[], active?: string) =>
  tabs.map((t) => `<li><a href="${esc(t.href)}"${t.href === active ? ` aria-current="page"` : ""} title="${esc(t.title)}">${icon(TAB_ICON)}<span class="lb">${esc(t.title)}</span></a></li>`).join("");

/** The side menu: a CSS-only checkbox collapses it to icons on a wide screen and opens it as a dropdown on a phone. */
function sideMenu(active?: string): string {
  const links = NAV.map(([href, label, paths]) => `<li><a href="${href}"${href === active ? ` aria-current="page"` : ""} title="${esc(label)}">${icon(paths)}<span class="lb">${esc(label)}</span></a></li>`).join("");
  return `<input type="checkbox" id="nav-toggle" class="nav-toggle"><nav class="side" aria-label="Secciones"><div class="brand-row"><span class="brand">${LOGO}</span><label for="nav-toggle" class="toggle" aria-label="Mostrar u ocultar el menú" title="Mostrar u ocultar el menú">${icon(MENU_ICON)}</label></div><ul class="links">${links}${TABS_MARK}</ul></nav>`;
}

/** Reloads the page every 15 s while nobody is typing, so the phone shows live state without a framework. */
const REFRESH = `setInterval(() => {
  const a = document.activeElement;
  const typing = a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT");
  const drafted = [...document.querySelectorAll("textarea,input[type=text]")].some((e) => e.value);
  if (document.visibilityState === "visible" && !typing && !drafted) location.reload();
}, 15000);`;

/** `active` is the side menu's section of the page; `nav: false` is the login page, which shows only the logo. */
export function page(title: string, body: string, opts: { nonce: string; flash?: string; refresh?: boolean; nav?: boolean; active?: string } = { nonce: "" }): string {
  const chrome = opts.nav === false ? `<header class="top"><span class="brand">${LOGO}</span></header>` : sideMenu(opts.active);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin"><title>${esc(title)} · zero</title><style>${STYLE}</style></head>
<body class="${opts.nav === false ? "plain" : "shell"}">${chrome}<main>
${opts.flash ? `<div class="card flash">${esc(opts.flash)}</div>` : ""}${body}</main>
${opts.refresh ? `<script nonce="${opts.nonce}">${REFRESH}</script>` : ""}</body></html>`;
}

/** The "Informe mensual" tab: a GET form to choose line and month, then each line's report with its downloads. */
export function reportPage(view: { report?: MonthlyReport; error?: string; names: string[]; line?: string; month?: string }, nonce: string): string {
  const month = view.report?.month ?? view.month ?? "";
  const names = [...new Set([...view.names, ...(view.report?.lines.map((l) => l.line) ?? []), ...(view.line ? [view.line] : [])])];
  const options = names.map((n) => `<option value="${esc(n)}"${n === view.line ? " selected" : ""}>${esc(n)}</option>`).join("");
  const form = `<div class="card"><h1>Informe mensual</h1>
<p class="muted">Armado solo con lo que la fábrica ya tiene guardado. Nada se envía a nadie: lo descargás y lo compartís vos si querés.</p>
<form method="get" action="/report"><label for="r-line">Línea</label><select id="r-line" name="line"><option value="">Todas las líneas</option>${options}</select>
<label for="r-mes">Mes (AAAA-MM)</label><input id="r-mes" type="text" name="mes" value="${esc(month)}" placeholder="2026-10"><button class="primary">Ver informe</button></form></div>`;
  const download = (line: string, format: "md" | "html", label: string) => `<a href="/report/export?line=${encodeURIComponent(line)}&amp;mes=${encodeURIComponent(month)}&amp;format=${format}">${label}</a>`;
  const body = view.error
    ? `<div class="card bad">${esc(view.error)}</div>`
    : (view.report?.lines ?? []).map((l) => `<div class="card">${reportSection(l)}<p>Descargar: ${download(l.line, "md", "Markdown")} · ${download(l.line, "html", "HTML")}</p></div>`).join("");
  return page("Informe mensual", form + body, { nonce, active: "/report" });
}

/** A package's read-only tab: a third party's data, so every text is escaped and only http(s) links get an href. */
export function packageTabPage(view: PackageTabView, nonce: string): string {
  const options = view.categories.map((c) => `<option value="${esc(c)}"${c === view.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const filter = view.categories.length
    ? `<form method="get" action="${esc(view.href)}"><label for="t-cat">Categoría</label><select id="t-cat" name="categoria"><option value="">Todas</option>${options}</select><button>Filtrar</button></form>`
    : "";
  const item = (i: PackageTabView["items"][number]) => {
    const href = safeUrl(i.url);
    const title = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title);
    const meta = [i.category, i.date].filter(Boolean).map(esc).join(" · ");
    return `<li><b>${title}</b>${meta ? `<br><span class="muted">${meta}</span>` : ""}${i.description ? `<br>${esc(i.description)}` : ""}</li>`;
  };
  const body =
    view.state === "missing"
      ? `<div class="card muted">Todavía no hay datos: el paquete no escribió el archivo de esta pestaña.</div>`
      : view.state === "invalid"
        ? `<div class="card bad">Los datos de esta pestaña no son válidos, así que no se muestran.</div>`
        : view.items.length
          ? `<div class="card"><ul class="jobs">${view.items.map(item).join("")}</ul></div>`
          : `<div class="card muted">No hay elementos${view.category ? " en esa categoría" : ""}.</div>`;
  return page(view.title, `<div class="card"><h1>${esc(view.title)}</h1><p class="muted">Datos del paquete ${esc(view.package)}, de solo lectura.</p>${filter}</div>${body}`, { nonce });
}

/** One station of a package: its state, its last on-demand run and, when it takes them, the form to ask for one. */
function packageStation(pkg: string, s: PackageList["packages"][number]["stations"][number], onDemand: boolean): string {
  const ref = `${pkg}/${s.name}`;
  const state = !s.allowed ? "no corre" : s.missingSecrets.length ? `espera los secretos ${s.missingSecrets.join(", ")}` : s.lastRun ? `última pasada ${s.lastRun}` : "todavía no corrió";
  const pending = s.onDemandPendingSince
    ? `<p>Corrida a demanda pendiente desde ${esc(resetTime(s.onDemandPendingSince))}${s.onDemandRequest ? `, pedido: «${esc(s.onDemandRequest)}»` : ""}</p>`
    : "";
  const last = s.lastOnDemand ? `<p${s.lastOnDemand.outcome && s.lastOnDemand.outcome !== "done" ? ` class="bad"` : ""}>Última corrida a demanda: ${esc(describeStationRun(s.lastOnDemand))}</p>` : "";
  const form = onDemand
    ? `<form method="post" action="/packages/run"><input type="hidden" name="station" value="${esc(ref)}"><label for="p-${esc(ref)}">Pedido (opcional)</label><textarea id="p-${esc(ref)}" name="pedido" maxlength="4000"></textarea><button class="primary">Pedir ahora</button></form>`
    : "";
  return `<div class="card"><h3>${esc(s.name)} <span class="muted">${esc(state)}</span></h3>${pending}${last}${form}</div>`;
}

/** The "Paquetes" tab: each loaded package's stations, their on-demand runs and a "Pedir ahora" form on those that take them. */
export function packagesPage(list: PackageList, onDemand: string[], nonce: string, flash?: string): string {
  const packages = list.packages
    .map((p) => `<h2>${esc(p.name)} <span class="muted">${esc(p.version)}</span></h2>${p.stations.length ? p.stations.map((s) => packageStation(p.name, s, onDemand.includes(`${p.name}/${s.name}`))).join("") : `<p class="muted">Sin estaciones.</p>`}`)
    .join("");
  const problems = list.problems.length ? `<div class="card bad"><h2>Problemas</h2><ul>${list.problems.map((p) => `<li>${esc(p.package)}: ${esc(p.reason)}</li>`).join("")}</ul></div>` : "";
  return page(
    "Paquetes",
    `<div class="card"><h1>Paquetes</h1><p class="muted">Las estaciones de los paquetes instalados. Las que aceptan corridas a demanda corren una vez en la próxima pasada, sin esperar a los trabajos en cola, con tu pedido si escribís uno.</p></div>
${list.packages.length ? packages : `<div class="card muted">No hay paquetes instalados.</div>`}${problems}`,
    { nonce, flash, refresh: true, active: "/packages" },
  );
}

/** The only page without a session: exchanges the key in the link's fragment for a cookie, clears it from the address bar and goes back to the page the link pointed at. */
export function loginPage(nonce: string, failed = false): string {
  const script = `(() => {
  const k = new URLSearchParams(location.hash.slice(1)).get("k");
  if (!k) return;
  const here = location.pathname + location.search;
  const to = here.startsWith("/") && !here.startsWith("//") ? here : "/";
  history.replaceState(null, "", to);
  fetch("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "k=" + encodeURIComponent(k) })
    .then((r) => (r.ok ? location.replace(to) : (document.getElementById("msg").textContent = "La clave no es válida.")));
})();`;
  return page(
    "Ingresar",
    `<div class="card"><h1>Panel de tu fábrica</h1>
<p class="muted">Abrí el link que te dio <code>zero panel</code>, o pegá la clave.</p>
<p id="msg" class="bad">${failed ? "La clave no es válida." : ""}</p>
<form method="post" action="/login"><label for="k">Clave</label><input id="k" name="k" type="password" autocomplete="off"><button class="primary">Ingresar</button></form></div>
<script nonce="${nonce}">${script}</script>`,
    { nonce, nav: false },
  );
}

/** Short status texts for the chips; the colors come from the shared status tokens. */
const CHIP_TEXT: Record<JobStatus, string> = { queued: "en cola", running: "trabajando", waiting: "te espera", delivered: "entregado", failed: "fallido", stopped: "detenido" };
const chip = (status: JobStatus) => `<span class="chip" data-status="${status}">${CHIP_TEXT[status]}</span>`;

const jobLine = (j: Job) =>
  `<li><div class="top"><a class="job" href="/job/${esc(j.id)}"><b>${esc(jobName(j))}</b></a>${chip(j.status)}</div><span class="muted">${esc(j.id)} · ${esc(j.line)}${jobOrigin(j) ? ` · ${esc(jobOrigin(j))}` : ""} · ${esc(describeJobStatus(j))}${j.delivery ? ` · ${esc(describeDelivery(j.delivery))}` : ""}</span></li>`;

const answerForms = (j: Job) =>
  `<form method="post" action="/job/${esc(j.id)}/answer"><label for="n-${esc(j.id)}">Nota (opcional)</label><input id="n-${esc(j.id)}" type="text" name="note">
<button class="primary" name="decision" value="approve">Aprobar</button><button class="danger" name="decision" value="reject">Rechazar</button></form>`;

/** The budget tile: the most used subscription window, or the day's spend against its cap. */
function budgetStat(s: FactoryStatus): string {
  const b = s.budget;
  const paused = b.reached ? ` · <span class="bad">PAUSADA${b.until ? ` hasta ${esc(resetTime(b.until))}` : ""}</span>` : "";
  if (b.billing === "subscription") {
    const top = [...b.windows].sort((x, y) => (y.utilization ?? 0) - (x.utilization ?? 0))[0];
    if (!top) return `<div class="stat"><b>—</b><span class="muted">cupo de la suscripción${paused}</span></div>`;
    const used = top.utilization === undefined ? "—" : `${Math.round(top.utilization * 100)}%`;
    return `<div class="stat"><b>${used}</b><span class="muted" title="${esc(planSummary(b))}">cupo de ${esc(top.label)}${top.resetsAt ? ` · se renueva ${esc(resetTime(top.resetsAt))}` : ""}${paused}</span></div>`;
  }
  return `<div class="stat"><b>${usd(b.spentUsd)}</b><span class="muted">de ${usd(b.limitUsd)} hoy${paused}</span></div>`;
}

export function overviewPage(s: FactoryStatus, lines: string[], nonce: string, flash?: string): string {
  const t = s.today;
  const state = s.andon ? `<span class="bad">DETENIDA (andon)</span>` : s.daemon.alive ? `<span class="ok">en marcha</span>` : s.daemon.lockHeld ? `<span class="bad">no responde${s.daemon.pid ? ` (proceso ${s.daemon.pid})` : ""}</span>` : "apagada";
  const box =
    s.isolation !== "container"
      ? "Caja de aislamiento desactivada: los trabajos corren en copias locales."
      : s.box.availability.ready
        ? `Caja lista (${esc(s.box.status?.runtime)}).`
        : s.boxWait
          ? "Sin caja: los trabajos esperan en la cola. Corré <code>zero box setup</code> o elegí otra cosa con <code>zero setup</code>."
          : "Sin caja: los trabajos corren en copias locales.";
  const waiting = s.waiting
    .map((j) => `<div class="card"><h3><a class="job" href="/job/${esc(j.id)}">${esc(jobName(j))}</a></h3>${jobOrigin(j) ? `<p class="muted">${esc(jobOrigin(j))}</p>` : ""}<pre>${esc(j.question?.text)}</pre>
<p class="muted">Si nadie responde antes de ${esc(j.question?.expiresAt.slice(0, 16).replace("T", " "))} UTC: ${j.question?.onTimeout === "approve" ? "se aprueba" : "se rechaza"}.</p>${answerForms(j)}</div>`)
    .join("");
  const list = (title: string, jobs: Job[]) => (jobs.length ? `<div class="card"><h2>${title}</h2><ul class="jobs">${jobs.map(jobLine).join("")}</ul></div>` : "");
  const options = lines.map((l) => `<option>${esc(l)}</option>`).join("");
  return page(
    "Resumen",
    `<div class="card"><h1>Fábrica ${state} · nivel ${esc(s.level.level)}</h1>
${s.level.reason ? `<p class="muted">${esc(s.level.reason)}</p>` : ""}<p class="muted">${box}</p>
<div class="grid">
<div class="stat"><b>${t.delivered}</b><span class="muted">entregados hoy</span></div>
<div class="stat"><b>${t.failed}</b><span class="muted">fallidos hoy</span></div>
${budgetStat(s)}
${s.isolation === "container" && s.box.availability.ready ? `<div class="stat"><b>${t.egress.blocked}</b><span class="muted">salidas bloqueadas${t.egress.suspicious ? ` (${t.egress.suspicious} sospechosas)` : ""}</span></div>` : ""}
</div>
<p class="muted">${esc(budgetLine(s.budget))}</p>
${s.outages.map((o) => `<p class="muted"><span class="bad">${esc(outageLine(o))}</span></p>`).join("")}
${s.selfUpdate ? selfUpdateLines(s.selfUpdate).map((l) => `<p class="muted">${l.bad ? `<span class="bad">${esc(l.text)}</span>` : esc(l.text)}</p>`).join("") : ""}
${s.merges.map((m) => `<p class="muted">Fusión automática: <a href="${esc(m.url)}">${esc(m.url)}</a> · ${m.status === "blocked" ? `<span class="bad">no se funde: ${esc(m.why ?? "")}</span>` : esc(m.why ?? "esperando")}</p>`).join("")}
${s.intake.map((i) => `<p class="muted">Issues de GitHub: ${esc(i.line)} toma los issues con la etiqueta <b>${esc(i.label)}</b>.${i.problem ? ` <span class="bad">${esc(i.problem)}</span>` : ""}</p>`).join("")}
${s.linear.map((i) => `<p class="muted">Issues de Linear: ${esc(i.line)} toma los issues del equipo <b>${esc(i.team)}</b> con la etiqueta <b>${esc(i.label)}</b>.${i.problem ? ` <span class="bad">${esc(i.problem)}</span>` : ""}</p>`).join("")}
${s.onDemand.map((d) => `<p class="muted">Corrida a demanda de <b>${esc(d.station)}</b>: pendiente desde ${esc(resetTime(d.since))}.</p>`).join("")}
${s.onDemandRuns.map((r) => `<p class="muted">Corrida a demanda de <b>${esc(r.station)}</b>, pedida ${esc(resetTime(r.asked))}: ${r.outcome === "failed" || r.outcome === "timeout" || r.outcome === "not-run" || r.stale ? `<span class="bad">${esc(onDemandState(r))}</span>` : esc(onDemandState(r))}.</p>`).join("")}
${s.jira.map((j) => `<p class="muted">Issues de Jira: ${esc(j.line)} toma los issues de <b>${esc(j.project)}</b> (${esc(j.site)}) con la etiqueta <b>${esc(j.label)}</b>.${j.problem ? ` <span class="bad">${esc(j.problem)}</span>` : ""}</p>`).join("")}
<form method="post" action="/andon">${s.andon ? `<button class="primary" name="state" value="off">Reanudar la fábrica</button>` : `<button class="danger" name="state" value="on">Detener la fábrica (andon)</button>`}</form></div>
${waiting ? `<h2>Esperando tu respuesta</h2>${waiting}` : ""}
${list("Trabajando", s.running)}${list("En cola", s.queued)}${list("Últimos terminados", s.recent)}
<div class="card"><h2>Pedir un trabajo</h2>
<form method="post" action="/request"><label for="text">Qué querés, en tus palabras</label><textarea id="text" name="text" required></textarea>
${lines.length > 1 ? `<label for="line">Proyecto</label><select id="line" name="line">${options}</select>` : ""}
<button class="primary">Pedir</button></form></div>`,
    { nonce, flash, refresh: true, active: "/" },
  );
}

export function jobPage(job: Job, traceText: string, nonce: string, flash?: string, subscription = false): string {
  const final = FINAL_STATUSES.includes(job.status);
  return page(
    jobName(job),
    `<div class="card"><h1>${esc(jobName(job))}</h1>
<p class="muted">${esc(job.id)} · línea ${esc(job.line)}${jobOrigin(job) ? ` · ${esc(jobOrigin(job))}` : ""} · ${esc(jobCost(job, subscription))}</p>
<p>${chip(job.status)} <b>${esc(describeJobStatus(job))}</b></p>
${job.delivery ? `<p class="ok">Entrega: ${job.delivery.url ? `<a href="${esc(job.delivery.url)}">${esc(describeDelivery(job.delivery))}</a>` : esc(describeDelivery(job.delivery))}</p>` : ""}
${job.reason ? `<p>Motivo:</p><pre>${esc(job.reason)}</pre>` : ""}
${job.question ? `<h2>Pregunta para vos</h2><pre>${esc(job.question.text)}</pre>${answerForms(job)}` : ""}
${!final ? `<form method="post" action="/job/${esc(job.id)}/stop"><button class="danger">Detener este trabajo</button></form>` : ""}
<h2>Pedido</h2><pre>${esc(job.request)}</pre></div>
<div class="card"><h2>Traza</h2><pre>${esc(traceText)}</pre></div>`,
    { nonce, flash, refresh: !final },
  );
}

function siteCard(s: EgressSite, report: EgressReport, lists: { allow: string[]; block: string[] }): string {
  const site = esc(s.host);
  const action = (value: string, label: string, cls = "") =>
    `<form class="inline" method="post" action="/egress/rule"><input type="hidden" name="site" value="${site}"><button class="${cls}" name="action" value="${value}">${label}</button></form>`;
  const buttons = lists.block.includes(s.host)
    ? action("remove", "Quitar el bloqueo")
    : lists.allow.includes(s.host)
      ? action("remove", "Quitar el permiso") + action("block", "Bloquear", "danger")
      : action("block", "Bloquear", "danger") + (s.blocked ? action("allow", "Permitir") : "");
  const detail = s.blocked
    ? `<p class="${s.rule === "suspicious" ? "bad" : "warn"}">${s.rule === "suspicious" ? "Sospechoso: " : ""}${esc(s.reason)}</p>`
    : `<p class="muted">envió ${bytes(s.bytesUp)} · recibió ${bytes(s.bytesDown)}</p>`;
  return `<div class="card"><h3>${site}:${s.port}${s.isNew ? ` <span class="muted">· nuevo</span>` : ""}</h3>
<p class="muted">${s.connections} ${s.connections === 1 ? "conexión" : "conexiones"}${s.blocked ? ` · ${s.blocked} bloqueadas` : ""}${s.stations.length ? ` · ${esc(s.stations.join(", "))}` : ""}${s.jobs.length ? ` · ${s.jobs.map((j) => `<a href="/job/${esc(j)}">${esc(j)}</a>`).join(", ")}` : ""}</p>
${detail}${buttons}</div>`;
}

export function egressPage(report: EgressReport, lists: { allow: string[]; block: string[] }, nonce: string, flash?: string): string {
  const e = report.summary;
  const mode =
    report.mode === "blocklist"
      ? `Modo <b>blocklist</b>: sale todo salvo lo sospechoso y lo que bloquees. <button name="mode" value="allowlist">Pasar a allowlist</button>`
      : `Modo <b>allowlist</b>: solo salen tus sitios permitidos y los de tus motores. <button name="mode" value="blocklist">Pasar a blocklist</button>`;
  return page(
    "Salidas",
    `<div class="card"><h1>Salidas a internet de la caja</h1>
<p class="muted">Desde ${esc(report.from.slice(0, 16).replace("T", " "))} UTC · <a href="/egress?days=7">7 días</a> · <a href="/egress?days=30">30 días</a></p>
${report.note ? `<p class="warn">${esc(report.note)}</p>` : ""}
<p>${e.connections} conexiones a ${e.sites.length} sitios · ${e.blocked} bloqueadas${e.suspicious ? ` <span class="bad">(${e.suspicious} sospechosas)</span>` : ""}</p>
<form method="post" action="/egress/mode">${mode}</form></div>
${e.sites.map((s) => siteCard(s, report, lists)).join("")}
<div class="card"><h2>Tus listas</h2>
<p class="muted">Permitidos: ${esc(lists.allow.join(", ") || "ninguno")}<br>Bloqueados: ${esc(lists.block.join(", ") || "ninguno")}</p>
<form method="post" action="/egress/rule"><label for="site">Sitio (incluye sus subdominios)</label><input id="site" type="text" name="site" placeholder="ejemplo.com">
<button class="danger" name="action" value="block">Bloquear</button><button name="action" value="allow">Permitir</button><button name="action" value="remove">Quitar de las listas</button></form></div>`,
    { nonce, flash, refresh: true, active: "/egress" },
  );
}

/** Just enough Markdown for the owner's briefing: headings, lists, bold, code and tables. */
export function markdown(text: string): string {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  let list = false;
  let table: string[][] = [];
  const flush = () => {
    if (list) out.push("</ul>");
    list = false;
    if (table.length) {
      const [head, ...rows] = table;
      out.push(`<table><tr>${head!.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
    }
    table = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("|")) {
      if (/^\|[\s|:-]+\|$/.test(line)) continue;
      if (list) flush();
      table.push(line.slice(1, -1).split("|").map((c) => c.trim()));
      continue;
    }
    if (table.length) flush();
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      flush();
      out.push(`<h${heading[1]!.length + 1}>${inline(heading[2]!)}</h${heading[1]!.length + 1}>`);
    } else if (line.startsWith("- ")) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line) {
      flush();
      out.push(`<p>${inline(line)}</p>`);
    } else flush();
  }
  flush();
  return out.join("\n");
}

const AUTONOMY: Record<Autonomy, string> = {
  propose: "propose: cada propuesta espera tu decisión",
  build: "build: se construye sola y espera tu aprobación para integrarse",
  auto: "auto: se construye y se integra sola",
};

const STAGES: [ProposalStage, string][] = [
  ["pending", "Pendientes"],
  ["building", "Construyéndose"],
  ["delivered", "Entregadas"],
  ["ended", "Terminadas sin entregar"],
  ["rejected", "Rechazadas"],
  ["reverted", "Revertidas"],
];

function proposalCard(p: ProposalView): string {
  const decidable = p.stage === "pending" || p.awaitsIntegration;
  const by = p.decidedBy === "night-shift" ? "el turno nocturno, solo" : p.decidedBy === "owner" ? "vos" : "";
  const job = p.job
    ? `<p class="muted">Trabajo <a href="/job/${esc(p.job.id)}">${esc(p.job.id)}</a> · ${esc(p.job.status)}${p.awaitsIntegration ? ` · <span class="warn">construido, espera tu aprobación para integrarse</span>` : ""}${p.job.delivery ? ` · ${p.job.delivery.url ? `<a href="${esc(p.job.delivery.url)}">${esc(describeDelivery(p.job.delivery))}</a>` : esc(describeDelivery(p.job.delivery))}` : ""}</p>`
    : "";
  const actions = decidable
    ? `<form method="post" action="/proposals/${esc(p.id)}/approve" class="inline"><button class="primary">${p.awaitsIntegration ? "Aprobar e integrar" : "Aprobar"}</button></form>
<form method="post" action="/proposals/${esc(p.id)}/reject"><label for="r-${esc(p.id)}">Motivo del rechazo (opcional)</label><input id="r-${esc(p.id)}" type="text" name="note"><button class="danger">Rechazar</button></form>`
    : "";
  return `<div class="card"><h3>${esc(p.title)} <span class="muted">${esc(p.id)}</span></h3>
<p>${esc(p.why)}</p><p class="muted">Qué cambiaría: ${esc(p.change)}</p>
<p class="muted">Costo estimado ${usd(p.estimatedUsd)}${p.paths.length ? ` · ${esc(p.paths.join(", "))}` : ""}${by ? ` · aprobada por ${by}` : ""}</p>
${p.researchNote ? `<p class="muted">Nació de la nota de investigación ${esc(p.researchNote)}${p.thirdParty ? " · agrega algo de terceros" : ""}${p.business ? " · de negocio: espera tu decisión" : ""}</p>` : ""}
${p.sourceIssueUrl ? `<p class="muted">Nació del issue #${esc(String(p.sourceIssue ?? ""))}: <a href="${esc(p.sourceIssueUrl)}">${esc(p.sourceIssueUrl)}</a></p>` : ""}
${p.issueUrl ? `<p class="muted">Issue: <a href="${esc(p.issueUrl)}">${esc(p.issueUrl)}</a></p>` : ""}
${p.stage === "rejected" ? `<p class="bad">Rechazada: ${esc(p.note ?? "sin motivo")}</p>` : ""}${p.stage === "reverted" ? `<p class="bad">El turno nocturno la integró solo y la revertiste en la rama principal.</p>` : ""}${job}${actions}</div>`;
}

function proposalLine(l: ProposalLine): string {
  const groups = STAGES.map(([stage, title]) => {
    const items = l.proposals.filter((p) => p.stage === stage);
    return items.length ? `<h3>${title} (${items.length})</h3>${items.map(proposalCard).join("")}` : "";
  }).join("");
  return `<h2>${esc(l.line)}</h2><p class="muted">Autonomía del turno nocturno: <b>${esc(AUTONOMY[l.autonomy])}</b></p>${groups || `<p class="muted">Sin propuestas todavía.</p>`}`;
}

/** The night shift's proposals of every line, grouped by where they stand, with each line's autonomy. */
export function proposalsPage(data: { research: Autonomy | "off"; lines: ProposalLine[] }, nonce: string, flash?: string): string {
  const research = data.research === "off" ? "apagada" : AUTONOMY[data.research];
  return page(
    "Propuestas",
    `<div class="card"><h1>Propuestas del turno nocturno</h1>
<p class="muted">Lo que <code>scout</code> propone cuando la fábrica está libre. Las nacidas de una nota de investigación las regula la autonomía de investigación: <b>${esc(research)}</b>.</p></div>
${data.lines.map(proposalLine).join("")}`,
    { nonce, flash, refresh: true, active: "/proposals" },
  );
}

/** The step before approving a proposal: approving opens a job or integrates one, so the owner confirms it. */
export function confirmProposalPage(p: ProposalView, nonce: string): string {
  const what = p.awaitsIntegration
    ? `El trabajo ${esc(p.job?.id)} ya está construido: aprobar lo integra según la configuración de la línea ${esc(p.line)}.`
    : `Aprobar abre un trabajo normal en la línea ${esc(p.line)}.`;
  return page(
    "Confirmar",
    `<div class="card"><h1>¿Aprobar «${esc(p.title)}»?</h1><p>${what}</p><pre>${esc(p.change)}</pre>
<form method="post" action="/proposals/${esc(p.id)}/approve"><input type="hidden" name="confirm" value="1"><button class="primary">Sí, aprobar</button></form>
<p><a href="/proposals">Cancelar</a></p></div>`,
    { nonce, active: "/proposals" },
  );
}

/** A link only for http(s) URLs; anything else is shown as text. */
const webLink = (url: string) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(url)}</a>` : esc(url));

function researchCard(n: ResearchNote): string {
  return `<div class="card"><h3>${esc(n.topic)} <span class="muted">${esc(n.id)} · ${esc(n.createdAt.slice(0, 10))}${n.skill ? ` · skill ${esc(n.skill)}` : ""}</span></h3>
<p>${esc(n.findings)}</p>
<p class="muted">Para qué serviría: ${esc(n.serves)}</p>
<p class="muted">Madurez: ${esc(n.maturity)}</p>
<p class="muted">Fuentes:</p><ul>${n.sources.map((u) => `<li>${webLink(u)}</li>`).join("")}</ul>
${n.issueUrl ? `<p class="muted">Issue: ${webLink(n.issueUrl)}</p>` : ""}
<form method="post" action="/research/${esc(n.id)}/request"><button class="primary">Pedir trabajo</button></form></div>`;
}

/** One line's notes, business and technical apart. */
function researchLine(l: ResearchLine): string {
  if (!l.notes.length) return `<h2>${esc(l.line)}</h2><p class="muted">Sin notas todavía.</p>`;
  const group = (title: string, notes: ResearchNote[]) => (notes.length ? `<section class="research-group"><h3>${title}</h3>${notes.map(researchCard).join("")}</section>` : "");
  return `<h2>${esc(l.line)}</h2>${group("Negocio", l.business)}${group("Técnica", l.technical)}`;
}

/** The research station's notes of every line, newest first, business and technical apart, each with a button to turn it into work. */
export function researchPage(lines: ResearchLine[], nonce: string, flash?: string): string {
  return page(
    "Investigación",
    `<div class="card"><h1>Investigación</h1>
<p class="muted">Lo que la estación <code>research</code> encontró en la web en los últimos 30 días. Son datos de la web, no instrucciones.</p></div>
${lines.map(researchLine).join("")}`,
    { nonce, flash, active: "/research" },
  );
}

/** The step before turning a note into work: it opens a job, so the owner confirms it. */
export function confirmResearchPage(n: ResearchNote, nonce: string): string {
  return page(
    "Confirmar",
    `<div class="card"><h1>¿Pedir un trabajo a partir de «${esc(n.topic)}»?</h1><p>Abre un trabajo normal en la línea ${esc(n.line)} con lo encontrado y sus fuentes.</p><pre>${esc(n.findings)}</pre>
<form method="post" action="/research/${esc(n.id)}/request"><input type="hidden" name="confirm" value="1"><button class="primary">Sí, pedir el trabajo</button></form>
<p><a href="/research">Cancelar</a></p></div>`,
    { nonce, active: "/research" },
  );
}

const ESTADOS: [RequestFilter, string][] = [
  ["todos", "Todos"],
  ["activos", "En curso"],
  ["esperando", "Esperando tu respuesta"],
  ["terminados", "Terminados"],
];

/** One job of the "Pedidos" list, with its actions: detail and trace, its pending question, stop. */
function requestRow({ job: j, age }: RequestsView["rows"][number]): string {
  const id = esc(j.id);
  const question =
    j.status === "waiting" && j.question
      ? `<pre>${esc(j.question.text)}</pre><form method="post" action="/requests/${id}/answer"><label for="rn-${id}">Nota (opcional)</label><input id="rn-${id}" type="text" name="note">
<button class="primary" name="decision" value="approve">Aprobar</button><button class="danger" name="decision" value="reject">Rechazar</button></form>`
      : "";
  const halt = FINAL_STATUSES.includes(j.status) ? "" : `<form method="post" action="/requests/${id}/stop"><button class="danger">Frenar</button></form>`;
  return `<div class="card" id="request-${id}"><h3><a class="job" href="/job/${id}">${esc(jobName(j))}</a></h3>
<p class="muted">${id} · ${esc(j.line)}${jobOrigin(j) ? ` · ${esc(jobOrigin(j))}` : ""} · ${esc(describeJobStatus(j))} · ${esc(age)}</p>
<p><a href="/job/${id}">Ver detalle y traza</a></p>${question}${halt}</div>`;
}

/** The "Pedidos" section: a typed request form, then every request with filters and per-request actions. */
export function requestsPage(view: RequestsView, nonce: string, flash?: string): string {
  const lineOptions = (selected?: string) => view.lines.map((l) => `<option value="${esc(l)}"${l === selected ? " selected" : ""}>${esc(l)}</option>`).join("");
  const types = Object.entries(REQUEST_TYPES)
    .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
    .join("");
  const form = `<div class="card"><h1>Pedidos</h1><h2>Pedir un trabajo</h2>
<form method="post" action="/requests"><label for="q-line">Línea</label><select id="q-line" name="line">${lineOptions()}</select>
<label for="q-type">Tipo de pedido</label><select id="q-type" name="type">${types}</select>
<label for="q-title">Título</label><input id="q-title" type="text" name="title" required>
<label for="q-desc">Descripción</label><textarea id="q-desc" name="description"></textarea>
<button class="primary">Pedir</button></form></div>`;
  const filters = `<div class="card"><h2>Pedidos de la fábrica</h2>
<form method="get" action="/requests"><label for="f-line">Línea</label><select id="f-line" name="line"><option value="">Todas las líneas</option>${lineOptions(view.line)}</select>
<label for="f-estado">Estado</label><select id="f-estado" name="estado">${ESTADOS.map(([v, label]) => `<option value="${v}"${v === view.estado ? " selected" : ""}>${label}</option>`).join("")}</select>
<button>Filtrar</button></form>
${view.rows.length ? "" : `<p class="muted">No hay pedidos con ese filtro.</p>`}</div>`;
  return page("Pedidos", form + filters + `<section class="requests">${view.rows.map(requestRow).join("")}</section>`, { nonce, flash, refresh: true, active: "/requests" });
}

/** The step before stopping a job from the list: the owner confirms it. */
export function confirmStopPage(j: Job, nonce: string): string {
  return page(
    "Confirmar",
    `<div class="card"><h1>¿Frenar «${esc(jobName(j))}»?</h1><p>El trabajo ${esc(j.id)} de la línea ${esc(j.line)} se detiene y no sigue.</p>
<form method="post" action="/requests/${esc(j.id)}/stop"><input type="hidden" name="confirm" value="1"><button class="danger">Sí, frenarlo</button></form>
<p><a href="/requests">Cancelar</a></p></div>`,
    { nonce, active: "/requests" },
  );
}

export function briefingPage(title: string, body: string, nonce: string): string {
  return page("Informe", `<div class="card"><h1>${esc(title)}</h1><p class="muted"><a href="/briefing?days=1">hoy</a> · <a href="/briefing?days=7">7 días</a></p>${markdown(body)}</div>`, { nonce, active: "/briefing" });
}

/** Icons of the stations: inline SVG, so the panel's policy needs no outside resource. */
const ICONS: Record<LineStation, string> = {
  setup: `<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V5h8v3M3 13h18"/>`,
  spec: `<path d="M3 5h14l4 4v10H3z"/><path d="M7 10h8M7 14h10M7 18h5"/>`,
  build: `<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>`,
  verify: `<path d="M9 3h6M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4A1.5 1.5 0 0 0 19 19l-5-10V3M7.5 15h9"/>`,
  review: `<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/>`,
  security: `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>`,
  integrate: `<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 8c0 4 4 4 10 4"/>`,
};
const STATION_LABEL: Record<LineStation, string> = {
  setup: "preparación",
  spec: "especificación",
  build: "construcción",
  verify: "verificación",
  review: "revisión",
  security: "seguridad",
  integrate: "integración",
};
const STATE_TEXT: Record<StationState, string> = { pending: "pendiente", active: "activa", done: "lista", error: "error", waiting: "te espera" };
const STATE_MARK: Record<StationState, string> = { pending: "○", active: "●", done: "✓", error: "✗", waiting: "⏸" };

/** One station of a job card: an icon in the compact progress, with its time, cost, engine and error behind `<details>`. */
function station(st: StationView): string {
  const d = st.detail;
  const label = STATION_LABEL[st.name];
  const detail = d
    ? `Duración: ${esc(d.time)}<br>Costo: ${esc(d.cost ?? "sin costo")}${d.engines.length ? `<br>Motor: ${esc(d.engines.join(", "))}` : ""}${d.error ? `<br>Error: ${esc(d.error)}` : ""}`
    : "Todavía no pasó por acá.";
  return `<li class="st" data-station="${st.name}" data-state="${st.state}"><details><summary title="${label}: ${STATE_TEXT[st.state]}"><span class="ic">${icon(ICONS[st.name])}</span><span class="nm">${label}</span><span class="mk" aria-hidden="true">${STATE_MARK[st.state]}</span><span class="tx">${STATE_TEXT[st.state]}</span></summary><div class="dt"><b>${label}</b> · ${STATE_TEXT[st.state]}${
    st.reason ? `<span class="why">${esc(st.reason)}</span>` : ""
  }<br>${detail}</div></details></li>`;
}

const LINE_ORDER: LineStation[] = ["setup", "spec", "build", "verify", "review", "security", "integrate"];

type Lane = LineStation | "out";
const OUT_ICON = `<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5 13l2-8h10l2 8v6H5z"/>`;
const LANES: [Lane, string, string][] = [
  ...LINE_ORDER.map((n): [Lane, string, string] => [n, STATION_LABEL[n][0]!.toUpperCase() + STATION_LABEL[n].slice(1), ICONS[n]]),
  ["out", "Salida", OUT_ICON],
];

/** Where a job's card goes: finished work leaves the line, the rest sits at its station (setup until it has one). */
const laneOf = (r: LineRow): Lane => (FINAL_STATUSES.includes(r.status) ? "out" : (r.at ?? "setup"));

function jobCard(r: LineRow): string {
  const final = FINAL_STATUSES.includes(r.status);
  const back = !final && r.attempt > 1 && r.at === "build";
  const d = r.delivery;
  const out =
    r.status === "delivered"
      ? `<p class="out ok"><b>entregado</b>${d ? ` · ${d.url ? `<a href="${esc(d.url)}">${esc(d.text)}</a>` : esc(d.text)}${d.merge ? ` · ${esc(d.merge)}` : ""}` : ""}</p>`
      : final
        ? `<p class="out bad"><b>${r.status === "failed" ? "fallido" : "detenido"}</b>${r.reason ? ` · ${esc(r.reason)}` : ""}</p>`
        : "";
  const stage = r.stage && !final ? `<p class="retry muted">etapa ${r.stage.n} de ${r.stage.total} · ${esc(r.stage.title)}</p>` : "";
  const retry = stage + (r.attempt > 1 && !final ? `<p class="retry warn">intento ${r.attempt} de ${r.maxAttempts}${r.retryError ? ` · ${esc(r.retryError)}` : ""}</p>` : "");
  const inner = `<h3 class="jh" data-part="head"><a class="job" href="/job/${esc(r.id)}">${esc(r.title)}</a>${chip(r.status)}</h3>
<p class="meta muted">${esc(r.id)} · ${esc(r.line)}${r.origin ? ` · ${esc(r.origin)}` : ""}</p>${retry}<ol class="stations">${r.stations.map(station).join("")}</ol>${out}`;
  // Lets the page's script skip cards that did not change, so open details stay open.
  const sig = createHash("sha256").update(inner).digest("hex").slice(0, 16);
  return `<article class="card job${final ? " final" : ""}${back ? " back" : ""}" id="job-${esc(r.id)}" data-status="${r.status}" data-sig="${sig}">${inner}</article>`;
}

/** The production line's counters and board: the page's content, and the fragment the page fetches to stay current. */
export function lineView(data: ProductionLine): string {
  const c = data.counts;
  const summary = `<div class="card grid" data-part="summary">
<div class="stat"><b>${c.active}</b><span class="muted">activos</span></div>
<div class="stat"><b>${c.waiting}</b><span class="muted">esperando</span></div>
<div class="stat"><b>${c.failed}</b><span class="muted">con error</span></div>
<div class="stat"><b>${c.delivered}</b><span class="muted">entregados hoy</span></div></div>`;
  const note = `<p class="board-note muted" data-part="note">${data.rows.length ? "" : "La fábrica está libre"}</p>`;
  const lanes = LANES.map(([lane, label, paths]) => {
    const cards = data.rows.filter((r) => laneOf(r) === lane);
    return `<section class="lane" data-lane="${lane}" data-count="${cards.length}" aria-label="${label}"><header class="lane-head" data-part="lane-head"><span class="ic">${icon(paths)}</span><span class="ln">${label}</span><span class="n">${cards.length}</span></header><div class="cards" data-part="cards">${cards.map(jobCard).join("")}</div></section>`;
  }).join("");
  return `${summary}${note}<div class="board" data-part="board">${lanes}</div>`;
}

/**
 * Keeps the board current without reloading: gets the fragment (pushed on `/line/events`, or polled), patches only the cards
 * that changed, moves each card to the lane the fragment puts it in, and keeps open station details open.
 */
const LINE_REFRESH = `(() => {
  const root = document.getElementById("line");
  let last = "";
  const part = (el, name) => el.querySelector('[data-part="' + name + '"]');
  const lanesOf = (board) => [...board.querySelectorAll("[data-lane]")];
  const keepOpen = (old, card) => {
    for (const st of [...card.querySelectorAll("[data-station]")]) {
      const cur = old.querySelector('[data-station="' + st.dataset.station + '"] details');
      if (cur) st.querySelector("details").open = cur.open;
    }
  };
  const update = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    const next = t.content;
    const board = part(root, "board");
    const fresh = part(next, "board");
    const same = board && fresh && lanesOf(fresh).every((l) => board.querySelector('[data-lane="' + l.dataset.lane + '"]'));
    if (!same) return root.replaceChildren(next);
    for (const name of ["summary", "note"]) {
      const a = part(root, name);
      const b = part(next, name);
      if (a && b && a.outerHTML !== b.outerHTML) a.replaceWith(b);
    }
    const kept = new Map([...board.querySelectorAll("article[id]")].map((c) => [c.id, c]));
    for (const lane of lanesOf(fresh)) {
      const cur = board.querySelector('[data-lane="' + lane.dataset.lane + '"]');
      cur.dataset.count = lane.dataset.count;
      const head = part(cur, "lane-head");
      const freshHead = part(lane, "lane-head");
      if (head.outerHTML !== freshHead.outerHTML) head.replaceWith(freshHead);
      const list = part(cur, "cards");
      const order = [...part(lane, "cards").children].map((card) => {
        const old = kept.get(card.id);
        if (!old) return card;
        kept.delete(card.id);
        if (old.dataset.sig === card.dataset.sig) return old;
        keepOpen(old, card);
        old.remove();
        return card;
      });
      order.forEach((c, i) => {
        if (list.children[i] !== c) list.insertBefore(c, list.children[i] || null);
      });
    }
    kept.forEach((c) => c.remove());
  };
  const apply = (html) => {
    if (html && html !== last) update(html);
    if (html) last = html;
  };
  const poll = () =>
    fetch("/line?fragment=1", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then(apply)
      .catch(() => {});
  // The server pushes the fragment when something changes; polling is the fallback while the stream is not open.
  const stream = window.EventSource ? new EventSource("/line/events") : null;
  if (stream) stream.addEventListener("message", (e) => apply(e.data));
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (stream && stream.readyState === EventSource.OPEN) return;
    poll();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
})();`;

export function linePage(data: ProductionLine, nonce: string): string {
  const view = lineView(data);
  return page("Línea de producción", `<h1>Línea de producción</h1><div id="line">${view}</div><script nonce="${nonce}">${LINE_REFRESH}</script>`, { nonce, active: "/line" });
}

/** The path of every request, in the order the line runs it. */
const ROUTE: [string, string][] = [
  ["especificación", "Convierte tu pedido en un contrato claro: qué va a cambiar y cómo se comprueba."],
  ["construcción", "Un agente escribe el código y las pruebas en una copia aparte de tu proyecto."],
  ["verificación", "La fábrica corre los comandos de verificación de la línea; si fallan, vuelve a construir."],
  ["revisión", "Otro agente lee el cambio contra la especificación y pide arreglos si algo no cumple."],
  ["seguridad", "Una segunda lectura busca solo problemas de seguridad."],
  ["integración", "Entrega el cambio terminado: merge local, rama o pull request, según la línea."],
];

const ASKS: Record<PolicyEvent, string> = {
  "spec-ready": "Antes de construir, para que apruebes la especificación.",
  "before-integrate": "Antes de integrar el cambio terminado.",
  "protected-path": "Si el cambio toca una ruta protegida.",
  "budget-exceeded": "Si un trabajo se queda sin presupuesto.",
  "egress-suspicious": "Si la caja intenta una salida sospechosa a internet.",
};

export function aboutPage(g: FactoryGuide, nonce: string): string {
  const item = (p: { event: PolicyEvent }) => `<li>${esc(ASKS[p.event])}</li>`;
  const asks = g.policy.filter((p) => p.decision === "ask");
  const consults = asks.length
    ? `<p>Con el nivel ${esc(g.level.level)} te consulta en estos momentos:</p><ul>${asks.map(item).join("")}</ul>`
    : `<p>Con el nivel ${esc(g.level.level)} la fábrica nunca te consulta. En estos casos, en lugar de preguntarte, el trabajo se detiene:</p><ul>${g.policy.filter((p) => p.decision === "fail").map(item).join("")}</ul>`;
  const timeout = g.approvals.onTimeout === "approve" ? "Si no respondés a tiempo, la fábrica aprueba sola y el trabajo sigue." : "Si no respondés a tiempo, el trabajo se rechaza y se detiene.";
  const labeled = g.lines.filter((l) => l.issues);
  const github = labeled.length ? `: ${labeled.map((l) => `${esc(l.name)} toma los issues con la etiqueta <b>${esc(l.issues!.label)}</b>`).join("; ")}.` : ". Hoy ninguna línea toma issues.";
  const box =
    g.isolation === "container" && g.box.ready
      ? "activa: los agentes trabajan dentro de una caja aislada."
      : g.boxWait
        ? "no está activa: está configurada pero no está lista, así que los trabajos esperan en la cola."
      : g.isolation === "container"
        ? "no está activa: está configurada pero no está lista, así que los trabajos corren en copias locales."
        : "no está activa: los trabajos corren en copias locales.";
  return page(
    "Qué es zero",
    `<div class="card"><h1>Qué es zero</h1>
<p>zero es una fábrica de software que trabaja sola en tu PC. Vos le hacés pedidos en tus palabras y ella los convierte en cambios terminados en tus proyectos: los escribe, los prueba, los revisa y te los entrega.</p>
<p class="muted">Cada pedido pasa por una línea de producción. Agentes de inteligencia artificial hacen cada paso y la fábrica controla que se cumplan las reglas.</p></div>
<div class="card"><h2>El recorrido de un pedido</h2>
<ol class="route">${ROUTE.map(([label, what]) => `<li><b>${esc(label)}</b><span>${esc(what)}</span></li>`).join("")}</ol></div>
<div class="card"><h2>Cuándo te consulta</h2>${consults}
<p>Cuando te consulta, espera tu respuesta hasta ${esc(g.approvals.timeoutHours)} horas. ${timeout} Mientras tanto la fábrica sigue con otros trabajos.</p></div>
<div class="card"><h2>Cómo le llegan los pedidos</h2><ul>
<li><b>chat</b>: desde tu asistente de chat, con las herramientas de zero.</li>
<li><b>terminal</b>: con <code>zero request</code>.</li>
<li><b>panel</b>: desde la página Resumen de este panel.</li>
<li><b>GitHub</b>: issues con la etiqueta de la línea, escritos por alguien con permiso de escritura${github}</li></ul></div>
<div class="card"><h2>Tu configuración</h2><ul class="kv">
<li>Nivel de autonomía configurado: <b>${esc(g.level.configured)}</b></li>
<li>Nivel efectivo: <b>${esc(g.level.level)}</b>${g.level.reason ? ` <span class="muted">(${esc(g.level.reason)})</span>` : ""}</li>
<li>Motor: <b>${esc(g.engine)}</b></li>
<li>Con una suscripción, el límite es el cupo real del plan (5 horas y semana): la fábrica pausa cuando se agota y retoma sola cuando se renueva. Reserva para vos: <b>${g.limits.reservePercent}%</b></li>
<li>Límite de gasto por día, si se paga por uso: <b>${usd(g.limits.usdPerDay)}</b></li>
<li>Límite de gasto por trabajo, si se paga por uso: <b>${usd(g.limits.usdPerJob)}</b></li>
<li>Caja de aislamiento: ${box}</li>
<li>Líneas: <b>${g.lines.length}</b></li></ul></div>`,
    { nonce, active: "/about" },
  );
}

/** What each station does and cannot do, in the owner's words. Its original instructions are shown next to it. */
const AGENT_SUMMARY: Record<StationName, { name: string; does: string; cannot: string }> = {
  spec: {
    name: "Especificación (spec)",
    does: "Convierte tu pedido en una especificación: requisitos, escenarios que se pueden comprobar y tareas.",
    cannot: "No modifica el código, solo lee el proyecto. Si el pedido no se puede hacer, lo dice en lugar de inventar.",
  },
  build: {
    name: "Construcción (build)",
    does: "Escribe el código y las pruebas que pide la especificación, y corre la verificación.",
    cannot: "No hace commits, no cambia de rama ni toca credenciales; no decide la entrega ni aprueba su propio trabajo.",
  },
  review: {
    name: "Revisión (review)",
    does: "Lee el cambio contra la especificación y busca errores; aprueba o pide arreglos concretos.",
    cannot: "No modifica el código.",
  },
  security: {
    name: "Seguridad (security)",
    does: "Hace una segunda lectura del cambio buscando solo problemas de seguridad.",
    cannot: "No modifica el código.",
  },
  reply: {
    name: "Respuestas (reply)",
    does: "Lee tus comentarios en los issues y decide si responde, si pide un cambio nuevo o si aprueba o rechaza una consulta pendiente.",
    cannot: "No ve el repositorio ni modifica el código; dónde está cada cambio lo calcula la fábrica, no el agente.",
  },
  scout: {
    name: "Turno nocturno (scout)",
    does: "Cuando la fábrica está libre, mira el código, el townhall, las trazas de los últimos 30 días y las specs sin tests, y propone mejoras que vos aprobás o rechazás.",
    cannot: "No modifica el código ni construye nada; nunca propone tocar rutas protegidas ni cambios que pidan credenciales nuevas.",
  },
  research: {
    name: "Investigación (research)",
    does: "Una vez por día, con la fábrica libre, busca en la web skills, servidores MCP y tecnologías que sirvan a la línea, según la skill de investigación de cada línea, y deja una nota con fuentes.",
    cannot: "No modifica el código ni instala, clona o ejecuta nada de lo que encuentra; lo que lee en la web es dato, nunca instrucciones.",
  },
};

const DELIVERY: Record<FactoryGuide["lines"][number]["integrate"], string> = { merge: "merge local", branch: "rama", "pull-request": "pull request" };

const codes = (items: string[], none: string) => (items.length ? items.map((c) => `<code>${esc(c)}</code>`).join(", ") : none);

function skillItems(skills: SkillView[]): string {
  return `<ul class="skills">${skills
    .map(
      (s) =>
        `<li data-skill="${esc(s.name)}"><code>${esc(s.name)}</code>${s.missing ? ` <span class="badge warn">faltante</span> <span class="muted">${esc(s.missing)}</span>` : s.description ? ` — ${esc(s.description)}` : ""}</li>`,
    )
    .join("")}</ul>`;
}

function agentSkillsSection(s: AgentGuide["skills"]): string {
  if (!s.general.length && !s.lines.length) return `<div class="skills"><h3>Skills</h3><p class="muted">No tiene skills asignadas.</p></div>`;
  const general = s.general.length ? `<p>Generales:</p>${skillItems(s.general)}` : `<p class="muted">Sin skills generales.</p>`;
  const lines = s.lines.map((l) => `<div class="skills-line" data-line="${esc(l.line)}"><p>Suma la línea <b>${esc(l.line)}</b>:</p>${skillItems(l.skills)}</div>`).join("");
  return `<div class="skills"><h3>Skills</h3>${general}${lines}</div>`;
}

/** A line's custom agents in the order they run, with what each may do. */
function lineAgentItems(agents: FactoryGuide["lines"][number]["agents"]): string {
  if (!agents.length) return `<li>No tiene agentes a medida.</li>`;
  const items = agents.map((a) => {
    const kind = a.type === "build" ? `<span class="badge warn">modifica el código</span> <span class="muted">entre build y verify</span>` : `<span class="badge ok">solo lectura</span> <span class="muted">después de security${a.blocking ? "" : ", solo informa"}</span>`;
    return `<li data-agent="${esc(a.name)}"><code>${esc(a.name)}</code> ${kind}${a.files.length ? ` · solo si el cambio toca ${codes(a.files, "")}` : ""}</li>`;
  });
  return `<li>Agentes a medida, en el orden en que corren:<ul class="skills">${items.join("")}</ul></li>`;
}

export function agentsPage(g: FactoryGuide, nonce: string): string {
  const agents = g.agents
    .map((a) => {
      const t = AGENT_SUMMARY[a.station];
      return `<div class="card agent" data-station="${esc(a.station)}"><h2>${esc(t.name)}</h2>
<p>${esc(t.does)}</p><p class="muted">${esc(t.cannot)}</p>
<p>${a.access === "write" ? `<span class="badge warn">puede modificar el código</span>` : `<span class="badge ok">solo lectura${a.access === "web" ? " · busca en la web" : ""}</span>`}</p>
<ul class="kv"><li>Motor: <b>${esc(a.engine)}</b></li>
<li>Modelo: ${a.model ? `<b>${esc(a.model)}</b>` : "el predeterminado del motor"}</li>
<li>Máximo de turnos: <b>${a.maxTurns ?? "sin límite"}</b></li>
<li>Máximo de minutos: <b>${esc(a.timeoutMinutes)}</b></li></ul>
${agentSkillsSection(a.skills)}
<details class="ins"><summary>ver instrucciones completas</summary><pre>${esc(a.instructions)}</pre></details></div>`;
    })
    .join("");
  const lines = g.lines.length
    ? g.lines
        .map(
          (l) => `<div class="card line" data-line="${esc(l.name)}"><h3>${esc(l.name)}</h3><ul class="kv">
<li>Repositorio: <code>${esc(l.repo)}</code></li>
<li>Rama base: <code>${esc(l.baseBranch)}</code></li>
<li>Comandos de verificación: ${codes(l.verify, "ninguno")}</li>
<li>Entrega: <b>${DELIVERY[l.integrate]}</b></li>
<li>${l.autoMerge ? "Se funde sola cuando GitHub dice que está lista." : "No se funde sola."}</li>
<li>${l.issues ? `Toma issues de GitHub con la etiqueta <b>${esc(l.issues.label)}</b>.` : "No toma issues de GitHub."}</li>
<li>Rutas protegidas: ${codes(g.limits.protectedPaths, "ninguna")}</li>
${lineAgentItems(l.agents)}</ul></div>`,
        )
        .join("")
    : `<div class="card muted">Todavía no hay líneas. Agregá una con <code>zero line add</code>.</div>`;
  return page(
    "Agentes",
    `<div class="card"><h1>Agentes</h1><p class="muted">Cada paso de la línea lo hace un agente con sus propias instrucciones y límites. Los límites los controla la fábrica, no el agente.</p></div>
${agents}<h2>Líneas</h2>${lines}`,
    { nonce, active: "/agents" },
  );
}

/** "45 s", "3 min", "1 h 5 min". */
function duration(ms: number | undefined): string {
  if (ms === undefined) return "sin dato";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const percent = (rate: number | undefined) => (rate === undefined ? "sin dato" : `${Math.round(rate * 100)} %`);
const PERIODS: [MonitorPeriod, string][] = [["hoy", "Hoy"], ["7", "7 días"], ["30", "30 días"]];
const stat = (label: string, value: string | number) => `<div class="card stat"><span class="muted">${esc(label)}</span><b class="big">${esc(value)}</b></div>`;

/** The "Monitor" tab: a read-only cockpit of the factory, its agents and its lines, drawn in inline SVG. */
export function monitorPage(view: MonitorView, nonce: string): string {
  const periods = `<p class="periods">${PERIODS.map(([p, label]) => `<a href="/monitor?periodo=${p}"${p === view.period ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</p>`;
  const totals = `<div class="monitor">
${stat("Trabajos creados", view.created)}${stat("Entregados", view.delivered)}${stat("Fallidos", view.failed)}${stat("Detenidos", view.stopped)}
${stat("En cola", view.queued)}${stat("En curso", view.running)}
<div class="card"><span class="muted">Tasa de éxito</span>${gauge(view.successRate === undefined ? undefined : view.successRate * 100, "entregados sobre terminados")}</div>
${stat("Tiempo promedio por trabajo", duration(view.avgJobMs))}${stat("Intentos por trabajo", view.avgAttempts === undefined ? "sin dato" : Number(view.avgAttempts.toFixed(1)))}
${stat("Tokens", view.tokens === undefined ? "sin dato" : view.tokens.toLocaleString("es-AR"))}
<div class="card wide"><h3>Trabajos por día</h3>${lineChart(view.days.map((d) => ({ label: d.day.slice(5), value: d.jobs })))}</div>
${view.weeks ? `<div class="card wide"><h3>Trabajos por semana</h3>${bars(view.weeks.map((w) => ({ label: `desde ${w.week.slice(5)}`, value: w.jobs })))}</div>` : ""}
<div class="card wide"><h3>Tiempo promedio por estación</h3>${bars(view.stations.map((s) => ({ label: s.station, value: s.avgMs, text: duration(s.avgMs) })))}</div>
<div class="card wide"><h3>Uso de la suscripción</h3>${view.plans.length ? `<div class="gauges">${view.plans.map((w) => gauge((w.utilization ?? 0) * 100, `${w.engine} · ${w.label}`)).join("")}</div>` : `<p class="muted">sin dato</p>`}</div>
<div class="card wide"><h3>Gasto del mes por motor</h3>${bars(view.monthUsd.map((m) => ({ label: m.engine, value: m.usd, text: usd(m.usd) })))}</div>
</div>`;
  const agents = view.agents
    .map(
      (a) => `<div class="card" data-agent="${esc(a.name)}"><h3>${esc(a.name)}</h3>${gauge(a.successRate === undefined ? undefined : a.successRate * 100, "éxito")}
<ul class="kv"><li>Llamadas: <b>${a.calls}</b></li><li>Costo: <b>${usd(a.costUsd)}</b></li><li>Tokens: <b>${a.tokens === undefined ? "sin dato" : a.tokens.toLocaleString("es-AR")}</b></li>
<li>Tiempo trabajado: <b>${duration(a.workedMs)}</b></li><li>Entregas: <b>${a.deliveries}</b></li>
<li>Motores: ${a.engines.length ? esc(a.engines.join(", ")) : "—"}</li><li>Modelos: ${a.models.length ? esc(a.models.join(", ")) : "—"}</li><li>Líneas: ${a.lines.length ? esc(a.lines.join(", ")) : "—"}</li></ul></div>`,
    )
    .join("\n");
  const lines = view.lines
    .map(
      (l) => `<div class="card" data-line="${esc(l.line)}"><h3>${esc(l.line)}</h3>
<ul class="kv"><li>Trabajos: <b>${l.jobs}</b></li><li>Entregas: <b>${l.deliveries}</b></li><li>Pull requests abiertos: <b>${l.openPullRequests}</b></li>
<li>Último trabajo: ${l.last ? `<a href="/job/${esc(l.last.id)}">${esc(l.last.name)}</a> <span class="badge">${esc(STATUS_TEXT[l.last.status])}</span>` : "ninguno"}</li></ul></div>`,
    )
    .join("\n");
  return page(
    "Monitor",
    `<div class="card"><h1>Monitor</h1><p class="muted">Lo que la fábrica ya tiene guardado, sin escribir nada. Se actualiza solo.</p>${periods}</div>
<h2>Fábrica</h2>${totals}<h2>Agentes</h2><div class="monitor">${agents}</div><h2>Líneas</h2><div class="monitor">${lines || `<p class="muted">No hay líneas.</p>`}</div>`,
    { nonce, refresh: true, active: "/monitor" },
  );
}
