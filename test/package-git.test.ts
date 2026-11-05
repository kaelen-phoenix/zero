import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packageAdd, packageList, packageRemove, packageUpdate, type FactoryContext, type PackageUpdateInput, type ShutdownResult } from "../src/app.js";
import { ConfigError, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { formatPackages } from "../src/format.js";
import { packageUpdatesPass, remoteCommit } from "../src/line/package-updates.js";
import { findOnPath, folderLockProblem, gitEnv, lockProblem, lockProblemAt, manifestAt, manifestNotAFile, npmCiArgs, npmCommand, npmSpecProblem, readSeen, realDependencies, realGit, runNpm, widening, type GitRunner } from "../src/package-install.js";
import { isGitSource, parseGitSource } from "../src/package-source.js";
import { factoryConfig, ManifestSchema } from "../src/packages.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

// Real processes, watched: the list must start none.
vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return { ...real, spawn: vi.fn(real.spawn), spawnSync: vi.fn(real.spawnSync) };
});

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-11-04T12:00:00Z");
const URL_V = "https://github.com/acme/hola.git";
const SOURCE = "github:acme/hola";

const manifestText = (over: Record<string, unknown> = {}) => stringify({ interface: 1, name: "hello", version: "1.0.0", ...over });
const AGENT = { agents: [{ name: "hello-review", instructions: "agents/review.md" }] };
const AGENT_FILE = { "agents/review.md": "# hello-review\n" };
const station = (over: Record<string, unknown> = {}) => ({ name: "nota", module: "stations/nota.mjs", ...over });
const STATION_FILE = { "stations/nota.mjs": "export async function pass() {}\n" };

/** A real repository holding a package. */
const packageRepo = (over: Record<string, unknown> = {}, files: Record<string, string> = {}) => gitRepo({ "zero-package.yaml": manifestText(over), ...files });

function commit(repo: string, subject: string, files: Record<string, string>): string {
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", subject);
  return gitIn(repo, "rev-parse", "HEAD");
}

/** Real git, with these URLs reaching temporary repositories instead of the network; it records each call. */
function gitTo(remotes: Record<string, string>) {
  const insteadOf = Object.entries(remotes).flatMap(([url, repo]) => ["-c", `url.${repo.replace(/\\/g, "/")}.insteadOf=${url}`]);
  const calls: string[][] = [];
  const git = vi.fn<GitRunner>(async (args, opts = {}) => {
    calls.push(args);
    const r = spawnSync("git", [...insteadOf, ...args], { cwd: opts.cwd, encoding: "utf8", env: { ...process.env, GIT_ALLOW_PROTOCOL: "file:https:ssh", GIT_TERMINAL_PROMPT: "0" } });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  });
  return { git, calls };
}

const failingGit = () => vi.fn<GitRunner>(async () => {
  throw new Error("must not be called");
});

async function factory(packages: unknown[] = []): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [], packages }, () => NOW);
  writeFileSync(ctx.home.config, `# mi fábrica\n${readFileSync(ctx.home.config, "utf8")}`);
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const entries = (ctx: FactoryContext) => parseFactory(readFileSync(ctx.home.config, "utf8")).packages;
const gitRoot = (ctx: FactoryContext) => join(ctx.home.packages, "git");
const leftInGitRoot = (ctx: FactoryContext) => (existsSync(gitRoot(ctx)) ? readdirSync(gitRoot(ctx)) : []);
const yes = async () => true;

/** A factory with the package already added from `repo`. */
async function installed(repo: string, opts: { allowCode?: boolean; lock?: boolean } = {}) {
  const ctx = await factory();
  const { git } = gitTo({ [URL_V]: repo });
  await packageAdd(ctx, { source: SOURCE, allowCode: opts.allowCode, git, confirm: yes, deps: async () => undefined });
  return { ctx, dir: join(gitRoot(ctx), "hello"), git };
}

/** Fakes that record the order things happen in; the git calls join the order through `order`. */
function fakes(git: GitRunner, status: ShutdownResult["status"] = "stopped", pid?: number) {
  const order: string[] = [];
  const shutdown = vi.fn(async (): Promise<ShutdownResult> => {
    order.push("shutdown");
    return { status, ...(pid && { pid }) };
  });
  const start = vi.fn(async () => {
    order.push("start");
    return true;
  });
  const deps = vi.fn(async (_dir: string) => void order.push("deps"));
  const confirm = vi.fn(async (_q: string) => true);
  const tracked: GitRunner = async (args, opts) => {
    if (args[0] === "checkout") order.push("checkout");
    return git(args, opts);
  };
  const input: PackageUpdateInput = { git: tracked, deps, confirm, daemon: { shutdown, start } };
  return { order, shutdown, start, deps, confirm, input };
}

const head = (dir: string) => gitIn(dir, "rev-parse", "HEAD");

/** A commit whose manifest is a link to another file; written in the index, so it needs no links on this machine. */
function commitLinkedManifest(repo: string, target: string, content: string): string {
  writeTree(repo, { [target]: content, "link-target": target });
  gitIn(repo, "add", "-A");
  const blob = gitIn(repo, "hash-object", "-w", "--no-filters", "link-target");
  gitIn(repo, "rm", "-q", "--cached", "link-target");
  gitIn(repo, "update-index", "--add", "--cacheinfo", `120000,${blob},zero-package.yaml`);
  gitIn(repo, "commit", "-q", "-m", "manifiesto enlazado");
  return gitIn(repo, "rev-parse", "HEAD");
}

