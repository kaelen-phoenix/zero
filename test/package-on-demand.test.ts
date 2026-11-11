import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, briefing, factoryStatus, packageList, requestStationRun, requestWork, waitStationStart, type FactoryContext, type PackageList } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { onDemandPass, onDemandPending, packagesPass, readStationRun, stationLastKey, stationOnDemandKey, stationOnDemandLastKey, stationOnDemandRequestKey, stationRunKey } from "../src/line/packages.js";
import { formatPackages, formatStatus } from "../src/format.js";
import { log } from "../src/log.js";
import { overviewPage } from "../src/panel/html.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { factoryConfig } from "../src/packages.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const passes = `node -e "process.exit(0)"`;
const DEFAULT_MODULE = `export async function pass(ctx, arg) { note(JSON.stringify(arg ?? null)); }`;

/** A package whose station `nota` notes each call to `pass` and the argument it got. */
function stationPackage(opts: { onDemand?: unknown; module?: string; secrets?: string[]; instructions?: boolean; timeoutMinutes?: number } = {}) {
  const dir = tempDir("zero-pkg-");
  const marker = join(tempDir("zero-marker-"), "calls.txt");
  const onDemand = opts.onDemand === undefined ? {} : { onDemand: opts.onDemand };
  const timeout = opts.timeoutMinutes === undefined ? {} : { timeoutMinutes: opts.timeoutMinutes };
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", secrets: opts.secrets ?? [], ...(opts.instructions && { instructions: "nota.md" }), ...onDemand, ...timeout }] }),
    "nota.md": "Write a sentence.\n",
    "nota.mjs": `import { appendFileSync } from "node:fs";
const note = (text) => appendFileSync(${JSON.stringify(marker)}, text + "\\n");
${opts.module ?? DEFAULT_MODULE}
`,
  });
  return { dir, marker, calls: () => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : []) };
}

async function factory(dir: string, over: Record<string, unknown> = {}, allowCode = true): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [{ name: "web", repo: gitRepo() }], packages: [{ path: dir, allowCode }], ...over });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const key = stationOnDemandKey("hello", "nota");
const lastRun = stationOnDemandLastKey("hello", "nota");

describe("declaring onDemand in the manifest", () => {
  it("carries true to the loaded station", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    expect(ctx.config.loadedPackages!.stations[0]!.onDemand).toBe(true);
  });

  it("is false when absent", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(ctx.config.loadedPackages!.stations[0]!.onDemand).toBe(false);
  });

  it("leaves the package out for a wrong type", async () => {
    const ctx = await factory(stationPackage({ onDemand: "yes" }).dir);
    expect(ctx.config.loadedPackages!.stations).toEqual([]);
    expect(ctx.config.loadedPackages!.problems[0]).toMatchObject({ reason: expect.stringContaining("onDemand") });
  });
});

describe("asking for an on-demand run", () => {
  it("records one pending run", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    expect(r).toMatchObject({ ok: true, text: expect.any(String) });
    expect(new Date(ctx.store.getKv(key)!).toISOString()).toBe(ctx.store.getKv(key));
  });

  it("refuses a station that does not declare it", async () => {
    const ctx = await factory(stationPackage().dir);
    const r = requestStationRun(ctx, "hello/nota");
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("onDemand") });
    expect(ctx.store.getKv(key)).toBeUndefined();
  });

  it("refuses a second request while one is pending", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    requestStationRun(ctx, "hello/nota", new Date(2026, 10, 7, 10));
    const first = ctx.store.getKv(key);
    const r = requestStationRun(ctx, "hello/nota", new Date(2026, 10, 7, 11));
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("pendiente") });
    expect(ctx.store.getKv(key)).toBe(first);
  });

  it.each(["hello/nada", "sinbarra", "otro/nota", "hello/nota/x"])("refuses %s without writing", async (ref) => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    expect(requestStationRun(ctx, ref)).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(ctx.store.getKv(key)).toBeUndefined();
  });

  it("refuses a station that cannot run without allowCode", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir, {}, false);
    expect(requestStationRun(ctx, "hello/nota")).toMatchObject({ ok: false });
    expect(ctx.store.getKv(key)).toBeUndefined();
  });

  it("refuses with the andon on", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    ctx.store.setKv(ANDON_KEY, "on");
    expect(requestStationRun(ctx, "hello/nota")).toMatchObject({ ok: false, reason: expect.stringContaining("detenida") });
    expect(ctx.store.getKv(key)).toBeUndefined();
  });

  it("refuses with the budget reached", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir, { limits: { usdPerDay: 1 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": 5 });
    expect(requestStationRun(ctx, "hello/nota")).toMatchObject({ ok: false, reason: expect.stringContaining("presupuesto") });
    expect(ctx.store.getKv(key)).toBeUndefined();
  });
});

