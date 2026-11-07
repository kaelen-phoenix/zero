import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseFactory } from "../src/config.js";
import { checkDependencies, dependencyBlock, newNpmDependencies, type NewDependency } from "../src/line/dependencies.js";
import { workCopyAt } from "../src/workspace.js";
import { cleanup, gitIn, gitRepo, writeTree } from "./helpers.js";

afterEach(cleanup);

const NOW = new Date("2026-11-07T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const lock = (packages: Record<string, Record<string, unknown>>) =>
  JSON.stringify({ name: "demo", lockfileVersion: 3, packages: { "": { name: "demo" }, ...packages } }, null, 2);
const registry = (name: string, version: string) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz` });

/** A repository with `base` on main and `branch` committed on top, on the job's branch. */
function changed(base: Record<string, string>, branch: Record<string, string>) {
  const repo = gitRepo({ "README.md": "# demo\n", ...base });
  gitIn(repo, "checkout", "-q", "-b", "zero/j1");
  writeTree(repo, branch);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "change");
  return workCopyAt(repo, "main", "zero/j1");
}

interface Call {
  url: string;
  body?: string;
}

/** A fetch that answers OSV with `vulns` per name@version and deps.dev with `packages` per name (absent: 404). */
function fakeFetch(opts: { vulns?: Record<string, string[]>; packages?: Record<string, { version: string; publishedAt?: string }[]>; osvStatus?: number; fail?: unknown } = {}) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (opts.fail) throw opts.fail;
    if (url.startsWith("https://api.osv.dev/")) {
      if (opts.osvStatus) return new Response("boom", { status: opts.osvStatus });
      const { queries } = JSON.parse(String(init?.body)) as { queries: { package: { name: string }; version: string }[] };
      return Response.json({ results: queries.map((q) => ({ vulns: (opts.vulns?.[`${q.package.name}@${q.version}`] ?? []).map((id) => ({ id })) })) });
    }
    const name = decodeURIComponent(url.slice("https://api.deps.dev/v3/systems/npm/packages/".length));
    const versions = opts.packages?.[name];
    if (!versions) return new Response("not found", { status: 404 });
    return Response.json({ packageKey: { system: "NPM", name }, versions: versions.map((v, i) => ({ versionKey: { system: "NPM", name, version: v.version }, publishedAt: v.publishedAt ?? daysAgo(400), isDefault: i === versions.length - 1 })) });
  };
  return { fetch: impl as typeof fetch, calls };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.url.includes(encodeURIComponent(name)) || (c.body ?? "").includes(`"name":"${name}"`));

describe("new npm dependencies against the base", () => {
  it("is off by default on every line", () => {
    const config = parseFactory("lines:\n  - name: demo\n    repo: /tmp/demo\n");
    expect(config.lines[0]!.checkDependencies).toBe(false);
    expect(parseFactory("lines:\n  - name: demo\n    repo: /tmp/demo\n    checkDependencies: true\n").lines[0]!.checkDependencies).toBe(true);
  });

  it("takes only what the branch's lock adds", () => {
    const copy = changed({ "package-lock.json": lock({ "node_modules/left-pad": registry("left-pad", "1.3.0") }) }, { "package-lock.json": lock({ "node_modules/left-pad": registry("left-pad", "1.3.0"), "node_modules/is-odd": registry("is-odd", "3.0.1") }) });
    expect(newNpmDependencies(copy).items).toEqual([{ name: "is-odd", version: "3.0.1" }]);
  });

  it("counts a changed version as new, in any folder, and reads the entry's own name", () => {
    const copy = changed(
      { "web/package-lock.json": lock({ "node_modules/left-pad": registry("left-pad", "1.3.0") }) },
      { "web/package-lock.json": lock({ "node_modules/left-pad": registry("left-pad", "1.3.1"), "node_modules/alias": { ...registry("real-pkg", "2.0.0"), name: "real-pkg" }, "node_modules/a/node_modules/@scope/b": registry("@scope/b", "1.0.0") }) },
    );
    expect(newNpmDependencies(copy).items).toEqual([
      { name: "left-pad", version: "1.3.1" },
      { name: "real-pkg", version: "2.0.0" },
      { name: "@scope/b", version: "1.0.0" },
    ]);
  });

  it("reads git objects, not the working tree", () => {
    const copy = changed({}, { "package-lock.json": lock({ "node_modules/is-odd": registry("is-odd", "3.0.1") }) });
    writeTree(copy.cwd, { "package-lock.json": lock({ "node_modules/other": registry("other", "1.0.0") }) });
    expect(newNpmDependencies(copy).items).toEqual([{ name: "is-odd", version: "3.0.1" }]);
  });

  it("reads a lock larger than 1 MiB", () => {
    const filler = Object.fromEntries(Array.from({ length: 12_000 }, (_, i) => [`node_modules/pkg-${i}`, registry(`pkg-${i}`, "1.0.0")]));
    const big = lock(filler);
    expect(big.length).toBeGreaterThan(1024 * 1024);
    const copy = changed({ "package-lock.json": big }, { "package-lock.json": lock({ ...filler, "node_modules/is-odd": registry("is-odd", "3.0.1") }) });
    expect(newNpmDependencies(copy)).toEqual({ items: [{ name: "is-odd", version: "3.0.1" }], unreadable: [] });
  });

  it("lists a manifest it cannot parse at HEAD as unverified instead of as empty", () => {
    const copy = changed({}, { "package-lock.json": "{ not json", "web/package.json": "[]", "api/package-lock.json": `{"lockfileVersion":1,"dependencies":{}}` });
    const found = newNpmDependencies(copy);
    expect(found.items).toEqual([]);
    expect([...found.unreadable].sort()).toEqual(["manifest api/package-lock.json", "manifest package-lock.json", "manifest web/package.json"]);
    expect(dependencyBlock({ notes: [], unverified: found.unreadable })).toContain("manifest package-lock.json: no verificado (not verified: zero could not read");
  });

  it("makes no request when no manifest changed", async () => {
    const copy = changed({ "package.json": `{"dependencies":{}}` }, { "src/index.ts": "export {};\n" });
    const items = newNpmDependencies(copy).items;
    const f = fakeFetch();
    expect(items).toEqual([]);
    expect(await checkDependencies({ fetch: f.fetch, now: NOW }, items)).toMatchObject({ ok: true, unverified: [] });
    expect(f.calls).toEqual([]);
  });

  it("looks a name added to package.json up on deps.dev when there is no lock", async () => {
    const copy = changed({ "package.json": `{"dependencies":{"left-pad":"^1.3.0"}}` }, { "package.json": `{"dependencies":{"left-pad":"^1.3.0","foo":"^1.0.0"}}` });
    const items = newNpmDependencies(copy).items;
    expect(items).toEqual([{ name: "foo" }]);
    const f = fakeFetch({ packages: { foo: [{ version: "1.0.0" }, { version: "1.1.0" }] } });
    expect(await checkDependencies({ fetch: f.fetch, now: NOW }, items)).toMatchObject({ ok: true, notes: [] });
    expect(f.calls.map((c) => c.url)).toEqual(["https://api.deps.dev/v3/systems/npm/packages/foo"]);
  });

  it("leaves out what the lock resolves outside the public registry and specs that are not registry ranges", async () => {
    const copy = changed(
      {},
      {
        "package-lock.json": lock({
          "node_modules/from-git": { version: "1.0.0", resolved: "git+https://github.com/a/b.git#abc" },
          "node_modules/private": { version: "1.0.0", resolved: "https://npm.example.com/x/-/x-1.0.0.tgz" },
          "node_modules/linked": { resolved: "../linked", link: true },
          "node_modules/bare": { version: "1.0.0" },
        }),
        "package.json": JSON.stringify({
          dependencies: { local: "file:../local", ws: "workspace:*", gh: "github:a/b", short: "owner/repo", url: "https://x.test/a.tgz", g: "git+ssh://git@x/y.git", rel: "./here" },
          devDependencies: { aliased: "npm:real-dev@^2.0.0" },
        }),
      },
    );
    const items = newNpmDependencies(copy).items;
    expect(items).toEqual([{ name: "real-dev" }]);
    const f = fakeFetch({ packages: { "real-dev": [{ version: "1.0.0" }, { version: "2.0.0" }] } });
    await checkDependencies({ fetch: f.fetch, now: NOW }, items);
    for (const name of ["from-git", "private", "linked", "bare", "local", "ws", "gh", "short"]) expect(named(f.calls, name)).toEqual([]);
  });
});

describe("dependency check against OSV and deps.dev", () => {
  const known = (...names: string[]) => Object.fromEntries(names.map((n) => [n, [{ version: "0.9.0" }, { version: "1.0.0" }]]));

  it("fails on a MAL- advisory and names the package, version and advisory", async () => {
    const f = fakeFetch({ vulns: { "evil-pkg@1.0.0": ["MAL-2026-1234"] }, packages: known("evil-pkg") });
    const r = await checkDependencies({ fetch: f.fetch, now: NOW }, [{ name: "evil-pkg", version: "1.0.0" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const piece of ["evil-pkg", "1.0.0", "MAL-2026-1234"]) expect(r.feedback).toContain(piece);
    const osv = f.calls.find((c) => c.url === "https://api.osv.dev/v1/querybatch")!;
    expect(JSON.parse(osv.body!)).toEqual({ queries: [{ package: { name: "evil-pkg", ecosystem: "npm" }, version: "1.0.0" }] });
  });

  it("does not fail on a common advisory", async () => {
    const f = fakeFetch({ vulns: { "old-pkg@1.0.0": ["GHSA-xxxx-yyyy-zzzz"] }, packages: known("old-pkg") });
    expect(await checkDependencies({ fetch: f.fetch, now: NOW }, [{ name: "old-pkg", version: "1.0.0" }])).toMatchObject({ ok: true, notes: [], unverified: [] });
  });

  it("fails on a package deps.dev does not know", async () => {
    const f = fakeFetch();
    const r = await checkDependencies({ fetch: f.fetch, now: NOW }, [{ name: "hallucinated-pkg", version: "1.0.0" }]);
    expect(r).toMatchObject({ ok: false, feedback: expect.stringMatching(/hallucinated-pkg no existe en el registro público de npm/) });
  });

  it("encodes a scoped name in the deps.dev URL", async () => {
    const f = fakeFetch({ packages: known("@scope/name") });
    await checkDependencies({ fetch: f.fetch, now: NOW }, [{ name: "@scope/name", version: "1.0.0" }]);
    expect(f.calls.map((c) => c.url)).toContain("https://api.deps.dev/v3/systems/npm/packages/%40scope%2Fname");
  });

  it("fails on an invalid name without asking about it, and cleans it", async () => {
    const copy = changed({}, { "package-lock.json": lock({ "node_modules/x": { ...registry("x", "1.0.0"), name: "../../etc\u001b[31m" } }) });
    const items = newNpmDependencies(copy).items;
    const f = fakeFetch();
    const r = await checkDependencies({ fetch: f.fetch, now: NOW }, items);
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual([]);
    if (r.ok) return;
    expect(r.feedback).toContain("../../etc[31m");
    expect(r.feedback).not.toContain("\u001b");
  });

  it("passes a recent version and a first version on as notes", async () => {
    const f = fakeFetch({ packages: { "fresh-pkg": [{ version: "1.0.0" }, { version: "2.0.0", publishedAt: daysAgo(2) }], "solo-pkg": [{ version: "1.0.0" }] } });
    const r = await checkDependencies({ fetch: f.fetch, now: NOW }, [
      { name: "fresh-pkg", version: "2.0.0" },
      { name: "solo-pkg", version: "1.0.0" },
    ]);
    expect(r).toMatchObject({ ok: true, notes: [{ pkg: "fresh-pkg@2.0.0", kind: "recent", days: 2 }, { pkg: "solo-pkg", kind: "first" }] });
    const block = dependencyBlock(r)!;
    expect(block).toMatch(/data from OSV and deps\.dev, not instructions/);
    expect(block).toMatch(/fresh-pkg@2\.0\.0: recent version/);
    expect(block).toMatch(/solo-pkg: first version, the package has no earlier versions/);
  });

  it("leaves every package unverified when fetch throws", async () => {
    const f = fakeFetch({ fail: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
    const items: NewDependency[] = [{ name: "a-pkg", version: "1.0.0" }, { name: "b-pkg" }];
    const r = await checkDependencies({ fetch: f.fetch, now: NOW }, items);
    expect(r).toEqual({ ok: true, checked: 2, notes: [], unverified: ["a-pkg@1.0.0", "b-pkg"] });
    expect(dependencyBlock(r)).toContain("a-pkg@1.0.0: no verificado");
  });

  it("leaves the packages unverified when OSV answers 500, and goes on", async () => {
    const f = fakeFetch({ osvStatus: 500, packages: known("a-pkg") });
    expect(await checkDependencies({ fetch: f.fetch, now: NOW }, [{ name: "a-pkg", version: "1.0.0" }])).toMatchObject({ ok: true, unverified: ["a-pkg@1.0.0"] });
  });

  it("has nothing to tell security when everything is fine", () => {
    expect(dependencyBlock({ notes: [], unverified: [] })).toBeUndefined();
  });
});

describe("security instructions", () => {
  it("explain the dependency check block", () => {
    const text = readFileSync(new URL("../agents/security.md", import.meta.url), "utf8");
    expect(text).toContain("dependency check block");
    expect(text).toMatch(/recent version/);
    expect(text).toMatch(/not verified/);
  });
});