describe("git sources", () => {
  it("reads the short github form with a reference", () => {
    expect(parseGitSource("github:acme/hola#v1")).toEqual({ url: URL_V, ref: "v1" });
    expect(parseGitSource("github:acme/hola")).toEqual({ url: URL_V });
    expect(parseGitSource("github:acme/hola.git#ramas/una")).toEqual({ url: URL_V, ref: "ramas/una" });
  });

  it("accepts the URL forms", () => {
    expect(parseGitSource("https://host/a/b.git")).toEqual({ url: "https://host/a/b.git" });
    expect(parseGitSource("ssh://git@host/a/b.git#main")).toEqual({ url: "ssh://git@host/a/b.git", ref: "main" });
    expect(parseGitSource("git@host:a/b.git")).toEqual({ url: "git@host:a/b.git" });
  });

  it.each(["github:acme/hola#v1", "https://host/a/b.git", "ssh://git@host/a.git", "git@host:a/b.git", "http://host/a.git", "ext::sh -c x", "file:///tmp/a", "git:pw@host:a/b.git"])("classifies %s as git", (source) => {
    expect(isGitSource(source)).toBe(true);
  });

  it.each(["./hello", "C:\\paquetes\\hello", "D:/paquetes/hello", "/tmp/hello", "hello-zero", "@acme/hello-zero"])("leaves %s to folders and npm", (source) => {
    expect(isGitSource(source)).toBe(false);
  });

  it.each(["https://usuario:tok3n@host/a/b.git", "https://tok3n@host/a/b.git", "ssh://git:tok3n@host/a.git", "git:tok3n@host:a/b.git", "https://host/a.git?t=tok3n"])("refuses credentials in %s, without repeating them and without git", async (source) => {
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const git = failingGit();
    const err: Error = await packageAdd(ctx, { source, git, confirm: yes }).then(() => {
      throw new Error("it should have refused");
    }, (e) => e);
    expect(err.message).toMatch(/No se puede agregar/);
    expect(err.message).not.toContain("tok3n");
    expect(git).not.toHaveBeenCalled();
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it.each(["http://host/a.git", "ext::sh -c x", "file:///tmp/a", "github:a/b#--upload-pack=x", "github:a/b#a..b", "https://host/a.git#-x", "ssh://-oProxyCommand=x/a.git", "git@-oProxy:a.git", "git@host:-a.git", "git://host/a.git"])("refuses %s without git", async (source) => {
    const ctx = await factory();
    const git = failingGit();
    await expect(packageAdd(ctx, { source, git, confirm: yes })).rejects.toThrow(/No se puede agregar/);
    expect(git).not.toHaveBeenCalled();
    expect(leftInGitRoot(ctx)).toEqual([]);
  });

  it("refuses credentials in the factory file", () => {
    const text = (git: string) => stringify({ lines: [], packages: [{ git, path: "/x", commit: "a".repeat(40) }] });
    expect(() => parseFactory(text("https://usuario:tok3n@host/a.git"))).toThrow(ConfigError);
    expect(() => parseFactory(text("https://usuario:tok3n@host/a.git"))).not.toThrow(/tok3n/);
    expect(parseFactory(text("github:acme/hola")).packages[0]!.git).toBe("github:acme/hola");
  });

  it("requires path and commit next to git, and no npm", () => {
    const sha = "a".repeat(40);
    const load = (entry: unknown) => () => parseFactory(stringify({ lines: [], packages: [entry] }));
    expect(load({ git: SOURCE, path: "/x" })).toThrow(ConfigError);
    expect(load({ git: SOURCE, npm: "x", commit: sha })).toThrow(ConfigError);
    expect(load({ git: SOURCE, path: "/x", npm: "x", commit: sha })).toThrow(ConfigError);
    expect(load({ path: "/x", commit: sha })).toThrow(ConfigError);
    expect(load({ git: SOURCE, path: "/x", commit: "corto" })).toThrow(ConfigError);
    expect(load({ path: "/x", npm: "x" })).toThrow(/exactamente uno de path o npm/);
  });
});

describe("the real git runner", () => {
  it("never asks and only speaks https and ssh", async () => {
    const env = await realGit(["-c", "alias.vars=!env", "vars"]);
    expect(env).toMatch(/^GIT_TERMINAL_PROMPT=0$/m);
    expect(env).toMatch(/^GIT_ALLOW_PROTOCOL=https:ssh$/m);
    expect(gitEnv()).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https:ssh" });
  });

  it("gives it no stdin to wait on", async () => {
    expect(await realGit(["-c", "alias.reads=!cat", "reads"])).toBe("");
  });

  it("refuses the file protocol, and its errors carry no credentials", async () => {
    const repo = gitRepo();
    await expect(realGit(["ls-remote", `file://${repo.replace(/\\/g, "/")}`])).rejects.toThrow(/git ls-remote/);
    await expect(realGit(["ls-remote", "https://usuario:tok3n@127.0.0.1:1/a.git"])).rejects.not.toThrow(/tok3n/);
  });
});

/** The programs a repository could plant to be started instead of the real ones; the scripts leave a mark if they ever run. */
const planted = (name: string) => ({
  [`${name}.exe`]: "no soy un programa\n",
  [`${name}.com`]: "no soy un programa\n",
  [`${name}.cmd`]: "@echo plantado> plantado.txt\r\n",
  [`${name}.bat`]: "@echo plantado> plantado.txt\r\n",
  [name]: "#!/bin/sh\necho plantado > plantado.txt\n",
});
const outside = (dir: string, path: unknown) => relative(dir, String(path)).startsWith("..") || isAbsolute(relative(dir, String(path)));

describe("programs planted in a package's folder", () => {
  it("git is the one on PATH, started from outside the folder", async () => {
    const repo = packageRepo({}, planted("git"));
    const sha = gitIn(repo, "rev-parse", "HEAD");
    vi.mocked(spawn).mockClear();
    expect(await realGit(["rev-parse", "HEAD"], { cwd: repo })).toBe(sha);
    expect(await manifestNotAFile(realGit, repo, sha)).toBe(false);
    expect((await manifestAt(realGit, repo, sha))?.name).toBe("hello");
    expect(await realGit(["status", "--porcelain", "--untracked-files=no"], { cwd: repo })).toBe("");
    expect(existsSync(join(repo, "plantado.txt"))).toBe(false);
    expect(vi.mocked(spawn).mock.calls).toHaveLength(4);
    for (const [command, args, opts] of vi.mocked(spawn).mock.calls) {
      expect(isAbsolute(command)).toBe(true);
      expect(outside(repo, command)).toBe(true);
      expect(args.slice(0, 2)).toEqual(["-C", repo]);
      expect(outside(repo, opts.cwd)).toBe(true);
      expect(opts.shell).toBe(false);
      expect(opts.env?.NoDefaultCurrentDirectoryInExePath).toBe("1");
    }
  });

  it("npm is the one on PATH, with no shell and the folder as --prefix", async () => {
    const dir = tempDir();
    const dep = { dep: "file:vendor/dep" };
    writeTree(dir, {
      ...planted("npm"),
      "package.json": JSON.stringify({ name: "p", version: "1.0.0", dependencies: dep }),
      "package-lock.json": JSON.stringify({ name: "p", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "p", version: "1.0.0", dependencies: dep }, "node_modules/dep": { resolved: "vendor/dep", link: true }, "vendor/dep": { version: "1.0.0" } } }),
      "vendor/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      ".npmrc": "git=./git.cmd\n",
    });
    vi.mocked(spawn).mockClear();
    await realDependencies(dir);
    expect(existsSync(join(dir, "plantado.txt"))).toBe(false);
    expect(existsSync(join(dir, "node_modules", "dep", "package.json"))).toBe(true);
    const [command, args, opts] = vi.mocked(spawn).mock.calls[0]!;
    expect(isAbsolute(command)).toBe(true);
    expect(outside(dir, command)).toBe(true);
    expect(args.slice(-2)).toEqual(["--prefix", dir]);
    expect(args).toEqual(expect.arrayContaining(npmCiArgs()));
    expect(outside(dir, opts.cwd)).toBe(true);
    expect(opts.shell).toBe(false);
    expect(opts.env?.NoDefaultCurrentDirectoryInExePath).toBe("1");
    expect(isAbsolute(String(opts.env?.npm_config_git))).toBe(true);
    expect(opts.env?.npm_config_allow_git).toBe("none");
  }, 120_000);

  it("the rest of npm goes the same way", async () => {
    vi.mocked(spawn).mockClear();
    expect(await runNpm(["--version"], 60_000)).toMatch(/^\d+\./);
    const [command, , opts] = vi.mocked(spawn).mock.calls[0]!;
    expect(isAbsolute(command)).toBe(true);
    expect(opts.shell).toBe(false);
  }, 60_000);

  it("PATH only counts when it is absolute", () => {
    const near = tempDir();
    const real = tempDir();
    for (const dir of [near, real]) {
      writeFileSync(join(dir, "herramienta.exe"), "");
      chmodSync(join(dir, "herramienta.exe"), 0o755);
    }
    expect(findOnPath("herramienta", [".exe"], [".", "", relative(process.cwd(), near), `"${real}"`].join(delimiter))).toBe(join(real, "herramienta.exe"));
    expect(findOnPath("herramienta", [".exe"], [".", ""].join(delimiter))).toBeUndefined();
  });

  it("starts npm through this Node, and refuses an npm only a shell could start", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "npm.cmd"), "");
    writeFileSync(join(dir, "npm"), "");
    chmodSync(join(dir, "npm"), 0o755);
    if (process.platform === "win32") expect(() => npmCommand(dir)).toThrow(/npm-cli\.js/);
    writeTree(dir, { "node_modules/npm/bin/npm-cli.js": "" });
    expect(npmCommand(dir)).toEqual([process.execPath, join(dir, "node_modules", "npm", "bin", "npm-cli.js")]);
    expect(() => npmCommand("")).toThrow(/npm/);
  });
});

