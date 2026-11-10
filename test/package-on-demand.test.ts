import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, factoryStatus, packageList, requestStationRun, requestWork, waitStationRunStart, type FactoryContext, type FactoryStatus, type PackageList } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { packagesPass, stationLastKey, stationOnDemandKey, stationOnDemandRequestKey, stationOnDemandRunKey, type OnDemandRun } from "../src/line/packages.js";
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
function stationPackage(opts: { onDemand?: unknown; module?: string; secrets?: string[]; instructions?: boolean } = {}) {
  const dir = tempDir("zero-pkg-");
  const marker = join(tempDir("zero-marker-"), "calls.txt");
  const onDemand = opts.onDemand === undefined ? {} : { onDemand: opts.onDemand };
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", secrets: opts.secrets ?? [], ...(opts.instructions && { instructions: "nota.md" }), ...onDemand }] }),
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
    const output = zero(ctx, "help").output;
    expect(output).toContain("zero package run <paquete>/<estación>");
    expect(output).toContain("--pedido");
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

  it("zero_package_run stores the request text", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    const r = (await client.callTool({ name: "zero_package_run", arguments: { station: "hello/nota", request: "hola" } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain("pedida");
    expect(ctx.store.getKv(requestKey)).toBe("hola");
    expect(ctx.store.getKv(key)).toBeDefined();
  });
});

const requestKey = stationOnDemandRequestKey("hello", "nota");
const runKey = stationOnDemandRunKey("hello", "nota");
const runOf = (ctx: FactoryContext) => JSON.parse(ctx.store.getKv(runKey) ?? "null") as OnDemandRun | null;

describe("a request with text", () => {
  it("is cleaned of the station's secrets and cut to 4000 characters", async () => {
    const ctx = await factory(stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"] }).dir);
    ctx.secrets.set("NOTA_TOKEN", "s3cr3t-value");
    const r = requestStationRun(ctx, "hello/nota", { request: "usá s3cr3t-value " + "x".repeat(5000) });
    expect(r).toMatchObject({ ok: true, at: expect.any(String) });
    const stored = ctx.store.getKv(requestKey)!;
    expect(stored.length).toBeLessThanOrEqual(4000);
    expect(stored).not.toContain("s3cr3t-value");
    expect(stored.startsWith("usá")).toBe(true);
    expect(r.ok && r.at).toBe(ctx.store.getKv(key));
  });

  it("refuses a blank request and records nothing", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    expect(requestStationRun(ctx, "hello/nota", { request: " " })).toMatchObject({ ok: false, reason: expect.stringContaining("vacío") });
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(ctx.store.getKv(requestKey)).toBeUndefined();
  });

  it("writes no request key without text", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    expect(requestStationRun(ctx, "hello/nota").ok).toBe(true);
    expect(ctx.store.getKv(requestKey)).toBeUndefined();
  });

  it("reaches pass as request, and both keys are gone afterwards", async () => {
    const { dir, calls } = stationPackage({ onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota", { request: "resumí lo de ayer" });
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls().map((c) => JSON.parse(c) as unknown)).toEqual([{ onDemand: true, request: "resumí lo de ayer" }]);
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(ctx.store.getKv(requestKey)).toBeUndefined();
    expect(runOf(ctx)).toMatchObject({ request: true, outcome: "done" });
  });

  it("is cleared with the pending key when the module cannot run", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const ctx = await factory(stationPackage({ onDemand: true, module: `export async function scheduled() {}` }).dir);
    requestStationRun(ctx, "hello/nota", { request: "algo" });
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(ctx.store.getKv(requestKey)).toBeUndefined();
  });

  it("cannot be forged through ctx.state", async () => {
    const { dir, calls } = stationPackage({ onDemand: true, module: `export async function pass(ctx, arg) { ctx.state.set("on-demand", "x"); ctx.state.set("on-demand:request", "x"); note(JSON.stringify(arg ?? null)); }` });
    const ctx = await factory(dir);
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(ctx.store.getKv(key)).toBeUndefined();
    expect(ctx.store.getKv(requestKey)).toBeUndefined();
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(calls()).toEqual(["null"]);
  });
});