describe("onDemandPass runs a pending request", () => {
  const pass = () => fakeAgents({}).runner;
  const record = (ctx: FactoryContext) => JSON.parse(ctx.store.getKv(lastRun)!) as Record<string, unknown>;

  it("runs before its period, once, with { onDemand: true }, leaving the period as it was", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    const last = new Date(Date.now() - 60_000).toISOString();
    ctx.store.setKv(stationLastKey("hello", "nota"), last);
    expect(requestStationRun(ctx, "hello/nota").ok).toBe(true);
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBe(last);
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toHaveLength(1);
  });

  it("runs with a queued job", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    requestWork(ctx, { text: "algo", line: "web" });
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
    expect(ctx.store.getKv(key)).toBeUndefined();
  });

  it("runs with a running job", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    const { job } = requestWork(ctx, { text: "algo", line: "web" });
    ctx.store.updateJob(job.id, { status: "running" });
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
  });

  it("calls nothing without a pending request", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeUndefined();
    expect(ctx.store.getKv(lastRun)).toBeUndefined();
  });

  it("waits for the andon, then runs, recording nothing meanwhile", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    ctx.store.setKv(ANDON_KEY, "on");
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
    expect(ctx.store.getKv(lastRun)).toBeUndefined();
    ctx.store.setKv(ANDON_KEY, "off");
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
  });

  it("waits for the budget", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir, { limits: { usdPerDay: 1 } });
    requestStationRun(ctx, "hello/nota");
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": 5 });
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
    expect(ctx.store.getKv(lastRun)).toBeUndefined();
  });

  it("waits for a missing secret", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"] });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
    expect(ctx.store.getKv(lastRun)).toBeUndefined();
  });

  it("keeps the night cap on ctx.runAgent", async () => {
    const out = join(tempDir(), "run.json");
    const { dir } = stationPackage({
      onDemand: true,
      instructions: true,
      module: `import { writeFileSync } from "node:fs";\nexport async function pass(ctx) { writeFileSync(${JSON.stringify(out)}, JSON.stringify(await ctx.runAgent({ prompt: "p" }))); }`,
    });
    const ctx = await factory(dir, { limits: { usdPerNight: 0.3 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout" } }).end("ok", { "zero.cost.usd": 0.3 });
    requestStationRun(ctx, "hello/nota");
    const agents = fakeAgents({});
    await onDemandPass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ ok: false, text: expect.stringContaining("limits.usdPerNight") });
  });

  it("records a run that ended fine", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    requestStationRun(ctx, "hello/nota");
    const asked = ctx.store.getKv(key);
    await onDemandPass(ctx, pass(), new Date());
    const r = record(ctx);
    expect(r).toMatchObject({ asked, outcome: "ok", startedAt: expect.any(String), endedAt: expect.any(String) });
    expect(Date.parse(r.endedAt as string)).toBeGreaterThanOrEqual(Date.parse(r.startedAt as string));
  });

  it("records a pass that threw", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const ctx = await factory(stationPackage({ onDemand: true, module: `export async function pass() { throw new Error("mal"); }` }).dir);
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, pass(), new Date());
    expect(record(ctx)).toMatchObject({ outcome: "failed", startedAt: expect.any(String), endedAt: expect.any(String) });
  });

  it("records a pass cut by shutdown", async () => {
    const ctx = await factory(stationPackage({ onDemand: true, module: `export function pass() { return new Promise(() => {}); }` }).dir);
    requestStationRun(ctx, "hello/nota");
    const stop = new AbortController();
    const done = onDemandPass(ctx, pass(), new Date(), { signal: stop.signal });
    await vi.waitFor(() => expect(ctx.store.getKv(lastRun)).toBeDefined());
    expect(record(ctx).endedAt).toBeUndefined();
    stop.abort();
    await done;
    expect(record(ctx)).toMatchObject({ outcome: "stopped", startedAt: expect.any(String), endedAt: expect.any(String) });
  });

  it("clears the request of a module without pass, warns and records it as not run", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function scheduled() { note("scheduled"); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    const asked = ctx.store.getKv(key);
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(warn.mock.calls.some(([m]) => String(m).includes("hello/nota") && String(m).includes("pass"))).toBe(true);
    const r = record(ctx);
    expect(r).toMatchObject({ asked, outcome: "not-run" });
    expect(r.startedAt).toBeUndefined();
  });

  it("clears the request when parseConfig throws", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ onDemand: true, module: `export function parseConfig() { throw new Error("mal"); }\n${DEFAULT_MODULE}` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(record(ctx)).toMatchObject({ outcome: "not-run" });
  });

  it("waits while the station's regular pass is running, then runs", async () => {
    const gate = join(tempDir(), "gate.txt");
    const { dir, calls } = stationPackage({
      onDemand: true,
      module: `import { existsSync } from "node:fs";
export async function pass(ctx, arg) {
  note(JSON.stringify(arg ?? null));
  if (!arg) while (!existsSync(${JSON.stringify(gate)})) await new Promise((r) => setTimeout(r, 10));
}`,
    });
    const ctx = await factory(dir);
    const regular = packagesPass(ctx, pass(), new Date());
    await vi.waitFor(() => expect(calls()).toEqual(["null"]));
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual(["null"]);
    expect(ctx.store.getKv(key)).toBeDefined();
    expect(ctx.store.getKv(lastRun)).toBeUndefined();
    writeFileSync(gate, "");
    await regular;
    await onDemandPass(ctx, pass(), new Date());
    expect(calls()).toEqual(["null", JSON.stringify({ onDemand: true })]);
  });
});

