import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, requestWork, type FactoryContext } from "../src/app.js";
import { budgetState } from "../src/budget.js";
import { runDaemon } from "../src/daemon.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { packagesPass, scheduledPass, stationLastKey, stationScheduleKey } from "../src/line/packages.js";
import { log } from "../src/log.js";
import { factoryConfig } from "../src/packages.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const passes = `node -e "process.exit(0)"`;
const at = (hours: number, minutes = 0, day = 4) => new Date(2026, 10, day, hours, minutes);
const DEFAULT_PASS = `export async function pass() { note("pass"); }`;

/** A package whose station `nota` runs `body` in `scheduled` and notes each call in a file. */
function stationPackage(opts: { name?: string; schedule?: unknown; secrets?: string[]; body?: string; other?: string; timeoutMinutes?: number } = {}) {
  const dir = tempDir("zero-pkg-");
  const marker = join(tempDir("zero-marker-"), "calls.txt");
  const schedule = opts.schedule === undefined ? {} : { schedule: opts.schedule };
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: opts.name ?? "hello", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", secrets: opts.secrets ?? [], ...schedule, ...(opts.timeoutMinutes ? { timeoutMinutes: opts.timeoutMinutes } : {}) }] }),
    "nota.mjs": `import { appendFileSync } from "node:fs";
const note = (text) => appendFileSync(${JSON.stringify(marker)}, text + "\\n");
export async function scheduled(ctx, slot) {
  note(slot.at);
  ${opts.body ?? ""}
}
${opts.other ?? DEFAULT_PASS}
`,
  });
  return { dir, calls: () => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : []) };
}

async function factory(dirs: string | string[], over: Record<string, unknown> = {}, now?: () => Date): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [{ name: "web", repo: gitRepo(), verify: [passes], integrate: "merge" }], packages: [dirs].flat().map((path) => ({ path, allowCode: true })), ...over }, now);
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const warnings = () => vi.spyOn(log, "warn").mockImplementation(() => undefined);

describe("declaring a schedule in the manifest", () => {
  it("loads valid times", async () => {
    const ctx = await factory(stationPackage({ schedule: ["08:00", "12:00", "18:00"] }).dir);
    expect(ctx.config.loadedPackages!.problems).toEqual([]);
    expect(ctx.config.loadedPackages!.stations[0]!.schedule).toEqual(["08:00", "12:00", "18:00"]);
  });

  it("takes the whole range of the day", async () => {
    const ctx = await factory(stationPackage({ schedule: ["00:00", "23:59"] }).dir);
    expect(ctx.config.loadedPackages!.stations[0]!.schedule).toEqual(["00:00", "23:59"]);
  });

  it("is an empty list when absent", async () => {
    const ctx = await factory(stationPackage().dir);
    expect(ctx.config.loadedPackages!.problems).toEqual([]);
    expect(ctx.config.loadedPackages!.stations[0]!.schedule).toEqual([]);
  });

  it.each([[["24:00"]], [["8:00"]], [["08:60"]], [[800]], ["08:00"], [["08:00", "08:00"]]])("leaves the package out for %j, naming schedule", async (schedule) => {
    const ctx = await factory(stationPackage({ schedule }).dir);
    expect(ctx.config.loadedPackages!.stations).toEqual([]);
    expect(ctx.config.loadedPackages!.problems[0]!.reason).toContain("schedule");
  });
});

