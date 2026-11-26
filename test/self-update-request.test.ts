import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAUNCH_KEY, requestUpdate, requestWork, SHUTDOWN_KEY, waitUpdate, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { acquireSwitchLock, resultPath } from "../src/self-update-switch.js";
import {
  CHECK_EVERY_MS,
  importSwitchResult,
  readSelfUpdate,
  readSelfUpdateLook,
  readUpdateRequest,
  readUpdateRun,
  recordSelfUpdate,
  selfUpdateCheck,
  UPDATE_REQUEST_KEY,
  UPDATE_RUN_KEY,
  type SelfUpdateDeps,
  type UpdateRunRecord,
} from "../src/self-update.js";
import { cleanup, fakeAgents, gitIn, gitRepo, testFactory } from "./helpers.js";
import { configure, installation } from "./installation.js";

afterEach(cleanup);

const MINUTE = 60_000;
const AT = new Date("2026-11-11T10:00:00.000Z");
const ASKED = AT.toISOString();

const ask = (ctx: FactoryContext) => {
  const r = requestUpdate(ctx, AT);
  if (!r.ok) throw new Error(r.reason);
};

/** One pass of the daemon with a fake switch; the commits it was launched for. */
async function daemon(ctx: FactoryContext, deps: SelfUpdateDeps): Promise<string[]> {
  const launched: string[] = [];
  await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: deps, launchSwitch: async (_, s) => void launched.push(s.to ?? ""), agentRunner: () => fakeAgents({}).runner });
  return launched;
}

