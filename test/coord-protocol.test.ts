import { describe, expect, it } from "vitest";
import { claimJob, claimRef, CoordConflict, heartbeat, listMachines, machineRef, memoryCoord, probeCoord, readClaimOf, releaseJob, stillHolds, type CoordApi } from "../src/coord/protocol.js";
import type { MachineCapabilities } from "../src/machine.js";

const A = { id: "id-a", name: "pc-vieja" };
const B = { id: "id-b", name: "notebook" };
const C = { id: "id-c", name: "mac" };
const caps: MachineCapabilities = { platform: "win32", box: false, engines: ["claude"] };
const t0 = new Date("2026-11-15T12:00:00Z");
const later = (minutes: number): Date => new Date(t0.getTime() + minutes * 60_000);

describe("memoryCoord", () => {
  it("refuses a second create and a move from an old tip", async () => {
    const api = memoryCoord();
    const sha = await api.create("x", "1");
    await expect(api.create("x", "2")).rejects.toBeInstanceOf(CoordConflict);
    await api.update("x", "3", sha);
    await expect(api.update("x", "4", sha)).rejects.toBeInstanceOf(CoordConflict);
    expect((await api.read("x"))?.data).toBe("3");
  });
});

describe("claimJob", () => {
  it("lets one of two racing machines take a job", async () => {
    const api = memoryCoord();
    const [a, b] = await Promise.all([claimJob(api, "job1", A, t0), claimJob(api, "job1", B, t0)]);
    const results = [a, b];
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const loser = results.find((r) => !r.claimed);
    const winner = a.claimed ? A : B;
    expect(loser).toEqual({ claimed: false, holder: expect.objectContaining({ machine: winner.id, name: winner.name, job: "job1" }) });
  });

  it("keeps a job whose holder beat within the lease", async () => {
    const api = memoryCoord();
    expect(await claimJob(api, "job1", A, t0)).toEqual({ claimed: true });
    await heartbeat(api, A, caps, ["job1"], later(10));
    const before = api.refs.get(claimRef("job1"));
    const result = await claimJob(api, "job1", B, later(11), 10);
    expect(result).toEqual({ claimed: false, holder: expect.objectContaining({ machine: A.id }) });
    expect(api.refs.get(claimRef("job1"))).toEqual(before);
    expect(api.calls.filter((c) => c.includes(claimRef("job1")) && !c.startsWith("read")).length).toBe(1);
  });

  it("takes over a job whose holder is past its lease", async () => {
    const api = memoryCoord();
    await claimJob(api, "job1", A, t0);
    await heartbeat(api, A, caps, ["job1"], t0);
    expect(await claimJob(api, "job1", B, later(11), 10)).toEqual({ claimed: true, takenFrom: expect.objectContaining({ machine: A.id, name: A.name }) });
    expect(JSON.parse(api.refs.get(claimRef("job1"))!.data)).toMatchObject({ machine: B.id, name: B.name });
  });

  it("lets only one of two machines take over an expired claim", async () => {
    const api = memoryCoord();
    await claimJob(api, "job1", A, t0);
    await heartbeat(api, A, caps, ["job1"], t0);
    const [b, c] = await Promise.all([claimJob(api, "job1", B, later(11), 10), claimJob(api, "job1", C, later(11), 10)]);
    expect([b, c].filter((r) => r.claimed)).toHaveLength(1);
    const winner = b.claimed ? B : C;
    expect(JSON.parse(api.refs.get(claimRef("job1"))!.data).machine).toBe(winner.id);
    expect((b.claimed ? c : b)).toEqual({ claimed: false, holder: expect.objectContaining({ machine: winner.id }) });
  });
});

describe("a returning machine", () => {
  it("sees it lost the job and does not release it", async () => {
    const api = memoryCoord();
    await claimJob(api, "job1", A, t0);
    await heartbeat(api, A, caps, ["job1"], t0);
    await claimJob(api, "job1", B, later(20), 10);
    expect(await stillHolds(api, "job1", A.id)).toBe(false);
    expect(await releaseJob(api, "job1", A, "stopped", later(21))).toBe(false);
    expect(api.calls.some((c) => c.startsWith("delete"))).toBe(false);
    expect(await stillHolds(api, "job1", B.id)).toBe(true);
    expect(await readClaimOf(api, "job1")).toMatchObject({ machine: B.id });
  });
});

