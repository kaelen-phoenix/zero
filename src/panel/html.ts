import type { EgressReport, FactoryStatus } from "../app.js";
import { bytes, describeJobStatus, jobName } from "../format.js";
import { describeDelivery } from "../line/finish.js";
import { FINAL_STATUSES, type Job } from "../state/store.js";
import type { EgressSite } from "../telemetry/metrics.js";

/** Pages of the control panel: plain HTML rendered on the server, made for a phone first. */

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const usd = (n: number) => `$${n.toFixed(2)}`;

const STYLE = `
:root { color-scheme:light dark;
  --bg:#f4f6f9; --card:#fff; --sunken:#f0f2f6; --text:#14171c; --muted:#5b6370; --line:#e1e5eb; --line-strong:#cdd3dc;
  --accent:#2f5bea; --accent-ink:#fff; --accent-soft:#e8eefe; --warn:#a24c08; --warn-soft:#fdf1e4; --bad:#bf2b2b; --bad-soft:#fdeaea;
  --ok:#1b7340; --ok-soft:#e5f5ec; --info:#5b45c9; --info-soft:#efecfc; --neutral-soft:#eceff3;
  --radius:12px; --radius-sm:8px; --shadow:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px;
  --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif; --mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
@media (prefers-color-scheme: dark) { :root {
  --bg:#0f1115; --card:#171a20; --sunken:#12151a; --text:#e7e9ee; --muted:#9aa2ae; --line:#272c34; --line-strong:#353b45;
  --accent:#7d9bff; --accent-ink:#0f1115; --accent-soft:#1d2540; --warn:#f0a35e; --warn-soft:#33240f; --bad:#ff7b7b; --bad-soft:#3a1a1a;
  --ok:#5fd394; --ok-soft:#14301f; --info:#b3a6ff; --info-soft:#252040; --neutral-soft:#242830;
  --shadow:0 1px 2px rgba(0,0,0,.4); } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 var(--font); -webkit-font-smoothing:antialiased; }
a { color:var(--accent); text-underline-offset:2px; }
code { font:.9em var(--mono); background:var(--sunken); border:1px solid var(--line); border-radius:5px; padding:0 4px; }
header { position:sticky; top:0; z-index:1; background:var(--card); border-bottom:1px solid var(--line); box-shadow:var(--shadow); }
.bar { max-width:860px; margin:0 auto; padding:var(--s2) var(--s4); display:flex; gap:var(--s3); align-items:center; flex-wrap:wrap; }
.brand { display:inline-flex; align-items:center; gap:var(--s2); margin-right:auto; color:var(--text); text-decoration:none; font-weight:700; letter-spacing:-.01em; }
.brand svg { width:26px; height:26px; flex:none; }
.brand small { font-weight:500; color:var(--muted); font-size:.85rem; }
nav { display:flex; gap:var(--s1); }
nav a { color:var(--muted); text-decoration:none; padding:6px 12px; border-radius:999px; font-size:.95rem; font-weight:500; }
nav a:hover { color:var(--text); background:var(--sunken); }
nav a[aria-current="page"] { color:var(--accent); background:var(--accent-soft); }
main { max-width:860px; margin:0 auto; padding:var(--s4); }
.card { background:var(--card); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:var(--s4) var(--s4); margin:0 0 var(--s4); }
.card > :last-child { margin-bottom:0; }
.hero { border-top:3px solid var(--accent); }
.hero.stopped { border-top-color:var(--bad); }
h1 { font-size:1.3rem; line-height:1.3; margin:0 0 var(--s2); letter-spacing:-.01em; }
h2 { font-size:1.05rem; margin:var(--s5) 0 var(--s2); } .card > h2:first-child { margin-top:0; }
h3 { font-size:1rem; margin:0 0 6px; } h4 { font-size:.95rem; margin:var(--s3) 0 6px; }
.section { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:var(--s5) 0 var(--s2); }
p { margin:0 0 var(--s2); }
.muted { color:var(--muted); font-size:.92rem; } .warn { color:var(--warn); } .bad { color:var(--bad); } .ok { color:var(--ok); }
pre { white-space:pre-wrap; word-break:break-word; background:var(--sunken); border:1px solid var(--line); border-radius:var(--radius-sm); padding:var(--s3); font:13px/1.45 var(--mono); margin:var(--s2) 0; max-height:60vh; overflow:auto; }
form { margin:var(--s2) 0 0; } form.inline { display:inline; }
button { font:inherit; font-size:.95rem; font-weight:500; padding:8px 14px; border-radius:var(--radius-sm); border:1px solid var(--line-strong); background:var(--card); color:var(--text); cursor:pointer; margin:var(--s1) 6px 0 0; min-height:40px; }
button:hover { background:var(--sunken); }
button.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); } button.primary:hover { filter:brightness(1.08); }
button.danger { border-color:var(--bad); color:var(--bad); } button.danger:hover { background:var(--bad-soft); }
textarea, input, select { font:inherit; width:100%; padding:9px 11px; border-radius:var(--radius-sm); border:1px solid var(--line-strong); background:var(--card); color:var(--text); }
textarea { min-height:96px; resize:vertical; } label { display:block; margin:var(--s3) 0 var(--s1); font-size:.9rem; font-weight:500; color:var(--muted); }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
ul.jobs { list-style:none; padding:0; margin:0; } ul.jobs li { padding:var(--s3) 0; border-top:1px solid var(--line); } ul.jobs li:first-child { border-top:0; padding-top:0; } ul.jobs li:last-child { padding-bottom:0; }
a.job { color:var(--text); text-decoration:none; font-weight:600; } a.job:hover { color:var(--accent); text-decoration:underline; }
.meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:var(--s1); }
.badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.8rem; font-weight:600; line-height:1.6; background:var(--neutral-soft); color:var(--muted); }
.badge-queued { background:var(--neutral-soft); color:var(--muted); }
.badge-running { background:var(--accent-soft); color:var(--accent); }
.badge-waiting { background:var(--warn-soft); color:var(--warn); }
.badge-delivered { background:var(--ok-soft); color:var(--ok); }
.badge-failed { background:var(--bad-soft); color:var(--bad); }
.badge-stopped { background:var(--info-soft); color:var(--info); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:var(--s3); margin:var(--s4) 0 var(--s2); }
.stat { background:var(--sunken); border:1px solid var(--line); border-radius:var(--radius-sm); padding:var(--s3); }
.stat b { display:block; font-size:1.5rem; line-height:1.2; font-variant-numeric:tabular-nums; }
.question { border-left:4px solid var(--warn); }
.flash { border-color:var(--accent); background:var(--accent-soft); }
table { border-collapse:collapse; width:100%; font-size:.9rem; display:block; overflow-x:auto; margin:var(--s2) 0; }
td, th { border-bottom:1px solid var(--line); padding:6px 10px; text-align:left; } th { background:var(--sunken); font-weight:600; }
@media (max-width: 560px) {
  body { font-size:15px; }
  .bar { padding:var(--s2) var(--s3); } .brand small { display:none; }
  nav { width:100%; justify-content:space-between; } nav a { flex:1; text-align:center; }
  main { padding:var(--s3); } .card { padding:var(--s3); border-radius:10px; }
  .grid { grid-template-columns:1fr 1fr; }
  form:not(.inline) button { width:100%; margin-right:0; }
}
`;

