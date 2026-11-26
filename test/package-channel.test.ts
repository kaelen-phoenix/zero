import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packageAdd, packageList, packageUpdate, type FactoryContext, type PackageUpdateInput, type ShutdownResult } from "../src/app.js";
import { PackageEntrySchema, parseFactory } from "../src/config.js";
import { formatPackages } from "../src/format.js";
import { packageUpdatesPass } from "../src/line/package-updates.js";
import { readSeen, recordLookFailed, recordSeen, type GitRunner } from "../src/package-install.js";
import { factoryConfig } from "../src/packages.js";
import { packagesPage } from "../src/panel/html.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

// Real processes, watched: the list must start none.
vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return { ...real, spawn: vi.fn(real.spawn), spawnSync: vi.fn(real.spawnSync) };
});

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-11-25T12:00:00Z");
const NEXT_DAY = new Date(NOW.getTime() + 25 * 3_600_000);
const URL_V = "https://github.com/acme/hola.git";
const SOURCE = "github:acme/hola";

const manifestText = (over: Record<string, unknown> = {}) => stringify({ interface: 1, name: "hello", version: "1.0.0", ...over });
const packageRepo = () => gitRepo({ "zero-package.yaml": manifestText() });

function commit(repo: string, subject: string, files: Record<string, string> = { [`${subject}.md`]: `${subject}\n` }): string {
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", subject);
  return gitIn(repo, "rev-parse", "HEAD");
}

const tag = (repo: string, name: string, at = "HEAD") => gitIn(repo, "tag", name, at);
const head = (dir: string) => gitIn(dir, "rev-parse", "HEAD");
const yes = async () => true;