describe("the idle pass and the daemon", () => {
  const pass = () => fakeAgents({}).runner;

  it("the idle pass leaves a pending request alone, and runs the regular turn after it", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeUndefined();
    await onDemandPass(ctx, pass(), new Date());
    await packagesPass(ctx, pass(), new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true }), "null"]);
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeDefined();
  });

  it("calls a regular pass with no second argument", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function pass(...args) { note(String(args.length) + ":" + String(args[1])); }` });
    const ctx = await factory(dir);
    await packagesPass(ctx, pass(), new Date());
    expect(calls()).toEqual(["1:undefined"]);
  });

  it("the daemon picks it up", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, panel: false, agentRunner: () => fakeAgents({}).runner });
    expect(calls()).toContain(JSON.stringify({ onDemand: true }));
  });

  it("the daemon runs it without scout or research while a low-priority job waits its turn", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    requestWork(ctx, { text: "primero", line: "web", priority: "alta" });
    requestWork(ctx, { text: "después", line: "web", priority: "baja" });
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, scout: false, research: false, panel: false, agentRunner: () => fakeAgents({}).runner });
    expect(calls()).toContain(JSON.stringify({ onDemand: true }));
  });
});

describe("a request text", () => {
  const SECRET = "s3cr3t-valor-largo";

  it("reaches pass cleaned of secrets and paths, and cut", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"] });
    const ctx = await factory(dir);
    ctx.secrets.set("NOTA_TOKEN", SECRET);
    const repo = ctx.config.lines[0]!.repo;
    const r = requestStationRun(ctx, "hello/nota", new Date(), `revisar ${SECRET} en ${join(repo, "src", "a.ts")} ${"x".repeat(5000)}`);
    expect(r).toMatchObject({ ok: true, requestedAt: ctx.store.getKv(key) });
    await onDemandPass(ctx, fakeAgents({}).runner, new Date());
    const arg = JSON.parse(calls()[0]!) as { onDemand: boolean; request: string };
    expect(arg.onDemand).toBe(true);
    expect(arg.request).toContain("revisar");
    expect(arg.request).not.toContain(SECRET);
    expect(arg.request).not.toContain(repo);
    expect(arg.request.length).toBeLessThanOrEqual(4000);
  });

  it("keeps the old shape with no text or an empty one", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota", new Date(), "   ");
    expect(ctx.store.getKv(stationOnDemandRequestKey("hello", "nota"))).toBeUndefined();
    await onDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
  });

  it("is gone after the run, and a later regular pass gets no argument", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function pass(...args) { note(String(args.length) + ":" + JSON.stringify(args[1] ?? null)); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota", new Date(), "revisar precios");
    await onDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(ctx.store.getKv(stationOnDemandRequestKey("hello", "nota"))).toBeUndefined();
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([`2:${JSON.stringify({ onDemand: true, request: "revisar precios" })}`, "1:null"]);
  });

  it("cannot be asked for from a station's ctx", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function pass(ctx) { note(Object.keys(ctx).join(",")); }` });
    const ctx = await factory(dir);
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    const keys = calls()[0]!.split(",");
    expect(keys.filter((k) => /run|demand/i.test(k) && k !== "runAgent")).toEqual([]);
    expect(onDemandPending(ctx)).toBe(false);
  });
});

