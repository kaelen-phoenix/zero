import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { packageTabFile, packageTabView, type FactoryContext } from "../src/app.js";
import { factoryConfig, loadPackages, packageDataDir } from "../src/packages.js";
import { cleanup, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const MODULE = { "stations/nota.mjs": "export async function pass() {}\n" };
const tabs = [
  { name: "novedades", title: "Novedades", data: "items.json" },
  { name: "interno", title: "Interno", data: "interno.json" },
];
const stations = [
  { name: "nota", module: "stations/nota.mjs", onDemand: true },
  { name: "archivo", module: "stations/nota.mjs", onDemand: true, uploads: {} },
  { name: "sola", module: "stations/nota.mjs" },
];

/** A factory with one package declaring these tabs and stations and the given `guests`. */
async function factory(guests: unknown, manifest: Record<string, unknown> = {}): Promise<FactoryContext> {
  const dir = tempDir("zero-pkg-");
  writeTree(dir, { "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", tabs, stations, ...(guests !== undefined && { guests }), ...manifest }), ...MODULE });
  const ctx = testFactory({ packages: [{ path: dir, allowCode: true }] });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const loaded = (ctx: FactoryContext) => ctx.config.loadedPackages!;

describe("what a package offers to guests", () => {
  it("is carried by the loaded package", async () => {
    const { packages, problems } = loaded(await factory({ scope: { name: "cuenta", title: "Cuenta" }, tabs: ["novedades"], run: ["nota"] }));
    expect(problems).toEqual([]);
    expect(packages[0]!.guests).toEqual({ scope: { name: "cuenta", title: "Cuenta" }, tabs: ["novedades"], run: ["nota"], upload: [] });
  });

  it("may be only an action, without a scope, the same station in both", async () => {
    const { packages, problems } = loaded(await factory({ run: ["archivo"], upload: ["archivo"] }));
    expect(problems).toEqual([]);
    expect(packages[0]!.guests).toEqual({ tabs: [], run: ["archivo"], upload: ["archivo"] });
  });

  it("is nothing without the declaration", async () => {
    const { packages, problems } = loaded(await factory(undefined));
    expect(problems).toEqual([]);
    expect(packages[0]).not.toHaveProperty("guests");
  });

  it("does not depend on the stations' code being allowed", async () => {
    const ctx = await factory({ run: ["nota"] });
    ctx.config.packages[0]!.allowCode = false;
    const { packages, stations: running } = loadPackages(ctx.config, ctx.home);
    expect(running).toEqual([]);
    expect(packages[0]!.guests?.run).toEqual(["nota"]);
  });

  it.each<[string, unknown, RegExp]>([
    ["a run of a station without onDemand", { run: ["sola"] }, /guests\.run.*"sola".*onDemand/],
    ["an upload to a station without uploads", { upload: ["nota"] }, /guests\.upload.*"nota".*uploads/],
    ["a tab that does not exist", { tabs: ["otra"] }, /guests\.tabs.*"otra"/],
    ["a run of a station that does not exist", { run: ["otra"] }, /guests\.run.*"otra"/],
    ["an upload to a station that does not exist", { upload: ["otra"] }, /guests\.upload.*"otra"/],
    ["a station given as a tab", { tabs: ["nota"] }, /guests\.tabs.*"nota"/],
    ["a repeated tab", { tabs: ["novedades", "novedades"] }, /guests\.tabs.*"novedades".*repetido/],
    ["a repeated run", { run: ["nota", "nota"] }, /guests\.run.*"nota".*repetido/],
    ["a repeated upload", { upload: ["archivo", "archivo"] }, /guests\.upload.*"archivo".*repetido/],
    ["nothing", {}, /guests: no ofrece nada/],
    ["only a scope", { scope: { name: "cuenta", title: "Cuenta" } }, /guests: no ofrece nada/],
    ["an unknown key", { tabs: ["novedades"], merge: ["x"] }, /guests.*merge/],
    ["an unknown key in the scope", { tabs: ["novedades"], scope: { name: "cuenta", title: "Cuenta", values: ["a"] } }, /guests\.scope.*values/],
    ["a scope with a bad name", { tabs: ["novedades"], scope: { name: "Mi Cuenta", title: "Cuenta" } }, /guests\.scope\.name/],
    ["a scope without title", { tabs: ["novedades"], scope: { name: "cuenta", title: " " } }, /guests\.scope\.title/],
  ])("leaves the package out when it offers %s", async (_what, guests, reason) => {
    const { packages, problems } = loaded(await factory(guests));
    expect(packages).toEqual([]);
    expect(problems).toEqual([{ package: expect.any(String), reason: expect.stringMatching(reason) }]);
  });
});

