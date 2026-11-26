import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, packageList, requestStationRun, uploadToStation, type FactoryContext } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { formatPackages } from "../src/format.js";
import { busyPass, onDemandPass, onDemandPending, packagesPass, scheduledPass, stationLastKey, stationOnDemandKey, whenBusyStations } from "../src/line/packages.js";
import { MACHINE_ID_KEY, machineIdentity } from "../src/machine.js";
import { factoryConfig, packageDataDir } from "../src/packages.js";
import { packagesPage } from "../src/panel/html.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";
import { makeZip } from "./zip.js";

afterEach(cleanup);

/** Local noon, so the station's 12:00 schedule is due. */
const NOON = new Date(2026, 5, 10, 12, 1);
const runner = () => fakeAgents({}).runner;

/** Package `plus`, with station `cm` (every way to run) and station `otra` (regular only); each notes its import and its calls. */
function plus() {
  const dir = tempDir("zero-pkg-");
  const marker = join(tempDir("zero-marker-"), "calls.txt");
  const module = (name: string) => `import { appendFileSync } from "node:fs";
const note = (text) => appendFileSync(${JSON.stringify(marker)}, "${name} " + text + "\\n");
note("import");
export async function pass(ctx, run) { note(run?.onDemand ? "onDemand" : "pass"); }
export async function scheduled() { note("scheduled"); }
`;
  writeTree(dir, {
    "zero-package.yaml": stringify({
      interface: 1,
      name: "plus",
      version: "1.0.0",
      stations: [
        { name: "cm", module: "cm.mjs", schedule: ["12:00"], onDemand: true, whenBusy: true, uploads: { maxMb: 1 } },
        { name: "otra", module: "otra.mjs", whenBusy: true },
      ],
    }),
    "cm.mjs": module("cm"),
    "otra.mjs": module("otra"),
  });
  return { dir, calls: () => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : []) };
}

async function factory(dir: string, entry: Record<string, unknown>, machine: string | undefined, over: Record<string, unknown> = {}): Promise<FactoryContext> {
  const ctx = testFactory({
    isolation: "worktree",
    level: "L2",
    lines: [{ name: "web", repo: gitRepo(), verify: [`node -e "process.exit(0)"`] }],
    packages: [{ path: dir, allowCode: true, ...entry }],
    ...(machine && { distributed: { repository: "me/zero-coord", machine } }),
    ...over,
  });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

/** Every pass of the daemon that may run a station. */
async function allPasses(ctx: FactoryContext, now = NOON) {
  await scheduledPass(ctx, now);
  await onDemandPass(ctx, runner(), now);
  await busyPass(ctx, runner(), now);
  await packagesPass(ctx, runner(), now);
}

const ofCm = (calls: string[]) => calls.filter((c) => c.startsWith("cm "));
const pinned = { machines: { cm: "pc-casa" } };

describe("machine and machines in the factory file", () => {
  it("takes both and leaves an entry without them as it was", () => {
    const cfg = parseFactory("packages:\n  - path: ./a\n    machine: pc-casa\n    machines: { cm: nube }\n  - path: ./b\n");
    expect(cfg.packages).toEqual([
      { path: "./a", allowCode: false, machine: "pc-casa", machines: { cm: "nube" } },
      { path: "./b", allowCode: false },
    ]);
  });

  it.each(["machine: ''", "machine: '  '", "machines: { cm: '' }", "machines: [cm]", "machine: 3"])("refuses %s", (field) => {
    expect(() => parseFactory(`packages:\n  - path: ./a\n    ${field}\n`)).toThrow();
  });

  it("shows a station that does not exist as the package's problem and runs none of its stations", async () => {
    const { dir, calls } = plus();
    const ctx = await factory(dir, { machines: { cmm: "pc-casa" } }, "nube");
    expect(ctx.config.loadedPackages!.problems).toEqual([{ package: "plus", reason: expect.stringContaining("cmm") }]);
    expect(formatPackages(packageList(ctx))).toContain("cmm");
    await allPasses(ctx);
    expect(calls()).toEqual([]);
  });

  it("shows it too without allowCode", async () => {
    const ctx = await factory(plus().dir, { machines: { cmm: "pc-casa" }, allowCode: false }, "nube");
    const [problem] = ctx.config.loadedPackages!.problems;
    expect(problem!.reason).toContain("allowCode");
    expect(problem!.reason).toContain("cmm");
  });

  it("shows it in a package with no stations", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": stringify({ interface: 1, name: "vacio", version: "1.0.0" }) });
    const ctx = await factory(dir, { machines: { constructor: "pc-casa" } }, "nube");
    expect(ctx.config.loadedPackages!.problems).toEqual([{ package: "vacio", reason: expect.stringContaining("constructor") }]);
  });
});