describe("adding from git", () => {
  it("clones into its folder at the reference asked for", async () => {
    const repo = packageRepo();
    const v1 = gitIn(repo, "rev-parse", "HEAD");
    gitIn(repo, "tag", "-a", "v1", "-m", "uno");
    commit(repo, "later", { "otro.md": "x\n" });
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: repo });
    await packageAdd(ctx, { source: "github:acme/hola#v1", git, confirm: yes });
    const dir = join(gitRoot(ctx), "hello");
    expect(existsSync(join(dir, "zero-package.yaml"))).toBe(true);
    expect(head(dir)).toBe(v1);
    expect(readdirSync(gitRoot(ctx))).toEqual(["hello"]);
  });

  it("writes the entry keeping the comments, and its stations load", async () => {
    const repo = packageRepo({ stations: [station()] }, STATION_FILE);
    gitIn(repo, "tag", "v1");
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: repo });
    await packageAdd(ctx, { source: "github:acme/hola#v1", allowCode: true, git, confirm: yes });
    const dir = join(gitRoot(ctx), "hello");
    expect(entries(ctx)).toEqual([{ git: "github:acme/hola#v1", path: dir, commit: head(dir), allowCode: true }]);
    expect(head(dir)).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(ctx.home.config, "utf8")).toContain("# mi fábrica");
    expect(ctx.config.loadedPackages!.stations.map((s) => s.name)).toEqual(["nota"]);
  });

  it("opens the factory with the package loaded from path", async () => {
    const { ctx, dir } = await installed(packageRepo(AGENT, AGENT_FILE));
    const config = await factoryConfig(ctx.home);
    expect(config.loadedPackages!.problems).toEqual([]);
    expect(config.loadedPackages!.packages[0]).toMatchObject({ name: "hello", agents: ["hello-review"] });
    expect(config.loadedPackages!.packages[0]!.entry.path).toBe(dir);
  });

  it("shows everything it brings before asking", async () => {
    const repo = packageRepo({ ...AGENT, skills: ["skills/saludo"], stations: [station({ secrets: ["HELLO_TOKEN"] })] }, { ...AGENT_FILE, ...STATION_FILE, "skills/saludo/SKILL.md": "# saludo\n" });
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: repo });
    const said: string[] = [];
    const confirm = vi.fn(async (q: string) => {
      said.push(q);
      return false;
    });
    await packageAdd(ctx, { source: SOURCE, git, confirm, say: (t) => said.push(t) });
    const text = said.join("\n");
    for (const piece of ["hello-review", "skills/saludo", "nota", "HELLO_TOKEN", "pide permiso de código: sí"]) expect(text).toContain(piece);
    expect(said.at(-1)).toMatch(/¿Instalo hello\?/);
  });

  it("leaves everything as it was when the answer is no", async () => {
    const repo = packageRepo({}, { "package-lock.json": "{}\n" });
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const { git } = gitTo({ [URL_V]: repo });
    const deps = vi.fn(async () => undefined);
    expect(await packageAdd(ctx, { source: SOURCE, git, deps, confirm: async () => false })).toMatch(/No instalé nada/);
    expect(leftInGitRoot(ctx)).toEqual([]);
    expect(deps).not.toHaveBeenCalled();
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it("installs nothing without anyone to consent", async () => {
    const repo = packageRepo();
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: repo });
    expect(await packageAdd(ctx, { source: SOURCE, git })).toMatch(/No instalé nada/);
    expect(leftInGitRoot(ctx)).toEqual([]);
    expect(entries(ctx)).toEqual([]);
  });

  it("from the command line, a remote that fails leaves nothing and exits with 1, and so does an unknown name", async () => {
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "package", "add", "https://127.0.0.1:1/a.git"], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root, GIT_TERMINAL_PROMPT: "0" }, input: "", windowsHide: true });
    expect(r.status).toBe(1);
    expect(leftInGitRoot(ctx)).toEqual([]);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
    const update = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "package", "update", "fantasma"], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
    expect(update.status).toBe(1);
    expect(update.stdout).toMatch(/No existe un paquete fantasma/);
  });

  it("installs dependencies without scripts when there is a lock", async () => {
    const repo = packageRepo({}, { "package-lock.json": "{}\n" });
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: repo });
    const deps = vi.fn(async (_dir: string) => undefined);
    await packageAdd(ctx, { source: SOURCE, git, deps, confirm: yes });
    expect(deps.mock.calls).toEqual([[join(gitRoot(ctx), "hello")]]);
    expect(npmCiArgs()).toEqual(expect.arrayContaining(["ci", "--omit=dev", "--ignore-scripts"]));
  });

  it("does not install dependencies without a lock", async () => {
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: packageRepo() });
    const deps = vi.fn(async () => undefined);
    await packageAdd(ctx, { source: SOURCE, git, deps, confirm: yes });
    expect(deps).not.toHaveBeenCalled();
    expect(entries(ctx)).toHaveLength(1);
  });

  it("removes the clone when dependencies fail", async () => {
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const { git } = gitTo({ [URL_V]: packageRepo({}, { "package-lock.json": "{}\n" }) });
    await expect(packageAdd(ctx, { source: SOURCE, git, deps: async () => Promise.reject(new Error("npm roto")), confirm: yes })).rejects.toThrow(/npm roto/);
    expect(leftInGitRoot(ctx)).toEqual([]);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it.each([
    ["no manifest", gitRepo, /zero-package\.yaml/],
    ["another interface", () => packageRepo({ interface: 2 }), /interfaz 2/],
  ])("refuses a repository with %s without asking", async (_label, repo, reason) => {
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const { git } = gitTo({ [URL_V]: repo() });
    const confirm = vi.fn(yes);
    await expect(packageAdd(ctx, { source: SOURCE, git, confirm })).rejects.toThrow(reason);
    expect(confirm).not.toHaveBeenCalled();
    expect(leftInGitRoot(ctx)).toEqual([]);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it("refuses a package that does not fit, naming what collides", async () => {
    const { ctx } = await installed(packageRepo(AGENT, AGENT_FILE));
    const before = readFileSync(ctx.home.config, "utf8");
    const { git } = gitTo({ "https://github.com/acme/otro.git": packageRepo({ name: "otro", ...AGENT }, { ...AGENT_FILE, "package-lock.json": "{}\n" }) });
    const deps = vi.fn(async () => undefined);
    await expect(packageAdd(ctx, { source: "github:acme/otro", git, deps, confirm: yes })).rejects.toThrow(/"hello-review"/);
    expect(deps).not.toHaveBeenCalled();
    expect(readdirSync(gitRoot(ctx))).toEqual(["hello"]);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it("refuses a folder already there that no entry declares with that source", async () => {
    const ctx = await factory();
    const taken = join(gitRoot(ctx), "hello");
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, "mio.txt"), "mío");
    const { git } = gitTo({ [URL_V]: packageRepo() });
    await expect(packageAdd(ctx, { source: SOURCE, git, confirm: yes })).rejects.toThrow(taken);
    expect(readdirSync(taken)).toEqual(["mio.txt"]);
    expect(readFileSync(join(taken, "mio.txt"), "utf8")).toBe("mío");
    expect(readdirSync(gitRoot(ctx))).toEqual(["hello"]);
  });

  it("only updates the permission when the source is already declared", async () => {
    const { ctx } = await installed(packageRepo({ stations: [station()] }, STATION_FILE));
    const git = failingGit();
    await packageAdd(ctx, { source: SOURCE, allowCode: true, git, confirm: yes });
    expect(git).not.toHaveBeenCalled();
    expect(entries(ctx)).toHaveLength(1);
    expect(entries(ctx)[0]!.allowCode).toBe(true);
  });

  it("removes a git package by its source too, leaving its files", async () => {
    const { ctx, dir } = await installed(packageRepo());
    expect(await packageRemove(ctx, { name: SOURCE })).toContain(dir);
    expect(entries(ctx)).toEqual([]);
    expect(existsSync(join(dir, "zero-package.yaml"))).toBe(true);
  });
});

describe("adding a folder", () => {
  it("stays as it was: path, no git, nothing asked", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText() });
    const ctx = await factory();
    const confirm = vi.fn(yes);
    const git = failingGit();
    await packageAdd(ctx, { source: dir, git, confirm });
    expect(entries(ctx)).toEqual([{ path: dir, allowCode: false }]);
    expect(confirm).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });
});