describe("a scheduled pass", () => {
  it("calls scheduled with the manifest's text, never pass", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    expect(calls()).toEqual(["08:00"]);
  });

  it("does nothing before the time", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(7, 59));
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(stationScheduleKey("hello", "nota", "08:00"))).toBeUndefined();
  });

  it("does nothing for a station without a schedule", async () => {
    const { dir, calls } = stationPackage();
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    expect(calls()).toEqual([]);
  });

  it("warns once about a module without scheduled, and the next station runs", async () => {
    const warn = warnings();
    const dir = tempDir("zero-pkg-");
    writeTree(dir, {
      "zero-package.yaml": stringify({ interface: 1, name: "sin", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", schedule: ["08:00", "09:00"] }] }),
      "nota.mjs": `export async function pass() {}\n`,
    });
    const next = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory([dir, next.dir]);
    await scheduledPass(ctx, at(9));
    await scheduledPass(ctx, at(9, 1));
    expect(next.calls()).toEqual(["08:00"]);
    expect(warn.mock.calls.filter(([m]) => m.includes("sin/nota") && m.includes("scheduled"))).toHaveLength(1);
  });

  it("runs with the budget used up", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir, { limits: { usdPerDay: 1 } });
    const span = ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } });
    span.end("ok", { "zero.cost.usd": 5 });
    const now = new Date();
    expect(budgetState(ctx.store, ctx.config, now).reached).toBe(true);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    ctx.config.loadedPackages!.stations[0]!.schedule = [time];
    await scheduledPass(ctx, now);
    expect(calls()).toEqual([time]);
  });

  it("runs with a job queued", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    requestWork(ctx, { text: "algo" });
    await scheduledPass(ctx, at(8));
    expect(calls()).toEqual(["08:00"]);
  });
});

describe("with the factory busy", () => {
  it("runs while a job runs, and neither waits for the other", async () => {
    const shared = tempDir("zero-shared-");
    const agentIn = join(shared, "agent-in.txt");
    const stationDone = join(shared, "station-done.txt");
    const { dir, calls } = stationPackage({
      schedule: ["08:00"],
      other: "",
      body: `const { existsSync, writeFileSync } = await import("node:fs");
  while (!existsSync(${JSON.stringify(agentIn)})) await new Promise((r) => setTimeout(r, 10));
  writeFileSync(${JSON.stringify(stationDone)}, "done");`,
    });
    const ctx = await factory(dir, {}, () => at(8));
    const { job } = requestWork(ctx, { text: "algo", line: "web" });
    const agents = fakeAgents({
      build: async (req) => {
        writeFileSync(agentIn, "in");
        const deadline = Date.now() + 10_000;
        while (!existsSync(stationDone) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        if (!existsSync(stationDone)) return { ok: false, text: "scheduled never ran" };
        writeFileSync(join(req.cwd, "x.txt"), "x");
        return {};
      },
    });
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, panel: false, agentRunner: () => agents.runner });
    expect(calls()).toEqual(["08:00"]);
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("stays off in a one-shot daemon unless asked", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir, {}, () => at(8));
    await runDaemon(ctx, { once: true, pollMs: 5, panel: false, agentRunner: () => fakeAgents({}).runner });
    expect(calls()).toEqual([]);
  });
});

describe("no model", () => {
  it("makes ctx.runAgent throw synchronously, naming scheduled, with no engine call or span", async () => {
    const shared = join(tempDir("zero-shared-"), "caught.json");
    const { dir, calls } = stationPackage({
      schedule: ["08:00"],
      other: "",
      body: `const { writeFileSync } = await import("node:fs");
  let returned = false;
  try { ctx.runAgent({ prompt: "hola" }); returned = true; } catch (err) { writeFileSync(${JSON.stringify(shared)}, JSON.stringify({ message: err.message, returned })); }`,
    });
    const ctx = await factory(dir, {}, () => at(8));
    const agents = fakeAgents({ "package:hello/nota": () => ({ text: "no debería" }) });
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, panel: false, agentRunner: () => agents.runner });
    expect(calls()).toEqual(["08:00"]);
    expect(JSON.parse(readFileSync(shared, "utf8"))).toEqual({ message: expect.stringContaining("scheduled"), returned: false });
    expect(agents.calls).toEqual([]);
    expect(ctx.store.spansSince(AGENT_SPAN, new Date(0))).toEqual([]);
  });

  it("keeps an uncaught error in the log, and the next station runs", async () => {
    const warn = warnings();
    const bad = stationPackage({ name: "mala", schedule: ["08:00"], body: `ctx.runAgent({ prompt: "hola" });` });
    const good = stationPackage({ name: "buena", schedule: ["08:00"] });
    const ctx = await factory([bad.dir, good.dir]);
    await expect(scheduledPass(ctx, at(8))).resolves.toBeUndefined();
    expect(good.calls()).toEqual(["08:00"]);
    expect(JSON.stringify(warn.mock.calls.find(([m]) => m.includes("mala/nota")))).toContain("scheduled");
  });
});