/** Real git, with the package's URL reaching a temporary repository instead of the network. */
function gitTo(repo: string) {
  const insteadOf = ["-c", `url.${repo.replace(/\\/g, "/")}.insteadOf=${URL_V}`];
  return vi.fn<GitRunner>(async (args, opts = {}) => {
    const r = spawnSync("git", [...insteadOf, ...args], { cwd: opts.cwd, encoding: "utf8", env: { ...process.env, GIT_ALLOW_PROTOCOL: "file:https:ssh", GIT_TERMINAL_PROMPT: "0" } });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  });
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

const entry = (ctx: FactoryContext) => parseFactory(readFileSync(ctx.home.config, "utf8")).packages[0]!;
const fileText = (ctx: FactoryContext) => readFileSync(ctx.home.config, "utf8");
const folder = (ctx: FactoryContext) => join(ctx.home.packages, "git", "hello");

/** A factory with the package added from `repo`, from its tip unless told otherwise. */
async function installed(repo: string, opts: { source?: string; channel?: "estable" } = {}) {
  const ctx = await factory();
  const git = gitTo(repo);
  await packageAdd(ctx, { source: opts.source ?? SOURCE, ...(opts.channel && { channel: opts.channel }), git, confirm: yes, deps: async () => undefined });
  return { ctx, git, dir: folder(ctx), from: entry(ctx).commit! };
}

/** A package on the stable channel at v1.0.0. */
async function stable() {
  const repo = packageRepo();
  tag(repo, "v1.0.0");
  return { repo, ...(await installed(repo, { channel: "estable" })) };
}

/** One pinned to `#v1.0.0`. */
async function pinned() {
  const repo = packageRepo();
  tag(repo, "v1.0.0");
  return { repo, ...(await installed(repo, { source: `${SOURCE}#v1.0.0` })) };
}

function update(git: GitRunner, over: Partial<PackageUpdateInput> = {}) {
  const shutdown = vi.fn(async (): Promise<ShutdownResult> => ({ status: "stopped" }));
  const start = vi.fn(async () => true);
  const confirm = vi.fn(async (_q: string) => true);
  const input: PackageUpdateInput = { name: "hello", git, deps: async () => undefined, confirm, daemon: { shutdown, start }, ...over };
  return { input, shutdown, start, confirm };
}

describe("a package entry's channel", () => {
  const COMMIT = "a".repeat(40);
  const git = { git: SOURCE, path: "/p", commit: COMMIT };

  it("is optional and has no default", () => {
    expect(PackageEntrySchema.parse(git)).toEqual({ ...git, allowCode: false });
    expect(PackageEntrySchema.parse({ ...git, channel: "estable" }).channel).toBe("estable");
  });

  it.each([
    ["another value", { ...git, channel: "ultimo" }],
    ["an npm entry", { npm: "hello-zero", channel: "estable" }],
    ["a folder", { path: "/p", channel: "estable" }],
    ["a source with a reference", { ...git, git: `${SOURCE}#v1.0.0`, channel: "estable" }],
  ])("refuses %s", (_what, value) => {
    expect(PackageEntrySchema.safeParse(value).success).toBe(false);
  });
});

describe("adding on the stable channel", () => {
  it("installs the newest release and not the branch tip", async () => {
    const repo = packageRepo();
    const v1 = commit(repo, "uno");
    tag(repo, "v0.9.0", "HEAD~1");
    gitIn(repo, "tag", "-a", "v1.0.0", "-m", "uno");
    commit(repo, "sin liberar");
    const ctx = await factory();
    const say = vi.fn();
    const text = await packageAdd(ctx, { source: SOURCE, channel: "estable", git: gitTo(repo), confirm: yes, say });
    expect(entry(ctx)).toMatchObject({ git: SOURCE, commit: v1, channel: "estable" });
    expect(head(folder(ctx))).toBe(v1);
    expect(say.mock.calls.flat().join("\n")).toContain("v1.0.0");
    expect(text).toContain("canal estable");
    expect(fileText(ctx)).toContain("# mi fábrica");
  });

  it("takes the tag and not a branch with its name", async () => {
    const repo = packageRepo();
    const v1 = head(repo);
    tag(repo, "v1.0.0");
    gitIn(repo, "checkout", "-q", "-b", "v1.0.0");
    commit(repo, "en la rama");
    const { from } = await installed(repo, { channel: "estable" });
    expect(from).toBe(v1);
  });

  it("refuses a remote without releases and installs nothing", async () => {
    const repo = packageRepo();
    tag(repo, "v1.0.0-rc1");
    const ctx = await factory();
    const before = fileText(ctx);
    const confirm = vi.fn(yes);
    await expect(packageAdd(ctx, { source: SOURCE, channel: "estable", git: gitTo(repo), confirm })).rejects.toThrow(/no tiene versiones liberadas/);
    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(join(ctx.home.packages, "git")) ? readdirSync(join(ctx.home.packages, "git")) : []).toEqual([]);
    expect(fileText(ctx)).toBe(before);
  });

  it.each([
    ["a reference", `${SOURCE}#v1.0.0`],
    ["an npm package", "hello-zero"],
  ])("refuses %s", async (_what, source) => {
    const ctx = await factory();
    const before = fileText(ctx);
    const git = failingGit();
    const install = vi.fn(async () => undefined);
    await expect(packageAdd(ctx, { source, channel: "estable", git, install, confirm: yes })).rejects.toThrow(/canal estable/);
    expect(git).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(fileText(ctx)).toBe(before);
  });

  it("refuses a folder", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText() });
    const ctx = await factory();
    await expect(packageAdd(ctx, { source: dir, channel: "estable" })).rejects.toThrow(/canal estable/);
    expect(parseFactory(fileText(ctx)).packages).toEqual([]);
  });

  it("only sets the channel of a source already declared", async () => {
    const { ctx, dir, from } = await installed(packageRepo());
    const before = entry(ctx);
    const git = failingGit();
    await packageAdd(ctx, { source: SOURCE, channel: "estable", git, confirm: yes });
    expect(git).not.toHaveBeenCalled();
    expect(entry(ctx)).toEqual({ ...before, channel: "estable" });
    expect(head(dir)).toBe(from);
  });

  it("keeps the channel when the permission is given later", async () => {
    const { ctx } = await stable();
    await packageAdd(ctx, { source: SOURCE, allowCode: true, git: failingGit(), confirm: yes });
    expect(entry(ctx)).toMatchObject({ channel: "estable", allowCode: true });
  });
});

