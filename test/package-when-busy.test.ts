import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, factoryStatus, packageList, requestStationRun, requestWork, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { busyPass, packagesPass, stationLastKey } from "../src/line/packages.js";
import { formatPackages, formatStatus } from "../src/format.js";
import { log } from "../src/log.js";
import { overviewPage, packagesPage } from "../src/panel/html.js";
import { factoryConfig } from "../src/packages.js";
import { recordSelfUpdate } from "../src/self-update.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const passes = `node -e "process.exit(0)"`;
const DEFAULT_MODULE = `export async function pass(ctx) { note("pass"); }`;
const BUSY = "corre aunque la fábrica esté ocupada";
const STATUS_LINE = "Estaciones que corren aunque la fábrica esté ocupada:";

/** A package whose station `nota` notes each call to `pass`. */
function stationPackage(opts: { whenBusy?: unknown; module?: string; secrets?: string[]; instructions?: boolean; onDemand?: boolean } = {}) {
  const dir = tempDir("zero-pkg-");
  const marker = join(tempDir("zero-marker-"), "calls.txt");
  const whenBusy = opts.whenBusy === undefined ? {} : { whenBusy: opts.whenBusy };
  writeTree(dir, {
    "zero-package.yaml": stringify({
      interface: 1,
      name: "hello",
      version: "1.0.0",
      stations: [{ name: "nota", module: "nota.mjs", secrets: opts.secrets ?? [], ...(opts.instructions && { instructions: "nota.md" }), ...(opts.onDemand && { onDemand: true }), ...whenBusy }],
    }),
    "nota.md": "Write a sentence.\n",
    "nota.mjs": `import { appendFileSync } from "node:fs";
const note = (text) => appendFileSync(${JSON.stringify(marker)}, text + "\\n");
${opts.module ?? DEFAULT_MODULE}
`,
  });
  return { dir, marker, calls: () => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : []) };
}

async function factory(dir: string, over: Record<string, unknown> = {}): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [{ name: "web", repo: gitRepo(), verify: [passes] }], packages: [{ path: dir, allowCode: true }], ...over });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const last = stationLastKey("hello", "nota");
const pass = () => fakeAgents({}).runner;

describe("declaring whenBusy in the manifest", () => {
  it("carries true to the loaded station", async () => {
    const ctx = await factory(stationPackage({ whenBusy: true }).dir);
    expect(ctx.config.loadedPackages!.stations[0]!.whenBusy).toBe(true);
  });

  it("is false when absent", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(ctx.config.loadedPackages!.stations[0]!.whenBusy).toBe(false);
  });

  it("leaves the package out for a wrong type", async () => {
    const ctx = await factory(stationPackage({ whenBusy: "yes" }).dir);
    expect(ctx.config.loadedPackages!.stations).toEqual([]);
    expect(ctx.config.loadedPackages!.problems[0]).toMatchObject({ reason: expect.stringContaining("whenBusy") });
  });
});

describe("busyPass", () => {
  it("runs a whenBusy station with a job queued", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir);
    requestWork(ctx, { text: "algo", line: "web" });
    await busyPass(ctx, pass(), new Date());
    expect(calls()).toEqual(["pass"]);
    expect(ctx.store.getKv(last)).toBeDefined();
  });

  it("runs a whenBusy station whose period is over with a job running", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir);
    const job = requestWork(ctx, { text: "algo", line: "web" }).job;
    ctx.store.updateJob(job.id, { status: "running" });
    ctx.store.setKv(last, new Date(Date.now() - 2 * 86_400_000).toISOString());
    await busyPass(ctx, pass(), new Date());
    expect(calls()).toEqual(["pass"]);
  });

  it("respects everyMinutes", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir);
    requestWork(ctx, { text: "algo", line: "web" });
    await busyPass(ctx, pass(), new Date());
    await busyPass(ctx, pass(), new Date(Date.now() + 60_000));
    expect(calls()).toEqual(["pass"]);
  });

  it("does nothing with the andon on", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir);
    ctx.store.setKv(ANDON_KEY, "on");
    await busyPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(last)).toBeUndefined();
  });

  it("does nothing with the budget reached", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir, { limits: { usdPerDay: 1 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": 5 });
    await busyPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
  });

  it("waits for a missing secret", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, calls } = stationPackage({ whenBusy: true, secrets: ["NOTA_TOKEN"] });
    const ctx = await factory(dir);
    await busyPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(last)).toBeUndefined();
  });

  it("keeps the night cap on ctx.runAgent", async () => {
    const out = join(tempDir(), "run.json");
    const { dir } = stationPackage({
      whenBusy: true,
      instructions: true,
      module: `import { writeFileSync } from "node:fs";\nexport async function pass(ctx) { writeFileSync(${JSON.stringify(out)}, JSON.stringify(await ctx.runAgent({ prompt: "p" }))); }`,
    });
    const ctx = await factory(dir, { limits: { usdPerNight: 0.3 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout" } }).end("ok", { "zero.cost.usd": 0.3 });
    requestWork(ctx, { text: "algo", line: "web" });
    const agents = fakeAgents({});
    await busyPass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ ok: false, text: expect.stringContaining("limits.usdPerNight") });
  });

  it("runs no second turn while one is under way", async () => {
    const gate = join(tempDir(), "gate.txt");
    const { dir, calls } = stationPackage({
      whenBusy: true,
      module: `import { existsSync } from "node:fs";
export async function pass() {
  note("pass");
  while (!existsSync(${JSON.stringify(gate)})) await new Promise((r) => setTimeout(r, 10));
}`,
    });
    const ctx = await factory(dir);
    const first = busyPass(ctx, pass(), new Date());
    await vi.waitFor(() => expect(calls()).toEqual(["pass"]));
    ctx.store.deleteKv(last);
    await busyPass(ctx, pass(), new Date());
    writeFileSync(gate, "");
    await first;
    expect(calls()).toEqual(["pass"]);
  });

  it("leaves a pending on-demand request to onDemandPass", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true, onDemand: true });
    const ctx = await factory(dir);
    requestStationRun(ctx, "hello/nota");
    await busyPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(last)).toBeUndefined();
  });
});

