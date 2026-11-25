import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork, type FactoryContext } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { mergeKey } from "../src/line/automerge.js";
import { resultPath } from "../src/self-update-switch.js";
import {
  CHECK_EVERY_MS,
  importSwitchResult,
  readSelfUpdate,
  readSelfUpdateLook,
  recordSelfUpdate,
  RETRY_FIRST_MS,
  SELF_UPDATE_LOOK_KEY,
  SELF_UPDATE_STATE_KEY,
  selfUpdateCheck,
  STABLE_CHECK_EVERY_MS,
} from "../src/self-update.js";
import { cleanup, fakeAgents, gitIn } from "./helpers.js";
import { configure, installation } from "./installation.js";

afterEach(cleanup);

const MINUTE = 60_000;

describe("the channel in the factory file", () => {
  it("is absent by default, takes estable and ultimo, and refuses anything else", () => {
    expect(parseFactory("lines: []\n").selfUpdate).toEqual({ enabled: false, remote: "origin", startTimeoutSeconds: 120 });
    expect(parseFactory("selfUpdate: { channel: estable }\n").selfUpdate).toMatchObject({ channel: "estable", enabled: false });
    expect(parseFactory("selfUpdate: { channel: ultimo }\n").selfUpdate.channel).toBe("ultimo");
    expect(() => parseFactory("selfUpdate: { channel: beta }\n")).toThrow();
  });
});

describe("without a channel", () => {
  it("runs no git and records nothing while it is off", async () => {
    const z = installation();
    const ctx = z.factory();
    z.release("1.1.0", z.merged("a"));
    await selfUpdateCheck(ctx, z.deps);
    await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: z.deps, launchSwitch: async () => undefined, agentRunner: () => fakeAgents({}).runner });
    expect(z.calls).toEqual([]);
    expect(ctx.store.getKv(SELF_UPDATE_STATE_KEY)).toBeUndefined();
    expect(ctx.store.getKv(SELF_UPDATE_LOOK_KEY)).toBeUndefined();
  });

  it("prepares the branch tip without asking for releases or keeping a look", async () => {
    const z = installation();
    const from = z.head();
    const tip = z.merged("a");
    const ctx = z.factory({ enabled: true });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toEqual({ status: "ready", from, to: tip, dir: join(ctx.home.root, "self-update", tip.slice(0, 12)), checkedAt: z.clock.at.toISOString(), head: from });
    expect(z.calls.some((c) => c.args[0] === "ls-remote")).toBe(false);
    expect(ctx.store.getKv(SELF_UPDATE_LOOK_KEY)).toBeUndefined();
  });
});