describe("updating on the stable channel", () => {
  it("is up to date when only unreleased commits are newer", async () => {
    const { repo, ctx, git, dir, from } = await stable();
    commit(repo, "sin liberar");
    const { input, shutdown } = update(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(false);
    expect(text).toMatch(/al día \(v1\.0\.0/);
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(entry(ctx).commit).toBe(from);
  });

  it("moves to a new release, not past it", async () => {
    const { repo, ctx, git, dir } = await stable();
    const v11 = commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    commit(repo, "sin liberar");
    const { input, shutdown, start } = update(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(false);
    expect(text).toContain("de v1.0.0 (");
    expect(text).toContain("a v1.1.0 (");
    expect(text).toContain("nuevo");
    expect(text).not.toContain("sin liberar");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(head(dir)).toBe(v11);
    expect(entry(ctx)).toMatchObject({ git: SOURCE, commit: v11, channel: "estable" });
  });

  it("asks when the release asks for more, and a no leaves it where it is", async () => {
    const { repo, ctx, git, dir, from } = await stable();
    commit(repo, "pide", { "zero-package.yaml": manifestText({ stations: [{ name: "nota", module: "nota.mjs", secrets: ["OTRO"] }] }), "nota.mjs": "export async function pass() {}\n" });
    tag(repo, "v1.1.0");
    const { input, confirm, shutdown } = update(git);
    confirm.mockResolvedValue(false);
    await packageUpdate(ctx, input);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    // Nobody to ask is a no too.
    await packageUpdate(ctx, { ...input, confirm: undefined });
    expect(entry(ctx).commit).toBe(from);
  });

  it("goes back to its version when applying fails", async () => {
    const { repo, ctx, git, dir, from } = await stable();
    commit(repo, "con lock", { "package-lock.json": "{}\n" });
    tag(repo, "v1.1.0");
    const { input } = update(git, { deps: async () => Promise.reject(new Error("npm falló")) });
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toContain("npm falló");
    expect(head(dir)).toBe(from);
    expect(entry(ctx).commit).toBe(from);
  });

  it("does not move back one ahead of the newest release, and says why", async () => {
    const repo = packageRepo();
    tag(repo, "v1.0.0");
    commit(repo, "sin liberar");
    const { ctx, git, dir, from } = await installed(repo);
    await packageAdd(ctx, { source: SOURCE, channel: "estable", git, confirm: yes });
    const { input, shutdown } = update(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(false);
    expect(text).toMatch(/más adelante que la última versión liberada \(v1\.0\.0\)/);
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(entry(ctx).commit).toBe(from);
    const list = formatPackages(packageList(ctx));
    expect(list).toContain("más adelante que la última versión liberada (v1.0.0)");
    expect(list).not.toContain("hay una actualización");
  });

  it("does not move back when its own release is withdrawn", async () => {
    const { repo, ctx, git, dir, from } = await stable();
    // Another history, so ancestry says nothing.
    gitIn(repo, "checkout", "-q", "--orphan", "otra");
    commit(repo, "vieja");
    tag(repo, "v0.9.0");
    gitIn(repo, "tag", "-d", "v1.0.0");
    const { input, shutdown } = update(git);
    expect((await packageUpdate(ctx, input)).text).toMatch(/más adelante/);
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
  });

  it("fails without releases, leaving the folder and the reason on record", async () => {
    const { repo, ctx, git, dir, from } = await stable();
    commit(repo, "nuevo");
    gitIn(repo, "tag", "-d", "v1.0.0");
    const { input } = update(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toMatch(/no tiene versiones liberadas/);
    expect(head(dir)).toBe(from);
    expect(readSeen(ctx.store, "hello")).toMatchObject({ seen: from, version: "1.0.0", error: expect.stringContaining("versiones liberadas") });
  });
});

describe("moving a pin", () => {
  it("moves to the tag and records it as the reference of its source", async () => {
    const { repo, ctx, git, dir } = await pinned();
    const v11 = commit(repo, "nuevo");
    gitIn(repo, "tag", "-a", "v1.1.0", "-m", "nuevo");
    const { input, shutdown } = update(git, { tag: "v1.1.0" });
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(false);
    expect(text).toContain("fijado a v1.1.0");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(head(dir)).toBe(v11);
    expect(entry(ctx)).toMatchObject({ git: `${SOURCE}#v1.1.0`, commit: v11 });
    expect(formatPackages(packageList(ctx))).toContain("fijado a v1.1.0");
    expect(formatPackages(packageList(ctx))).not.toContain("hay una actualización");
  });

  it("stays pinned without a tag", async () => {
    const { repo, ctx, git, dir, from } = await pinned();
    commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    const { input } = update(git);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(false);
    expect(text).toMatch(/al día/);
    expect(head(dir)).toBe(from);
    expect(entry(ctx)).toMatchObject({ git: `${SOURCE}#v1.0.0`, commit: from });
  });

  it("pins one without a reference, also when it is already on that commit", async () => {
    const repo = packageRepo();
    tag(repo, "v1.0.0");
    const { ctx, git, from } = await installed(repo);
    const { input, shutdown } = update(git, { tag: "v1.0.0" });
    expect((await packageUpdate(ctx, input)).failed).toBe(false);
    expect(shutdown).not.toHaveBeenCalled();
    expect(entry(ctx)).toMatchObject({ git: `${SOURCE}#v1.0.0`, commit: from });
  });

  it("may be an older tag, because it was asked for", async () => {
    const { repo, ctx, git, from } = await pinned();
    commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    await packageUpdate(ctx, update(git, { tag: "v1.1.0" }).input);
    const { text } = await packageUpdate(ctx, update(git, { tag: "v1.0.0" }).input);
    expect(text).toMatch(/Ojo: v1\.0\.0 .* no incluye lo instalado/);
    expect(entry(ctx)).toMatchObject({ git: `${SOURCE}#v1.0.0`, commit: from });
  });

  it("stays where it was when the answer is no", async () => {
    const { repo, ctx, git, dir, from } = await pinned();
    commit(repo, "pide", { "zero-package.yaml": manifestText({ stations: [{ name: "nota", module: "nota.mjs" }] }), "nota.mjs": "export async function pass() {}\n" });
    tag(repo, "v1.1.0");
    const before = fileText(ctx);
    await packageUpdate(ctx, update(git, { tag: "v1.1.0", confirm: async () => false }).input);
    expect(head(dir)).toBe(from);
    expect(fileText(ctx)).toBe(before);
    expect(formatPackages(packageList(ctx))).not.toContain("hay una actualización");
  });

  it.each([
    ["a missing tag", "v9.9.9", /no tiene la etiqueta v9\.9\.9/],
    ["a branch", "rama", /no tiene la etiqueta rama/],
    ["a name git reads as something else", "HEAD", /no tiene la etiqueta HEAD|no sirve/],
    ["one with a tag's name behind a branch", "heads/rama", /no sirve para fijar/],
    ["an option", "--upload-pack=x", /etiqueta no es válida/],
    ["an empty one", "", /etiqueta no es válida/],
    ["a refspec", "v1.0.0:refs/heads/x", /etiqueta no es válida/],
  ])("refuses %s, changing nothing", async (_what, name, reason) => {
    const { repo, ctx, git, dir, from } = await pinned();
    gitIn(repo, "branch", "rama");
    tag(repo, "heads/rama");
    const before = fileText(ctx);
    const seen = readSeen(ctx.store, "hello");
    const { input, shutdown } = update(git, { tag: name });
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toMatch(reason);
    expect(shutdown).not.toHaveBeenCalled();
    expect(head(dir)).toBe(from);
    expect(fileText(ctx)).toBe(before);
    expect(readSeen(ctx.store, "hello")).toEqual(seen);
  });

  it("refuses a call without a name", async () => {
    const { ctx } = await pinned();
    const git = failingGit();
    const { text, failed } = await packageUpdate(ctx, update(git, { name: undefined, tag: "v1.0.0" }).input);
    expect(failed).toBe(true);
    expect(text).toMatch(/Indicá qué paquete/);
    expect(git).not.toHaveBeenCalled();
  });

  it("refuses one on the stable channel", async () => {
    const { ctx } = await stable();
    const git = failingGit();
    const { text, failed } = await packageUpdate(ctx, update(git, { tag: "v1.0.0" }).input);
    expect(failed).toBe(true);
    expect(text).toMatch(/canal estable/);
    expect(git).not.toHaveBeenCalled();
  });

  it("refuses one that is not from git", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, { "zero-package.yaml": manifestText(), "package-lock.json": "{}\n" });
    const ctx = await factory([{ path: dir }]);
    const { input, shutdown } = update(failingGit(), { tag: "v1.0.0" });
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toMatch(/solo para paquetes instalados desde git/);
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("the daily look on the stable channel", () => {
  it("records the newest release, its version and the one installed, never the branch tip", async () => {
    const { repo, ctx, git, dir, from } = await stable();
    const v11 = commit(repo, "nuevo");
    gitIn(repo, "tag", "-a", "v1.1.0", "-m", "nuevo");
    commit(repo, "sin liberar");
    await packageUpdatesPass(ctx, NOW, { git });
    expect(readSeen(ctx.store, "hello")).toEqual({ seen: v11, version: "1.1.0", current: { commit: from, version: "1.0.0" }, at: NOW.toISOString() });
    expect(head(dir)).toBe(from);
  });

  it("only asks the remote, with a look at the clone that fetches nothing", async () => {
    const { repo, ctx, git } = await stable();
    commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    git.mockClear();
    await packageUpdatesPass(ctx, NOW, { git });
    expect(git.mock.calls.map(([args]) => args.slice(0, 2))).toEqual([
      ["ls-remote", "--tags"],
      ["merge-base", "--is-ancestor"],
    ]);
  });

  it("does not offer a release that what is installed already contains", async () => {
    const repo = packageRepo();
    tag(repo, "v1.0.0");
    commit(repo, "sin liberar");
    const { ctx, git, from } = await installed(repo);
    await packageAdd(ctx, { source: SOURCE, channel: "estable", git, confirm: yes });
    await packageUpdatesPass(ctx, NOW, { git });
    expect(readSeen(ctx.store, "hello")).toMatchObject({ version: "1.0.0", ahead: from });
    expect(packageList(ctx).packages[0]).toMatchObject({ aheadOf: "1.0.0" });
    expect(packageList(ctx).packages[0]!.update).toBeUndefined();
  });

  it("keeps what it knew when the remote fails", async () => {
    const { repo, ctx, git, from } = await stable();
    const v11 = commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    await packageUpdatesPass(ctx, NOW, { git });
    const down = vi.fn<GitRunner>(async () => Promise.reject(new Error("sin red")));
    await packageUpdatesPass(ctx, NEXT_DAY, { git: down });
    expect(readSeen(ctx.store, "hello")).toMatchObject({ seen: v11, version: "1.1.0", current: { commit: from, version: "1.0.0" }, error: "sin red" });
  });
});

describe("the lists", () => {
  const page = (ctx: FactoryContext) => packagesPage(packageList(ctx), [], "n");

  it("show the channel, both versions and the command, from what is on record", async () => {
    const { repo, ctx, git } = await stable();
    commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    await packageUpdatesPass(ctx, NOW, { git });
    vi.mocked(spawn).mockClear();
    vi.mocked(spawnSync).mockClear();
    for (const text of [formatPackages(packageList(ctx)), page(ctx)]) for (const piece of ["estable", "v1.0.0", "v1.1.0", "zero package update hello"]) expect(text).toContain(piece);
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("show the version installed right after adding and after updating", async () => {
    const { repo, ctx, git } = await stable();
    expect(packageList(ctx).packages[0]).toMatchObject({ channel: "estable", release: "1.0.0" });
    commit(repo, "nuevo");
    tag(repo, "v1.1.0");
    await packageUpdate(ctx, update(git).input);
    const [p] = packageList(ctx).packages;
    expect(p).toMatchObject({ channel: "estable", release: "1.1.0" });
    expect(p!.update).toBeUndefined();
  });

  it("show what a package is pinned to", async () => {
    const { ctx, from } = await pinned();
    for (const text of [formatPackages(packageList(ctx)), page(ctx)]) {
      expect(text).toContain("fijado a v1.0.0");
      expect(text).toContain(from.slice(0, 7));
      expect(text).not.toContain("canal:");
    }
  });

  it("do not offer what was seen before the channel changed", async () => {
    const repo = packageRepo();
    tag(repo, "v1.0.0");
    const { ctx, git } = await installed(repo);
    commit(repo, "sin liberar");
    await packageUpdatesPass(ctx, NOW, { git });
    expect(packageList(ctx).packages[0]!.update).toBeDefined();
    await packageAdd(ctx, { source: SOURCE, channel: "estable", git, confirm: yes });
    expect(packageList(ctx).packages[0]!.update).toBeUndefined();
  });

  it("show neither channel nor pin for a package without them", async () => {
    const { ctx } = await installed(packageRepo());
    const text = formatPackages(packageList(ctx));
    expect(text).not.toContain("canal:");
    expect(text).not.toContain("fijado a");
  });

  it("escape every third-party text in the panel", async () => {
    const { ctx } = await stable();
    const list = packageList(ctx);
    const evil = "<img src=x onerror=alert(1)>";
    Object.assign(list.packages[0]!, { installed: evil, release: undefined, channel: undefined, pin: `${evil}\`${evil}\``, update: { seen: evil, at: evil }, aheadOf: evil });
    const html = packagesPage(list, [], "n");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("the record of a look", () => {
  it("keeps the release through a failed look, and a plain one has none", async () => {
    const ctx = await factory();
    recordSeen(ctx.store, "x", "a", NOW, { version: "1.0.0" });
    recordLookFailed(ctx.store, "x", "sin red", NEXT_DAY);
    expect(readSeen(ctx.store, "x")).toEqual({ seen: "a", version: "1.0.0", at: NEXT_DAY.toISOString(), error: "sin red" });
    recordSeen(ctx.store, "x", "b", NOW);
    expect(readSeen(ctx.store, "x")).toEqual({ seen: "b", at: NOW.toISOString() });
  });
});

describe("the command line", () => {
  function cli(ctx: FactoryContext, ...args: string[]) {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "package", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
    return { code: r.status, text: `${r.stdout}${r.stderr}` };
  }

  it.each([
    ["the channel with a reference", ["add", `${SOURCE}#v1.0.0`, "--canal", "estable"], /canal estable no va junto a una #referencia/],
    ["the channel of an npm package", ["add", "hello-zero", "--canal", "estable"], /solo para paquetes instalados desde git/],
    ["another channel", ["add", SOURCE, "--canal", "ultimo"], /solo puede ser estable/],
    ["a tag when adding", ["add", SOURCE, "--etiqueta", "v1.0.0"], /ponela en la fuente/],
    ["a tag without a name", ["update", "--etiqueta", "v1.0.0"], /Indicá qué paquete fijar/],
  ])("refuses %s", async (_what, args, reason) => {
    const ctx = await factory();
    const before = fileText(ctx);
    const { code, text } = cli(ctx, ...args);
    expect(text).toMatch(reason);
    expect(code).toBe(1);
    expect(fileText(ctx)).toBe(before);
  });

  it("passes the tag on to the named package", async () => {
    const { ctx } = await stable();
    const { code, text } = cli(ctx, "update", "hello", "--etiqueta", "v1.0.0");
    expect(text).toMatch(/hello: sigue el canal estable/);
    expect(code).toBe(1);
  });

  it("sets the channel of a source already declared", async () => {
    const { ctx } = await installed(packageRepo());
    const { code, text } = cli(ctx, "add", SOURCE, "--canal", "estable");
    expect(code).toBe(0);
    expect(text).toContain("canal estable");
    expect(entry(ctx).channel).toBe("estable");
  });

  it("says both options in its help", () => {
    const usage = readFileSync("src/cli.ts", "utf8");
    expect(usage).toMatch(/^  zero package add .*\[--canal estable\]/m);
    expect(usage).toMatch(/^  zero package update \[nombre\] \[--etiqueta <etiqueta>\]/m);
  });
});