describe("adding from git: a manifest that is a link", () => {
  it("refuses it and leaves nothing", async () => {
    const repo = packageRepo();
    commitLinkedManifest(repo, "real.yaml", manifestText());
    const ctx = await factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const { git } = gitTo({ [URL_V]: repo });
    const confirm = vi.fn(yes);
    await expect(packageAdd(ctx, { source: SOURCE, git, confirm })).rejects.toThrow(/no es un archivo común/);
    expect(confirm).not.toHaveBeenCalled();
    expect(leftInGitRoot(ctx)).toEqual([]);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });
});

describe("updating from git: what it shows", () => {
  it("lists the new commits and both short commits", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "primer cambio", { "a.md": "a\n" });
    const to = commit(repo, "segundo cambio", { "b.md": "b\n" });
    const { input } = fakes(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(false);
    for (const piece of ["primer cambio", "segundo cambio", from.slice(0, 7), to.slice(0, 7)]) expect(text).toContain(piece);
  });

  it("cleans what a commit subject could do to the terminal", async () => {
    const repo = packageRepo();
    const { ctx, git } = await installed(repo);
    commit(repo, "cambio\u001b[31m rojo", { "a.md": "a\n" });
    const { input } = fakes(git);
    const { text } = await packageUpdate(ctx, input);
    expect(text).not.toContain("\u001b");
    expect(text).toContain("rojo");
  });

  it("says it is up to date and leaves the factory alone", async () => {
    const { ctx, git } = await installed(packageRepo());
    const { input, shutdown, start } = fakes(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(text).toMatch(/al día/);
    expect(failed).toBe(false);
    expect(shutdown).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("names a new declared secret", async () => {
    const repo = packageRepo({ stations: [station()] }, STATION_FILE);
    const { ctx, git } = await installed(repo);
    commit(repo, "pide otro", { "zero-package.yaml": manifestText({ stations: [station({ secrets: ["OTRO"] })] }) });
    const { input } = fakes(git);
    expect((await packageUpdate(ctx, input)).text).toMatch(/Secreto nuevo: OTRO/);
  });

  it("says when the name does not exist", async () => {
    const ctx = await factory();
    const { input } = fakes(failingGit());
    const { text, failed } = await packageUpdate(ctx, { ...input, name: "fantasma" });
    expect(text).toMatch(/No existe un paquete fantasma/);
    expect(failed).toBe(true);
  });

  it("only updates the package named", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    const extra = tempDir("zero-pkg-");
    writeTree(extra, { "zero-package.yaml": manifestText({ name: "otro" }), "package-lock.json": "{}\n" });
    await packageAdd(ctx, { source: extra });
    writeFileSync(join(extra, "package-lock.json"), '{"a":1}\n');
    commit(repo, "nuevo", { "a.md": "a\n" });
    const { input, deps } = fakes(git);
    await packageUpdate(ctx, { ...input, name: "otro" });
    expect(deps).toHaveBeenCalledTimes(1);
    expect(head(dir)).toBe(from);
  });
});

describe("updating from git: asking when it asks for more", () => {
  it("leaves all as it was when the answer is no", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    const before = readFileSync(ctx.home.config, "utf8");
    commit(repo, "con estación", { "zero-package.yaml": manifestText({ stations: [station()] }), ...STATION_FILE });
    const { input, shutdown, confirm } = fakes(git);
    confirm.mockResolvedValue(false);
    const { failed } = await packageUpdate(ctx, input);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(failed).toBe(false);
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(entries(ctx)[0]!.commit).toBe(from);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
    expect(formatPackages(packageList(ctx))).toMatch(/hay una actualización/);
  });

  it("applies when the answer is yes", async () => {
    const repo = packageRepo({ stations: [station()] }, STATION_FILE);
    const { ctx, dir, git } = await installed(repo);
    const to = commit(repo, "otro secreto", { "zero-package.yaml": manifestText({ stations: [station({ secrets: ["OTRO"] })] }) });
    const { input, confirm } = fakes(git);
    await packageUpdate(ctx, input);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(head(dir)).toBe(to);
  });

  it("does not ask when it asks for no more", async () => {
    const repo = packageRepo({ stations: [station({ secrets: ["VIEJO"] })] }, { ...STATION_FILE, "x.md": "uno\n" });
    const { ctx, dir, git } = await installed(repo);
    const to = commit(repo, "menos", { "zero-package.yaml": manifestText({ stations: [station()] }), "x.md": "dos\n" });
    const { input, confirm } = fakes(git);
    const { text } = await packageUpdate(ctx, input);
    expect(confirm).not.toHaveBeenCalled();
    expect(head(dir)).toBe(to);
    expect(text).toMatch(/ya no declara: VIEJO/);
  });

  it("nobody to consent is a no", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "con estación", { "zero-package.yaml": manifestText({ stations: [station()] }), ...STATION_FILE });
    const { input } = fakes(git);
    await packageUpdate(ctx, { ...input, confirm: undefined });
    expect(head(dir)).toBe(from);
  });

  it("refuses a manifest that became a link, without asking or stopping the factory", async () => {
    const repo = packageRepo({ stations: [station()] }, STATION_FILE);
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commitLinkedManifest(repo, "real.yaml", manifestText({ stations: [station({ secrets: ["OTRO"] })] }));
    const { input, shutdown, confirm } = fakes(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toMatch(/no es un archivo común/);
    expect(confirm).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(entries(ctx)[0]!.commit).toBe(from);
  });

  it.each([
    ["is not valid", manifestText({ interface: 2 })],
    ["is empty", ""],
  ])("refuses a commit whose manifest %s, since it cannot tell what it asks for", async (_what, text) => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "sin manifiesto legible", { "zero-package.yaml": text });
    const { input, shutdown, confirm } = fakes(git);
    const result = await packageUpdate(ctx, input);
    expect(result.failed).toBe(true);
    expect(result.text).toMatch(/no se sabe qué pide/);
    expect(confirm).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(entries(ctx)[0]!.commit).toBe(from);
  });

  it("does not go ahead when the commit's manifest cannot be read", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "con estación", { "zero-package.yaml": manifestText({ stations: [station()] }), ...STATION_FILE });
    const blind: GitRunner = (args, opts) => (args[0] === "show" ? Promise.reject(new Error("git show: roto")) : git(args, opts));
    const { input, shutdown, confirm } = fakes(blind);
    const { failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
  });

  it("goes back when the manifest on disk is not the one it judged", async () => {
    const repo = packageRepo({ stations: [station()] }, STATION_FILE);
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "otro secreto", { "zero-package.yaml": manifestText({ stations: [station({ secrets: ["OTRO"] })] }) });
    const told: GitRunner = (args, opts) => (args[0] === "show" ? Promise.resolve(manifestText({ stations: [station()] })) : git(args, opts));
    const { input, confirm, start } = fakes(told);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toMatch(/no es el que se mostró/);
    expect(confirm).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(entries(ctx)[0]!.commit).toBe(from);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("counts as more what the manifest newly asks for", () => {
    const m = (over: Record<string, unknown>) => ManifestSchema.parse({ interface: 1, name: "a", version: "1", ...over });
    const review = { name: "r", instructions: "r.md" };
    const build = { name: "r", instructions: "r.md", type: "build" };
    const limited = (n: number) => station({ requests: { perLinePerDay: n } });
    expect(widening(m({ agents: [review] }), m({ agents: [build] })).buildAgents).toEqual(["r"]);
    expect(widening(m({}), m({ agents: [build] })).buildAgents).toEqual(["r"]);
    expect(widening(m({ agents: [build] }), m({ agents: [build] })).buildAgents).toEqual([]);
    expect(widening(m({}), m({ agents: [review] })).buildAgents).toEqual([]);
    expect(widening(m({ stations: [station()] }), m({ stations: [limited(1)] })).requests).toEqual(["nota"]);
    expect(widening(m({ stations: [limited(1)] }), m({ stations: [limited(2)] })).requests).toEqual(["nota"]);
    expect(widening(m({ stations: [limited(2)] }), m({ stations: [limited(1)] })).requests).toEqual([]);
    expect(widening(undefined, m({ stations: [station()] })).stations).toEqual(["nota"]);
  });
});