describe("the stable channel", () => {
  it("ignores what was not released", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    z.merged("a");
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toEqual({ status: "idle", checkedAt: z.clock.at.toISOString(), head: z.head(), channel: "estable" });
    expect(readSelfUpdateLook(ctx.store)).toEqual({ channel: "estable", checkedAt: z.clock.at.toISOString(), head: z.head(), version: "1.0.0" });
    expect(z.built()).toBe(0);
  });

  it("prepares the newest release, not the branch tip", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    const released = z.merged("a");
    z.release("1.1.0", released);
    z.merged("b");
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const dir = join(ctx.home.root, "self-update", released.slice(0, 12));
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to: released, dir, channel: "estable" });
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(released);
    expect(readSelfUpdateLook(ctx.store)).toMatchObject({ version: "1.0.0", available: { commit: released, version: "1.1.0" } });
  });

  it("refuses a release that is not in the branch, naming it", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    z.release("1.1.0", z.elsewhere("otra"));
    for (const enabled of [true, false]) {
      const ctx = z.factory({ enabled, channel: "estable" });
      await selfUpdateCheck(ctx, z.deps);
      const { state } = readSelfUpdate(ctx.store);
      expect(state.status).toBe("idle");
      expect(state.problem).toContain("v1.1.0");
      expect(readSelfUpdateLook(ctx.store)?.available).toBeUndefined();
    }
    expect(z.built()).toBe(0);
  });

  it("refuses a release that is not a fast-forward", async () => {
    const z = installation();
    z.release("1.1.0", z.merged("a"));
    gitIn(z.install, "commit", "-q", "--allow-empty", "-m", "local");
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.problem).toMatch(/v1\.1\.0 .*no es un avance rápido/);
    expect(readSelfUpdateLook(ctx.store)?.available).toBeUndefined();
    expect(z.built()).toBe(0);
  });

  it("stays where it is when it is past the newest release, or there is none", async () => {
    const z = installation();
    const ctx = z.factory({ enabled: true, channel: "estable" });
    z.merged("a");
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toEqual({ status: "idle", checkedAt: z.clock.at.toISOString(), head: z.head(), channel: "estable" });
    z.release("1.0.0", z.head());
    gitIn(z.install, "pull", "-q");
    const other = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(other, z.deps);
    expect(readSelfUpdate(other.store).state).toEqual({ status: "idle", checkedAt: z.clock.at.toISOString(), head: z.head(), channel: "estable" });
    expect(readSelfUpdateLook(other.store)).toEqual({ channel: "estable", checkedAt: z.clock.at.toISOString(), head: z.head() });
    expect(z.built()).toBe(0);
  });

  it("holds back an update over local changes, but not the look", async () => {
    const z = installation();
    const released = z.merged("a");
    z.release("1.1.0", released);
    writeFileSync(join(z.install, "package.json"), "{}\n");
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "idle", problem: expect.stringContaining("cambios locales") });
    expect(readSelfUpdateLook(ctx.store)?.available).toEqual({ commit: released, version: "1.1.0" });
    expect(z.built()).toBe(0);
  });

  it("keeps the last look when the remote does not answer", async () => {
    const z = installation();
    z.release("1.1.0", z.merged("a"));
    const ctx = z.factory({ channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const look = readSelfUpdateLook(ctx.store);
    z.fail.remote = true;
    z.later(STABLE_CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.problem).toContain("sin red");
    expect(readSelfUpdateLook(ctx.store)).toEqual(look);
  });

  it("never prepares a failed release again, and looks for the next one", async () => {
    const z = installation();
    z.release("1.1.0", z.merged("a"));
    const ctx = z.factory({ enabled: true, channel: "estable" });
    z.fail.npm = "npm run build: falló";
    await selfUpdateCheck(ctx, z.deps);
    const built = z.built();
    z.fail.npm = undefined;
    z.later(STABLE_CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.built()).toBe(built);
    const next = z.merged("b");
    z.release("1.2.0", next);
    z.later(STABLE_CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to: next });
  });

  it("forgets the machine retry of a commit that is no longer the target", async () => {
    const z = installation();
    const released = z.merged("a");
    z.release("1.1.0", released);
    const ctx = z.factory({ enabled: true, channel: "estable" });
    z.fail.npm = "EBUSY: resource busy";
    recordSelfUpdate(ctx.store, { state: { status: "idle", retry: { commit: "f".repeat(40), at: z.clock.at.toISOString(), tries: 2 } } });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.retry).toEqual({ commit: released, at: new Date(z.clock.at.getTime() + RETRY_FIRST_MS).toISOString(), tries: 1 });
  });
});

describe("a channel without automatic updates", () => {
  it("only looks, once an hour in estable", async () => {
    const z = installation();
    const released = z.merged("a");
    z.release("1.1.0", released);
    const ctx = z.factory({ channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdateLook(ctx.store)).toEqual({ channel: "estable", checkedAt: z.clock.at.toISOString(), head: z.head(), available: { commit: released, version: "1.1.0" } });
    expect(readSelfUpdate(ctx.store)).toEqual({ state: { status: "idle", checkedAt: z.clock.at.toISOString(), head: z.head(), channel: "estable" }, history: [] });
    z.later(30 * MINUTE);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.fetches()).toBe(1);
    z.later(30 * MINUTE);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.fetches()).toBe(2);
    expect(z.built()).toBe(0);
  });

  it("asks no sooner for a pending retry, a merge or a remote that fails", async () => {
    const z = installation();
    const ctx = z.factory({ channel: "estable" });
    z.fail.remote = true;
    recordSelfUpdate(ctx.store, { state: { status: "idle", retry: { commit: "f".repeat(40), at: "2026-11-11T09:00:00Z", tries: 1 } } });
    await selfUpdateCheck(ctx, z.deps);
    const asked = z.calls.filter((c) => c.args[0] === "ls-remote").length;
    expect(asked).toBe(1);
    const job = ctx.store.createJob({ line: "zero", kind: "request", request: "x", budgetUsd: 3 });
    ctx.store.finishJob(job.id, "delivered");
    z.later(MINUTE);
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "merged" }));
    z.later(MINUTE);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.calls.filter((c) => c.args[0] === "ls-remote").length).toBe(asked);
  });

  it("looks at the branch tip at today's moments in ultimo", async () => {
    const z = installation();
    const tip = z.merged("a");
    const ctx = z.factory({ channel: "ultimo" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdateLook(ctx.store)).toEqual({ channel: "ultimo", checkedAt: z.clock.at.toISOString(), head: z.head(), available: { commit: tip } });
    z.later(STABLE_CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.fetches()).toBe(1);
    z.later(CHECK_EVERY_MS - STABLE_CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, z.deps);
    expect(z.fetches()).toBe(2);
    expect(z.built()).toBe(0);
  });

  it("looks at once when the channel changes", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    const tip = z.merged("a");
    const ctx = z.factory({ channel: "ultimo" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdateLook(ctx.store)?.available).toEqual({ commit: tip });
    configure(ctx, { channel: "estable" });
    z.later(MINUTE);
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdateLook(ctx.store)).toEqual({ channel: "estable", checkedAt: z.clock.at.toISOString(), head: z.head(), version: "1.0.0" });
  });

  it("drops a version left ready by automatic updates since turned off", async () => {
    const z = installation();
    const released = z.merged("a");
    z.release("1.1.0", released);
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const { dir } = readSelfUpdate(ctx.store).state;
    expect(existsSync(dir!)).toBe(true);
    configure(ctx, { enabled: false });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state.status).toBe("idle");
    expect(existsSync(dir!)).toBe(false);
    expect(readSelfUpdateLook(ctx.store)?.available?.commit).toBe(released);
  });

  it("runs as a pass of the daemon and never switches", async () => {
    const z = installation();
    z.release("1.1.0", z.merged("a"));
    const ctx = z.factory({ channel: "estable" });
    let switched = 0;
    await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: z.deps, launchSwitch: async () => void switched++, agentRunner: () => fakeAgents({}).runner });
    expect(readSelfUpdateLook(ctx.store)?.available?.version).toBe("1.1.0");
    expect(readSelfUpdate(ctx.store).state.status).toBe("idle");
    expect(switched).toBe(0);
    expect(z.built()).toBe(0);
  });
});