describe("an update on request", () => {
  it("prepares and switches with automatic updates off and no channel", async () => {
    const z = installation();
    const from = z.head();
    const to = z.merged("a");
    const ctx = z.factory();
    ask(ctx);
    expect(await daemon(ctx, z.deps)).toEqual([]);
    expect(readUpdateRequest(ctx.store)).toBeUndefined();
    expect(readUpdateRun(ctx.store)).toEqual({ asked: ASKED, startedAt: ASKED, target: { commit: to }, outcome: "ready", endedAt: ASKED });
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", from, to, onDemand: true });
    const fetches = z.fetches();
    expect(await daemon(ctx, z.deps)).toEqual([to]);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "switching", to, onDemand: true });
    expect(z.fetches()).toBe(fetches);
    expect(z.calls.some((c) => c.args[0] === "ls-remote")).toBe(false);
  });

  it("takes the newest release in estable, without waiting for the next look", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    const ctx = z.factory({ channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const to = z.merged("a");
    z.release("1.1.0", to);
    z.merged("b");
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to, channel: "estable", onDemand: true });
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "ready", target: { commit: to, version: "1.1.0" } });
    // Nor is it dropped by the next pass, which only looks.
    z.later(MINUTE);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to });
  });

  it("waits for the running job and lets no other one start", async () => {
    const z = installation();
    const to = z.merged("a");
    const ctx = testFactory({ isolation: "worktree", concurrency: 2, lines: ["uno", "dos"].map((name) => ({ name, repo: gitRepo(), verify: [] })) }, () => z.clock.at);
    requestWork(ctx, { text: "primero", line: "uno" });
    const launched: string[] = [];
    let second = "";
    const during = { launched: -1, status: "" };
    const agents = fakeAgents({
      spec: async (_, n) => {
        if (n > 1) return { ok: false };
        ask(ctx);
        await vi.waitFor(() => expect(readSelfUpdate(ctx.store).state.status).toBe("ready"), { timeout: 40_000 });
        second = requestWork(ctx, { text: "segundo", line: "dos" }).job.id;
        await new Promise((r) => setTimeout(r, 300));
        during.launched = launched.length;
        during.status = ctx.store.getJob(second)!.status;
        return { ok: false };
      },
    });
    await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: z.deps, launchSwitch: async (_, s) => void launched.push(s.to ?? ""), agentRunner: () => agents.runner });
    expect(during).toEqual({ launched: 0, status: "queued" });
    expect(launched).toEqual([to]);
    expect(ctx.store.getJob(second)!.status).toBe("queued");
  }, 90_000);

  it("ends up to date when there is nothing new, and is consumed once", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    for (const channel of ["estable", "ultimo", undefined]) {
      const ctx = z.factory(channel ? { channel } : undefined);
      ask(ctx);
      await selfUpdateCheck(ctx, z.deps);
      expect(readUpdateRun(ctx.store)).toEqual({ asked: ASKED, startedAt: ASKED, outcome: "up-to-date", endedAt: ASKED });
      expect(readUpdateRequest(ctx.store)).toBeUndefined();
      const calls = z.calls.length;
      configure(ctx, { channel: undefined });
      await selfUpdateCheck(ctx, z.deps);
      expect(z.calls.length).toBe(calls);
    }
    expect(z.built()).toBe(0);
  });

  it("says why a stable installation stays where it is", async () => {
    const z = installation();
    z.merged("a");
    const ctx = z.factory({ channel: "estable" });
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "up-to-date", reason: expect.stringContaining("no hay versiones liberadas") });
    z.release("1.0.0", z.head());
    gitIn(z.install, "pull", "-q");
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "up-to-date", reason: expect.stringContaining("v1.0.0") });
    expect(z.built()).toBe(0);
  });

  it("ends failed with its reason, leaving no problem where nothing looks again", async () => {
    const z = installation();
    z.merged("a");
    const ctx = z.factory();
    z.fail.remote = true;
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "failed", reason: expect.stringContaining("sin red"), endedAt: ASKED });
    expect(readSelfUpdate(ctx.store).state.problem).toBeUndefined();
    z.fail.remote = false;
    writeFileSync(join(z.install, "package.json"), "{}\n");
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "failed", reason: expect.stringContaining("cambios locales") });
    const stable = z.factory({ channel: "estable" });
    z.release("1.1.0", z.elsewhere("otra"));
    ask(stable);
    await selfUpdateCheck(stable, z.deps);
    expect(readUpdateRun(stable.store)).toMatchObject({ outcome: "failed", reason: expect.stringContaining("v1.1.0") });
    expect(readSelfUpdate(stable.store).state.problem).toContain("v1.1.0");
    expect(z.built()).toBe(0);
  });

  it("switches to a version that was already ready without preparing it again", async () => {
    const z = installation();
    const to = z.merged("a");
    z.release("1.1.0", to);
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const built = z.built();
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "ready", target: { commit: to, version: "1.1.0" } });
    // It was asked for, so turning automatic updates off does not drop it.
    configure(ctx, { enabled: false });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to, onDemand: true });
    expect(z.built()).toBe(built);
  });

  it("leaves alone a switch launched while it was looking", async () => {
    const z = installation();
    const to = z.merged("a");
    const ctx = z.factory({ enabled: true });
    await selfUpdateCheck(ctx, z.deps);
    ask(ctx);
    expect(await daemon(ctx, z.deps)).toEqual([to]);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "switching", to });
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "ready", target: { commit: to } });
  });

  it.each([false, true])("uses what automatic updates left ready only while the installation is the same (moved: %s)", async (moved) => {
    const z = installation();
    const old = z.merged("a");
    const ctx = z.factory({ enabled: true });
    await selfUpdateCheck(ctx, z.deps);
    const built = z.built();
    configure(ctx, { enabled: false });
    const byHand = moved ? z.merged("b") : undefined;
    if (moved) gitIn(z.install, "pull", "-q");
    const to = moved ? z.merged("c") : old;
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to, onDemand: true, ...(byHand && { from: byHand }) });
    expect(z.built() > built).toBe(moved);
  });

  it("looks for a newer version when the ready one was put in place by hand", async () => {
    const z = installation();
    z.merged("a");
    const ctx = z.factory({ enabled: true });
    await selfUpdateCheck(ctx, z.deps);
    gitIn(z.install, "pull", "-q");
    const to = z.merged("b");
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to });
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "ready", target: { commit: to } });
  });

  it("drops a version asked for when the channel changes, also back to none", async () => {
    const z = installation();
    z.release("1.1.0", z.merged("a"));
    const ctx = z.factory({ channel: "estable" });
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    const { dir } = readSelfUpdate(ctx.store).state;
    expect(existsSync(dir!)).toBe(true);
    configure(ctx, { channel: undefined });
    const calls = z.calls.length;
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.status).toBe("idle");
    expect(existsSync(dir!)).toBe(false);
    expect(z.calls.length).toBe(calls);
  });

  it("stays pending while a switch is under way", async () => {
    const z = installation();
    const ctx = z.factory();
    ask(ctx);
    recordSelfUpdate(ctx.store, { state: { status: "switching", switchingAt: ASKED } });
    await selfUpdateCheck(ctx, z.deps);
    recordSelfUpdate(ctx.store, { state: { status: "idle" } });
    const lock = acquireSwitchLock(ctx.home.root)!;
    await selfUpdateCheck(ctx, z.deps);
    lock.release();
    expect(readUpdateRequest(ctx.store)).toEqual({ requestedAt: ASKED });
    expect(readUpdateRun(ctx.store)).toBeUndefined();
    expect(z.calls).toEqual([]);
  });

  it("does not wait for the check's interval in a running daemon", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    const ctx = z.factory({ channel: "estable" });
    const done = runDaemon(ctx, {
      pollMs: 10,
      panel: false,
      scout: false,
      unjam: false,
      urgentUnjam: false,
      unjamOnDemand: false,
      research: false,
      researchOnDemand: false,
      recruit: false,
      packages: false,
      packageUpdates: false,
      autostart: () => ({ status: "unchanged" }) as never,
      install: { root: z.install, git: async () => "" },
      selfUpdate: z.deps,
      launchSwitch: async () => undefined,
      agentRunner: () => fakeAgents({}).runner,
    });
    await vi.waitFor(() => expect(readSelfUpdateLook(ctx.store)).toBeDefined(), { timeout: 20_000 });
    ask(ctx);
    await vi.waitFor(() => expect(readUpdateRun(ctx.store)?.outcome).toBe("up-to-date"), { timeout: 20_000 });
    ctx.store.setKv(SHUTDOWN_KEY, ASKED);
    await done;
  }, 60_000);

  it("closes a run without an end when the daemon starts, and does not repeat it", async () => {
    const z = installation();
    z.merged("a");
    const ctx = z.factory();
    ctx.store.setKv(UPDATE_RUN_KEY, JSON.stringify({ asked: ASKED, startedAt: ASKED }));
    await daemon(ctx, z.deps);
    expect(readUpdateRun(ctx.store)).toEqual({ asked: ASKED, startedAt: ASKED, endedAt: ASKED, outcome: "stopped", reason: "la fábrica se cerró antes de que terminara" });
    expect(z.calls).toEqual([]);
  });

  it("goes back to idle, and is not tried again on its own, when its switch cannot be launched", async () => {
    const z = installation();
    const to = z.merged("a");
    const ctx = z.factory();
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    let launched = 0;
    const launchSwitch = async () => {
      launched++;
      throw new Error("EBUSY: resource busy");
    };
    await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: z.deps, launchSwitch, agentRunner: () => fakeAgents({}).runner });
    const { state, history } = readSelfUpdate(ctx.store);
    expect(launched).toBe(1);
    expect(state.status).toBe("idle");
    expect(state.onDemand).toBeUndefined();
    expect(state.retry).toBeUndefined();
    expect(history).toMatchObject([{ to, outcome: "failed" }]);
  });
});