describe("applying with the factory off", () => {
  it("shuts down before touching anything and starts after", async () => {
    const repo = packageRepo({}, { "package-lock.json": "{}\n" });
    const { ctx, git } = await installed(repo);
    commit(repo, "nuevo", { "a.md": "a\n" });
    const { input, order } = fakes(git);
    await packageUpdate(ctx, input);
    expect(order).toEqual(["shutdown", "checkout", "deps", "start"]);
  });

  it("does not start a factory that was off", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const to = commit(repo, "nuevo", { "a.md": "a\n" });
    const { input, start } = fakes(git, "not-running");
    await packageUpdate(ctx, input);
    expect(head(dir)).toBe(to);
    expect(start).not.toHaveBeenCalled();
  });

  it("goes on after a package fails, with one shutdown and one start", async () => {
    const first = packageRepo({ name: "uno" });
    const second = packageRepo({ name: "dos" });
    const ctx = await factory();
    const { git } = gitTo({ "https://github.com/acme/uno.git": first, "https://github.com/acme/dos.git": second });
    await packageAdd(ctx, { source: "github:acme/uno", git, confirm: yes });
    await packageAdd(ctx, { source: "github:acme/dos", git, confirm: yes });
    commit(first, "se rompe", { "zero-package.yaml": manifestText({ name: "uno", interface: 2 }) });
    const to = commit(second, "bien", { "a.md": "a\n" });
    const { input, shutdown, start } = fakes(git);
    const { failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(head(join(gitRoot(ctx), "dos"))).toBe(to);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("touches nothing when the factory does not stop", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "nuevo", { "a.md": "a\n" });
    const { input, start, order } = fakes(git, "timeout", 4242);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toContain("4242");
    expect(text).toMatch(/pedido de apagado/);
    expect(start).not.toHaveBeenCalled();
    expect(order).toEqual(["shutdown"]);
    expect(head(dir)).toBe(from);
  });

  it("records the new commit, keeping the file's comments", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const to = commit(repo, "nuevo", { "a.md": "a\n" });
    const { input } = fakes(git);
    expect((await packageUpdate(ctx, input)).failed).toBe(false);
    expect(entries(ctx)[0]!.commit).toBe(to);
    expect(head(dir)).toBe(to);
    expect(readFileSync(ctx.home.config, "utf8")).toContain("# mi fábrica");
  });
});