describe("the record of an on-demand run", () => {
  const record = (ctx: FactoryContext) => readStationRun(ctx, "hello", "nota");

  it("is running while pass awaits, then done", async () => {
    const seen = join(tempDir(), "seen.txt");
    const { dir } = stationPackage({ onDemand: true, module: `import { writeFileSync } from "node:fs";\nexport async function pass(ctx) { writeFileSync(${JSON.stringify(seen)}, "x"); await new Promise((r) => setTimeout(r, 300)); }` });
    const ctx = await factory(dir);
    const r = requestStationRun(ctx, "hello/nota", new Date(), "revisar precios");
    const run = onDemandPass(ctx, fakeAgents({}).runner, new Date());
    await vi.waitFor(() => expect(existsSync(seen)).toBe(true));
    expect(record(ctx)).toMatchObject({ state: "running", requestedAt: r.ok && r.requestedAt, request: "revisar precios", startedAt: expect.any(String) });
    await run;
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "done", finishedAt: expect.any(String), startedAt: expect.any(String) });
    expect(record(ctx)!.error).toBeUndefined();
  });

  it("is failed without the secret when pass throws", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const SECRET = "s3cr3t-valor-largo";
    const { dir } = stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"], module: `export async function pass(ctx) { throw new Error("se cayó con " + ctx.secrets.get("NOTA_TOKEN")); }` });
    const ctx = await factory(dir);
    ctx.secrets.set("NOTA_TOKEN", SECRET);
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "failed", error: expect.stringContaining("se cayó") });
    expect(record(ctx)!.error).not.toContain(SECRET);
    expect(record(ctx)!.error!.length).toBeLessThanOrEqual(600);
  });

  it("is failed when the module cannot run", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir } = stationPackage({ onDemand: true, module: `export async function scheduled() {}` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "failed" });
  });

  it("is timeout when pass never ends", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir } = stationPackage({ onDemand: true, timeoutMinutes: 0.002, module: `export function pass() { return new Promise(() => undefined); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await onDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "timeout", startedAt: expect.any(String) });
  });

  it("is stopped on shutdown", async () => {
    const seen = join(tempDir(), "seen.txt");
    const { dir } = stationPackage({ onDemand: true, module: `import { writeFileSync } from "node:fs";\nexport function pass() { writeFileSync(${JSON.stringify(seen)}, "x"); return new Promise(() => undefined); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    const outer = new AbortController();
    const run = onDemandPass(ctx, fakeAgents({}).runner, new Date(), { signal: outer.signal });
    await vi.waitFor(() => expect(existsSync(seen)).toBe(true));
    outer.abort();
    await run;
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "stopped" });
  });

  it("is not written by a regular pass", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(ctx.store.getKv(stationRunKey("hello", "nota"))).toBeUndefined();
  });
});

