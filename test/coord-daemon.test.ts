import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, joinFactory } from "../src/app.js";
import { MACHINES_KEY, PROBE_KEY, coordPass, coordReady, readMachines, readProbe } from "../src/coord/pass.js";
import { machineRef, memoryCoord, type MachineView } from "../src/coord/protocol.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { HALT_KEY } from "../src/github-quota.js";
import { MACHINE_ID_KEY } from "../src/machine.js";
import { overviewPage } from "../src/panel/html.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const DISTRIBUTED = { repository: "me/zero-coord", machine: "pc-vieja" };
const coordKeys = (ctx: ReturnType<typeof testFactory>) => ctx.store.kvWithPrefix("coord:").map(([k]) => k);

describe("coordination pass in the daemon", () => {
  it("sends nothing and writes no coord key without distributed", async () => {
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "demo", repo: gitRepo() }] });
    const api = memoryCoord();
    await runDaemon(ctx, { once: true, pollMs: 10, coord: () => api });
    expect(api.calls).toEqual([]);
    expect(coordKeys(ctx)).toEqual([]);
  });

  it("writes this machine's heartbeat and stores it as alive", async () => {
    const ctx = testFactory({ isolation: "worktree", distributed: DISTRIBUTED, lines: [{ name: "demo", repo: gitRepo() }] });
    const api = memoryCoord();
    const asked: string[] = [];
    await runDaemon(ctx, {
      once: true,
      pollMs: 10,
      coord: (repository) => {
        asked.push(repository);
        return api;
      },
    });
    const id = ctx.store.getKv(MACHINE_ID_KEY)!;
    expect(asked[0]).toBe("me/zero-coord");
    expect(api.refs.has(machineRef(id))).toBe(true);
    const machines = readMachines(ctx.store)!;
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({ id, name: "pc-vieja", alive: true, jobs: [] });
  });

  it("skips its turn while GitHub holds a pause", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const ctx = testFactory({ isolation: "worktree", distributed: DISTRIBUTED, lines: [] }, () => now);
    ctx.store.setKv(HALT_KEY, JSON.stringify({ until: "2026-11-15T11:00:00Z", why: "límite" }));
    const api = memoryCoord();
    expect(await coordPass(ctx, api, undefined, now)).toBeUndefined();
    await runDaemon(ctx, { once: true, pollMs: 10, coord: () => api });
    expect(api.calls).toEqual([]);
    expect(ctx.store.getKv(MACHINES_KEY)).toBeUndefined();
  });
});

describe("probe of the coordination repository", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
  const probes = (api: ReturnType<typeof memoryCoord>) => api.calls.filter((c) => c.startsWith("create probe/"));

  it("stores a passed probe once and leaves no probe ref", async () => {
    const ctx = testFactory({ isolation: "worktree", distributed: DISTRIBUTED, lines: [] }, () => now);
    const api = memoryCoord();
    expect(coordReady(ctx)).toBe(false);
    await coordPass(ctx, api, undefined, now);
    expect(readProbe(ctx.store)).toEqual({ repository: "me/zero-coord", at: now.toISOString(), ok: true });
    expect([...api.refs.keys()].some((k) => k.startsWith("probe/"))).toBe(false);
    expect(coordReady(ctx)).toBe(true);
    await coordPass(ctx, api, undefined, minutes(120));
    expect(probes(api)).toHaveLength(2);
  });

  it("stores a failed probe and tries again only after an hour", async () => {
    const ctx = testFactory({ isolation: "worktree", distributed: DISTRIBUTED, lines: [] }, () => now);
    const api = memoryCoord();
    // A backend whose create accepts a ref that already exists.
    api.create = async (name, data) => {
      api.calls.push(`create ${name}`);
      return api.write(name, data);
    };
    await coordPass(ctx, api, undefined, now);
    const probe = readProbe(ctx.store)!;
    expect(probe).toMatchObject({ repository: "me/zero-coord", ok: false, problem: expect.stringContaining("ya existe") });
    expect(coordReady(ctx)).toBe(false);
    const tried = probes(api).length;
    await coordPass(ctx, api, undefined, minutes(30));
    expect(probes(api)).toHaveLength(tried);
    await coordPass(ctx, api, undefined, minutes(61));
    expect(probes(api).length).toBeGreaterThan(tried);
  });

  it("is not ready for another repository than the one probed", async () => {
    const ctx = testFactory({ isolation: "worktree", distributed: DISTRIBUTED, lines: [] }, () => now);
    ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: "me/otro", at: now.toISOString(), ok: true }));
    expect(coordReady(ctx)).toBe(false);
    const api = memoryCoord();
    await coordPass(ctx, api, undefined, now);
    expect(readProbe(ctx.store)?.repository).toBe("me/zero-coord");
    expect(coordReady(ctx)).toBe(true);
  });

  it("is never ready without distributed", () => {
    const ctx = testFactory({ isolation: "worktree", lines: [] }, () => now);
    ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: "me/zero-coord", at: now.toISOString(), ok: true }));
    expect(coordReady(ctx)).toBe(false);
  });
});

