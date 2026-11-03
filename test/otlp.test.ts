import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactoryContext } from "../src/app.js";
import { ConfigError, parseFactory } from "../src/config.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { exportPass, OTLP_CURSOR_KEY, OTLP_RETRY_KEY, otlpBody, otlpScrub, otlpSpanId, otlpTraceId } from "../src/telemetry/otlp.js";
import { cleanup, tempDir, testFactory } from "./helpers.js";

interface Received {
  headers: IncomingHttpHeaders;
  body: any;
}

/** A fake OpenTelemetry collector: records each request and answers with the next status (hangs on 0). */
async function collector(statuses: number[] = []) {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: JSON.parse(data) });
      const status = statuses.length ? statuses.shift()! : 200;
      if (status === 0) return;
      res.writeHead(status, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
  return { received, url };
}

const servers: Server[] = [];
let warnings: string[] = [];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void warnings.push(String(line)));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  cleanup();
});

function factory(otlp?: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
  let clock = new Date("2026-11-03T10:00:00.000Z");
  const repo = tempDir("zero-otlp-repo-");
  const ctx = testFactory({ lines: [{ name: "api", repo }], ...(otlp ? { telemetry: { otlp } } : {}) }, () => clock);
  ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), env);
  const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));
  return { ctx, repo, advance };
}

/** A finished job with a job span, a station span and an agent span. */
function finishedJob(ctx: FactoryContext, agent: { status?: "ok" | "error"; attrs?: Record<string, string | number | boolean> } = {}) {
  const job = ctx.store.createJob({ line: "api", kind: "request", request: "algo", budgetUsd: 1 });
  const root = ctx.tracer.start("zero.job", { id: ctx.tracer.jobSpanId(job.id), jobId: job.id, attrs: { "zero.line": "api" } });
  const station = ctx.tracer.start("zero.station.build", { jobId: job.id, parentId: root.id, attrs: { "zero.station": "build" } });
  const call = ctx.tracer.start("gen_ai.invoke_agent", { jobId: job.id, parentId: station.id, attrs: { "gen_ai.agent.name": "build", ...agent.attrs } });
  call.end(agent.status ?? "ok");
  station.end("ok");
  root.end("ok");
  ctx.store.finishJob(job.id, "delivered");
  return { job, ids: { root: root.id, station: station.id, call: call.id } };
}

/** Turns export on: the first pass only sets the cursor. */
async function enable(ctx: FactoryContext, advance: (ms: number) => void) {
  await exportPass(ctx);
  advance(1000);
}

const spansOf = (r: Received) => r.body.resourceSpans[0].scopeSpans[0].spans as any[];