describe("going back to the previous commit", () => {
  it("returns when the new manifest cannot load", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "sin archivo", { "zero-package.yaml": manifestText(AGENT) });
    const { input, start } = fakes(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(head(dir)).toBe(from);
    expect(entries(ctx)[0]!.commit).toBe(from);
    expect(text).toMatch(/agents\/review\.md/);
    expect(failed).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("returns and reinstalls the previous dependencies when they fail", async () => {
    const repo = packageRepo({}, { "package-lock.json": "{}\n" });
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "lock nuevo", { "package-lock.json": '{"a":1}\n' });
    const { input, deps } = fakes(git);
    const seen: string[] = [];
    deps.mockImplementationOnce(async (d) => {
      seen.push(readFileSync(join(d, "package-lock.json"), "utf8").trim());
      throw new Error("npm roto");
    });
    deps.mockImplementationOnce(async (d) => void seen.push(readFileSync(join(d, "package-lock.json"), "utf8").trim()));
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toContain("npm roto");
    expect(seen).toEqual(['{"a":1}', "{}"]);
    expect(head(dir)).toBe(from);
    expect(entries(ctx)[0]!.commit).toBe(from);
  });

  it("returns when the name changes, and says so", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    commit(repo, "otro nombre", { "zero-package.yaml": manifestText({ name: "chau" }) });
    const { input } = fakes(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(head(dir)).toBe(from);
    expect(failed).toBe(true);
    expect(text).toMatch(/cambia el nombre/);
  });

  it("returns when it no longer fits with the others", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    const extra = tempDir("zero-pkg-");
    writeTree(extra, { "zero-package.yaml": manifestText({ name: "otro", ...AGENT }), ...AGENT_FILE });
    await packageAdd(ctx, { source: extra });
    commit(repo, "repite", { "zero-package.yaml": manifestText(AGENT), ...AGENT_FILE });
    const { input } = fakes(git);
    const { text, failed } = await packageUpdate(ctx, { ...input, name: "hello" });
    expect(head(dir)).toBe(from);
    expect(failed).toBe(true);
    expect(text).toContain("hello-review");
  });
});

describe("what protects a package's folder", () => {
  const expectRefused = async (ctx: FactoryContext, git: GitRunner) => {
    const { input, shutdown } = fakes(git);
    const { failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(shutdown).not.toHaveBeenCalled();
  };

  it("refuses a folder outside packages/git", async () => {
    const repo = packageRepo();
    const sha = head(repo);
    const remote = packageRepo();
    commit(remote, "nuevo", { "a.md": "a\n" });
    const ctx = await factory([{ git: SOURCE, path: repo, commit: sha }]);
    await expectRefused(ctx, gitTo({ [URL_V]: remote }).git);
    expect(head(repo)).toBe(sha);
  });

  it("refuses a folder without its own .git, inside another repository", async () => {
    const ctx = await factory();
    const dir = join(gitRoot(ctx), "hello");
    writeTree(dir, { "zero-package.yaml": manifestText() });
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: ctx.home.root });
    gitIn(ctx.home.root, "add", join("packages", "git"));
    gitIn(ctx.home.root, "commit", "-q", "-m", "outer");
    const outer = head(ctx.home.root);
    writeFileSync(ctx.home.config, stringify({ isolation: "worktree", level: "L2", lines: [], packages: [{ git: SOURCE, path: dir, commit: outer }] }));
    ctx.config = await factoryConfig(ctx.home);
    await expectRefused(ctx, gitTo({}).git);
    expect(head(ctx.home.root)).toBe(outer);
  });

  it("refuses local changes in tracked files, keeping them", async () => {
    const repo = packageRepo({}, { "x.md": "uno\n" });
    const { ctx, dir, git } = await installed(repo);
    writeFileSync(join(dir, "x.md"), "mío\n");
    commit(repo, "nuevo", { "a.md": "a\n" });
    await expectRefused(ctx, git);
    expect(readFileSync(join(dir, "x.md"), "utf8")).toBe("mío\n");
  });

  it("does not mind untracked files such as node_modules", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    writeTree(dir, { "node_modules/x/index.js": "1\n" });
    const to = commit(repo, "nuevo", { "a.md": "a\n" });
    const { input } = fakes(git);
    expect((await packageUpdate(ctx, input)).failed).toBe(false);
    expect(head(dir)).toBe(to);
  });
});

describe("updating a folder", () => {
  async function folderPackage(files: Record<string, string> = { "package-lock.json": "{}\n" }) {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText(), ...files });
    const ctx = await factory();
    await packageAdd(ctx, { source: dir });
    return { ctx, dir };
  }

  it("leaves it alone while the lock stays the same", async () => {
    const { ctx } = await folderPackage();
    const { input, deps, shutdown } = fakes(failingGit());
    const { text } = await packageUpdate(ctx, input);
    expect(deps).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    expect(text).toMatch(/al día/);
  });

  it("reinstalls once when the lock changes", async () => {
    const { ctx, dir } = await folderPackage();
    writeFileSync(join(dir, "package-lock.json"), '{"a":1}\n');
    const { input, deps, shutdown, start, order } = fakes(failingGit());
    await packageUpdate(ctx, input);
    expect(order).toEqual(["shutdown", "deps", "start"]);
    await packageUpdate(ctx, input);
    expect(deps).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("reinstalls once for an earlier package with no record", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText(), "package-lock.json": "{}\n" });
    const ctx = await factory([{ path: dir }]);
    const { input, deps } = fakes(failingGit());
    await packageUpdate(ctx, input);
    await packageUpdate(ctx, input);
    expect(deps).toHaveBeenCalledTimes(1);
  });

  it("does not install without a lock", async () => {
    const { ctx } = await folderPackage({});
    const { input, deps } = fakes(failingGit());
    await packageUpdate(ctx, input);
    expect(deps).not.toHaveBeenCalled();
  });

  it("tries again next time when dependencies fail", async () => {
    const { ctx, dir } = await folderPackage();
    writeFileSync(join(dir, "package-lock.json"), '{"a":1}\n');
    const { input, deps, start } = fakes(failingGit());
    deps.mockRejectedValueOnce(new Error("npm roto"));
    expect((await packageUpdate(ctx, input)).failed).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect((await packageUpdate(ctx, input)).failed).toBe(false);
    expect(deps).toHaveBeenCalledTimes(2);
  });
});