describe("machines in status and panel", () => {
  const now = new Date("2026-11-15T10:00:00");
  const machines: MachineView[] = [
    { id: "a", name: "pc-vieja", at: new Date(now.getTime() - 60_000).toISOString(), capabilities: { platform: "win32", box: false, engines: ["claude"] }, jobs: ["abc12345"], alive: true },
    { id: "b", name: "mac", at: new Date(now.getTime() - 20 * 60_000).toISOString(), capabilities: { platform: "darwin", box: true, engines: ["claude"] }, jobs: [], alive: false },
  ];

  it("shows one line per machine", () => {
    const ctx = testFactory({ isolation: "worktree", distributed: DISTRIBUTED, lines: [] }, () => now);
    ctx.store.setKv(MACHINES_KEY, JSON.stringify(machines));
    const status = factoryStatus(ctx);
    expect(status.machines).toHaveLength(2);
    const text = formatStatus(status, now);
    expect(text).toContain("Máquinas:");
    const lines = text.split("\n");
    expect(lines.find((l) => l.includes("pc-vieja"))).toMatch(/viva.*09:59.*abc12345/);
    expect(lines.find((l) => l.includes("mac ·"))).toContain("caída");
    const html = overviewPage(status, [], "n");
    expect(html).toContain("Máquinas:");
    expect(html).toContain("pc-vieja");
    expect(html).toContain("caída");
  });

  it("shows no block without distributed", () => {
    const ctx = testFactory({ isolation: "worktree", lines: [] }, () => now);
    ctx.store.setKv(MACHINES_KEY, JSON.stringify(machines));
    const status = factoryStatus(ctx);
    expect(status.machines).toBeUndefined();
    expect(formatStatus(status, now)).not.toContain("Máquinas:");
    expect(overviewPage(status, [], "n")).not.toContain("Máquinas:");
  });
});

describe("zero unirse", () => {
  const file = (ctx: ReturnType<typeof testFactory>) => readFileSync(ctx.home.config, "utf8");

  it("writes the repository when it is private", async () => {
    const ctx = testFactory({ isolation: "worktree", lines: [] });
    const result = await joinFactory(ctx, "me/zero-coord", async () => ({ private: true }), { coord: () => memoryCoord() });
    expect(result.joined).toBe(true);
    expect(ctx.config.distributed).toMatchObject({ repository: "me/zero-coord", heartbeatSeconds: 60, leaseMinutes: 10 });
    expect(file(ctx)).toMatch(/distributed:\s*\n\s+repository: me\/zero-coord/);
  });

  it("refuses a public repository, an unreadable one and a bad name, writing nothing", async () => {
    const ctx = testFactory({ isolation: "worktree", lines: [] });
    const before = file(ctx);
    const pub = await joinFactory(ctx, "me/zero-coord", async () => ({ private: false }));
    expect(pub.joined).toBe(false);
    expect(pub.text).toContain("público");
    const unreadable = await joinFactory(ctx, "me/zero-coord", async () => {
      throw new Error("Not Found");
    });
    expect(unreadable.joined).toBe(false);
    let checked = false;
    const bad = await joinFactory(ctx, "zero-coord", async () => {
      checked = true;
      return { private: true };
    });
    expect(bad.joined).toBe(false);
    expect(checked).toBe(false);
    expect(file(ctx)).toBe(before);
    expect(ctx.config.distributed).toBeUndefined();
  });
});