/** Reloads the page every 15 s while nobody is typing, so the phone shows live state without a framework. */
const REFRESH = `setInterval(() => {
  const a = document.activeElement;
  const typing = a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT");
  const drafted = [...document.querySelectorAll("textarea,input[type=text]")].some((e) => e.value);
  if (document.visibilityState === "visible" && !typing && !drafted) location.reload();
}, 15000);`;

/** The brand mark, inline so the page loads nothing from outside. */
const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><ellipse cx="16" cy="16" rx="7" ry="9" fill="none" stroke="var(--accent-ink)" stroke-width="3"/><path d="M11 22 21 10" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="round"/></svg>`;

export type Section = "overview" | "egress" | "briefing";

const SECTIONS: [Section, string, string][] = [
  ["overview", "/", "Resumen"],
  ["egress", "/egress", "Salidas"],
  ["briefing", "/briefing", "Informe"],
];

export function page(title: string, body: string, opts: { nonce: string; flash?: string; refresh?: boolean; nav?: boolean; active?: Section } = { nonce: "" }): string {
  const nav =
    opts.nav === false
      ? ""
      : `<nav aria-label="Secciones">${SECTIONS.map(([id, href, label]) => `<a href="${href}"${opts.active === id ? ` aria-current="page"` : ""}>${label}</a>`).join("")}</nav>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)} · zero</title><style>${STYLE}</style></head>
<body><header><div class="bar"><a class="brand" href="/">${MARK}<span>zero <small>· tu fábrica</small></span></a>${nav}</div></header><main>
${opts.flash ? `<div class="card flash" role="status">${esc(opts.flash)}</div>` : ""}${body}</main>
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