describe("updating from npm", () => {
  const NPM = "@acme/hello-zero";

  async function npmPackage(version = "1.0.0") {
    const ctx = await factory();
    const folder = join(ctx.home.packages, "node_modules", NPM);
    writeTree(folder, { "zero-package.yaml": manifestText({ version }), "package.json": JSON.stringify({ name: NPM, version }) });
    writeFileSync(ctx.home.config, stringify({ isolation: "worktree", level: "L2", lines: [], packages: [{ npm: NPM }] }));
    ctx.config = await factoryConfig(ctx.home);
    return { ctx, folder };
  }

  it("installs the new version with the factory off", async () => {
    const { ctx, folder } = await npmPackage();
    const { input, order, deps } = fakes(failingGit());
    const install = vi.fn(async (dir: string, spec: string) => {
      order.push("install");
      writeTree(folder, { "zero-package.yaml": manifestText({ version: "2.0.0" }), "package.json": JSON.stringify({ name: NPM, version: "2.0.0" }) });
      expect(dir).toBe(ctx.home.packages);
      expect(spec).toBe(`${NPM}@2.0.0`);
    });
    const { failed } = await packageUpdate(ctx, { ...input, install, latest: async () => "2.0.0" });
    expect(failed).toBe(false);
    expect(order).toEqual(["shutdown", "install", "start"]);
    expect(deps).not.toHaveBeenCalled();
    expect(formatPackages(packageList(ctx))).not.toMatch(/hay una actualización/);
  });

  it("does nothing when it is up to date", async () => {
    const { ctx } = await npmPackage();
    const { input, shutdown } = fakes(failingGit());
    const install = vi.fn(async () => undefined);
    const { text } = await packageUpdate(ctx, { ...input, install, latest: async () => "1.0.0" });
    expect(text).toMatch(/al día/);
    expect(install).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("reports a version whose manifest stopped being valid, and starts again", async () => {
    const { ctx, folder } = await npmPackage();
    const { input, start } = fakes(failingGit());
    const install = vi.fn(async () => void writeTree(folder, { "zero-package.yaml": manifestText({ interface: 2 }) }));
    const { text, failed } = await packageUpdate(ctx, { ...input, install, latest: async () => "2.0.0" });
    expect(failed).toBe(true);
    expect(text).toMatch(/interfaz 2/);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("refuses a version it cannot hand back to npm", async () => {
    const { ctx } = await npmPackage();
    const { input, shutdown } = fakes(failingGit());
    const { failed } = await packageUpdate(ctx, { ...input, latest: async () => "1.0.0 & calc" });
    expect(failed).toBe(true);
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("shows a git package's source and short commit", async () => {
    const { ctx, dir } = await installed(packageRepo());
    const text = formatPackages(packageList(ctx));
    expect(text).toContain(SOURCE);
    expect(text).toContain(head(dir).slice(0, 7));
    expect(text).toContain("(git)");
    expect(packageList(ctx).packages[0]).toMatchObject({ source: "git", origin: SOURCE, installed: head(dir) });
  });

  it("warns when what was last seen differs, with the commit and date", async () => {
    const repo = packageRepo();
    const { ctx, git } = await installed(repo);
    const seen = commit(repo, "nuevo", { "a.md": "a\n" });
    await packageUpdatesPass(ctx, NOW, { git });
    const text = formatPackages(packageList(ctx));
    expect(text).toContain(`hay una actualización: ${seen.slice(0, 7)} (revisado 2026-11-04)`);
  });

  it("stops warning once applied", async () => {
    const repo = packageRepo();
    const { ctx, git } = await installed(repo);
    commit(repo, "nuevo", { "a.md": "a\n" });
    await packageUpdatesPass(ctx, NOW, { git });
    const { input } = fakes(git);
    await packageUpdate(ctx, input);
    expect(formatPackages(packageList(ctx))).not.toMatch(/hay una actualización/);
  });

  it("uses neither git nor npm, and shows a folder as before", async () => {
    const repo = packageRepo();
    const { ctx } = await installed(repo);
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText({ name: "carpeta" }) });
    await packageAdd(ctx, { source: dir });
    vi.mocked(spawn).mockClear();
    vi.mocked(spawnSync).mockClear();
    const folder = packageList(ctx).packages.find((p) => p.name === "carpeta")!;
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(folder).toMatchObject({ source: "path", origin: dir });
    expect(folder.installed).toBeUndefined();
    expect(formatPackages(packageList(ctx))).toContain(`carpeta 1.0.0 (carpeta): `);
  });
});

describe("the daily look at the remotes", () => {
  const sameDay = new Date(NOW.getTime() + 23 * 3_600_000);
  const nextDay = new Date(NOW.getTime() + 25 * 3_600_000);

  it("records what the remote has and leaves the folder as it is", async () => {
    const repo = packageRepo();
    const { ctx, dir, git } = await installed(repo);
    const from = head(dir);
    const seen = commit(repo, "nuevo", { "a.md": "a\n" });
    await packageUpdatesPass(ctx, NOW, { git });
    expect(readSeen(ctx.store, "hello")).toEqual({ seen, at: NOW.toISOString() });
    expect(head(dir)).toBe(from);
  });

  it("looks at most once per day", async () => {
    const { ctx, git, dir } = await installed(packageRepo());
    git.mockClear();
    await packageUpdatesPass(ctx, NOW, { git });
    expect(git).toHaveBeenCalledTimes(1);
    expect(git.mock.calls[0]![0][0]).toBe("ls-remote");
    expect(git.mock.calls[0]![1]!.cwd).not.toBe(dir);
    await packageUpdatesPass(ctx, sameDay, { git });
    expect(git).toHaveBeenCalledTimes(1);
    await packageUpdatesPass(ctx, nextDay, { git });
    expect(git).toHaveBeenCalledTimes(2);
  });

  it("keeps going when a remote fails, and leaves the failure on record", async () => {
    const first = packageRepo({ name: "uno" });
    const second = packageRepo({ name: "dos" });
    const ctx = await factory();
    const { git } = gitTo({ "https://github.com/acme/uno.git": first, "https://github.com/acme/dos.git": second });
    await packageAdd(ctx, { source: "github:acme/uno", git, confirm: yes });
    await packageAdd(ctx, { source: "github:acme/dos", git, confirm: yes });
    const seen = commit(second, "nuevo", { "a.md": "a\n" });
    const flaky = vi.fn<GitRunner>((args, opts) => (args.includes("https://github.com/acme/uno.git") ? Promise.reject(new Error("sin red")) : git(args, opts)));
    await expect(packageUpdatesPass(ctx, NOW, { git: flaky })).resolves.toBeUndefined();
    expect(readSeen(ctx.store, "uno")).toMatchObject({ error: expect.stringContaining("sin red") });
    expect(readSeen(ctx.store, "dos")).toMatchObject({ seen });
    expect(formatPackages(packageList(ctx))).toMatch(/no se pudo revisar.*sin red/);
  });

  it("asks npm for npm packages", async () => {
    const ctx = await factory();
    writeTree(join(ctx.home.packages, "node_modules", "hello-zero"), { "zero-package.yaml": manifestText(), "package.json": JSON.stringify({ version: "1.0.0" }) });
    writeFileSync(ctx.home.config, stringify({ isolation: "worktree", level: "L2", lines: [], packages: [{ npm: "hello-zero" }] }));
    ctx.config = await factoryConfig(ctx.home);
    await packageUpdatesPass(ctx, NOW, { git: failingGit(), latest: async () => "2.0.0" });
    expect(formatPackages(packageList(ctx))).toContain("hay una actualización: 2.0.0");
  });

  it("runs in the daemon when asked, and a remote that fails does not stop it", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText() });
    const ctx = await factory([{ git: "https://127.0.0.1:1/a.git", path: dir, commit: "a".repeat(40) }]);
    await runDaemon(ctx, { once: true, pollMs: 1, panel: false });
    expect(readSeen(ctx.store, "hello")).toBeUndefined();
    await runDaemon(ctx, { once: true, pollMs: 1, panel: false, packageUpdates: true });
    expect(readSeen(ctx.store, "hello")).toMatchObject({ at: NOW.toISOString(), error: expect.any(String) });
  });

  it("reads the commit of a reference from ls-remote, peeled when it is a tag", () => {
    const [a, b, c] = ["a", "b", "c"].map((x) => x.repeat(40));
    expect(remoteCommit(`${a}\trefs/tags/v1\n${b}\trefs/tags/v1^{}`, "v1")).toBe(b);
    expect(remoteCommit(`${a}\trefs/heads/x/main\n${b}\trefs/heads/main`, "main")).toBe(b);
    expect(remoteCommit(`${c}\tHEAD`, undefined)).toBe(c);
    expect(remoteCommit("", "v1")).toBeUndefined();
  });
});

describe("the daily look at annotated tags", () => {
  const PINNED = `${SOURCE}#v1`;

  /** A factory with the package added at `#v1`, through real git against a temporary repository. */
  async function pinned(repo: string) {
    const ctx = await factory();
    const { git } = gitTo({ [URL_V]: repo });
    await packageAdd(ctx, { source: PINNED, git, confirm: yes, deps: async () => undefined });
    const entry = entries(ctx)[0]!;
    return { ctx, git, installedAt: entry.commit!, dir: join(gitRoot(ctx), "hello") };
  }

  it("shows no notice for an annotated tag that did not move", async () => {
    const repo = packageRepo();
    gitIn(repo, "tag", "-a", "v1", "-m", "uno");
    const tagObject = gitIn(repo, "rev-parse", "v1");
    const { ctx, git, installedAt } = await pinned(repo);
    expect(tagObject).not.toBe(installedAt);
    await packageUpdatesPass(ctx, NOW, { git });
    expect(readSeen(ctx.store, "hello")?.seen).toBe(installedAt);
    expect(formatPackages(packageList(ctx))).not.toContain("hay una actualización");
  });

  it("records the new commit, not the tag object, when an annotated tag moves", async () => {
    const repo = packageRepo();
    gitIn(repo, "tag", "-a", "v1", "-m", "uno");
    const { ctx, git, dir, installedAt } = await pinned(repo);
    commit(repo, "nuevo", { "a.md": "a\n" });
    gitIn(repo, "tag", "-f", "-a", "v1", "-m", "dos");
    const moved = gitIn(repo, "rev-parse", "v1^{commit}");
    expect(moved).not.toBe(gitIn(repo, "rev-parse", "v1"));
    await packageUpdatesPass(ctx, NOW, { git });
    expect(readSeen(ctx.store, "hello")?.seen).toBe(moved);
    expect(formatPackages(packageList(ctx))).toContain(`hay una actualización: ${moved.slice(0, 7)}`);
    expect(head(dir)).toBe(installedAt);
  });

  it("shows no notice for a lightweight tag that did not move", async () => {
    const repo = packageRepo();
    gitIn(repo, "tag", "v1");
    const { ctx, git, installedAt } = await pinned(repo);
    await packageUpdatesPass(ctx, NOW, { git });
    expect(readSeen(ctx.store, "hello")?.seen).toBe(installedAt);
    expect(formatPackages(packageList(ctx))).not.toContain("hay una actualización");
  });

  it("asks ls-remote for the reference and its peeled line, and for HEAD when there is no reference", async () => {
    const repo = packageRepo({ name: "uno" });
    gitIn(repo, "tag", "-a", "v1", "-m", "uno");
    const other = packageRepo({ name: "dos" });
    const ctx = await factory();
    const { git } = gitTo({ "https://github.com/acme/uno.git": repo, "https://github.com/acme/dos.git": other });
    await packageAdd(ctx, { source: "github:acme/uno#v1", git, confirm: yes, deps: async () => undefined });
    await packageAdd(ctx, { source: "github:acme/dos", git, confirm: yes, deps: async () => undefined });
    git.mockClear();
    await packageUpdatesPass(ctx, NOW, { git });
    expect(git.mock.calls.map(([args]) => args)).toEqual([
      ["ls-remote", "--", "https://github.com/acme/uno.git", "v1", "v1^{}"],
      ["ls-remote", "--", "https://github.com/acme/dos.git", "HEAD"],
    ]);
  });
});
