import { createHash } from "node:crypto";
import type { EgressReport, FactoryGuide, FactoryStatus, LineRow, LineStation, ProductionLine, StationState, StationView } from "../app.js";
import type { StationName } from "../config.js";
import { bytes, describeJobStatus, jobName } from "../format.js";
import { describeDelivery } from "../line/finish.js";
import type { PolicyEvent } from "../line/policy.js";
import { FINAL_STATUSES, type Job } from "../state/store.js";
import type { EgressSite } from "../telemetry/metrics.js";

/** Pages of the control panel: plain HTML rendered on the server, made for a phone first. */

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const usd = (n: number) => `$${n.toFixed(2)}`;

const STYLE = `
:root { --bg:#f6f7f9; --card:#fff; --text:#16181d; --muted:#5d6470; --line:#e3e6eb; --accent:#2f5bea; --warn:#b4540a; --bad:#c22f2f; --ok:#1f7a45; }
@media (prefers-color-scheme: dark) { :root { --bg:#111317; --card:#1a1d23; --text:#e8eaee; --muted:#9aa2ae; --line:#2a2f37; --accent:#7d9bff; --warn:#f0a35e; --bad:#ff7b7b; --ok:#5fd394; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
header { position:sticky; top:0; background:var(--card); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; z-index:1; }
header strong { margin-right:auto; }
header a { color:var(--accent); text-decoration:none; }
main { max-width:760px; margin:0 auto; padding:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin:0 0 14px; }
h1 { font-size:1.25rem; margin:0 0 8px; } h2 { font-size:1.05rem; margin:18px 0 8px; } h3 { font-size:1rem; margin:0 0 6px; }
.muted { color:var(--muted); font-size:.92rem; } .warn { color:var(--warn); } .bad { color:var(--bad); } .ok { color:var(--ok); }
pre { white-space:pre-wrap; word-break:break-word; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; font:13px/1.4 ui-monospace,Consolas,monospace; margin:8px 0; }
form { margin:8px 0 0; } form.inline { display:inline; }
button { font:inherit; padding:9px 14px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--text); cursor:pointer; margin:4px 6px 0 0; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; } button.danger { border-color:var(--bad); color:var(--bad); }
textarea, input, select { font:inherit; width:100%; padding:9px 10px; border-radius:9px; border:1px solid var(--line); background:var(--bg); color:var(--text); }
textarea { min-height:90px; } label { display:block; margin:8px 0 4px; font-size:.92rem; color:var(--muted); }
ul.jobs { list-style:none; padding:0; margin:0; } ul.jobs li { padding:8px 0; border-top:1px solid var(--line); } ul.jobs li:first-child { border-top:0; }
a.job { color:var(--text); text-decoration:none; } a.job:hover { text-decoration:underline; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; }
.stat b { display:block; font-size:1.3rem; }
.flash { border-color:var(--accent); }
table { border-collapse:collapse; width:100%; font-size:.9rem; display:block; overflow-x:auto; } td, th { border:1px solid var(--line); padding:4px 6px; text-align:left; }
.row h3 { overflow-wrap:anywhere; } .row .out, .row .retry { margin:8px 0 0; }
.belt { margin-top:8px; } .track { position:relative; padding-top:30px; }
.track::before { content:""; position:absolute; left:2%; right:2%; top:10px; height:8px; border-radius:4px; background:repeating-linear-gradient(90deg,var(--line) 0 10px,transparent 10px 20px); background-size:20px 8px; }
.piece { position:absolute; top:4px; left:calc(var(--pos) * 100% / 7 + 100% / 14 - 11px); width:22px; height:20px; border-radius:5px; background:var(--accent); transition:left .9s ease, background-color .4s, opacity .4s; }
.piece.out { left:calc(100% - 22px); } .piece.ok { background:var(--ok); } .piece.bad { background:var(--bad); } .piece.idle { opacity:0; }
ol.stations { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:4px; }
.st { text-align:center; font-size:.78rem; color:var(--muted); border:1px solid var(--line); border-radius:9px; padding:4px 2px; transition:border-color .4s, color .4s; }
.st summary { list-style:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:1px; } .st summary::-webkit-details-marker { display:none; }
.st .ic { display:inline-flex; width:26px; height:26px; } .st svg { width:26px; height:26px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.st .nm { font-weight:600; } .st .mk { font-weight:700; } .st .why { color:var(--bad); overflow-wrap:anywhere; }
.st .dt { text-align:left; padding:4px; overflow-wrap:anywhere; }
.st[data-state="active"] { color:var(--accent); border-color:var(--accent); }
.st[data-state="done"] { color:var(--ok); }
.st[data-state="error"] { color:var(--bad); border-color:var(--bad); }
.st[data-state="waiting"] { color:var(--warn); border-color:var(--warn); }
@keyframes spin { to { transform:rotate(360deg); } }
@keyframes scan { 0%,100% { transform:translateX(-3px); } 50% { transform:translateX(3px); } }
@keyframes glow { 0%,100% { opacity:1; } 50% { opacity:.45; } }
@keyframes bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }
@keyframes beat { 0%,100% { transform:scale(1); } 50% { transform:scale(1.12); } }
@keyframes belt { to { background-position:20px 0; } }
@keyframes pop { 0% { transform:scale(0); } 60% { transform:scale(1.35); } 100% { transform:scale(1); } }
@keyframes shake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-4px); } 75% { transform:translateX(4px); } }
@keyframes back { 0% { transform:translateX(0); } 40% { transform:translateX(-8px) rotate(-8deg); } 100% { transform:translateX(0); } }
.row:not(.final) .st[data-state="active"] .ic { animation:bob 1.4s ease-in-out infinite; }
.row:not(.final) .st[data-state="active"][data-station="build"] .ic { animation:spin 2.4s linear infinite; }
.row:not(.final) .st[data-state="active"][data-station="review"] .ic { animation:scan 1.6s ease-in-out infinite; }
.row:not(.final) .st[data-state="active"][data-station="security"] .ic { animation:glow 1.8s ease-in-out infinite; }
.row:not(.final) .st[data-state="waiting"] .ic { animation:beat 2.6s ease-in-out infinite; }
.row:not(.final) .belt[data-flow="active"] .track::before { animation:belt 1s linear infinite; }
.row:not(.final) .st[data-state="done"] .mk { display:inline-block; animation:pop .5s ease-out 1; }
.st[data-state="error"] { animation:shake .5s ease 1; }
.piece.back { animation:back .9s ease 1; }
@media (max-width: 600px) { .belt { overflow-x:auto; } .track { min-width:560px; } }
ol.route { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px 22px; counter-reset:step; }
ol.route li { position:relative; flex:1 1 150px; border:1px solid var(--line); border-radius:9px; padding:8px 10px; counter-increment:step; }
ol.route li b::before { content:counter(step) ". "; color:var(--muted); }
ol.route li:not(:last-child)::after { content:"→"; position:absolute; right:-17px; top:50%; transform:translateY(-50%); color:var(--accent); }
ol.route li span { display:block; font-size:.88rem; color:var(--muted); }
.kv { margin:6px 0 0; padding:0; list-style:none; } .kv li { margin:3px 0; overflow-wrap:anywhere; } .kv code { overflow-wrap:anywhere; white-space:pre-wrap; }
.badge { display:inline-block; font-size:.8rem; padding:1px 8px; border-radius:9px; border:1px solid currentColor; }
details.ins summary { cursor:pointer; color:var(--accent); margin-top:8px; }
@media (max-width: 600px) { ol.route { flex-direction:column; gap:22px; } ol.route li { flex-basis:auto; } ol.route li:not(:last-child)::after { content:"↓"; right:auto; left:50%; top:auto; bottom:-21px; transform:none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

/** Reloads the page every 15 s while nobody is typing, so the phone shows live state without a framework. */
const REFRESH = `setInterval(() => {
  const a = document.activeElement;
  const typing = a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT");
  const drafted = [...document.querySelectorAll("textarea,input[type=text]")].some((e) => e.value);
  if (document.visibilityState === "visible" && !typing && !drafted) location.reload();
}, 15000);`;

export function page(title: string, body: string, opts: { nonce: string; flash?: string; refresh?: boolean; nav?: boolean } = { nonce: "" }): string {
  const nav = opts.nav === false ? "" : `<a href="/">Resumen</a><a href="/line">Línea</a><a href="/egress">Salidas</a><a href="/briefing">Informe</a><a href="/about">Qué es zero</a><a href="/agents">Agentes</a>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)} · zero</title><style>${STYLE}</style></head>