describe("a version that failed before", () => {
  it("is prepared once more when asked for, and stays failed if it fails again", async () => {
    const z = installation();
    const to = z.merged("a");
    const ctx = z.factory({ enabled: true });
    z.fail.npm = "npm run build: falló";
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.failed).toEqual([to]);
    const built = z.built();
    z.later(CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.built()).toBe(built);
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.built()).toBe(built * 2);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "idle", failed: [to] });
    expect(readUpdateRun(ctx.store)).toMatchObject({ outcome: "failed", target: { commit: to }, reason: expect.stringContaining("npm run build: falló") });
    z.later(CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.built()).toBe(built * 2);
    z.fail.npm = undefined;
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to, onDemand: true });
  });

  it("does not wait for its machine retry when asked for, and schedules none with automatic updates off", async () => {
    const z = installation();
    const to = z.merged("a");
    const ctx = z.factory({ enabled: true });
    z.fail.npm = "EBUSY: resource busy";
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.retry?.commit).toBe(to);
    const built = z.built();
    z.later(MINUTE);
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.built()).toBe(built * 2);
    const off = z.factory();
    ask(off);
    await selfUpdateCheck(off, z.deps);
    expect(readUpdateRun(off.store)).toMatchObject({ outcome: "failed", reason: expect.stringContaining("EBUSY") });
    expect(readSelfUpdate(off.store).state.retry).toBeUndefined();
    expect(readSelfUpdate(off.store).state.failed).toBeUndefined();
  });

  it("schedules no retry either when the switch of a version asked for failed for the machine", async () => {
    const z = installation();
    const to = z.merged("a");
    const ctx = z.factory();
    ask(ctx);
    await selfUpdateCheck(ctx, z.deps);
    const { state } = readSelfUpdate(ctx.store);
    recordSelfUpdate(ctx.store, { state: { ...state, status: "switching", switchingAt: ASKED } });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from: state.from, to, at: ASKED, outcome: "failed", reason: "EBUSY", machine: true }));
    await importSwitchResult(ctx);
    const after = readSelfUpdate(ctx.store).state;
    expect(after).toMatchObject({ status: "idle", problem: "EBUSY" });
    expect(after.retry).toBeUndefined();
    expect(after.onDemand).toBeUndefined();
  });
});