const statusBadge = (j: Job) => `<span class="badge badge-${esc(j.status)}">${esc(describeJobStatus(j))}</span>`;

const jobLine = (j: Job) =>
  `<li><a class="job" href="/job/${esc(j.id)}">${esc(jobName(j))}</a><div class="meta">${statusBadge(j)}<span class="muted">${esc(j.id)} · ${esc(j.line)}${j.delivery ? ` · ${esc(describeDelivery(j.delivery))}` : ""}</span></div></li>`;

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
    .map((j) => `<div class="card question"><h3><a class="job" href="/job/${esc(j.id)}">${esc(jobName(j))}</a></h3><pre>${esc(j.question?.text)}</pre>
<p class="muted">Si nadie responde antes de ${esc(j.question?.expiresAt.slice(0, 16).replace("T", " "))} UTC: ${j.question?.onTimeout === "approve" ? "se aprueba" : "se rechaza"}.</p>${answerForms(j)}</div>`)
    .join("");
  const list = (title: string, jobs: Job[]) => (jobs.length ? `<div class="card"><h2>${title}</h2><ul class="jobs">${jobs.map(jobLine).join("")}</ul></div>` : "");
  const options = lines.map((l) => `<option>${esc(l)}</option>`).join("");
  return page(
    "Resumen",
    `<div class="card hero${s.andon ? " stopped" : ""}"><h1>Fábrica ${state} · nivel ${esc(s.level.level)}</h1>
${s.level.reason ? `<p class="muted">${esc(s.level.reason)}</p>` : ""}<p class="muted">${box}</p>
<div class="grid">
<div class="stat"><b>${t.delivered}</b><span class="muted">entregados hoy</span></div>
<div class="stat"><b>${t.failed}</b><span class="muted">fallidos hoy</span></div>
<div class="stat"><b>${usd(s.budget.spentUsd)}</b><span class="muted">de ${usd(s.budget.limitUsd)} hoy${s.budget.reached ? " · ALCANZADO" : ""}</span></div>
${s.isolation === "container" && s.box.availability.ready ? `<div class="stat"><b>${t.egress.blocked}</b><span class="muted">salidas bloqueadas${t.egress.suspicious ? ` (${t.egress.suspicious} sospechosas)` : ""}</span></div>` : ""}
</div>
<form method="post" action="/andon">${s.andon ? `<button class="primary" name="state" value="off">Reanudar la fábrica</button>` : `<button class="danger" name="state" value="on">Detener la fábrica (andon)</button>`}</form></div>
${waiting ? `<h2 class="section">Esperando tu respuesta</h2>${waiting}` : ""}
${list("Trabajando", s.running)}${list("En cola", s.queued)}${list("Últimos terminados", s.recent)}
<div class="card"><h2>Pedir un trabajo</h2>
<form method="post" action="/request"><label for="text">Qué querés, en tus palabras</label><textarea id="text" name="text" required></textarea>
${lines.length > 1 ? `<label for="line">Proyecto</label><select id="line" name="line">${options}</select>` : ""}
<button class="primary">Pedir</button></form></div>`,
    { nonce, flash, refresh: true, active: "overview" },
  );
}

export function jobPage(job: Job, traceText: string, nonce: string, flash?: string): string {
  const final = FINAL_STATUSES.includes(job.status);
  return page(
    jobName(job),
    `<div class="card"><h1>${esc(jobName(job))}</h1>
<p class="muted">${esc(job.id)} · línea ${esc(job.line)} · costo ${usd(job.costUsd)} de ${usd(job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0))}</p>
<p>${statusBadge(job)}</p>
${job.delivery ? `<p class="ok">Entrega: ${job.delivery.url ? `<a href="${esc(job.delivery.url)}">${esc(describeDelivery(job.delivery))}</a>` : esc(describeDelivery(job.delivery))}</p>` : ""}
${job.reason ? `<p>Motivo:</p><pre>${esc(job.reason)}</pre>` : ""}
${job.question ? `<div class="card question"><h2>Pregunta para vos</h2><pre>${esc(job.question.text)}</pre>${answerForms(job)}</div>` : ""}
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
    { nonce, flash, refresh: true, active: "egress" },
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
  return page("Informe", `<div class="card"><h1>${esc(title)}</h1><p class="muted"><a href="/briefing?days=1">hoy</a> · <a href="/briefing?days=7">7 días</a></p>${markdown(body)}</div>`, { nonce, active: "briefing" });
}