describe("a version prepared for another channel", () => {
  it("is dropped without switching, and jobs start as usual", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    const to = z.merged("a");
    const ctx = z.factory({ enabled: true, channel: "estable" });
    const dir = join(ctx.home.root, "self-update", to.slice(0, 12));
    mkdirSync(join(dir, "dist"), { recursive: true });
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: z.head(), to, dir, failed: ["f".repeat(40)] } });
    const job = requestWork(ctx, { text: "algo", line: "zero" }).job;
    const agents = fakeAgents({});
    let switched = 0;
    await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: z.deps, launchSwitch: async () => void switched++, agentRunner: () => agents.runner });
    expect(switched).toBe(0);
    expect(agents.calls.length).toBeGreaterThan(0);
    expect(ctx.store.getJob(job.id)!.status).not.toBe("queued");
    expect(readSelfUpdate(ctx.store).state.status).toBe("idle");
    expect(existsSync(dir)).toBe(false);
  });

  it("is kept when the channel only got its name", async () => {
    const z = installation();
    const ctx = z.factory({ enabled: true });
    const to = z.merged("a");
    await selfUpdateCheck(ctx, z.deps);
    configure(ctx, { channel: "ultimo" });
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "ready", to });
  });

  it("keeps the failed commits", async () => {
    const z = installation();
    const ctx = z.factory({ enabled: true, channel: "ultimo" });
    const failed = ["f".repeat(40)];
    z.merged("a");
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: z.head(), to: "e".repeat(40), dir: join(ctx.home.root, "self-update", "e"), channel: "estable", failed } });
    z.fail.remote = true;
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "idle", failed });
  });
});

describe("the look after an installation", () => {
  async function switched(outcome: "updated" | "rolled-back") {
    const z = installation();
    z.release("1.0.0", z.head());
    const from = z.head();
    const to = z.merged("a");
    z.release("1.1.0", to);
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const { state } = readSelfUpdate(ctx.store);
    recordSelfUpdate(ctx.store, { state: { ...state, status: "switching", switchingAt: z.clock.at.toISOString() } });
    mkdirSync(join(ctx.home.root, "self-update"), { recursive: true });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from, to, at: z.clock.at.toISOString(), outcome }));
    await importSwitchResult(ctx);
    return { z, ctx, from, to };
  }

  it("does not offer the version a switch just put in place", async () => {
    const { ctx, to } = await switched("updated");
    expect(readSelfUpdateLook(ctx.store)).toMatchObject({ head: to, version: "1.1.0" });
    expect(readSelfUpdateLook(ctx.store)?.available).toBeUndefined();
    expect(readSelfUpdate(ctx.store).state).toMatchObject({ status: "idle", channel: "estable" });
  });

  it("stays as it was after a rollback", async () => {
    const { ctx, from, to } = await switched("rolled-back");
    expect(readSelfUpdateLook(ctx.store)).toMatchObject({ head: from, version: "1.0.0", available: { commit: to, version: "1.1.0" } });
  });

  it("follows a prepared version put in place by hand", async () => {
    const z = installation();
    const to = z.merged("a");
    z.release("1.1.0", to);
    const ctx = z.factory({ enabled: true, channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    gitIn(z.install, "pull", "-q");
    await selfUpdateCheck(ctx, z.deps);
    expect(readSelfUpdate(ctx.store).state).toEqual({ status: "idle", checkedAt: z.clock.at.toISOString(), head: to, channel: "estable" });
    expect(readSelfUpdateLook(ctx.store)).toEqual({ channel: "estable", checkedAt: z.clock.at.toISOString(), head: to, version: "1.1.0" });
  });
});