describe("what it receives", () => {
  it("has secrets, state, log and lines, and pass reads the same state", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const out = join(tempDir("zero-out-"), "out.json");
    const { dir } = stationPackage({
      schedule: ["08:00"],
      secrets: ["HELLO_TOKEN"],
      body: `const { writeFileSync } = await import("node:fs");
  ctx.state.set("x", 1);
  ctx.log.info("hola desde scheduled");
  writeFileSync(${JSON.stringify(out)}, JSON.stringify({ token: ctx.secrets.get("HELLO_TOKEN"), other: ctx.secrets.get("OTHER_TOKEN") ?? null, lines: ctx.lines }));`,
      other: `export async function pass(ctx) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(${JSON.stringify(`${out}.pass`)}, JSON.stringify(ctx.state.get("x")));
}`,
    });
    const ctx = await factory(dir);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: "abc", OTHER_TOKEN: "no" });
    await scheduledPass(ctx, at(8));
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ token: "abc", other: null, lines: ["web"] });
    expect(info.mock.calls.some(([m]) => m.includes("hola desde scheduled"))).toBe(true);
    await packagesPass(ctx, fakeAgents({}).runner, at(8, 1));
    expect(JSON.parse(readFileSync(`${out}.pass`, "utf8"))).toBe(1);
  });

  it("waits for a missing secret, unmarked, and runs if it appears within 2 hours", async () => {
    warnings();
    const { dir, calls } = stationPackage({ schedule: ["08:00"], secrets: ["HELLO_TOKEN"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(stationScheduleKey("hello", "nota", "08:00"))).toBeUndefined();
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: "abc" });
    await scheduledPass(ctx, at(9, 59));
    expect(calls()).toEqual(["08:00"]);
  });
});

describe("once per day", () => {
  it("runs once on two turns in a row", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    await scheduledPass(ctx, at(8, 1));
    expect(calls()).toEqual(["08:00"]);
  });

  it("runs again the next day", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    await scheduledPass(ctx, at(8, 0, 5));
    expect(calls()).toEqual(["08:00", "08:00"]);
  });

  it("does not retry one that failed", async () => {
    const warn = warnings();
    const { dir, calls } = stationPackage({ schedule: ["08:00"], body: `throw new Error("boom");` });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    await scheduledPass(ctx, at(8, 1));
    expect(calls()).toEqual(["08:00"]);
    expect(JSON.stringify(warn.mock.calls)).toContain("boom");
  });

  it("aborts one that hangs, warns, goes on and does not repeat it", async () => {
    const warn = warnings();
    const seen = join(tempDir("zero-shared-"), "aborted.txt");
    const hung = stationPackage({
      name: "colgada",
      schedule: ["08:00"],
      timeoutMinutes: 0.001,
      body: `const { writeFileSync } = await import("node:fs");
  const told = () => writeFileSync(${JSON.stringify(seen)}, "aborted");
  // On a busy machine its time can run out before it gets here: the signal is already aborted.
  if (ctx.signal.aborted) told();
  else ctx.signal.addEventListener("abort", told);
  await new Promise(() => {});`,
    });
    const good = stationPackage({ name: "buena", schedule: ["08:00"] });
    const ctx = await factory([hung.dir, good.dir]);
    await scheduledPass(ctx, at(8));
    await vi.waitFor(() => expect(existsSync(seen)).toBe(true), { timeout: 10_000 });
    expect(warn.mock.calls.some(([m]) => m.includes("colgada/nota") && m.includes("tiempo"))).toBe(true);
    expect(good.calls()).toEqual(["08:00"]);
    await scheduledPass(ctx, at(8, 1));
    expect(hung.calls()).toEqual(["08:00"]);
  });

  it("counts each time on its own", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00", "12:00"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    await scheduledPass(ctx, at(12));
    expect(calls()).toEqual(["08:00", "12:00"]);
  });

  it("keeps its mark where ctx.state cannot reach", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"], body: `ctx.state.set("schedule:08:00", null); ctx.state.set(":schedule:08:00", null);` });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    await scheduledPass(ctx, at(8, 1));
    expect(calls()).toEqual(["08:00"]);
    expect(ctx.store.getKv(stationScheduleKey("hello", "nota", "08:00"))).toBe("2026-11-04");
  });
});

