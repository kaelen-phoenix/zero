import { afterEach, describe, expect, it } from "vitest";
import { parseFactory } from "../src/config.js";
import { MACHINE_ID_KEY, machineCapabilities, machineIdentity } from "../src/machine.js";
import { cleanup, testStore } from "./helpers.js";

afterEach(cleanup);

describe("distributed block", () => {
  it("is absent unless the file sets it", () => {
    expect(parseFactory("lines: []\n").distributed).toBeUndefined();
  });

  it("fills the heartbeat and the lease", () => {
    expect(parseFactory("distributed:\n  repository: me/zero-coord\n").distributed).toEqual({ repository: "me/zero-coord", heartbeatSeconds: 60, leaseMinutes: 10 });
  });

  it("keeps the machine name", () => {
    expect(parseFactory("distributed:\n  repository: me/zero-coord\n  machine: notebook\n").distributed?.machine).toBe("notebook");
  });

  it.each([
    "distributed:\n  repository: zero-coord\n",
    "distributed:\n  repository: me/zero-coord\n  heartbeatSeconds: 300\n  leaseMinutes: 10\n",
    "distributed:\n  repository: me/zero-coord\n  token: abc\n",
    "distributed:\n  repository: me/zero-coord\n  heartbeatSeconds: 10\n",
    "distributed:\n  repository: me/zero-coord\n  leaseMinutes: 1\n",
    "distributed:\n  heartbeatSeconds: 60\n",
  ])("refuses %j", (yaml) => {
    expect(() => parseFactory(yaml)).toThrow();
  });

  it("accepts a lease of exactly three heartbeats", () => {
    expect(parseFactory("distributed:\n  repository: me/zero-coord\n  heartbeatSeconds: 40\n  leaseMinutes: 2\n").distributed?.leaseMinutes).toBe(2);
  });
});

describe("machine identity", () => {
  it("returns the same id on every call and keeps it in kv", () => {
    const store = testStore();
    const config = parseFactory("lines: []\n");
    const first = machineIdentity(store, config);
    const second = machineIdentity(store, config);
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe("");
    expect(store.getKv(MACHINE_ID_KEY)).toBe(first.id);
  });

  it("takes the name from the file, else from the host", () => {
    const store = testStore();
    const named = parseFactory("distributed:\n  repository: me/zero-coord\n  machine: notebook\n");
    expect(machineIdentity(store, named, () => "otra").name).toBe("notebook");
    expect(machineIdentity(store, parseFactory("lines: []\n"), () => "Mi PC.local").name).toBe("Mi-PC-local");
  });
});

describe("machine capabilities", () => {
  const config = parseFactory("engine: claude\nfallback: [codex]\nlines: []\n");

  it("reports no box when it is not ready, with public keys only", () => {
    const caps = machineCapabilities(config, { ready: false }, "linux");
    expect(Object.keys(caps).sort()).toEqual(["box", "engines", "platform"]);
    expect(caps).toEqual({ platform: "linux", box: false, engines: ["claude", "codex"] });
    expect(machineCapabilities(config, undefined).box).toBe(false);
  });

  it("reports the box when it is ready", () => {
    expect(machineCapabilities(config, { ready: true }, "darwin")).toMatchObject({ platform: "darwin", box: true });
  });
});