describe("zero actualizar", () => {
  const run = (ctx: FactoryContext, over: Partial<UpdateRunRecord>) => ctx.store.setKv(UPDATE_RUN_KEY, JSON.stringify({ asked: ASKED, startedAt: ASKED, ...over }));
  /** The environment of a `zero` process on that factory, which takes the daemon for being on its way. */
  const env = (ctx: FactoryContext) => {
    ctx.store.setKv(LAUNCH_KEY, new Date(Date.now() + 600_000).toISOString());
    return { ...process.env, ZERO_HOME: ctx.home.root };
  };

  it("records one request and refuses another while it is pending", () => {
    const ctx = testFactory({});
    expect(requestUpdate(ctx, AT)).toMatchObject({ ok: true, requestedAt: ASKED, text: expect.stringContaining("canal ultimo") });
    expect(requestUpdate(ctx, new Date(AT.getTime() + MINUTE))).toEqual({ ok: false, reason: `ya hay una actualización pendiente, pedida el ${ASKED}` });
    expect(readUpdateRequest(ctx.store)).toEqual({ requestedAt: ASKED });
  });

  it("refuses while a switch is under way", () => {
    const ctx = testFactory({});
    const refused = { ok: false, reason: expect.stringContaining("cambio de versión en curso") };
    recordSelfUpdate(ctx.store, { state: { status: "switching", switchingAt: ASKED } });
    expect(requestUpdate(ctx, AT)).toMatchObject(refused);
    recordSelfUpdate(ctx.store, { state: { status: "idle" } });
    const lock = acquireSwitchLock(ctx.home.root)!;
    expect(requestUpdate(ctx, AT)).toMatchObject(refused);
    lock.release();
    expect(readUpdateRequest(ctx.store)).toBeUndefined();
    expect(requestUpdate(ctx, AT).ok).toBe(true);
  });

  it("tells what the pass found while it waits", async () => {
    const ctx = testFactory({});
    const commit = "a".repeat(40);
    const now = { timeoutMs: 0 };
    let polls = 0;
    const sleep = async () => {
      if (++polls === 2) run(ctx, { target: { commit, version: "1.1.0" } });
    };
    const found = await waitUpdate(ctx, ASKED, { timeoutMs: 120_000, sleep });
    expect(found.ok).toBe(true);
    expect(found.text).toMatch(/^Preparando la versión v1\.1\.0 .*cuando no haya trabajos corriendo/);
    run(ctx, { target: { commit }, outcome: "ready", endedAt: ASKED });
    expect(await waitUpdate(ctx, ASKED, now)).toEqual({ ok: true, text: `La versión ${commit.slice(0, 12)} está lista: la fábrica cambia a ella cuando no haya trabajos corriendo.` });
    run(ctx, { outcome: "up-to-date", endedAt: ASKED });
    expect(await waitUpdate(ctx, ASKED, now)).toEqual({ ok: true, text: "No hay una versión nueva: la instalación ya está al día." });
    run(ctx, { target: { commit }, outcome: "failed", reason: "sin red", endedAt: ASKED });
    expect(await waitUpdate(ctx, ASKED, now)).toEqual({ ok: false, text: "No se pudo actualizar: sin red." });
    run(ctx, { outcome: "stopped", reason: "se cerró", endedAt: ASKED });
    expect(await waitUpdate(ctx, ASKED, now)).toMatchObject({ ok: true, text: expect.stringContaining("se cerró") });
  });

  it("says it is still pending past the limit, also with the record of an earlier one", async () => {
    const ctx = testFactory({});
    run(ctx, { asked: "2026-11-10T10:00:00.000Z", outcome: "up-to-date", endedAt: ASKED });
    let waited = 0;
    const r = await waitUpdate(ctx, ASKED, { timeoutMs: 120_000, sleep: async (ms) => void (waited += ms) });
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining("sigue pendiente") });
    expect(waited).toBe(120_000);
  });

  it("exits 1 when it is refused, changing nothing", () => {
    const ctx = testFactory({});
    ask(ctx);
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "actualizar"], { encoding: "utf8", env: env(ctx), input: "", windowsHide: true });
    expect(r.stdout).toContain("ya hay una actualización pendiente");
    expect(r.status).toBe(1);
    expect(readUpdateRequest(ctx.store)).toEqual({ requestedAt: ASKED });
  }, 60_000);

  it.each([
    { end: { target: { commit: "a".repeat(40), version: "1.1.0" } }, says: /v1\.1\.0 .*cuando no haya trabajos corriendo/, code: 0 },
    { end: { outcome: "failed" as const, reason: "sin red", endedAt: ASKED }, says: /sin red/, code: 1 },
  ])("exits $code once the pass says what it found", async ({ end, says, code }) => {
    const ctx = testFactory({});
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "actualizar"], { env: env(ctx), windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    const closed = new Promise<number | null>((done) => child.once("close", done));
    await vi.waitFor(() => expect(readUpdateRequest(ctx.store)).toBeDefined(), { timeout: 30_000 });
    const { requestedAt } = readUpdateRequest(ctx.store)!;
    ctx.store.deleteKv(UPDATE_REQUEST_KEY);
    run(ctx, { asked: requestedAt, ...end });
    expect(await closed).toBe(code);
    expect(out).toMatch(says);
  }, 90_000);

  it("is in the usage text", () => {
    expect(readFileSync("src/cli.ts", "utf8")).toMatch(/^  zero actualizar  /m);
  });
});