describe("seeing a pending request", () => {
  const at = new Date(2026, 10, 7, 10, 5);
  const now = new Date(2026, 10, 7, 12, 0);

  it("packageList carries the request time and leaves the kv as it was", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    expect(requestStationRun(ctx, "hello/nota", at)).toMatchObject({ ok: true });
    const stored = ctx.store.getKv(key)!;
    expect(packageList(ctx).packages[0]!.stations[0]!.onDemandPendingSince).toBe(stored);
    expect(ctx.store.getKv(key)).toBe(stored);
  });

  it("packageList has no field without a request", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    expect(packageList(ctx).packages[0]!.stations[0]!.onDemandPendingSince).toBeUndefined();
  });

  it("packageList ignores a stray key on a station without onDemand", async () => {
    const ctx = await factory(stationPackage().dir);
    ctx.store.setKv(key, at.toISOString());
    expect(packageList(ctx).packages[0]!.stations[0]!.onDemandPendingSince).toBeUndefined();
    expect(factoryStatus(ctx).onDemand).toEqual([]);
  });

  it("zero package list shows HH:MM for a same-day request and leaves other stations as before", () => {
    const list: PackageList = {
      problems: [],
      packages: [{ name: "hello", version: "1.0.0", dir: "/p", agents: [], skills: [], source: "path", origin: "/p", allowCode: true, stations: [
        { name: "nota", allowed: true, missingSecrets: [], onDemandPendingSince: at.toISOString() },
        { name: "otra", allowed: true, missingSecrets: [] },
      ] }],
    };
    const lines = formatPackages(list, now).split("\n");
    expect(lines.find((l) => l.startsWith("- estación nota:"))).toContain("corrida a demanda pendiente desde 10:05");
    expect(lines.find((l) => l.startsWith("- estación otra:"))).toBe("- estación otra: todavía no corrió");
  });

  it("zero status lists the pending run in one line outside the box filter", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    requestStationRun(ctx, "hello/nota", at);
    const stored = ctx.store.getKv(key)!;
    const status = factoryStatus(ctx);
    expect(status.onDemand).toEqual([{ station: "hello/nota", since: stored }]);
    expect(ctx.store.getKv(key)).toBe(stored);
    const lines = formatStatus(status, now).split("\n").filter((l) => l.startsWith("Corridas a demanda pendientes: "));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hello/nota (desde 10:05)");
    expect(lines[0]!.startsWith("Caja") || lines[0]!.startsWith("Fábrica") || lines[0]!.startsWith("  ")).toBe(false);
  });

  it("zero status has no line with nothing pending", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const status = factoryStatus(ctx);
    expect(status.onDemand).toEqual([]);
    expect(formatStatus(status, now)).not.toContain("Corridas a demanda pendientes");
  });
});

