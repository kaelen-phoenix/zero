import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CONTROL_STATIONS, DAEMON_KEY, type ControlRoomView, type FactoryContext } from "../src/app.js";
import { quotaAttrs } from "../src/agent.js";
import { CONTROL_STYLE, controlRoomFragment } from "../src/panel/control-room.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import type { SpanRow } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

/** Noon, local time; the clock the factory and the panel read. */
const NOON = new Date(2026, 10, 9, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOON.getTime() - ms);

async function panel(before?: (ctx: FactoryContext, clock: { at: Date }) => void) {
  const clock = { at: NOON };
  const ctx = testFactory({ level: "L2", isolation: "worktree", engine: "claude", lines: [{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }] }, () => clock.at);
  ctx.store.setKv(DAEMON_KEY, JSON.stringify({ pid: process.pid, beatAt: NOON.toISOString() }));
  before?.(ctx, clock);
  clock.at = NOON;
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const text = async (path: string) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    return r.text();
  };
  return { ctx, get, text };
}

function job(ctx: FactoryContext, clock: { at: Date }, at: Date, status?: "delivered" | "failed" | "stopped" | "running" | "waiting", line = "tienda") {
  clock.at = at;
  const j = ctx.store.createJob({ line, kind: "request", request: `pedido ${at.toISOString()}`, budgetUsd: 5 });
  let out = j;
  if (status === "running" || status === "waiting") out = ctx.store.updateJob(j.id, { status, ...(status === "running" && { station: "verify" }) });
  else if (status) {
    clock.at = new Date(at.getTime() + MIN);
    out = ctx.store.finishJob(j.id, status);
  }
  clock.at = NOON;
  return out;
}

let seq = 0;
function span(ctx: FactoryContext, over: Partial<SpanRow> & { minutes?: number; open?: boolean }) {
  const start = over.start ?? ago(HOUR).toISOString();
  const end = over.open ? undefined : (over.end ?? new Date(Date.parse(start) + (over.minutes ?? 1) * MIN).toISOString());
  const { minutes: _m, open: _o, ...rest } = over;
  ctx.store.insertSpan({ id: `p${++seq}`, name: AGENT_SPAN, ...(end && { status: "ok" as const }), ...rest, start, end, attrs: over.attrs ?? {} });
}

/** The HTML of one module of the room. */
const mod = (html: string, name: string) => (html.split(`<div id="control">`)[1] ?? html).split(`data-module="${name}"`)[1]!.split("data-module=")[0]!;

describe("control room tab", () => {
  it("is in the menu of every page and marked on its own", async () => {
    const p = await panel();
    const home = await p.text("/");
    expect(home).toContain(`href="/control-room"`);
    expect(home).toContain("Sala de control");
    const room = await p.text("/control-room");
    expect(room).toContain(`<a href="/control-room" aria-current="page"`);
  });

  it("asks for the key without a session and shows no factory data", async () => {
    const p = await panel();
    for (const path of ["/control-room", "/control-room?fragment=1"]) {
      const r = await p.get(path, {});
      expect(r.status).toBe(401);
      const html = await r.text();
      expect(html).toContain("Panel de tu fábrica");
      expect(html).not.toContain("tienda");
      expect(html).not.toContain("data-module");
    }
  });

  it("shows every module with its hooks, from the stored state", async () => {
    let running = "";
    const p = await panel((ctx, clock) => {
      job(ctx, clock, ago(10 * MIN));
      job(ctx, clock, ago(9 * MIN));
      running = job(ctx, clock, ago(8 * MIN), "running").id;
      job(ctx, clock, ago(2 * HOUR), "delivered");
      job(ctx, clock, ago(3 * HOUR), "failed");
      job(ctx, clock, ago(4 * HOUR), "stopped");
      const api = quotaAttrs({ billing: "api", windows: [] });
      span(ctx, { jobId: running, start: ago(2 * HOUR).toISOString(), attrs: { "zero.engine": "claude", "gen_ai.agent.name": "build", "zero.cost.usd": 1, ...api } });
      span(ctx, { jobId: running, start: ago(10 * MIN).toISOString(), open: true, attrs: { "zero.engine": "codex", "gen_ai.agent.name": "review", "zero.cost.usd": 0.25, ...api } });
      span(ctx, { name: "zero.station.verify", jobId: running, start: ago(20 * MIN).toISOString(), minutes: 2 });
    });
    const html = await p.text("/control-room");
    for (const m of ["topbar", "ticker", "graph", "series", "bus", "trace", "engines", "alerts"]) expect(html).toContain(`data-module="${m}"`);

    const top = mod(html, "topbar");
    expect(top).toContain(`data-stat="queued" data-status="idle">2<`);
    expect(top).toContain(`data-stat="running" data-status="run">1<`);
    expect(top).toContain(`data-stat="delivered" data-status="ok">1<`);
    expect(top).toContain(`data-stat="failed" data-status="bad">1<`);
    expect(top).toContain(`data-stat="cost">$1.25<`);
    expect(top).toContain(`data-stat="daemon" data-status="ok">en marcha<`);
    expect(top).toContain(">12:00:00<");

    const ticker = mod(html, "ticker");
    for (const e of ["created", "station", "delivered", "failed"]) expect(ticker).toContain(`data-event="${e}"`);

    const graph = mod(html, "graph");
    expect(graph).toContain(`data-job="${running}" data-at="verify" data-status="run"`);
    expect([...graph.matchAll(/data-node="([a-z]+)"/g)].map((m) => m[1])).toEqual([...CONTROL_STATIONS]);
    expect([...graph.matchAll(/data-decision="[0-9a-f]+" data-status="([a-z]+)"/g)].map((m) => m[1])).toEqual(["ok", "bad", "warn"]);
    expect(graph.match(/data-at="queued"/g)).toHaveLength(2);

    const series = mod(html, "series");
    expect(series).toContain(`data-line="tienda"`);
    expect(series).toContain(`data-line="blog"`);
    expect(series.split(`data-line="blog"`)[1]).toContain(`data-series="jobs" data-values="${Array(24).fill(0).join(",")}"`);

    const bus = mod(html, "bus");
    for (const r of ["claude", "codex", "build", "review"]) expect(bus).toContain(`data-row="${r}"`);
    const open = /data-status="run" x="([\d.]+)" y="\d+" width="([\d.]+)"/.exec(bus)!;
    expect(Number(open[1]) + Number(open[2])).toBeCloseTo(600, 0);

    const trace = mod(html, "trace");
    expect(trace).toContain(`href="/job/${running}"`);
    expect(trace).toContain("zero.station.verify");

    expect(mod(html, "engines")).toContain(`data-engine="claude"`);
    expect(mod(html, "alerts")).toContain("Sin trabas ni alertas");
  });

  it("serves only the modules as its fragment", async () => {
    const p = await panel();
    const fragment = await p.text("/control-room?fragment=1");
    expect(fragment).toContain(`data-module="topbar"`);
    expect(fragment).not.toContain("<html");
    expect(fragment).not.toContain("<nav");
  });

  it("loads nothing from outside and runs no script without the nonce", async () => {
    const p = await panel();
    const html = await p.text("/control-room");
    for (const bad of ["<script src", "<link", `src="http`, "url(http"]) expect(html).not.toContain(bad);
    for (const tag of html.match(/<script[^>]*>/g) ?? []) expect(tag).toContain("nonce=");
  });

  it("is read-only: no forms or actions", async () => {
    const p = await panel((ctx, clock) => void job(ctx, clock, ago(MIN), "waiting"));
    for (const path of ["/control-room", "/control-room?fragment=1"]) {
      const html = await p.text(path);
      expect(html).not.toContain("<form");
      expect(html).not.toContain(`method="post"`);
      expect(html).not.toContain("<button");
    }
  });
});

