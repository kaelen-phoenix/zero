import { CONTROL_STATIONS, type ControlEvent, type ControlRoomView, type ControlSeries, type ControlTone } from "../app.js";
import { duration, esc, page } from "./html.js";

/** The "Sala de control" tab: an operations console of the factory, read-only, drawn in inline SVG and CSS. */

const usd = (n: number) => `$${n.toFixed(2)}`;
const two = (n: number) => String(n).padStart(2, "0");
/** Local `HH:MM` of a stored time. */
const hm = (iso: string) => {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** Its own dark console in both of the panel's themes: neon by `data-status`, monospace, thin borders. */
export const CONTROL_STYLE = `
#control { --cr-bg:#05080c; --cr-panel:#0a0f15; --cr-rule:#1c2a36; --cr-fg:#c9d6df; --cr-dim:#5d7282;
  --cr-ok:#39ff88; --cr-warn:#ffe14d; --cr-bad:#ff4d5e; --cr-run:#3ff0ff; --cr-idle:#7d8f9c;
  color-scheme:dark; background:var(--cr-bg); color:var(--cr-fg); font:11px/1.4 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;
  display:grid; grid-template-columns:minmax(220px,260px) minmax(0,1fr) minmax(220px,300px); gap:6px; padding:6px; border:1px solid var(--cr-rule); border-radius:4px;
  grid-template-areas:"top top top" "tick tick tick" "series graph alerts" "bus bus engines" "trace trace trace"; }
main > #control { max-width:none; }
body:has(#control) { background:#05080c; }
#control [data-status="ok"] { --cr:var(--cr-ok); } #control [data-status="warn"] { --cr:var(--cr-warn); }
#control [data-status="bad"] { --cr:var(--cr-bad); } #control [data-status="run"] { --cr:var(--cr-run); } #control [data-status="idle"] { --cr:var(--cr-idle); }
#control .mod { background:var(--cr-panel); border:1px solid var(--cr-rule); border-radius:2px; padding:6px 8px; min-width:0; overflow:hidden; }
#control h2 { margin:0 0 4px; font-size:10px; font-weight:600; line-height:1.3; text-transform:uppercase; letter-spacing:.12em; color:var(--cr-dim); }
#control a { color:var(--cr-run); text-decoration:none; } #control a:hover { text-decoration:underline; }
#control .dim { color:var(--cr-dim); }
#control [data-module="topbar"] { grid-area:top; display:flex; flex-wrap:wrap; align-items:center; gap:4px 18px; }
#control [data-module="topbar"] .clock { font-size:16px; color:var(--cr-run); text-shadow:0 0 6px var(--cr-run); }
#control .kpi { display:inline-flex; gap:6px; align-items:baseline; } #control .kpi b { font-size:14px; color:var(--cr, var(--cr-fg)); }
#control [data-stat="daemon"] { color:var(--cr); border:1px solid var(--cr); padding:1px 6px; box-shadow:0 0 6px var(--cr); }
#control [data-module="ticker"] { grid-area:tick; white-space:nowrap; padding:4px 0; }
#control .cr-tape { display:inline-block; padding-left:100%; animation:cr-scroll 90s linear infinite; }
#control [data-module="ticker"]:hover .cr-tape { animation-play-state:paused; }
#control .cr-tape [data-event] { margin-right:22px; color:var(--cr); }
@keyframes cr-scroll { to { transform:translateX(-100%); } }
#control [data-module="series"] { grid-area:series; }
#control [data-module="graph"] { grid-area:graph; display:flex; gap:6px; }
#control [data-module="graph"] .cr-flow { flex:1; min-width:0; }
#control [data-module="alerts"] { grid-area:alerts; }
#control [data-module="bus"] { grid-area:bus; }
#control [data-module="engines"] { grid-area:engines; }
#control [data-module="trace"] { grid-area:trace; }
#control svg { display:block; width:100%; height:auto; }
#control svg text { fill:var(--cr-dim); font-family:inherit; font-size:9px; }
#control .cr-node rect { fill:var(--cr-bg); stroke:var(--cr-rule); } #control .cr-node text { fill:var(--cr-fg); }
#control .cr-edge { stroke:var(--cr-rule); stroke-dasharray:3 3; }
#control .cr-dot { transition:transform .8s ease-in-out; } #control .cr-dot circle { fill:var(--cr); filter:drop-shadow(0 0 3px var(--cr)); }
#control .cr-dot[data-status="run"] circle { animation:cr-pulse 1.2s ease-in-out infinite; }
@keyframes cr-pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
#control .cr-decisions { list-style:none; margin:0; padding:0; width:150px; flex:none; display:flex; flex-direction:column; gap:3px; max-height:260px; overflow-y:auto; }
#control .cr-decisions li { border:1px solid var(--cr); border-left-width:3px; padding:2px 5px; color:var(--cr); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#control .cr-line { border-top:1px solid var(--cr-rule); padding:4px 0; } #control .cr-line:first-of-type { border-top:0; }
#control .cr-spark { display:grid; grid-template-columns:52px minmax(0,1fr) auto; gap:4px; align-items:center; }
#control .cr-spark svg { height:16px; } #control .cr-spark polyline { fill:none; stroke:var(--cr-run); stroke-width:1; }
#control .cr-bus rect.seg { fill:var(--cr); } #control .cr-bus line { stroke:var(--cr-rule); }
#control table { display:table; width:100%; border-collapse:collapse; font-size:10px; }
#control td, #control th { border:0; border-bottom:1px solid var(--cr-rule); padding:2px 4px; text-align:left; white-space:nowrap; }
#control th { color:var(--cr-dim); font-weight:400; }
#control tr[data-status] td:first-child { color:var(--cr); }
#control .cr-wrap { overflow-x:auto; }
#control .cr-alerts { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:3px; }
#control .cr-alerts li { color:var(--cr); border:1px solid var(--cr); padding:3px 5px; box-shadow:inset 0 0 6px rgba(255,77,94,.25); overflow-wrap:anywhere; }
#control p.cr-calm { color:var(--cr); margin:0; }
@media (max-width: 600px) {
  #control { grid-template-columns:1fr; grid-template-areas:"top" "tick" "alerts" "graph" "series" "bus" "engines" "trace"; }
  #control [data-module="graph"] { flex-direction:column; } #control .cr-decisions { width:auto; }
}
@media (prefers-reduced-motion: reduce) {
  #control .cr-tape { animation:none; padding-left:0; white-space:normal; }
  #control .cr-dot, #control .cr-dot circle { animation:none; transition:none; }
}
`;

const topbar = (v: ControlRoomView) => `
<header class="mod" data-module="topbar">
<span class="clock" data-clock="${esc(v.now)}">${esc(v.clock)}</span>
<span class="kpi">en cola <b data-stat="queued" data-status="idle">${v.topbar.queued}</b></span>
<span class="kpi">corriendo <b data-stat="running" data-status="run">${v.topbar.running}</b></span>
<span class="kpi">te esperan <b data-stat="waiting" data-status="warn">${v.topbar.waiting}</b></span>
<span class="kpi">entregados hoy <b data-stat="delivered" data-status="ok">${v.topbar.delivered}</b></span>
<span class="kpi">fallidos hoy <b data-stat="failed" data-status="${v.topbar.failed ? "bad" : "idle"}">${v.topbar.failed}</b></span>
<span class="kpi">costo del día${v.topbar.shared ? " (todas las máquinas)" : ""} <b data-stat="cost">${usd(v.topbar.spentUsd)}</b> <span class="dim">estimado <span data-stat="estimated">${usd(v.topbar.estimatedUsd)}</span></span></span>
<span class="kpi">daemon <span data-stat="daemon" data-status="${v.topbar.daemonTone}">${esc(v.topbar.daemonText)}</span></span>
</header>`;

const EVENT_TEXT: Record<ControlEvent["kind"], string> = { created: "entró", station: "pasó a", delivered: "entregado", failed: "falló", merged: "PR fundido" };
const EVENT_TONE: Record<ControlEvent["kind"], ControlTone> = { created: "idle", station: "run", delivered: "ok", failed: "bad", merged: "ok" };

function ticker(events: ControlEvent[]): string {
  const items = events
    .map((e) => {
      const what = e.kind === "station" ? `${EVENT_TEXT.station} ${e.station}` : EVENT_TEXT[e.kind];
      return `<span data-event="${e.kind}" data-status="${EVENT_TONE[e.kind]}">${hm(e.at)} ${esc(what)} ${esc(e.line ?? "—")} ${esc(e.job ?? e.url ?? "")}</span>`;
    })
    .join("");
  return `<section class="mod" data-module="ticker" aria-label="Eventos de las últimas 24 horas"><div class="cr-tape">${items || `<span class="dim">Sin eventos en las últimas 24 horas</span>`}</div></section>`;
}

// The graph's geometry: the entrance, then one node per station, left to right.
const NODE_X = (i: number) => 40 + i * 92;
const NODE_Y = 22;
const DOT_ROWS = 10;

function graph(v: ControlRoomView): string {
  const nodes = (["queued", ...CONTROL_STATIONS] as const).map((name, i) => {
    const attr = name === "queued" ? `data-entry="queued"` : `data-node="${name}"`;
    return `<g class="cr-node" ${attr}><rect x="${NODE_X(i) - 36}" y="${NODE_Y - 12}" width="72" height="22" rx="2"/><text x="${NODE_X(i)}" y="${NODE_Y + 3}" text-anchor="middle">${name === "queued" ? "entrada" : name}</text></g>`;
  });
  const edges = CONTROL_STATIONS.map((_, i) => `<line class="cr-edge" x1="${NODE_X(i) + 36}" y1="${NODE_Y}" x2="${NODE_X(i + 1) - 36}" y2="${NODE_Y}"/>`);
  const placed = new Map<string, number>();
  const dots = v.dots.map((d) => {
    const n = placed.get(d.at) ?? 0;
    placed.set(d.at, n + 1);
    const i = d.at === "queued" ? 0 : CONTROL_STATIONS.indexOf(d.at) + 1;
    const x = NODE_X(i) - 27 + Math.floor(n / DOT_ROWS) * 12;
    const y = NODE_Y + 26 + (n % DOT_ROWS) * 12;
    return `<g class="cr-dot" data-job="${esc(d.job)}" data-at="${d.at}" data-status="${d.tone}" style="transform:translate(${x}px,${y}px)"><circle r="4"/><title>${esc(d.line)} · ${esc(d.title)}</title></g>`;
  });
  const decisions = v.decisions
    .map((d) => `<li data-decision="${esc(d.job)}" data-status="${d.tone}" title="${esc(d.title)}">${hm(d.at)} <a href="/job/${esc(d.job)}">${esc(d.job)}</a> ${esc(d.line)}</li>`)
    .join("");
  return `<section class="mod" data-module="graph"><div class="cr-flow"><h2>Estaciones</h2>
<svg viewBox="0 0 640 170" role="img" aria-label="Trabajos en las estaciones">${edges.join("")}${nodes.join("")}${dots.join("")}</svg></div>
<div><h2>Decisiones</h2><ol class="cr-decisions">${decisions || `<li class="dim" data-status="idle">ninguna en 24 h</li>`}</ol></div></section>`;
}

/** A sparkline of the 24 hourly buckets, scaled to its own largest value. */
function sparkline(values: number[]): string {
  const max = Math.max(...values, 0) || 1;
  const points = values.map((n, i) => `${((i / (values.length - 1 || 1)) * 100).toFixed(1)},${(15 - (n / max) * 14).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/></svg>`;
}

const SERIES: [key: keyof Omit<ControlSeries, "line">, label: string, sum: boolean, text: (n: number) => string][] = [
  ["jobs", "trabajos", true, String],
  ["attempts", "intentos", true, String],
  ["costUsd", "costo", true, usd],
  ["verifyMs", "verify", false, (n) => (n ? duration(n) : "0")],
];

function series(lines: ControlSeries[]): string {
  const blocks = lines
    .map((l) => {
      const rows = SERIES.map(([key, label, sum, text]) => {
        const values = l[key];
        const last = values[values.length - 1] ?? 0;
        const whole = sum ? `Σ ${text(values.reduce((a, b) => a + b, 0))}` : `máx ${text(Math.max(...values, 0))}`;
        return `<div class="cr-spark" data-series="${key}" data-values="${values.join(",")}"><span class="dim">${label}</span>${sparkline(values)}<span>${esc(text(last))} <span class="dim">${esc(whole)}</span></span></div>`;
      });
      return `<div class="cr-line" data-line="${esc(l.line)}"><b>${esc(l.line)}</b>${rows.join("")}</div>`;
    })
    .join("");
  return `<section class="mod" data-module="series"><h2>Líneas · 24 h</h2>${blocks || `<p class="dim">No hay líneas.</p>`}</section>`;
}

// The bus: a label column, then six hours to the right edge, which is now.
const BUS_LABEL = 80;
const BUS_W = 600;
const BUS_ROW = 14;

function bus(v: ControlRoomView): string {
  const span = BUS_W - BUS_LABEL;
  const rows = v.bus.rows.map((r, n) => {
    const y = n * BUS_ROW;
    const segments = r.segments
      .map((s) => {
        const x = BUS_LABEL + s.left * span;
        const w = Math.max(1, s.width * span);
        return `<rect class="seg" data-status="${s.tone}" x="${x.toFixed(1)}" y="${y + 3}" width="${Math.min(w, BUS_W - x).toFixed(1)}" height="8"><title>${hm(s.start)}${s.end ? `–${hm(s.end)}` : " en curso"}</title></rect>`;
      })
      .join("");
    return `<g data-row="${esc(r.row)}" data-kind="${r.kind}"><text x="0" y="${y + 10}">${esc(r.row)}</text><line x1="${BUS_LABEL}" y1="${y + 7}" x2="${BUS_W}" y2="${y + 7}"/>${segments}</g>`;
  });
  const height = rows.length * BUS_ROW + 12;
  const axis = `<text x="${BUS_LABEL}" y="${height - 2}">${hm(v.bus.from)}</text><text x="${BUS_W}" y="${height - 2}" text-anchor="end">ahora</text>`;
  return `<section class="mod" data-module="bus"><h2>Bus de agentes · 6 h</h2>${
    rows.length ? `<svg class="cr-bus" viewBox="0 0 ${BUS_W} ${height}" role="img" aria-label="Llamadas a agentes de las últimas 6 horas">${rows.join("")}${axis}</svg>` : `<p class="dim">Sin llamadas en las últimas 6 horas.</p>`
  }</section>`;
}

const SPAN_TONE = { ok: "ok", error: "bad" } as const;

function trace(v: ControlRoomView): string {
  const rows = v.trace
    .map(
      (t) => `<tr data-span="${esc(t.name)}" data-status="${t.status ? SPAN_TONE[t.status] : "idle"}"><td>${hm(t.end)}</td><td>${esc(t.name)}</td><td>${t.job ? `<a href="/job/${esc(t.job)}">${esc(t.job)}</a>` : "—"}</td><td>${esc(t.status ?? "—")}</td><td>${esc(duration(t.ms))}</td><td>${t.costUsd === undefined ? "" : usd(t.costUsd)}</td></tr>`,
    )
    .join("");
  return `<section class="mod" data-module="trace"><h2>Traza de decisiones</h2>${
    rows ? `<div class="cr-wrap"><table><tr><th>fin</th><th>span</th><th>trabajo</th><th>estado</th><th>duración</th><th>costo</th></tr>${rows}</table></div>` : `<p class="dim">Sin spans en las últimas 24 horas.</p>`
  }</section>`;
}

const BILLING_TEXT = { subscription: "suscripción", api: "por uso", unknown: "sin dato" } as const;

function engines(v: ControlRoomView): string {
  const rows = v.engines
    .map((e) => {
      const windows = e.windows.map((w) => `${esc(w.label)} ${w.percent} %`).join(" · ") || "—";
      const pause = e.paused ? `en pausa${e.until ? ` hasta ${hm(e.until)}` : ""}${e.reason ? ` · ${esc(e.reason)}` : ""}` : "activo";
      return `<tr data-engine="${esc(e.engine)}" data-status="${e.tone}"><td>${esc(e.engine)}</td><td>${BILLING_TEXT[e.billing]}</td><td>${windows}</td><td>${pause}</td></tr>`;
    })
    .join("");
  return `<section class="mod" data-module="engines"><h2>Motores</h2>${
    rows ? `<div class="cr-wrap"><table><tr><th>motor</th><th>facturación</th><th>plan</th><th>estado</th></tr>${rows}</table></div>` : `<p class="dim">Sin motores.</p>`
  }</section>`;
}

function alerts(v: ControlRoomView): string {
  const items = v.alerts.map((a) => `<li data-alert="${a.kind}" data-status="bad">${esc(a.text)}</li>`).join("");
  return `<section class="mod" data-module="alerts"><h2>Trabas y alertas</h2>${items ? `<ul class="cr-alerts">${items}</ul>` : `<p class="cr-calm" data-status="ok">Sin trabas ni alertas</p>`}</section>`;
}

/** The room's modules: what the page shows inside `#control` and what its script fetches to refresh them. */
export function controlRoomFragment(v: ControlRoomView): string {
  return [topbar(v), ticker(v.events), series(v.series), graph(v), alerts(v), bus(v), engines(v), trace(v)].join("\n");
}

/**
 * Keeps the room live without reloading: gets the fragment (pushed on `/control-room/events`, or polled), replaces the
 * modules that changed, moves each job's dot in place by `data-job` so its CSS transition carries it to the next station,
 * and ticks the clock every second from the time the server last gave.
 */
const CONTROL_REFRESH = `(() => {
  const root = document.getElementById("control");
  let last = "";
  let base = 0;
  let since = Date.now();
  const two = (n) => String(n).padStart(2, "0");
  const setClock = () => {
    const el = root.querySelector("[data-clock]");
    if (!el) return;
    const m = /^(\\d+):(\\d+):(\\d+)$/.exec(el.dataset.shown || el.textContent || "");
    if (!m) return;
    if (!el.dataset.shown) {
      el.dataset.shown = el.textContent;
      base = (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
      since = Date.now();
    }
    const t = Math.floor((base + Date.now() - since) / 1000) % 86400;
    el.textContent = two(Math.floor(t / 3600)) + ":" + two(Math.floor(t / 60) % 60) + ":" + two(t % 60);
  };
  const modules = (el) => new Map([...el.querySelectorAll("[data-module]")].map((m) => [m.dataset.module, m]));
  const moveDots = (cur, fresh) => {
    const svg = cur.querySelector("svg");
    const next = fresh.querySelector("svg");
    if (!svg || !next) return false;
    const kept = new Map([...svg.querySelectorAll("[data-job]")].map((d) => [d.dataset.job, d]));
    for (const dot of [...next.querySelectorAll("[data-job]")]) {
      const old = kept.get(dot.dataset.job);
      if (!old) {
        svg.appendChild(dot);
        continue;
      }
      kept.delete(dot.dataset.job);
      for (const name of ["data-at", "data-status", "style"]) old.setAttribute(name, dot.getAttribute(name) || "");
      old.replaceChildren(...dot.childNodes);
    }
    kept.forEach((d) => d.remove());
    const list = cur.querySelector(".cr-decisions");
    const freshList = fresh.querySelector(".cr-decisions");
    if (list && freshList && list.outerHTML !== freshList.outerHTML) list.replaceWith(freshList);
    return true;
  };
  const update = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    const now = modules(root);
    const next = modules(t.content);
    const same = now.size === next.size && [...next.keys()].every((k) => now.has(k));
    if (!same) {
      root.replaceChildren(t.content);
      return setClock();
    }
    for (const [name, fresh] of next) {
      const cur = now.get(name);
      if (cur.outerHTML === fresh.outerHTML) continue;
      if (name === "graph" && moveDots(cur, fresh)) continue;
      cur.replaceWith(fresh);
    }
    setClock();
  };
  const apply = (html) => {
    if (html && html !== last) update(html);
    if (html) last = html;
  };
  const poll = () =>
    fetch("/control-room?fragment=1", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then(apply)
      .catch(() => {});
  // The server pushes the fragment when something changes; polling is the fallback while the stream is not open.
  const stream = window.EventSource ? new EventSource("/control-room/events") : null;
  if (stream) stream.addEventListener("message", (e) => apply(e.data));
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (stream && stream.readyState === EventSource.OPEN) return;
    poll();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
  setClock();
  setInterval(setClock, 1000);
})();`;

export function controlRoomPage(v: ControlRoomView, nonce: string): string {
  return page("Sala de control", `<style>${CONTROL_STYLE}</style><div id="control">${controlRoomFragment(v)}</div><script nonce="${nonce}">${CONTROL_REFRESH}</script>`, { nonce, active: "/control-room" });
}
