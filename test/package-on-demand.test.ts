import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, factoryStatus, packageList, requestStationRun, requestWork, waitStationStart, type FactoryContext, type PackageList } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { onDemandPending, packagesPass, readStationRun, stationLastKey, stationOnDemandKey, stationOnDemandRequestKey, stationRunKey } from "../src/line/packages.js";
import { formatPackages, formatStatus } from "../src/format.js";
import { log } from "../src/log.js";
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

describe("the daemon runs a pending request", () => {
  it("runs before its period, once, with { onDemand: true }, leaving the period as it was", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    const last = new Date(Date.now() - 60_000).toISOString();
    ctx.store.setKv(stationLastKey("hello", "nota"), last);
    expect(requestStationRun(ctx, "hello/nota").ok).toBe(true);
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBe(last);
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toHaveLength(1);
  });

  it("does not also run the regular turn in the same pass", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeUndefined();
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true }), "null"]);
  });

  it("calls a regular pass with no second argument", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function pass(...args) { note(String(args.length) + ":" + String(args[1])); }` });
    const ctx = await factory(dir);
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual(["1:undefined"]);
  });

  it("waits for the andon, then runs", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    ctx.store.setKv(ANDON_KEY, "on");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
    ctx.store.setKv(ANDON_KEY, "off");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
  });

  it("waits for queued jobs", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    requestWork(ctx, { text: "algo", line: "web" });
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
  });

  it("waits for a missing secret", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"] });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeDefined();
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
    await packagesPass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ ok: false, text: expect.stringContaining("limits.usdPerNight") });
  });

  it("clears the request of a module without pass and warns", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function scheduled() { note("scheduled"); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(warn.mock.calls.some(([m]) => String(m).includes("hello/nota") && String(m).includes("pass"))).toBe(true);
  });

  it("clears the request when parseConfig throws", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ onDemand: true, module: `export function parseConfig() { throw new Error("mal"); }\n${DEFAULT_MODULE}` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(key)).toBeUndefined();
  });

  it("is picked up by the daemon within its throttle", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, panel: false, agentRunner: () => fakeAgents({}).runner });
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
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
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
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual([JSON.stringify({ onDemand: true })]);
  });

  it("is gone after the run, and a later regular pass gets no argument", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function pass(...args) { note(String(args.length) + ":" + JSON.stringify(args[1] ?? null)); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota", new Date(), "revisar precios");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
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
    const run = packagesPass(ctx, fakeAgents({}).runner, new Date());
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
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "failed", error: expect.stringContaining("se cayó") });
    expect(record(ctx)!.error).not.toContain(SECRET);
    expect(record(ctx)!.error!.length).toBeLessThanOrEqual(600);
  });

  it("is failed when the module cannot run", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir } = stationPackage({ onDemand: true, module: `export async function scheduled() {}` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "failed" });
  });

  it("is timeout when pass never ends", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir } = stationPackage({ onDemand: true, timeoutMinutes: 0.002, module: `export function pass() { return new Promise(() => undefined); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(record(ctx)).toMatchObject({ state: "ended", outcome: "timeout", startedAt: expect.any(String) });
  });

  it("is stopped on shutdown", async () => {
    const seen = join(tempDir(), "seen.txt");
    const { dir } = stationPackage({ onDemand: true, module: `import { writeFileSync } from "node:fs";\nexport function pass() { writeFileSync(${JSON.stringify(seen)}, "x"); return new Promise(() => undefined); }` });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    const outer = new AbortController();
    const run = packagesPass(ctx, fakeAgents({}).runner, new Date(), { signal: outer.signal });
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
    const w = await waitStationStart(ctx, "hello/nota", r.requestedAt, { timeoutMs: 1000, pollMs: 100, sleep: () => packagesPass(ctx, fakeAgents({}).runner, new Date()) });
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