describe("on another machine", () => {
  it.each([{ machine: "pc-casa" }, pinned, { machine: "nube", machines: { cm: "pc-casa" } }])("%j: no pass imports or runs the station", async (entry) => {
    const { dir, calls } = plus();
    const ctx = await factory(dir, entry, "nube");
    ctx.store.setKv(stationOnDemandKey("plus", "cm"), NOON.toISOString());
    await allPasses(ctx);
    expect(ofCm(calls())).toEqual([]);
    expect(ctx.store.getKv(stationLastKey("plus", "cm"))).toBeUndefined();
    expect(ctx.store.getKv(MACHINE_ID_KEY)).toBeDefined();
  });

  it("a name that matches no machine runs nowhere, distributed or not", async () => {
    for (const machine of ["pc-casa", "nube", undefined]) {
      const { dir, calls } = plus();
      await allPasses(await factory(dir, { machine: "no-existe-esta-maquina" }, machine));
      expect(calls()).toEqual([]);
    }
  });

  it("is refused on demand naming the machine, with nothing pending", async () => {
    const ctx = await factory(plus().dir, pinned, "nube");
    expect(requestStationRun(ctx, "plus/cm", NOON)).toMatchObject({ ok: false, reason: expect.stringContaining("pc-casa") });
    expect(ctx.store.getKv(stationOnDemandKey("plus", "cm"))).toBeUndefined();
    expect(onDemandPending(ctx)).toBe(false);
  });

  it("refuses an upload naming the machine and keeps no file", async () => {
    const ctx = await factory(plus().dir, pinned, "nube");
    const zip = makeZip([{ name: "a.txt", data: "a" }]);
    expect(await uploadToStation(ctx, "plus/cm", { name: "a.zip", content: zip }, NOON)).toMatchObject({ ok: false, reason: expect.stringContaining("pc-casa") });
    expect(existsSync(join(packageDataDir(ctx.home, "plus"), "uploads"))).toBe(false);
    expect(ctx.store.getKv(stationOnDemandKey("plus", "cm"))).toBeUndefined();
  });

  it("starts no background pass for it, whatever was left pending", async () => {
    const ctx = await factory(plus().dir, { machine: "pc-casa" }, "nube");
    ctx.store.setKv(stationOnDemandKey("plus", "cm"), NOON.toISOString());
    expect(onDemandPending(ctx)).toBe(false);
    expect(whenBusyStations(ctx)).toBe(false);
    expect(factoryStatus(ctx).whenBusy).toEqual([]);
  });

  it("is not imported when its pin changes between the pass choosing it and its turn", async () => {
    const { dir, calls } = plus();
    const ctx = await factory(dir, {}, "nube");
    const cm = ctx.config.loadedPackages!.stations.find((s) => s.name === "cm")!;
    // The pass reads the entry once to choose and the turn reads it again as its last barrier.
    let reads = 0;
    const entry = cm.entry;
    Object.defineProperty(cm, "entry", { get: () => (reads++ === 0 ? entry : { ...entry, machine: "pc-casa" }) });
    await busyPass(ctx, runner(), NOON);
    expect(reads).toBeGreaterThan(1);
    expect(ofCm(calls())).toEqual([]);
  });
});