describe("seeing demand runs", () => {
  const now = new Date(2026, 10, 7, 12, 0);
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const recent = (s: string) => s.split("\n").filter((l) => l.startsWith("Corridas a demanda recientes: "));

  async function at(record?: Record<string, unknown>) {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    ctx.now = () => now;
    if (record) ctx.store.setKv(lastRun, JSON.stringify(record));
    return ctx;
  }

  it("zero status shows a run that ended fine", async () => {
    const ctx = await at({ asked: ago(15), startedAt: ago(12), endedAt: ago(10), outcome: "ok" });
    const status = factoryStatus(ctx);
    expect(status.onDemandRuns).toEqual([{ station: "hello/nota", asked: ago(15), startedAt: ago(12), endedAt: ago(10), outcome: "ok" }]);
    const lines = recent(formatStatus(status, now));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hello/nota");
    expect(lines[0]).toContain("terminó bien");
  });

  it("zero status shows a run under way", async () => {
    const ctx = await at({ asked: ago(2), startedAt: ago(1) });
    expect(recent(formatStatus(factoryStatus(ctx), now))[0]).toContain("corriendo desde");
  });

  it("zero status says a run past its time with no end has no result", async () => {
    const ctx = await at({ asked: ago(200), startedAt: ago(180) });
    const status = factoryStatus(ctx);
    expect(status.onDemandRuns[0]).toMatchObject({ stale: true });
    expect(recent(formatStatus(status, now))[0]).toContain("sin resultado");
  });

  it.each([
    ["failed", "falló"],
    ["timeout", "superó su tiempo"],
    ["stopped", "se cortó al apagar la fábrica"],
  ])("zero status tells outcome %s", async (outcome, text) => {
    const ctx = await at({ asked: ago(15), startedAt: ago(12), endedAt: ago(10), outcome });
    expect(recent(formatStatus(factoryStatus(ctx), now))[0]).toContain(text);
  });

  it("zero status tells a run that could not run", async () => {
    const ctx = await at({ asked: ago(15), endedAt: ago(10), outcome: "not-run" });
    expect(recent(formatStatus(factoryStatus(ctx), now))[0]).toContain("no pudo correr");
  });

  it("hides a record that ended 2 days ago", async () => {
    const ctx = await at({ asked: ago(2 * 1440 + 5), startedAt: ago(2 * 1440 + 3), endedAt: ago(2 * 1440), outcome: "ok" });
    const status = factoryStatus(ctx);
    expect(status.onDemandRuns).toEqual([]);
    expect(formatStatus(status, now)).not.toContain("Corridas a demanda recientes");
  });

  it("keeps the pending list unchanged next to a recorded run", async () => {
    const ctx = await at({ asked: ago(15), startedAt: ago(12), endedAt: ago(10), outcome: "ok" });
    requestStationRun(ctx, "hello/nota", now);
    const status = factoryStatus(ctx);
    expect(status.onDemand).toEqual([{ station: "hello/nota", since: now.toISOString() }]);
    expect(formatStatus(status, now)).toContain("Corridas a demanda pendientes: ");
  });

  it("the status reads the record onDemandPass wrote", async () => {
    const ctx = await at();
    requestStationRun(ctx, "hello/nota", now);
    await onDemandPass(ctx, fakeAgents({}).runner, now);
    expect(factoryStatus(ctx).onDemandRuns).toEqual([expect.objectContaining({ station: "hello/nota", outcome: "ok" })]);
  });

  it("the panel shows a pending run", async () => {
    const ctx = await at();
    requestStationRun(ctx, "hello/nota", now);
    const html = overviewPage(factoryStatus(ctx), ["web"], "n");
    expect(html).toContain("hello/nota");
    expect(html).toContain("pendiente");
  });

  it("the panel shows a failed run", async () => {
    const ctx = await at({ asked: ago(15), startedAt: ago(12), endedAt: ago(10), outcome: "failed" });
    const html = overviewPage(factoryStatus(ctx), ["web"], "n");
    expect(html).toContain("hello/nota");
    expect(html).toContain("falló");
  });

  it("the panel says nothing about demand runs without any", async () => {
    const ctx = await at();
    expect(overviewPage(factoryStatus(ctx), ["web"], "n")).not.toContain("a demanda");
  });

  it("the briefing lists a run of the day", async () => {
    const ctx = await at({ asked: ago(15), startedAt: ago(12), endedAt: ago(10), outcome: "ok" });
    const b = (await briefing(ctx, 1)).body;
    expect(b).toContain("## Corridas a demanda");
    expect(b).toContain("hello/nota");
    expect(b).toContain("terminó bien");
  });

  it("the briefing lists a pending run", async () => {
    const ctx = await at();
    requestStationRun(ctx, "hello/nota", now);
    const b = (await briefing(ctx, 1)).body;
    expect(b).toContain("## Corridas a demanda");
    expect(b).toMatch(/- hello\/nota: pendiente/);
  });

  it("the briefing has no section without runs in the period", async () => {
    const ctx = await at({ asked: ago(2 * 1440 + 5), startedAt: ago(2 * 1440 + 3), endedAt: ago(2 * 1440), outcome: "ok" });
    expect((await briefing(ctx, 1)).body).not.toContain("Corridas a demanda");
  });
});