describe("releaseJob", () => {
  it("leaves a closing record another machine can take", async () => {
    const api = memoryCoord();
    await claimJob(api, "job1", A, t0);
    expect(await releaseJob(api, "job1", A, "delivered", later(1))).toBe(true);
    expect(JSON.parse(api.refs.get(claimRef("job1"))!.data)).toEqual({ job: "job1", machine: A.id, name: A.name, at: later(1).toISOString(), released: true, status: "delivered" });
    expect(api.calls.some((c) => c.startsWith("delete claims/"))).toBe(false);
    expect(await stillHolds(api, "job1", A.id)).toBe(false);
    expect(await releaseJob(api, "job1", A, "delivered", later(2))).toBe(false);
    expect(await claimJob(api, "job1", B, later(2))).toEqual({ claimed: true });
    expect(await stillHolds(api, "job1", B.id)).toBe(true);
  });

  it("is a compare-and-swap: a claim taken meanwhile stays", async () => {
    const api = memoryCoord();
    await claimJob(api, "job1", A, t0);
    const update = api.update.bind(api);
    // Between A's read and its move, B takes the job over.
    api.update = async (name, data, from) => {
      api.update = update;
      await update(name, JSON.stringify({ job: "job1", machine: B.id, name: B.name, at: later(20).toISOString() }), from);
      return update(name, data, from);
    };
    expect(await releaseJob(api, "job1", A, "failed", later(20))).toBe(false);
    expect(await readClaimOf(api, "job1")).toMatchObject({ machine: B.id });
  });

  it("is released for nobody when the claim is missing", async () => {
    expect(await releaseJob(memoryCoord(), "job1", A, "failed", t0)).toBe(false);
  });
});

describe("claim records", () => {
  it("does not trust records it cannot validate", async () => {
    for (const bad of [
      { job: "job1", machine: "../x", name: "a", at: t0.toISOString() },
      { job: "job1", machine: A.id, name: "a", at: "ayer" },
      { job: "job1", machine: A.id, name: "a[2J", at: t0.toISOString() },
      { job: "job1", machine: A.id, name: "a", at: t0.toISOString(), released: "yes" },
    ]) {
      const api = memoryCoord();
      await api.create(claimRef("job1"), JSON.stringify(bad));
      expect(await readClaimOf(api, "job1")).toBeUndefined();
      expect(await stillHolds(api, "job1", A.id)).toBe(false);
      // An unreadable claim is taken from its tip, never reported as a resume.
      expect(await claimJob(api, "job1", B, t0)).toEqual({ claimed: true });
    }
  });
});

describe("probeCoord", () => {
  it("passes against memoryCoord and leaves no probe ref", async () => {
    const api = memoryCoord();
    expect(await probeCoord(api, "id-a-1")).toEqual({ ok: true });
    expect([...api.refs.keys()].filter((k) => k.startsWith("probe/"))).toEqual([]);
  });

  it("fails when creating an existing ref does not conflict", async () => {
    const api = memoryCoord();
    const create = api.create.bind(api);
    api.create = async (name, data) => (api.refs.has(name) ? api.write(name, data) : create(name, data));
    const result = await probeCoord(api, "id-a-1");
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("ya existe") });
    expect(api.refs.has("probe/id-a-1")).toBe(false);
  });

  it("fails when a move that is not a fast-forward goes through", async () => {
    const api = memoryCoord();
    api.update = (name, data) => api.write(name, data);
    expect(await probeCoord(api, "id-a-1")).toEqual({ ok: false, problem: expect.stringContaining("punta") });
    expect(api.refs.has("probe/id-a-1")).toBe(false);
  });

  it("reports an error as a failed probe", async () => {
    const api: CoordApi = { ...memoryCoord(), create: async () => Promise.reject(new Error("sin red")) };
    expect(await probeCoord(api, "id-a-1")).toEqual({ ok: false, problem: expect.stringContaining("sin red") });
    expect(await probeCoord(memoryCoord(), "../x")).toMatchObject({ ok: false });
  });
});

describe("heartbeat", () => {
  it("lists live and down machines with public fields only", async () => {
    const api = memoryCoord();
    await heartbeat(api, B, { ...caps, platform: "darwin" }, [], t0);
    await heartbeat(api, A, caps, ["abc12345"], later(20));
    const machines = await listMachines(api, later(20), 10);
    expect(machines.map((m) => [m.name, m.alive])).toEqual([
      ["notebook", false],
      ["pc-vieja", true],
    ]);
    for (const id of [A.id, B.id]) expect(Object.keys(JSON.parse(api.refs.get(machineRef(id))!.data)).sort()).toEqual(["at", "capabilities", "id", "jobs", "name"]);
    expect(machines.find((m) => m.id === A.id)?.jobs).toEqual(["abc12345"]);
  });

  it("skips records that are not machines", async () => {
    const api = memoryCoord();
    await api.write("machines/broken", "not json");
    expect(await listMachines(api, t0)).toEqual([]);
  });
});