describe("on the pinned machine", () => {
  it.each(["pc-casa", "PC-Casa"])("runs as always when pinned to %s", async (name) => {
    const { dir, calls } = plus();
    const ctx = await factory(dir, { machines: { cm: name } }, "pc-casa");
    expect(requestStationRun(ctx, "plus/cm", NOON).ok).toBe(true);
    expect(onDemandPending(ctx)).toBe(true);
    expect(whenBusyStations(ctx)).toBe(true);
    await allPasses(ctx);
    expect(ofCm(calls())).toEqual(["cm import", "cm scheduled", "cm onDemand", "cm pass"]);
    expect(factoryStatus(ctx).whenBusy).toEqual(["plus/cm", "plus/otra"]);
  });

  it("runs when pinned to its id", async () => {
    const { dir, calls } = plus();
    const ctx = await factory(dir, {}, "pc-casa");
    const id = machineIdentity(ctx.store, ctx.config).id;
    for (const s of ctx.config.loadedPackages!.stations) s.entry = { ...s.entry, machine: id };
    await packagesPass(ctx, runner(), NOON);
    expect(calls()).toContain("cm pass");
  });

  it("takes an upload", async () => {
    const ctx = await factory(plus().dir, pinned, "pc-casa");
    const zip = makeZip([{ name: "a.txt", data: "a" }]);
    expect(await uploadToStation(ctx, "plus/cm", { name: "a.zip", content: zip }, NOON)).toMatchObject({ ok: true });
  });
});

describe("only one station pinned", () => {
  it("runs the other one and not cm", async () => {
    const { dir, calls } = plus();
    await allPasses(await factory(dir, pinned, "nube"));
    expect(calls()).toEqual(["otra import", "otra pass"]);
  });

  it("machines wins over machine", async () => {
    const { dir, calls } = plus();
    await allPasses(await factory(dir, { machine: "pc-casa", machines: { otra: "nube" } }, "nube"));
    expect(calls()).toEqual(["otra import", "otra pass"]);
  });
});

describe("without machine or machines", () => {
  it("runs on any machine and never reads the machine's identity", async () => {
    const { dir, calls } = plus();
    const ctx = await factory(dir, {}, undefined);
    await allPasses(ctx);
    expect(calls()).toEqual(expect.arrayContaining(["cm scheduled", "cm pass", "otra pass"]));
    expect(formatPackages(packageList(ctx))).not.toContain("fijada");
    expect(ctx.store.getKv(MACHINE_ID_KEY)).toBeUndefined();
  });
});

describe("showing the pinned machine", () => {
  const uploads = { "plus/cm": { maxMb: 1, extensions: [".zip"] } };
  const html = (ctx: FactoryContext) => packagesPage(packageList(ctx), ["plus/cm"], "n", undefined, uploads);

  it("in zero package list", async () => {
    const away = formatPackages(packageList(await factory(plus().dir, pinned, "nube")));
    expect(away).toContain("- estación cm: no corre en esta máquina · fijada a la máquina pc-casa");
    expect(away).toContain("- estación otra: todavía no corrió");
    const home = formatPackages(packageList(await factory(plus().dir, pinned, "pc-casa")));
    expect(home).toContain("- estación cm: todavía no corrió · fijada a la máquina pc-casa");
  });

  it("in the panel, with its forms only where it runs", async () => {
    const away = html(await factory(plus().dir, pinned, "nube"));
    expect(away).toContain("no corre en esta máquina · fijada a la máquina pc-casa");
    expect(away).not.toContain(`action="/packages/`);
    const home = html(await factory(plus().dir, pinned, "pc-casa"));
    expect(home).toContain("todavía no corrió · fijada a la máquina pc-casa");
    expect(home).toContain(`action="/packages/run"`);
    expect(home).toContain(`action="/packages/upload?`);
  });

  it("escapes the name in the panel", async () => {
    const page = html(await factory(plus().dir, { machine: "<b>x</b>" }, "nube"));
    expect(page).not.toContain("<b>x</b>");
    expect(page).toContain("&lt;b&gt;x");
  });
});