describe("OTLP config", () => {
  it("is off without a telemetry section", async () => {
    const { ctx, advance } = factory();
    expect(ctx.config.telemetry?.otlp).toBeUndefined();
    const fetch = vi.fn();
    await exportPass(ctx, { fetch });
    advance(1000);
    finishedJob(ctx);
    await exportPass(ctx, { fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.store.getKv(OTLP_CURSOR_KEY)).toBeUndefined();
  });

  it("rejects endpoints that are not http(s) or carry credentials", () => {
    expect(() => parseFactory("telemetry:\n  otlp:\n    endpoint: ftp://x\n")).toThrow(/telemetry\.otlp\.endpoint: .*URL http o https/);
    expect(() => parseFactory("telemetry:\n  otlp:\n    endpoint: https://user:pass@host/v1/traces\n")).toThrow(ConfigError);
    expect(parseFactory("telemetry:\n  otlp:\n    endpoint: https://api.honeycomb.io/v1/traces\n").telemetry?.otlp).toEqual({ endpoint: "https://api.honeycomb.io/v1/traces", headers: {} });
  });

  it("takes header values only as secret names", () => {
    for (const value of ["abc 123", "my-key"]) {
      expect(() => parseFactory(`telemetry:\n  otlp:\n    endpoint: https://h/v1/traces\n    headers:\n      x-key: ${value}\n`)).toThrow(/telemetry\.otlp\.headers\.x-key: .*zero secret set/);
    }
    const cfg = parseFactory("telemetry:\n  otlp:\n    endpoint: https://h/v1/traces\n    headers:\n      x-honeycomb-team: HONEYCOMB_API_KEY\n");
    expect(cfg.telemetry?.otlp?.headers).toEqual({ "x-honeycomb-team": "HONEYCOMB_API_KEY" });
  });
});

describe("OTLP body", () => {
  it("keeps the hierarchy with valid, stable ids", () => {
    const { ctx } = factory();
    const { job } = finishedJob(ctx);
    const build = () => otlpBody([{ job: ctx.store.getJob(job.id)!, spans: ctx.store.spansForJob(job.id) }], (_, t) => t);
    const body = build();
    expect(body.resourceSpans[0]!.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "zero" } });
    expect(JSON.stringify(build())).toBe(JSON.stringify(body));
    const spans = body.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans).toHaveLength(3);
    expect(new Set(spans.map((s) => s.traceId))).toEqual(new Set([otlpTraceId(job.id)]));
    expect(otlpTraceId(job.id)).toMatch(/^[0-9a-f]{32}$/);
    for (const s of spans) expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
    const byName = Object.fromEntries(spans.map((s) => [s.name, s]));
    expect(byName["zero.job"]!.spanId).toBe(otlpSpanId(`job-${job.id}`));
    expect(byName["zero.job"]!.parentSpanId).toBeUndefined();
    expect(byName["zero.station.build"]!.parentSpanId).toBe(byName["zero.job"]!.spanId);
    expect(byName["gen_ai.invoke_agent"]!.parentSpanId).toBe(byName["zero.station.build"]!.spanId);
    expect(byName["zero.job"]!.startTimeUnixNano).toMatch(/^\d+$/);
  });

  it("derives ids for stored ids that are not OTLP ids", () => {
    expect(otlpSpanId("0123456789abcdef")).toBe("0123456789abcdef");
    expect(otlpSpanId("0000000000000000")).toMatch(/^(?!0+$)[0-9a-f]{16}$/);
    expect(otlpSpanId("job-abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(otlpSpanId("job-abc")).toBe(otlpSpanId("job-abc"));
  });

  it("types GenAI attributes and the error status", () => {
    const { ctx } = factory();
    const { job } = finishedJob(ctx, { status: "error", attrs: { "zero.cost.usd": 0.25, "gen_ai.usage.input_tokens": 12, "zero.cached": true } });
    const spans = otlpBody([{ job, spans: ctx.store.spansForJob(job.id) }], (_, t) => t).resourceSpans[0]!.scopeSpans[0]!.spans;
    const agent = spans.find((s) => s.name === "gen_ai.invoke_agent")!;
    expect(agent.attributes).toContainEqual({ key: "gen_ai.agent.name", value: { stringValue: "build" } });
    expect(agent.attributes).toContainEqual({ key: "zero.cost.usd", value: { doubleValue: 0.25 } });
    expect(agent.attributes).toContainEqual({ key: "gen_ai.usage.input_tokens", value: { intValue: "12" } });
    expect(agent.attributes).toContainEqual({ key: "zero.cached", value: { boolValue: true } });
    expect(agent.status.code).toBe(2);
    expect(spans.find((s) => s.name === "zero.job")!.status.code).toBe(1);
  });

  it("leaves out spans that never ended", () => {
    const { ctx } = factory();
    const { job } = finishedJob(ctx);
    ctx.tracer.start("zero.station.review", { jobId: job.id, parentId: `job-${job.id}` });
    const spans = otlpBody([{ job, spans: ctx.store.spansForJob(job.id) }], (_, t) => t).resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans.map((s) => s.name)).not.toContain("zero.station.review");
  });
});

