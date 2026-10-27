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
`;

/** Reloads the page every 15 s while nobody is typing, so the phone shows live state without a framework. */
const REFRESH = `setInterval(() => {
  const a = document.activeElement;
  const typing = a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT");
  const drafted = [...document.querySelectorAll("textarea,input[type=text]")].some((e) => e.value);
  if (document.visibilityState === "visible" && !typing && !drafted) location.reload();
}, 15000);`;

export function page(title: string, body: string, opts: { nonce: string; flash?: string; refresh?: boolean; nav?: boolean } = { nonce: "" }): string {
  const nav = opts.nav === false ? "" : `<a href="/">Resumen</a><a href="/egress">Salidas</a><a href="/briefing">Informe</a>`;
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