describe("without whenBusy", () => {
  it("a plain station waits for an idle factory", async () => {
    const { dir, calls } = stationPackage();
    const ctx = await factory(dir);
    requestWork(ctx, { text: "algo", line: "web" });
    await busyPass(ctx, pass(), new Date());
    await packagesPass(ctx, pass(), new Date());
    expect(calls()).toEqual([]);
  });

  it("one turn per period across the busy-time and the idle pass", async () => {
    const { dir, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir);
    await busyPass(ctx, pass(), new Date());
    await packagesPass(ctx, pass(), new Date(Date.now() + 60_000));
    expect(calls()).toEqual(["pass"]);
  });
});

describe("the daemon", () => {
  it("runs a whenBusy station while a job runs", async () => {
    const { dir, marker, calls } = stationPackage({ whenBusy: true });
    const ctx = await factory(dir);
    const job = requestWork(ctx, { text: "algo", line: "web" }).job;
    let during: string | undefined;
    const agents = fakeAgents({
      build: async (req) => {
        writeTree(req.cwd, { "src/a.ts": "ok" });
        await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 10_000 });
        during = ctx.store.getJob(job.id)?.status;
      },
    });
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, scout: false, research: false, unjam: false, recruit: false, panel: false, agentRunner: () => agents.runner });
    expect(during).toBe("running");
    expect(calls()).toEqual(["pass"]);
  });

  it("runs a whenBusy station while a prepared self-update waits for a running job", async () => {
    const { dir, marker, calls } = stationPackage({ whenBusy: true });
    let clock = new Date();
    const ctx = await factory(dir, { selfUpdate: { enabled: true } });
    ctx.now = () => clock;
    ctx.store.setKv(last, clock.toISOString());
    requestWork(ctx, { text: "algo", line: "web" });
    let ready: boolean | undefined;
    const agents = fakeAgents({
      build: async (req) => {
        writeTree(req.cwd, { "src/a.ts": "ok" });
        if (ready !== undefined) return;
        recordSelfUpdate(ctx.store, { state: { status: "ready", from: "a".repeat(40), to: "b".repeat(40), dir: "/prepared" } });
        clock = new Date(clock.getTime() + 2 * 86_400_000);
        await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 10_000 });
        ready = true;
      },
    });
    let switched = 0;
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, scout: false, research: false, unjam: false, recruit: false, panel: false, agentRunner: () => agents.runner, launchSwitch: async () => void switched++ });
    expect(ready).toBe(true);
    expect(calls()).toEqual(["pass"]);
    expect(switched).toBe(1);
  });
});

describe("zero package list and zero status", () => {
  it("package list shows a whenBusy station", async () => {
    const ctx = await factory(stationPackage({ whenBusy: true }).dir);
    const line = formatPackages(packageList(ctx))
      .split("\n")
      .find((l) => l.includes("estación nota"));
    expect(line).toContain(BUSY);
  });

  it("package list omits it for a plain station", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(formatPackages(packageList(ctx))).not.toContain(BUSY);
  });

  it("status names the whenBusy stations", async () => {
    const ctx = await factory(stationPackage({ whenBusy: true }).dir);
    const line = formatStatus(factoryStatus(ctx))
      .split("\n")
      .find((l) => l.startsWith(STATUS_LINE));
    expect(line).toContain("hello/nota");
  });

  it("status has no such line without them", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(formatStatus(factoryStatus(ctx))).not.toContain(STATUS_LINE);
  });
});

describe("the panel", () => {
  it("the packages page marks a whenBusy station", async () => {
    const ctx = await factory(stationPackage({ whenBusy: true }).dir);
    const card = packagesPage(packageList(ctx), [], "n")
      .split(`<div class="card">`)
      .find((c) => c.startsWith("<h3>nota "));
    expect(card).toContain(BUSY);
  });

  it("the packages page does not mark a plain station", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(packagesPage(packageList(ctx), [], "n")).not.toContain(BUSY);
  });

  it("the summary names the whenBusy stations", async () => {
    const ctx = await factory(stationPackage({ whenBusy: true }).dir);
    const html = overviewPage(factoryStatus(ctx), [], "n");
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain("hello/nota");
  });

  it("the summary has no such line without them", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(overviewPage(factoryStatus(ctx), [], "n")).not.toContain("Estaciones que corren aunque la fábrica esté ocupada");
  });
});