describe("OTLP export", () => {
  it("sends a finished job with the header from the environment, once", async () => {
    const fake = await collector();
    const { ctx, advance } = factory({ endpoint: fake.url, headers: { "x-honeycomb-team": "HONEYCOMB_API_KEY" } }, { HONEYCOMB_API_KEY: "abc123" });
    await enable(ctx, advance);
    const { job } = finishedJob(ctx);
    await exportPass(ctx);
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]!.headers["x-honeycomb-team"]).toBe("abc123");
    expect(fake.received[0]!.headers["content-type"]).toBe("application/json");
    const spans = spansOf(fake.received[0]!);
    expect(spans).toHaveLength(3);
    expect(spans[0].traceId).toBe(otlpTraceId(job.id));
    expect(warnings.join("\n")).not.toContain("abc123");

    advance(60_000);
    await exportPass(ctx);
    expect(fake.received).toHaveLength(1);
  });

  it("does not send jobs that finished before export was turned on", async () => {
    const fake = await collector();
    const { ctx, advance } = factory({ endpoint: fake.url });
    const { job: old } = finishedJob(ctx);
    advance(1000);
    await enable(ctx, advance);
    const { job } = finishedJob(ctx);
    await exportPass(ctx);
    const traces = fake.received.flatMap(spansOf).map((s) => s.traceId);
    expect(traces).toContain(otlpTraceId(job.id));
    expect(traces).not.toContain(otlpTraceId(old.id));
  });

  it("sends nothing when a header's secret is missing, naming it", async () => {
    const fake = await collector();
    const { ctx, advance } = factory({ endpoint: fake.url, headers: { "x-honeycomb-team": "HONEYCOMB_API_KEY" } });
    await enable(ctx, advance);
    finishedJob(ctx);
    await exportPass(ctx);
    expect(fake.received).toHaveLength(0);
    expect(warnings.join("\n")).toContain("HONEYCOMB_API_KEY");
  });

  it("scrubs secrets, the repository and the home folder", async () => {
    const fake = await collector();
    const { ctx, repo, advance } = factory({ endpoint: fake.url });
    await enable(ctx, advance);
    const key = `sk-ant-${"a".repeat(30)}`;
    finishedJob(ctx, { status: "error", attrs: { "error.message": `falló con ${key}`, "process.command_line": `npm test ${repo}/src ${homedir()}/notes.txt` } });
    await exportPass(ctx);
    const text = JSON.stringify(fake.received[0]!.body);
    expect(text).not.toContain(key);
    expect(text).toContain("[REDACTED]");
    for (const path of [repo, homedir()]) {
      expect(text).not.toContain(JSON.stringify(path).slice(1, -1));
      expect(text).not.toContain(path.replace(/\\/g, "/"));
    }
  });

  it("scrubs the home folder when the line is gone", () => {
    const { ctx } = factory();
    const job = { ...ctx.store.createJob({ line: "gone", kind: "request", request: "x", budgetUsd: 1 }) };
    const out = otlpScrub(ctx, job, `en ${homedir()}/x`);
    expect(out).not.toContain(homedir());
  });

  it("keeps going when the collector fails, then recovers after the backoff", async () => {
    const fake = await collector([500]);
    const { ctx, advance } = factory({ endpoint: fake.url });
    await enable(ctx, advance);
    const { job } = finishedJob(ctx);
    const cursor = ctx.store.getKv(OTLP_CURSOR_KEY);
    await expect(exportPass(ctx)).resolves.toBeUndefined();
    expect(fake.received).toHaveLength(1);
    expect(warnings.some((w) => w.includes("trace export failed"))).toBe(true);
    expect(ctx.store.getKv(OTLP_CURSOR_KEY)).toBe(cursor);
    expect(ctx.store.spansForJob(job.id)).toHaveLength(3);

    await exportPass(ctx);
    expect(fake.received).toHaveLength(1);

    advance(60_000);
    await exportPass(ctx);
    expect(fake.received).toHaveLength(2);
    expect(JSON.parse(ctx.store.getKv(OTLP_CURSOR_KEY)!).id).toBe(job.id);
    expect(ctx.store.getKv(OTLP_RETRY_KEY)).toBeUndefined();

    advance(60 * 60_000);
    await exportPass(ctx);
    expect(fake.received).toHaveLength(2);
  });

  it("logs and goes on when the collector's port is closed", async () => {
    const fake = await collector();
    const s = servers.pop()!;
    await new Promise((r) => s.close(r));
    const { ctx, advance } = factory({ endpoint: fake.url });
    await enable(ctx, advance);
    const { job } = finishedJob(ctx);
    const cursor = ctx.store.getKv(OTLP_CURSOR_KEY);
    await expect(exportPass(ctx)).resolves.toBeUndefined();
    expect(warnings.some((w) => w.includes("trace export failed"))).toBe(true);
    expect(ctx.store.getKv(OTLP_CURSOR_KEY)).toBe(cursor);
    expect(ctx.store.spansForJob(job.id)).toHaveLength(3);
  });

  it("aborts a request the collector never answers", async () => {
    const fake = await collector([0]);
    const { ctx, advance } = factory({ endpoint: fake.url });
    await enable(ctx, advance);
    finishedJob(ctx);
    const started = Date.now();
    await exportPass(ctx, { timeoutMs: 200 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(fake.received).toHaveLength(1);
    expect(warnings.some((w) => w.includes("TimeoutError"))).toBe(true);
  });

  it("skips a batch after 5 failed attempts and moves on", async () => {
    const fake = await collector([500, 500, 500, 500, 500]);
    const { ctx, advance } = factory({ endpoint: fake.url });
    await enable(ctx, advance);
    const { job: first } = finishedJob(ctx);
    for (let i = 0; i < 5; i++) {
      await exportPass(ctx);
      advance(60 * 60_000);
    }
    expect(fake.received).toHaveLength(5);
    expect(JSON.parse(ctx.store.getKv(OTLP_CURSOR_KEY)!).id).toBe(first.id);
    expect(warnings.some((w) => w.includes("gave up"))).toBe(true);

    const { job: second } = finishedJob(ctx);
    await exportPass(ctx);
    expect(fake.received).toHaveLength(6);
    expect(spansOf(fake.received[5]!)[0].traceId).toBe(otlpTraceId(second.id));
  });
});