describe("the scope of a tab's data", () => {
  const items = [
    { title: "Del norte", category: "n", scope: "norte", file: "norte.zip" },
    { title: "Del sur", category: "s", scope: "sur", file: "sur.zip" },
    { title: "De nadie", category: "x", file: "nadie.zip" },
    { title: "Rara", category: "r", scope: 3 },
  ];

  async function tab(categories?: string[], data: unknown[] = items) {
    const ctx = await factory({ scope: { name: "cuenta", title: "Cuenta" }, tabs: ["novedades"] }, { tabs: [{ ...tabs[0], ...(categories && { categories }) }] });
    const dir = packageDataDir(ctx.home, "hello");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "items.json"), JSON.stringify({ items: data }));
    for (const name of ["norte", "sur", "nadie"]) writeFileSync(join(dir, `${name}.zip`), name);
    const view = (scopes?: string[], category?: string) => {
      const v = packageTabView(ctx, "hello", "novedades", category, scopes)!;
      expect(v.state).toBe("ok");
      return { titles: v.items.map((i) => i.title), categories: v.categories, downloads: v.items.flatMap((i) => i.download ?? []) };
    };
    const file = (name: string, scopes?: string[]) => packageTabFile(ctx, "hello", "novedades", name, scopes);
    return { view, file, real: (name: string) => join(realpathSync(dir), name) };
  }

  it("leaves everything without a limit", async () => {
    const t = await tab(["n", "s", "z"]);
    expect(t.view().titles).toEqual(items.map((i) => i.title));
    expect(t.view().categories).toEqual(["n", "s", "z"]);
    for (const name of ["norte.zip", "sur.zip", "nadie.zip"]) expect(t.file(name)).toBe(t.real(name));
  });

  it("shows only the items of the values, and none without scope", async () => {
    const t = await tab();
    expect(t.view(["norte"])).toEqual({ titles: ["Del norte"], categories: ["n"], downloads: ["/packages/hello/novedades/files/norte.zip"] });
    expect(t.view(["norte", "sur"]).titles).toEqual(["Del norte", "Del sur"]);
  });

  it("matches the value exactly", async () => {
    const t = await tab(undefined, [...items, { title: "Vacía", scope: "" }]);
    for (const value of ["Norte", "nort", "norte ", "", "undefined", "3"]) expect(t.view([value]).titles).toEqual(value === "" ? ["Vacía"] : []);
    expect(t.view([])).toEqual({ titles: [], categories: [], downloads: [] });
  });

  it("takes the categories only from the visible items, even with the manifest's own", async () => {
    const t = await tab(["n", "s", "x", "z"]);
    expect(t.view(["norte"]).categories).toEqual(["n"]);
    expect(t.view(["norte"], "s")).toEqual({ titles: [], categories: ["n"], downloads: [] });
  });

  it("hands out only the files of the visible items", async () => {
    const t = await tab();
    expect(t.file("norte.zip", ["norte"])).toBe(t.real("norte.zip"));
    for (const name of ["sur.zip", "nadie.zip", "items.json"]) expect(t.file(name, ["norte"])).toBeUndefined();
    expect(t.file("norte.zip", [])).toBeUndefined();
  });
});
