import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFactory } from "../src/config.js";
import { HISTORY_LIMIT, installFolder, readSelfUpdate, recordSelfUpdate, SELF_UPDATE_HISTORY_KEY, versionText } from "../src/self-update.js";
import { cleanup, gitRepo, tempDir, testStore } from "./helpers.js";

afterEach(cleanup);

describe("selfUpdate in the factory file", () => {
  it("is off by default with the documented defaults", () => {
    const cfg = parseFactory("lines: []\n");
    expect(cfg.selfUpdate).toEqual({ enabled: false, remote: "origin", startTimeoutSeconds: 120 });
  });

  it("takes the person in charge's settings", () => {
    const cfg = parseFactory("selfUpdate:\n  enabled: true\n  remote: upstream\n  branch: main\n  startTimeoutSeconds: 30\n");
    expect(cfg.selfUpdate).toEqual({ enabled: true, remote: "upstream", branch: "main", startTimeoutSeconds: 30 });
  });

  it("refuses unknown keys and a start timeout under 10 s", () => {
    expect(() => parseFactory("selfUpdate: { enabled: true, token: x }\n")).toThrow();
    expect(() => parseFactory("selfUpdate: { enabled: true, startTimeoutSeconds: 5 }\n")).toThrow();
  });
});

describe("zero --version", () => {
  const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

  it("prints the package version and exits 0 without opening the factory", () => {
    const home = join(tempDir(), "missing-home");
    for (const flag of ["--version", "-v"]) {
      const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", flag], { encoding: "utf8", env: { ...process.env, ZERO_HOME: home }, input: "", windowsHide: true });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`zero ${version}`);
    }
  }, 30_000);

  it("adds the install folder's commit when it is a git repository", () => {
    const repo = gitRepo({ "package.json": JSON.stringify({ version: "9.8.7" }) });
    const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    expect(versionText(repo)).toBe(`zero 9.8.7 (${commit})`);
    expect(versionText(tempDir())).toBe("zero desconocida");
  });

  it("finds the install folder above the folder holding cli.js", () => {
    const root = tempDir();
    expect(installFolder(join(root, "zero", "dist", "cli.js"))).toBe(join(root, "zero"));
    expect(installFolder(join(process.cwd(), "dist", "cli.js"))).toBe(process.cwd());
  });
});

describe("self-update records", () => {
  it("keeps the state and the last 20 updates", () => {
    const store = testStore();
    expect(readSelfUpdate(store)).toEqual({ state: { status: "idle" }, history: [] });
    recordSelfUpdate(store, { state: { status: "ready", from: "a", to: "b", dir: "/x" } });
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) recordSelfUpdate(store, { entry: { from: `f${i}`, to: `t${i}`, at: new Date(i).toISOString(), outcome: "updated" } });
    const { state, history } = readSelfUpdate(store);
    expect(state).toEqual({ status: "ready", from: "a", to: "b", dir: "/x" });
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.from).toBe("f5");
    expect(history.at(-1)?.to).toBe(`t${HISTORY_LIMIT + 4}`);
  });

  it("reads a broken record as nothing and never throws on a store failure", () => {
    const store = testStore();
    store.setKv(SELF_UPDATE_HISTORY_KEY, "{not json");
    expect(readSelfUpdate(store).history).toEqual([]);
    store.close();
    expect(() => recordSelfUpdate(store, { state: { status: "idle" }, entry: { from: "a", to: "b", at: "x", outcome: "failed" } })).not.toThrow();
    expect(readSelfUpdate(store)).toEqual({ state: { status: "idle" }, history: [] });
  });
});