<body><header><strong>zero</strong>${nav}</header><main>
${opts.flash ? `<div class="card flash">${esc(opts.flash)}</div>` : ""}${body}</main>
${opts.refresh ? `<script nonce="${opts.nonce}">${REFRESH}</script>` : ""}</body></html>`;
}

/** The only page without a session: exchanges the key in the link's fragment for a cookie, then clears it from the address bar. */
export function loginPage(nonce: string, failed = false): string {
  const script = `(() => {
  const k = new URLSearchParams(location.hash.slice(1)).get("k");
  if (!k) return;
  history.replaceState(null, "", "/");
  fetch("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "k=" + encodeURIComponent(k) })
    .then((r) => (r.ok ? location.replace("/") : (document.getElementById("msg").textContent = "La clave no es válida.")));
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

const jobLine = (j: Job) =>
  `<li><a class="job" href="/job/${esc(j.id)}"><b>${esc(jobName(j))}</b></a><br><span class="muted">${esc(j.id)} · ${esc(j.line)} · ${esc(describeJobStatus(j))}${j.delivery ? ` · ${esc(describeDelivery(j.delivery))}` : ""}</span></li>`;

const answerForms = (j: Job) =>
  `<form method="post" action="/job/${esc(j.id)}/answer"><label for="n-${esc(j.id)}">Nota (opcional)</label><input id="n-${esc(j.id)}" type="text" name="note">
<button class="primary" name="decision" value="approve">Aprobar</button><button class="danger" name="decision" value="reject">Rechazar</button></form>`;

export function overviewPage(s: FactoryStatus, lines: string[], nonce: string, flash?: string): string {
  const t = s.today;
  const state = s.andon ? `<span class="bad">DETENIDA (andon)</span>` : s.daemon.alive ? `<span class="ok">en marcha</span>` : "apagada";
  const box =
    s.isolation !== "container"
      ? "Caja de aislamiento desactivada: los trabajos corren en copias locales."
      : s.box.availability.ready
        ? `Caja lista (${esc(s.box.status?.runtime)}).`
        : "Sin caja: los trabajos corren en copias locales.";
  const waiting = s.waiting
    .map((j) => `<div class="card"><h3><a class="job" href="/job/${esc(j.id)}">${esc(jobName(j))}</a></h3><pre>${esc(j.question?.text)}</pre>
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
<div class="stat"><b>${usd(s.budget.spentUsd)}</b><span class="muted">de ${usd(s.budget.limitUsd)} hoy${s.budget.reached ? " · ALCANZADO" : ""}</span></div>
${s.isolation === "container" && s.box.availability.ready ? `<div class="stat"><b>${t.egress.blocked}</b><span class="muted">salidas bloqueadas${t.egress.suspicious ? ` (${t.egress.suspicious} sospechosas)` : ""}</span></div>` : ""}
</div>
${s.merges.map((m) => `<p class="muted">Fusión automática: <a href="${esc(m.url)}">${esc(m.url)}</a> · ${m.status === "blocked" ? `<span class="bad">no se funde: ${esc(m.why ?? "")}</span>` : esc(m.why ?? "esperando")}</p>`).join("")}
${s.intake.map((i) => `<p class="muted">Issues de GitHub: ${esc(i.line)} toma los issues con la etiqueta <b>${esc(i.label)}</b>.${i.problem ? ` <span class="bad">${esc(i.problem)}</span>` : ""}</p>`).join("")}
<form method="post" action="/andon">${s.andon ? `<button class="primary" name="state" value="off">Reanudar la fábrica</button>` : `<button class="danger" name="state" value="on">Detener la fábrica (andon)</button>`}</form></div>
${waiting ? `<h2>Esperando tu respuesta</h2>${waiting}` : ""}
${list("Trabajando", s.running)}${list("En cola", s.queued)}${list("Últimos terminados", s.recent)}
<div class="card"><h2>Pedir un trabajo</h2>
<form method="post" action="/request"><label for="text">Qué querés, en tus palabras</label><textarea id="text" name="text" required></textarea>
${lines.length > 1 ? `<label for="line">Proyecto</label><select id="line" name="line">${options}</select>` : ""}
<button class="primary">Pedir</button></form></div>`,
    { nonce, flash, refresh: true },
  );
}

export function jobPage(job: Job, traceText: string, nonce: string, flash?: string): string {
  const final = FINAL_STATUSES.includes(job.status);
  return page(
    jobName(job),
    `<div class="card"><h1>${esc(jobName(job))}</h1>
<p class="muted">${esc(job.id)} · línea ${esc(job.line)} · costo ${usd(job.costUsd)} de ${usd(job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0))}</p>
<p><b>${esc(describeJobStatus(job))}</b></p>
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
    { nonce, flash, refresh: true },
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

export function briefingPage(title: string, body: string, nonce: string): string {
  return page("Informe", `<div class="card"><h1>${esc(title)}</h1><p class="muted"><a href="/briefing?days=1">hoy</a> · <a href="/briefing?days=7">7 días</a></p>${markdown(body)}</div>`, { nonce });
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

function station(st: StationView): string {
  const d = st.detail;
  const detail = d
    ? `Duración: ${esc(d.time)}<br>Costo: ${esc(d.cost ?? "sin costo")}${d.engines.length ? `<br>Motor: ${esc(d.engines.join(", "))}` : ""}${d.error ? `<br>Error: ${esc(d.error)}` : ""}`
    : "Todavía no pasó por acá.";
  return `<li class="st" data-station="${st.name}" data-state="${st.state}"><details><summary><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[st.name]}</svg></span>
<span class="nm">${STATION_LABEL[st.name]}</span><span><span class="mk" aria-hidden="true">${STATE_MARK[st.state]}</span> <span class="tx">${STATE_TEXT[st.state]}</span></span>${
    st.reason ? `<span class="why">${esc(st.reason)}</span>` : ""
  }</summary><div class="dt">${detail}</div></details></li>`;
}

/** The belt: the stations in order and the piece, whose position (`--pos`) changes so CSS can slide it. */
const belt = (stations: StationView[], pos: number, piece: string, flow: string) =>
  `<div class="belt" data-part="belt" data-flow="${flow}"><div class="track"><div class="${piece}" style="--pos:${pos}"></div><ol class="stations">${stations.map(station).join("")}</ol></div></div>`;

function lineRow(r: LineRow): string {
  const final = FINAL_STATUSES.includes(r.status);
  const pos = final ? 7 : Math.max(LINE_ORDER.indexOf(r.at ?? "setup"), 0);
  const backing = !final && r.attempt > 1 && r.at === "build";
  const piece = ["piece", final && "out", r.status === "delivered" ? "ok" : final && "bad", backing && "back"].filter(Boolean).join(" ");
  const flow = final ? "still" : r.stations.some((s) => s.state === "active") ? "active" : r.status === "waiting" ? "waiting" : "still";
  const d = r.delivery;
  const out =
    r.status === "delivered"
      ? `<p class="out ok"><b>entregado</b>${d ? ` · ${d.url ? `<a href="${esc(d.url)}">${esc(d.text)}</a>` : esc(d.text)}${d.merge ? ` · ${esc(d.merge)}` : ""}` : ""}</p>`
      : final
        ? `<p class="out bad"><b>${r.status === "failed" ? "fallido" : "detenido"}</b>${r.reason ? ` · ${esc(r.reason)}` : ""}</p>`
        : "";
  const retry = r.attempt > 1 && !final ? `<p class="retry warn">intento ${r.attempt} de ${r.maxAttempts}${r.retryError ? ` · ${esc(r.retryError)}` : ""}</p>` : "";
  const inner = `<h3 data-part="head"><a class="job" href="/job/${esc(r.id)}">${esc(r.title)}</a> <span class="muted">${esc(r.id)} · ${esc(r.line)}</span></h3>
<div data-part="retry">${retry}</div>${belt(r.stations, pos, piece, flow)}<div data-part="out">${out}</div>`;
  // Lets the page's script skip rows that did not change, so finished rows stay still.
  const sig = createHash("sha256").update(inner).digest("hex").slice(0, 16);
  return `<article class="card row${final ? " final" : ""}" id="job-${esc(r.id)}" data-status="${r.status}" data-sig="${sig}">${inner}</article>`;
}

const LINE_ORDER: LineStation[] = ["setup", "spec", "build", "verify", "review", "security", "integrate"];

/** The production line's counters and rows: the page's content, and the fragment the page fetches to stay current. */
export function lineView(data: ProductionLine): string {
  const c = data.counts;
  const summary = `<div class="card grid" data-part="summary">
<div class="stat"><b>${c.active}</b><span class="muted">activos</span></div>
<div class="stat"><b>${c.waiting}</b><span class="muted">esperando</span></div>
<div class="stat"><b>${c.failed}</b><span class="muted">con error</span></div>
<div class="stat"><b>${c.delivered}</b><span class="muted">entregados hoy</span></div></div>`;
  if (!data.rows.length) {
    const idle = LINE_ORDER.map((name) => station({ name, state: "pending" })).join("");
    return `${summary}<div class="card row final" data-part="idle"><h3>La fábrica está libre</h3><div class="belt" data-flow="still"><div class="track"><div class="piece idle" style="--pos:0"></div><ol class="stations">${idle}</ol></div></div></div>`;
  }
  return `${summary}<div data-part="rows">${data.rows.map(lineRow).join("")}</div>`;
}

/**
 * Keeps the line current without reloading: gets the fragment (pushed on `/line/events`, or polled) and patches only what changed,
 * keeping each row's elements so CSS transitions slide the piece instead of jumping.
 */
const LINE_REFRESH = `(() => {
  const root = document.getElementById("line");
  let last = "";
  const part = (el, name) => el.querySelector('[data-part="' + name + '"]');
  const patchRow = (old, row) => {
    for (const name of ["head", "retry", "out"]) {
      const a = part(old, name);
      const b = part(row, name);
      if (a && b && a.outerHTML !== b.outerHTML) a.replaceWith(b);
    }
    const belt = part(old, "belt");
    const fresh = part(row, "belt");
    belt.dataset.flow = fresh.dataset.flow;
    const piece = belt.querySelector(".piece");
    const next = fresh.querySelector(".piece");
    piece.className = next.className;
    piece.setAttribute("style", next.getAttribute("style"));
    for (const st of [...fresh.querySelectorAll("[data-station]")]) {
      const cur = belt.querySelector('[data-station="' + st.dataset.station + '"]');
      st.querySelector("details").open = cur.querySelector("details").open;
      if (cur.outerHTML !== st.outerHTML) cur.replaceWith(st);
    }
    old.className = row.className;
    old.dataset.status = row.dataset.status;
    old.dataset.sig = row.dataset.sig;
  };
  const update = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    const next = t.content;
    const rows = part(root, "rows");
    const fresh = part(next, "rows");
    if (!rows || !fresh) return root.replaceChildren(next);
    part(root, "summary").replaceWith(part(next, "summary"));
    const kept = new Map([...rows.children].map((r) => [r.id, r]));
    const order = [...fresh.children].map((row) => {
      const old = kept.get(row.id);
      if (!old) return row;
      kept.delete(row.id);
      if (old.dataset.sig !== row.dataset.sig) patchRow(old, row);
      return old;
    });
    kept.forEach((r) => r.remove());
    order.forEach((r, i) => {
      if (rows.children[i] !== r) rows.insertBefore(r, rows.children[i] || null);
    });
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
  return page("Línea de producción", `<h1>Línea de producción</h1><div id="line">${view}</div><script nonce="${nonce}">${LINE_REFRESH}</script>`, { nonce });
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
<li>Límite de gasto por día: <b>${usd(g.limits.usdPerDay)}</b></li>
<li>Límite de gasto por trabajo: <b>${usd(g.limits.usdPerJob)}</b></li>
<li>Caja de aislamiento: ${box}</li>
<li>Líneas: <b>${g.lines.length}</b></li></ul></div>`,
    { nonce },
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
};

const DELIVERY: Record<FactoryGuide["lines"][number]["integrate"], string> = { merge: "merge local", branch: "rama", "pull-request": "pull request" };

const codes = (items: string[], none: string) => (items.length ? items.map((c) => `<code>${esc(c)}</code>`).join(", ") : none);

export function agentsPage(g: FactoryGuide, nonce: string): string {
  const agents = g.agents
    .map((a) => {
      const t = AGENT_SUMMARY[a.station];
      return `<div class="card agent" data-station="${esc(a.station)}"><h2>${esc(t.name)}</h2>
<p>${esc(t.does)}</p><p class="muted">${esc(t.cannot)}</p>
<p>${a.access === "write" ? `<span class="badge warn">puede modificar el código</span>` : `<span class="badge ok">solo lectura</span>`}</p>
<ul class="kv"><li>Motor: <b>${esc(a.engine)}</b></li>
<li>Modelo: ${a.model ? `<b>${esc(a.model)}</b>` : "el predeterminado del motor"}</li>
<li>Máximo de turnos: <b>${a.maxTurns ?? "sin límite"}</b></li>
<li>Máximo de minutos: <b>${esc(a.timeoutMinutes)}</b></li></ul>
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
<li>Rutas protegidas: ${codes(g.limits.protectedPaths, "ninguna")}</li></ul></div>`,
        )
        .join("")
    : `<div class="card muted">Todavía no hay líneas. Agregá una con <code>zero line add</code>.</div>`;
  return page(
    "Agentes",
    `<div class="card"><h1>Agentes</h1><p class="muted">Cada paso de la línea lo hace un agente con sus propias instrucciones y límites. Los límites los controla la fábrica, no el agente.</p></div>
${agents}<h2>Líneas</h2>${lines}`,
    { nonce },
  );
}
