import { describe, expect, it } from "vitest";
import { claimJob, claimRef, CoordConflict, heartbeat, listMachines, machineRef, memoryCoord, releaseJob, stillHolds } from "../src/coord/protocol.js";
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
    expect(await claimJob(api, "job1", B, later(11), 10)).toEqual({ claimed: true });
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
    expect(await releaseJob(api, "job1", A.id)).toBe(false);
    expect(api.calls.some((c) => c.startsWith("delete"))).toBe(false);
    expect(await stillHolds(api, "job1", B.id)).toBe(true);
  });

  it("releases its own job", async () => {
    const api = memoryCoord();
    await claimJob(api, "job1", A, t0);
    expect(await releaseJob(api, "job1", A.id)).toBe(true);
    expect(api.refs.has(claimRef("job1"))).toBe(false);
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
