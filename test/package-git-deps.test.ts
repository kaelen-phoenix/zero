import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packageAdd, packageList, packageUpdate, type FactoryContext, type ShutdownResult } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { formatPackages } from "../src/format.js";
import { folderLockProblem, lockProblem, lockProblemAt, npmSpecProblem, realDependencies, realGit, type GitRunner } from "../src/package-install.js";
import { factoryConfig } from "../src/packages.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

// Real processes, watched: a refused lock must start none.
vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return { ...real, spawn: vi.fn(real.spawn), spawnSync: real.spawnSync };
});

afterEach(() => {
  cleanup();
});

const URL_V = "https://github.com/acme/hola.git";
const SOURCE = "github:acme/hola";
const REGISTRY = "https://registry.npmjs.org/x/-/x-1.0.0.tgz";
const MANIFEST = stringify({ interface: 1, name: "hello", version: "1.0.0" });

/** A lock whose production dependency comes from `resolved`. */
const lockFrom = (resolved: string) => JSON.stringify({ name: "p", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "p", version: "1.0.0", dependencies: { x: resolved } }, "node_modules/x": { version: "1.0.0", resolved } } });
const GIT_LOCK = lockFrom(`git+https://host/x.git#${"a".repeat(40)}`);

/** Real git, with the package's URL reaching a temporary repository. */
const gitTo = (repo: string): GitRunner => async (args, opts = {}) => {
  const r = spawnSync("git", ["-c", `url.${repo.replace(/\\/g, "/")}.insteadOf=${URL_V}`, ...args], { cwd: opts.cwd, encoding: "utf8", env: { ...process.env, GIT_ALLOW_PROTOCOL: "file:https:ssh", GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

function commit(repo: string, subject: string, files: Record<string, string>): string {
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", subject);
  return gitIn(repo, "rev-parse", "HEAD");
}

async function factory(): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [], packages: [] }, () => new Date("2026-11-04T12:00:00Z"));
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

function fakes(git: GitRunner) {
  const shutdown = vi.fn(async (): Promise<ShutdownResult> => ({ status: "stopped" }));
  const start = vi.fn(async () => true);
  const deps = vi.fn(async (_dir: string) => undefined);
  const confirm = vi.fn(async (_q: string) => true);
  return { shutdown, start, deps, confirm, input: { git, deps, confirm, daemon: { shutdown, start } } };
}

/** A real repository npm could really build: its `prepare` leaves a mark if it ever runs. */
function buildableDep() {
  const mark = join(tempDir(), "corrio.txt");
  const script = `node -e "require('fs').writeFileSync('${mark.replace(/\\/g, "/")}','x')"`;
  const repo = gitRepo({ "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { prepare: script } }) });
  return { mark, spec: `git+file:///${repo.replace(/\\/g, "/").replace(/^\//, "")}#${gitIn(repo, "rev-parse", "HEAD")}` };
}

describe("locks with dependencies npm would have to build", () => {
  it.each([
    ["git+ssh", lockFrom("git+ssh://git@host/x.git#abc")],
    ["git+https", GIT_LOCK],
    ["git", lockFrom("git://host/x.git")],
    ["github shorthand", lockFrom("github:a/x")],
    ["ssh", lockFrom("ssh://git@host/x.git")],
    ["a plain https URL read as a repository", lockFrom("https://github.com/a/x.git")],
    ["a host read as git whatever the path", lockFrom("https://www.gitlab.com/a/x.tgz")],
    ["a tarball on the disk", lockFrom("file:vendor/x.tgz")],
    ["http", lockFrom("http://registry.example/x/-/x-1.0.0.tgz")],
    ["credentials", lockFrom("https://user:pw@registry.example/x/-/x-1.0.0.tgz")],
    ["a git version with no resolved", JSON.stringify({ packages: { "node_modules/x": { version: "git+https://host/x.git" } } })],
    ["a repository as version", JSON.stringify({ packages: { "node_modules/x": { version: "acme/x" } } })],
    ["a repository as name", JSON.stringify({ packages: { "node_modules/x": { name: "acme/x", version: "1.0.0" } } })],
    ["a link that is not local", JSON.stringify({ packages: { "node_modules/x": { resolved: "git+https://host/x.git", link: true } } })],
    ["a shrinkwrap inside", JSON.stringify({ packages: { "node_modules/x": { version: "1.0.0", resolved: REGISTRY, hasShrinkwrap: true } } })],
    ["the old format", JSON.stringify({ lockfileVersion: 1, dependencies: { x: { version: "git+https://host/x.git#abc" } } })],
    ["the old format, nested", JSON.stringify({ lockfileVersion: 1, dependencies: { y: { version: "1.0.0", dependencies: { x: { version: "1.0.0", resolved: "file:x.tgz" } } } } })],
    ["what cannot be read", "no soy json"],
    ["what is not an object", "null"],
  ])("refuses %s", (_name, text) => {
    expect(lockProblem(text)).toMatch(/package-lock\.json/);
  });

  it.each([
    ["an empty lock", "{}"],
    ["a registry tarball", lockFrom(REGISTRY)],
    ["a private registry", lockFrom("https://npm.pkg.github.com/download/@a/x/1.0.0/abc")],
    ["a local link and its folder", JSON.stringify({ packages: { "node_modules/x": { resolved: "vendor/x", link: true }, "vendor/x": { version: "1.0.0" } } })],
    ["a bundled dependency", JSON.stringify({ packages: { "node_modules/x": { version: "1.0.0", inBundle: true } } })],
    ["an alias", JSON.stringify({ lockfileVersion: 1, dependencies: { x: { version: "npm:@a/y@1.0.0", resolved: REGISTRY } } })],
    ["a scoped name", JSON.stringify({ packages: { "node_modules/x": { name: "@a/y", version: "1.0.0-beta.1+b", resolved: REGISTRY } } })],
  ])("accepts %s", (_name, text) => {
    expect(lockProblem(text)).toBeUndefined();
  });

  it("says where a dependency comes from without its credentials", () => {
    const problem = lockProblem(lockFrom("git+https://tok3n@host/x.git"));
    expect(problem).toContain("x viene de");
    expect(problem).not.toContain("tok3n");
  });

  it("npm does not even start on a lock with a git dependency", async () => {
    const { mark, spec } = buildableDep();
    const dir = tempDir();
    writeTree(dir, { "package.json": JSON.stringify({ name: "p", version: "1.0.0", dependencies: { x: spec } }), "package-lock.json": lockFrom(spec) });
    vi.mocked(spawn).mockClear();
    await expect(realDependencies(dir)).rejects.toThrow(/la dependencia x viene de/);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(existsSync(mark)).toBe(false);
  });

  it("a clean lock does not hide a shrinkwrap, which npm reads first", async () => {
    const dir = tempDir();
    writeTree(dir, { "package.json": "{}", "package-lock.json": "{}", "npm-shrinkwrap.json": GIT_LOCK });
    vi.mocked(spawn).mockClear();
    await expect(realDependencies(dir)).rejects.toThrow(/npm-shrinkwrap\.json/);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it("reads what a commit has, a link included, without checking it out", async () => {
    const repo = gitRepo({ "zero-package.yaml": MANIFEST, "package-lock.json": "{}" });
    const clean = gitIn(repo, "rev-parse", "HEAD");
    const bad = commit(repo, "lock", { "package-lock.json": GIT_LOCK });
    expect(await lockProblemAt(realGit, repo, clean)).toBeUndefined();
    expect(await lockProblemAt(realGit, repo, bad)).toMatch(/la dependencia x/);
    writeFileSync(join(repo, "package-lock.json"), "{}");
    writeFileSync(join(repo, "link-target"), "otro.json");
    gitIn(repo, "add", "package-lock.json");
    const blob = gitIn(repo, "hash-object", "-w", "--no-filters", "link-target");
    gitIn(repo, "update-index", "--add", "--cacheinfo", `120000,${blob},npm-shrinkwrap.json`);
    gitIn(repo, "commit", "-q", "-m", "enlace");
    expect(await lockProblemAt(realGit, repo, "HEAD")).toMatch(/npm-shrinkwrap\.json no es un archivo común/);
    expect(folderLockProblem(tempDir())).toBeUndefined();
  });
});

describe("what real npm does with a package that brings a git dependency", () => {
  it("it is refused and never built", async () => {
    const { mark, spec } = buildableDep();
    // npm itself refuses where it knows allow-git; older ones write the lock zero refuses.
    const seen = await npmSpecProblem(spec).catch((err: Error) => err.message);
    expect(seen).toMatch(/git/i);
    expect(existsSync(mark)).toBe(false);
  }, 120_000);

  it("one with nothing to build passes", async () => {
    const pkg = tempDir();
    writeTree(pkg, { "package.json": JSON.stringify({ name: "p", version: "1.0.0" }) });
    expect(await npmSpecProblem(`file:${pkg.replace(/\\/g, "/")}`)).toBeUndefined();
  }, 120_000);
});

describe("refusing a lock before anything happens", () => {
  it("add refuses it before asking, without a trace", async () => {
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const { deps, confirm } = fakes(gitTo(""));
    const repo = gitRepo({ "zero-package.yaml": MANIFEST, "package-lock.json": GIT_LOCK });
    await expect(packageAdd(ctx, { source: SOURCE, git: gitTo(repo), confirm, deps })).rejects.toThrow(/la dependencia x viene de git\+https/);
    expect(confirm).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
    expect(readdirSync(join(ctx.home.packages, "git"))).toEqual([]);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it("an update that only changes the lock stops before the factory goes down", async () => {
    const repo = gitRepo({ "zero-package.yaml": MANIFEST, "package-lock.json": "{}\n" });
    const ctx = await factory();
    const git = gitTo(repo);
    await packageAdd(ctx, { source: SOURCE, git, confirm: async () => true, deps: async () => undefined });
    const dir = join(ctx.home.packages, "git", "hello");
    const from = gitIn(dir, "rev-parse", "HEAD");
    const to = commit(repo, "lock con git", { "package-lock.json": GIT_LOCK });
    const { shutdown, start, deps, confirm, input } = fakes(git);
    const result = await packageUpdate(ctx, input);
    expect(result.failed).toBe(true);
    expect(result.text).toContain(`no se aplicó ${to.slice(0, 7)}`);
    expect(result.text).toContain("la dependencia x viene de git+https");
    for (const fake of [shutdown, start, deps, confirm]) expect(fake).not.toHaveBeenCalled();
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(from);
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).packages[0]!.commit).toBe(from);
    expect(formatPackages(packageList(ctx))).toContain("hay una actualización");
  });

  it("a folder whose lock gained one stops before the factory goes down", async () => {
    const dir = tempDir();
    writeTree(dir, { "zero-package.yaml": MANIFEST, "package-lock.json": "{}\n" });
    const ctx = await factory();
    await packageAdd(ctx, { source: dir });
    writeFileSync(join(dir, "package-lock.json"), GIT_LOCK);
    const { shutdown, start, deps, input } = fakes(gitTo(""));
    const result = await packageUpdate(ctx, input);
    expect(result.failed).toBe(true);
    expect(result.text).toContain("la dependencia x viene de git+https");
    for (const fake of [shutdown, start, deps]) expect(fake).not.toHaveBeenCalled();
  });
});