describe("control room look", () => {
  it("is a dark monospace console with neon by status", () => {
    expect(CONTROL_STYLE).toContain("monospace");
    expect(CONTROL_STYLE).toContain("--cr-bg:#05080c");
    for (const s of ["ok", "warn", "bad", "run"]) expect(CONTROL_STYLE).toContain(`[data-status="${s}"]`);
  });

  it("stacks its columns on a phone", () => {
    const phone = CONTROL_STYLE.split("@media (max-width: 600px)")[1]!.split("@media")[0]!;
    expect(phone).toContain("grid-template-columns:1fr");
  });

  it("turns the ticker off for reduced motion", () => {
    const reduced = CONTROL_STYLE.split("@media (prefers-reduced-motion: reduce)")[1]!;
    expect(reduced).toMatch(/\.cr-tape \{ animation:none/);
    expect(CONTROL_STYLE).toMatch(/\.cr-tape \{[^}]*animation:cr-scroll/);
  });
});

describe("control room fragment", () => {
  const empty: ControlRoomView = {
    now: NOON.toISOString(),
    clock: "12:00:00",
    topbar: { queued: 0, running: 0, waiting: 0, delivered: 0, failed: 0, spentUsd: 1.25, estimatedUsd: 0, daemon: "crashed", daemonText: "se cayó", daemonTone: "bad" },
    events: [],
    dots: [],
    decisions: [],
    series: [],
    bus: { from: ago(6 * HOUR).toISOString(), to: NOON.toISOString(), rows: [] },
    trace: [],
    engines: [],
    alerts: [],
  };

  it("escapes stored text", () => {
    const html = controlRoomFragment({
      ...empty,
      events: [{ at: ago(MIN).toISOString(), kind: "created", job: "abcd1234", line: "<b>x</b>" }],
      alerts: [{ kind: "jam", text: "<i>traba</i> · qué falta: mirarlo", tone: "bad" }],
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(mod(html, "alerts")).toContain(`data-alert="jam" data-status="bad">&lt;i&gt;traba&lt;/i&gt; · qué falta: mirarlo`);
  });

  it("shows the day's cost and a crashed daemon in red", () => {
    const top = mod(controlRoomFragment(empty), "topbar");
    expect(top).toContain(`data-stat="cost">$1.25<`);
    expect(top).toContain(`data-stat="daemon" data-status="bad">se cayó<`);
  });

  it("shows a paused engine and its plan windows", () => {
    const engines = mod(
      controlRoomFragment({
        ...empty,
        engines: [
          { engine: "codex", billing: "api", windows: [], paused: true, reason: "sin crédito", tone: "bad" },
          { engine: "claude", billing: "subscription", windows: [{ label: "5 h", percent: 40 }], paused: false, tone: "ok" },
        ],
      }),
      "engines",
    );
    expect(engines).toMatch(/data-engine="codex" data-status="bad">.*sin crédito/);
    expect(engines).toMatch(/data-engine="claude" data-status="ok">.*5 h 40 %/);
  });

  it("shows the andon in red", () => {
    const alerts = mod(controlRoomFragment({ ...empty, alerts: [{ kind: "andon", text: "Andon encendido: la fábrica no empieza trabajo nuevo", tone: "bad" }] }), "alerts");
    expect(alerts).toContain(`data-alert="andon" data-status="bad">Andon encendido`);
    expect(alerts).not.toContain("Sin trabas ni alertas");
  });
});
