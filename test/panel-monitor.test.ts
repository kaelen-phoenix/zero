import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { monitorView, parsePeriod, type FactoryContext } from "../src/app.js";
import { mergeKey } from "../src/line/automerge.js";
import { bars, gauge, lineChart } from "../src/panel/charts.js";
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

/** Noon today, local time; the clock the factory and the panel read. */
const NOON = new Date(2026, 10, 9, 12, 0, 0);
const HOUR = 3_600_000;

async function panel(over: Record<string, unknown> = {}, before?: (ctx: FactoryContext, clock: { at: Date }) => void) {
  const clock = { at: NOON };
  const ctx = testFactory({ level: "L2", isolation: "worktree", engine: "claude", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => clock.at);
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

/** A job created at `at` that ends with `status` an hour later. */
function job(ctx: FactoryContext, clock: { at: Date }, at: Date, status?: "delivered" | "failed" | "stopped", patch: Parameters<FactoryContext["store"]["finishJob"]>[2] = {}, line = "tienda") {
  clock.at = at;
  const j = ctx.store.createJob({ line, kind: "request", request: `pedido ${at.toISOString()}`, budgetUsd: 5 });
  if (!status) return j;
  clock.at = new Date(at.getTime() + HOUR);
  return ctx.store.finishJob(j.id, status, patch);
}

let seq = 0;
function span(ctx: FactoryContext, over: Partial<SpanRow> & { minutes?: number }) {
  const start = over.start ?? new Date(NOON.getTime() - HOUR).toISOString();
  const end = over.end ?? new Date(Date.parse(start) + (over.minutes ?? 1) * 60_000).toISOString();
  ctx.store.insertSpan({ id: `s${++seq}`, name: AGENT_SPAN, status: "ok", ...over, start, end, attrs: over.attrs ?? {} });
}

/** The part of the page that holds one card. */
const card = (html: string, attr: string) => html.split(attr)[1]!.split('<div class="card')[0]!;
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** The big number of a factory total. */
const total = (html: string, label: string) => new RegExp(`${label}</span><b class="big">([^<]*)</b>`).exec(html)?.[1];

describe("monitor tab", () => {
  it("is in the menu and asks for the session", async () => {
    const p = await panel();
    expect(await p.text("/")).toMatch(/<a href="\/monitor"[^>]*>[\s\S]*?<span class="lb">Monitor<\/span><\/a>/);
    const r = await p.get("/monitor", {});
    expect(r.status).toBe(401);
    const html = await r.text();
    expect(html).toContain("Panel de tu fábrica");
    expect(html).not.toContain("tienda");
  });

  it("filters by period, falling back to 7 days", async () => {
    const p = await panel({}, (ctx, clock) => {
      job(ctx, clock, new Date(NOON.getTime() - 26 * HOUR), "delivered");
      job(ctx, clock, new Date(NOON.getTime() - 3 * HOUR), "delivered");
    });
    expect(total(await p.text("/monitor?periodo=hoy"), "Entregados")).toBe("1");
    expect(total(await p.text("/monitor?periodo=7"), "Entregados")).toBe("2");
    const fallback = await p.text("/monitor?periodo=xyz");
    expect(total(fallback, "Entregados")).toBe("2");
    expect(fallback).toContain(`<a href="/monitor?periodo=7" aria-current="page">`);
    const html = await p.text("/monitor");
    for (const period of ["hoy", "7", "30"]) expect(html).toContain(`/monitor?periodo=${period}`);
    expect(parsePeriod("30")).toBe("30");
    expect(parsePeriod(null)).toBe("7");
  });

  it("shows the factory totals", async () => {
    const p = await panel({}, (ctx, clock) => {
      for (let i = 0; i < 3; i++) job(ctx, clock, new Date(NOON.getTime() - (5 + i) * HOUR), "delivered", { attempt: 1 });
      job(ctx, clock, new Date(NOON.getTime() - 9 * HOUR), "failed", { attempt: 3 });
      job(ctx, clock, new Date(NOON.getTime() - 2 * HOUR));
      job(ctx, clock, new Date(NOON.getTime() - 2 * HOUR));
      const running = job(ctx, clock, new Date(NOON.getTime() - 2 * HOUR));
      ctx.store.updateJob(running.id, { status: "running" });
      span(ctx, { name: "zero.station.build", minutes: 2 });
      span(ctx, { name: "zero.station.build", minutes: 4 });
      span(ctx, { name: "zero.station.review", minutes: 9, attrs: { "zero.skipped": true } });
    });
    const html = await p.text("/monitor");
    expect(plain(html)).toContain("75 %");
    expect(total(html, "En cola")).toBe("2");
    expect(total(html, "En curso")).toBe("1");
    expect(total(html, "Intentos por trabajo")).toBe("1.5");
    expect(html).toMatch(/>build<\/text>[\s\S]*?>3 min<\/text>/);
    expect(html).not.toMatch(/>review<\/text>/);
    expect(html).toContain("<svg");
    expect(html).toContain("<polyline");
  });

  it("averages attempts and shows no rate without finished jobs", async () => {
    const p = await panel({}, (ctx, clock) => {
      job(ctx, clock, new Date(NOON.getTime() - 5 * HOUR), "delivered", { attempt: 1 });
      job(ctx, clock, new Date(NOON.getTime() - 6 * HOUR), "delivered", { attempt: 3 });
    });
    expect(total(await p.text("/monitor"), "Intentos por trabajo")).toBe("2");
    const empty = await panel();
    const html = await empty.text("/monitor");
    expect(plain(card(html, "Tasa de éxito"))).toContain("sin dato");
    expect(total(html, "Tokens")).toBe("sin dato");
  });

  it("shows plan use, month spend per engine and tokens", async () => {
    const p = await panel({ fallback: ["codex"] }, (ctx) => {
      const quota = JSON.stringify([{ name: "five_hour", label: "5 horas", utilization: 0.4, status: "ok", resetsAt: new Date(NOON.getTime() + HOUR).toISOString() }]);
      span(ctx, { attrs: { "zero.engine": "codex", "zero.billing": "api", "zero.cost.usd": 1, "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 50 } });
      span(ctx, { attrs: { "zero.engine": "codex", "zero.billing": "api", "zero.cost.usd": 0.5, "gen_ai.usage.input_tokens": 200, "gen_ai.usage.output_tokens": 25 } });
      span(ctx, { attrs: { "zero.engine": "claude", "zero.billing": "subscription", "zero.cost.usd": 3, "zero.quota": quota } });
    });
    const html = await p.text("/monitor");
    expect(html).toMatch(/aria-label="claude · 5 horas: 40 %"/);
    expect(html).toMatch(/>codex<\/text>[\s\S]*?>\$1\.50<\/text>/);
    expect(html).toMatch(/>claude<\/text>[\s\S]*?>\$0\.00<\/text>/);
    expect(total(html, "Tokens")).toBe("375");
  });

  it("has one card per agent", async () => {
    const p = await panel({ lines: [{ name: "tienda", repo: gitRepo(), agents: [{ name: "estilo", instructions: "estilo.md" }] }] }, (ctx, clock) => {
      const j = job(ctx, clock, new Date(NOON.getTime() - 3 * HOUR), "delivered");
      span(ctx, { jobId: j.id, status: "ok", attrs: { "gen_ai.agent.name": "review", "zero.engine": "claude", "zero.cost.usd": 0.1, "gen_ai.request.model": "claude-opus-5-5" } });
      span(ctx, { jobId: j.id, status: "error", attrs: { "gen_ai.agent.name": "review", "zero.engine": "claude", "zero.cost.usd": 0.2 } });
      span(ctx, { attrs: { "gen_ai.agent.name": "package:p/<est>" } });
      span(ctx, { name: "zero.station.verify", jobId: j.id, minutes: 1 });
    });
    const html = await p.text("/monitor");
    const review = plain(card(html, 'data-agent="review"'));
    for (const want of ["Llamadas: 2", "$0.30", "50 %", "Entregas: 1", "claude", "tienda", "claude-opus-5-5"]) expect(review).toContain(want);
    expect(plain(card(html, 'data-agent="security"'))).toContain("Llamadas: 0");
    expect(html).toContain('data-agent="estilo"');
    expect(html).toContain('data-agent="package:p/&lt;est&gt;"');
    expect(html).not.toContain("package:p/<est>");
    const verify = plain(card(html, 'data-agent="verify"'));
    expect(verify).toContain("Llamadas: 1");
    expect(verify).toContain("100 %");
    expect(verify).toContain("1 min");
  });

  it("has one card per line, with open pull requests from the stored state", async () => {
    const p = await panel({ lines: [{ name: "tienda", repo: gitRepo() }, { name: "vacia", repo: gitRepo() }] }, (ctx, clock) => {
      const pr = { mode: "pull-request", url: "https://github.com/o/r/pull/1", number: 1, branch: "zero/x" };
      const merged = job(ctx, clock, new Date(NOON.getTime() - 5 * HOUR), "delivered", { delivery: pr as never });
      ctx.store.setKv(mergeKey(merged.id), JSON.stringify({ status: "merged" }));
      job(ctx, clock, new Date(NOON.getTime() - 4 * HOUR), "delivered", { delivery: pr as never });
      const last = job(ctx, clock, new Date(NOON.getTime() - 2 * HOUR));
      ctx.store.setKv("last-job", last.id);
    });
    const html = await p.text("/monitor");
    const tienda = card(html, 'data-line="tienda"');
    expect(plain(tienda)).toContain("Pull requests abiertos: 1");
    expect(plain(tienda)).toContain("Trabajos: 3");
    expect(tienda).toContain(`href="/job/${p.ctx.store.getKv("last-job")}"`);
    expect(plain(card(html, 'data-line="vacia"'))).toContain("Trabajos: 0");
  });

  it("is drawn in inline SVG with only the refresh script", async () => {
    const p = await panel({}, (ctx, clock) => void job(ctx, clock, new Date(NOON.getTime() - 3 * HOUR), "delivered"));
    const html = await p.text("/monitor");
    for (const banned of ["<script src", "<link", 'src="http', 'method="post"']) expect(html).not.toContain(banned);
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/^<script nonce=/);
    expect(scripts[0]).toContain("location.reload()");
  });

  it("collapses to one column on a phone", () => {
    const css = readFileSync(new URL("../src/panel/html.ts", import.meta.url), "utf8");
    expect(css).toMatch(/@media \(max-width: 600px\) \{ \.monitor \{ grid-template-columns:1fr; \} \}/);
  });

  it("writes nothing while building the view", async () => {
    const p = await panel({}, (ctx, clock) => {
      const j = job(ctx, clock, new Date(NOON.getTime() - 3 * HOUR), "delivered", { delivery: { mode: "pull-request", url: "u", number: 1, branch: "b" } as never });
      span(ctx, { jobId: j.id, attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude" } });
    });
    const count = (table: string) => (p.ctx.store as unknown as { db: { prepare(s: string): { get(): { n: number } } } }).db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const before = ["jobs", "spans", "kv"].map(count);
    const first = monitorView(p.ctx, "7", NOON);
    const second = monitorView(p.ctx, "7", NOON);
    expect(second).toEqual(first);
    expect(["jobs", "spans", "kv"].map(count)).toEqual(before);
  });
});

describe("monitor charts", () => {
  it("draws a gauge with its percentage, or no data", () => {
    expect(gauge(40, "plan")).toMatch(/<svg[\s\S]*40 %/);
    expect(gauge(undefined, "plan")).toContain("sin dato");
    expect(gauge(150, "<x>")).toContain("100 %");
    expect(gauge(150, "<x>")).not.toContain("<x>");
  });

  it("draws bars scaled to the largest value", () => {
    const svg = bars([{ label: "a", value: 2 }, { label: "b", value: 1, text: "uno" }]);
    expect(svg).toContain('width="150.0"');
    expect(svg).toContain('width="75.0"');
    expect(svg).toContain(">uno</text>");
    expect(bars([])).toContain("sin dato");
  });

  it("draws a line with one point per day", () => {
    const svg = lineChart([{ label: "11-08", value: 0 }, { label: "11-09", value: 3 }]);
    expect(svg.match(/<polyline points="([^"]+)"/)![1]!.split(" ")).toHaveLength(2);
    expect(svg).toContain("máx 3");
  });
});