describe("the on-demand run record", () => {
  it("is done with its times once pass resolves", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    const run = runOf(ctx)!;
    expect(run).toMatchObject({ outcome: "done", request: false, startedAt: expect.any(String), finishedAt: expect.any(String) });
    expect(run.requestedAt).toBe(r.ok && r.at);
  });

  it("is failed with the error when pass throws, without the station's secrets", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir } = stationPackage({ onDemand: true, secrets: ["NOTA_TOKEN"], module: `export async function pass(ctx) { throw new Error("boom " + ctx.secrets.get("NOTA_TOKEN") + " " + "y".repeat(500)); }` });
    const ctx = await factory(dir);
    ctx.secrets.set("NOTA_TOKEN", "s3cr3t-value");
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    const run = runOf(ctx)!;
    expect(run).toMatchObject({ outcome: "failed", error: expect.stringContaining("boom"), startedAt: expect.any(String) });
    expect(run.error).not.toContain("s3cr3t-value");
    expect(run.error!.length).toBeLessThanOrEqual(300);
  });

  it("is failed without a start when the module exports no pass", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const ctx = await factory(stationPackage({ onDemand: true, module: `export async function scheduled() {}` }).dir);
    requestStationRun(ctx, "hello/nota");
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    const run = runOf(ctx)!;
    expect(run).toMatchObject({ outcome: "failed", error: expect.stringContaining("pass") });
    expect(run.startedAt).toBeUndefined();
  });

  it("is interrupted when the outer signal aborts", async () => {
    const ctx = await factory(stationPackage({ onDemand: true, module: `export async function pass(ctx) { await new Promise((done) => ctx.signal.addEventListener("abort", done)); }` }).dir);
    requestStationRun(ctx, "hello/nota");
    const controller = new AbortController();
    const pass = packagesPass(ctx, fakeAgents({}).runner, new Date(), { signal: controller.signal });
    await vi.waitFor(() => expect(runOf(ctx)?.outcome).toBe("running"));
    controller.abort();
    await pass;
    expect(runOf(ctx)).toMatchObject({ outcome: "interrupted", startedAt: expect.any(String) });
  });

  it("waitStationRunStart sees the start", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    if (!r.ok) throw new Error(r.reason);
    const waiting = waitStationRunStart(ctx, "hello/nota", r.at, { timeoutMs: 10_000, pollMs: 5 });
    await packagesPass(ctx, fakeAgents({}).runner, new Date());
    expect(await waiting).toMatchObject({ state: "started", run: { startedAt: expect.any(String), requestedAt: r.at } });
  });

  it("waitStationRunStart reports still pending when nothing runs", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const r = requestStationRun(ctx, "hello/nota");
    if (!r.ok) throw new Error(r.reason);
    await expect(waitStationRunStart(ctx, "hello/nota", r.at, { timeoutMs: 50, pollMs: 5 })).resolves.toEqual({ state: "pending" });
  });
});

describe("seeing requested, running and ended runs", () => {
  const at = new Date(2026, 10, 7, 10, 5);
  const now = new Date(2026, 10, 7, 12, 0);
  const record = (ctx: FactoryContext, run: OnDemandRun) => ctx.store.setKv(runKey, JSON.stringify(run));
  const statusAt = (ctx: FactoryContext, when: Date): FactoryStatus => {
    ctx.now = () => when;
    return factoryStatus(ctx);
  };

  it("marks a pending request with text", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    requestStationRun(ctx, "hello/nota", { request: "hola", now: at });
    const status = factoryStatus(ctx);
    expect(status.onDemand).toEqual([{ station: "hello/nota", since: at.toISOString(), request: true }]);
    expect(formatStatus(status, now)).toContain("hello/nota (desde 10:05, con pedido)");
  });

  it("shows a running turn", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    record(ctx, { requestedAt: at.toISOString(), request: false, startedAt: at.toISOString(), outcome: "running" });
    const status = statusAt(ctx, now);
    expect(status.onDemandRuns).toEqual([{ station: "hello/nota", outcome: "running", startedAt: at.toISOString() }]);
    expect(formatStatus(status, now).split("\n")).toContain("Corrida a demanda en curso: hello/nota (desde 10:05)");
  });

  it("shows a turn that ended within a day", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    record(ctx, { requestedAt: at.toISOString(), request: true, startedAt: at.toISOString(), finishedAt: new Date(now.getTime() - 3_600_000).toISOString(), outcome: "failed", error: "boom" });
    const line = formatStatus(statusAt(ctx, now), now).split("\n").find((l) => l.startsWith("Últimas corridas a demanda: "));
    expect(line).toContain("hello/nota");
    expect(line).toContain("boom");
  });

  it("hides a turn that ended two days ago", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    record(ctx, { requestedAt: at.toISOString(), request: false, startedAt: at.toISOString(), finishedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(), outcome: "done" });
    const status = statusAt(ctx, now);
    expect(status.onDemandRuns).toEqual([]);
    expect(formatStatus(status, now)).not.toContain("Últimas corridas a demanda");
  });

  it("zero package list shows the last run", async () => {
    const ctx = await factory(stationPackage({ onDemand: true }).dir);
    const run: OnDemandRun = { requestedAt: at.toISOString(), request: false, startedAt: at.toISOString(), finishedAt: at.toISOString(), outcome: "done" };
    record(ctx, run);
    const list = packageList(ctx);
    expect(list.packages[0]!.stations[0]!.onDemandLastRun).toEqual(run);
    expect(formatPackages(list, now)).toContain(" · última corrida a demanda: terminó bien (10:05)");
  });
});