describe("catching up", () => {
  it("runs exactly 2 hours late", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    await scheduledPass(await factory(dir), at(10));
    expect(calls()).toEqual(["08:00"]);
  });

  it("does not run later than that", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    await scheduledPass(await factory(dir), at(10, 1));
    expect(calls()).toEqual([]);
  });

  it("crosses midnight, once", async () => {
    const { dir, calls } = stationPackage({ schedule: ["23:30"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(0, 30, 5));
    await scheduledPass(ctx, at(0, 31, 5));
    expect(calls()).toEqual(["23:30"]);
    // That day's own time is still ahead.
    await scheduledPass(ctx, at(23, 30, 5));
    expect(calls()).toEqual(["23:30", "23:30"]);
  });

  it("runs several late ones, oldest first, whatever the manifest's order", async () => {
    const { dir, calls } = stationPackage({ schedule: ["09:00", "08:00"] });
    await scheduledPass(await factory(dir), at(9, 30));
    expect(calls()).toEqual(["08:00", "09:00"]);
  });
});

describe("the andon", () => {
  it("starts nothing and leaves the time unmarked", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    ctx.store.setKv(ANDON_KEY, "on");
    await scheduledPass(ctx, at(8));
    expect(calls()).toEqual([]);
    expect(ctx.store.getKv(stationScheduleKey("hello", "nota", "08:00"))).toBeUndefined();
  });

  it("lets the time run if it goes off soon enough", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    ctx.store.setKv(ANDON_KEY, "on");
    await scheduledPass(ctx, at(8));
    ctx.store.deleteKv(ANDON_KEY);
    await scheduledPass(ctx, at(9));
    expect(calls()).toEqual(["08:00"]);
  });
});

describe("pass", () => {
  it("keeps its own period, and packagesPass never calls scheduled", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    await scheduledPass(ctx, at(8));
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeUndefined();
    await packagesPass(ctx, fakeAgents({}).runner, at(8, 1));
    expect(calls()).toEqual(["08:00", "pass"]);
  });

  it("does not run with a job queued", async () => {
    const { dir, calls } = stationPackage({ schedule: ["08:00"] });
    const ctx = await factory(dir);
    requestWork(ctx, { text: "algo" });
    await packagesPass(ctx, fakeAgents({}).runner, at(8));
    expect(calls()).toEqual([]);
  });

  it("may be missing from a station with a schedule, silently", async () => {
    const warn = warnings();
    const { dir } = stationPackage({ schedule: ["08:00"], other: "" });
    const ctx = await factory(dir);
    await expect(packagesPass(ctx, fakeAgents({}).runner, at(8))).resolves.toBeUndefined();
    expect(warn.mock.calls.filter(([m]) => m.includes("hello/nota"))).toEqual([]);
  });

  it("is still asked of a station without a schedule", async () => {
    const warn = warnings();
    const { dir } = stationPackage({ name: "sinpass", other: "" });
    const ctx = await factory(dir);
    await packagesPass(ctx, fakeAgents({}).runner, at(8));
    expect(warn.mock.calls.some(([m]) => m.includes("sinpass/nota") && m.includes("pass"))).toBe(true);
  });
});