describe("interfaces", () => {
  const zero = (ctx: FactoryContext, ...args: string[]) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
    return { code: r.status, output: r.stdout + r.stderr };
  };

  it("zero package run exits 1 with the reason for a station without onDemand", async () => {
    const ctx = await factory(stationPackage().dir);
    const r = zero(ctx, "package", "run", "hello/nota");
    expect(r.code).toBe(1);
    expect(r.output).toContain("onDemand");
  }, 60_000);

  it("zero package run without a station shows the usage", async () => {
    const ctx = await factory(stationPackage().dir);
    const r = zero(ctx, "package", "run");
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("zero package run <paquete>/<estación>");
  }, 60_000);

  it("lists zero package run in the usage", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(zero(ctx, "help").output).toContain("zero package run <paquete>/<estación>");
  }, 60_000);

  it("zero_package_run tells the refusal", async () => {
    const ctx = await factory(stationPackage().dir);
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    const r = (await client.callTool({ name: "zero_package_run", arguments: { station: "hello/nota" } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain("onDemand");
    expect(ctx.store.getKv(key)).toBeUndefined();
  });
});

describe("waiting for the run to start", () => {
  const noSleep = async () => {};

  it("answers started once the run record carries the request and a startedAt", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    if (!r.ok) throw new Error(r.reason);
    let polls = 0;
    const sleep = async () => {
      polls++;
      if (polls === 2) ctx.store.setKv(stationRunKey("hello", "nota"), JSON.stringify({ requestedAt: r.requestedAt, startedAt: new Date().toISOString(), state: "running" }));
    };
    const w = await waitStationStart(ctx, "hello/nota", r.requestedAt, { timeoutMs: 1000, pollMs: 100, sleep });
    expect(w.started).toBe(true);
    expect(w.text).toContain("empezó");
  });

  it("does not take an earlier run's record for this one", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    ctx.store.setKv(stationRunKey("hello", "nota"), JSON.stringify({ requestedAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:01.000Z", state: "ended", outcome: "done" }));
    const r = requestStationRun(ctx, "hello/nota");
    if (!r.ok) throw new Error(r.reason);
    const w = await waitStationStart(ctx, "hello/nota", r.requestedAt, { timeoutMs: 300, pollMs: 100, sleep: noSleep });
    expect(w).toMatchObject({ started: false, text: expect.stringContaining("pendiente") });
  });

  it("answers pending when nothing starts within the limit", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    if (!r.ok) throw new Error(r.reason);
    const sleep = vi.fn(noSleep);
    const w = await waitStationStart(ctx, "hello/nota", r.requestedAt, { timeoutMs: 500, pollMs: 100, sleep });
    expect(w.started).toBe(false);
    expect(w.text).toContain("sigue pendiente");
    expect(sleep).toHaveBeenCalledTimes(5);
  });

  it("starts for real when the packages pass runs it", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    if (!r.ok) throw new Error(r.reason);
    const w = await waitStationStart(ctx, "hello/nota", r.requestedAt, { timeoutMs: 1000, pollMs: 100, sleep: () => onDemandPass(ctx, fakeAgents({}).runner, new Date()) });
    expect(w.started).toBe(true);
  });

  it("zero_package_run passes the request and tells whether it started", async () => {
    const { dir } = stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"] });
    const ctx = await factory(dir);
    const server = createZeroMcpServer(ctx.home, { autoStart: false, stationWaitMs: 0 });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    const r = (await client.callTool({ name: "zero_package_run", arguments: { station: "hello/nota", request: "  revisar precios  " } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain("sigue pendiente");
    expect(ctx.store.getKv(key)).toBeDefined();
    expect(ctx.store.getKv(stationOnDemandRequestKey("hello", "nota"))).toBe("revisar precios");
  });

  it("the CLI takes --pedido, passes it and waits two minutes", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    expect(cli).toMatch(/^  zero package run <paquete>\/<estación> \[--pedido "<texto>"\]$/m);
    expect(cli).toContain("pedido: { type: \"string\" }");
    expect(cli).toContain("requestStationRun(ctx, name, new Date(), values.pedido)");
    expect(cli).toContain("const STATION_WAIT_MS = 120_000;");
    expect(cli).toMatch(/waitStationStart\(ctx, name, r\.requestedAt, \{ timeoutMs: STATION_WAIT_MS \}\)/);
  });
});
