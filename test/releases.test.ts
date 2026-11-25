import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAUNCH_KEY, releaseVersion, type FactoryContext, type ReleaseInput } from "../src/app.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import type { GitRunner } from "../src/package-install.js";
import { compareVersions, listReleases, newestRelease, nextPatch, parseReleaseRequest, parseReleases, parseVersion } from "../src/releases.js";
import { selfUpdateGit } from "../src/self-update.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const sha = (c: string) => c.repeat(40);

function commit(repo: string, name: string): string {
  writeTree(repo, { [name]: `${name}\n` });
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", name);
  return gitIn(repo, "rev-parse", "HEAD");
}

/** A work copy on `main` with a bare `origin` that has it. */
function published(files: Record<string, string> = { "package.json": '{"version":"0.4.2"}\n' }) {
  const bare = tempDir("zero-bare-");
  gitIn(bare, "init", "-q", "--bare", "-b", "main");
  const repo = gitRepo(files);
  gitIn(repo, "remote", "add", "origin", bare);
  gitIn(repo, "push", "-q", "-u", "origin", "main");
  const first = gitIn(repo, "rev-parse", "HEAD");
  return {
    repo,
    bare,
    first,
    /** A commit of the remote's base branch. */
    merged: (name: string) => {
      const c = commit(repo, name);
      gitIn(repo, "push", "-q", "origin", "main");
      return c;
    },
    /** A tag that exists only on the remote. */
    tag: (name: string, at: string) => gitIn(repo, "push", "-q", "origin", `${at}:refs/tags/${name}`),
    /** The remote's tags, as `name commit`. */
    tags: () =>
      gitIn(bare, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/tags")
        .split("\n")
        .filter(Boolean),
  };
}

const factory = (lines: unknown[] = [], selfUpdate?: Record<string, unknown>) => testFactory({ isolation: "worktree", lines, ...(selfUpdate && { selfUpdate }) });

/** Releases from `install` with a git that records its calls, saying yes unless told otherwise. */
async function release(install: string, args: string[], opts: Partial<ReleaseInput> & { ctx?: FactoryContext } = {}) {
  const calls: string[][] = [];
  const git: GitRunner = async (a, o) => {
    calls.push(a);
    return selfUpdateGit(a, o);
  };
  const said: string[] = [];
  const { ctx = factory(), ...input } = opts;
  const r = await releaseVersion(ctx, { args, install, git, confirm: async () => true, say: (t) => said.push(t), ...input });
  return { ...r, said: said.join("\n"), pushes: calls.filter((c) => c[0] === "push") };
}

describe("released versions", () => {
  it("reads only vX.Y.Z tags, peeled and in numeric order", () => {
    const releases = parseReleases(
      [
        `${sha("a")}\trefs/tags/v1.10.0`,
        `${sha("b")}\trefs/tags/v1.2.0`,
        `${sha("c")}\trefs/tags/v1.9.0`,
        `${sha("d")}\trefs/tags/v1.9.0^{}`,
        `${sha("e")}\trefs/tags/v2.0.0-rc1`,
        `${sha("f")}\trefs/tags/nightly`,
        `${sha("f")}\trefs/tags/v3.0`,
        `${sha("f")}\trefs/tags/v03.0.0`,
        `${sha("f")}\trefs/tags/otra/v4.0.0`,
        `${sha("f")}\trefs/heads/v5.0.0`,
      ].join("\n"),
    );
    expect(releases).toEqual([
      { version: "1.2.0", commit: sha("b") },
      { version: "1.9.0", commit: sha("d") },
      { version: "1.10.0", commit: sha("a") },
    ]);
    expect(newestRelease(releases)?.version).toBe("1.10.0");
  });

  it("takes an empty list without throwing", async () => {
    expect(parseReleases("")).toEqual([]);
    expect(newestRelease([])).toBeUndefined();
    const { repo } = published();
    expect(await listReleases(selfUpdateGit, "origin", { cwd: repo })).toEqual([]);
  });

  it("reads them from a real remote, with the commit of an annotated tag", async () => {
    const { repo, first, tag, merged } = published();
    tag("v1.2.0", first);
    tag("v2.0.0-rc1", first);
    tag("nightly", first);
    const second = merged("dos");
    gitIn(repo, "tag", "-a", "v1.9.0", "-m", "anotada", second);
    gitIn(repo, "push", "-q", "origin", "v1.9.0");
    tag("v1.10.0", merged("tres"));
    const releases = await listReleases(selfUpdateGit, "origin", { cwd: repo });
    expect(releases.map((r) => r.version)).toEqual(["1.2.0", "1.9.0", "1.10.0"]);
    expect(releases[1]!.commit).toBe(second);
  });

  it("compares and raises versions of any size", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.90071992547409931", "1.0.90071992547409930")).toBe(1);
    expect(nextPatch("1.2.9")).toBe("1.2.10");
  });

  it("reads a version with or without its v", () => {
    expect(parseVersion("1.2.0")).toBe("1.2.0");
    expect(parseVersion("v1.2.0")).toBe("1.2.0");
    for (const text of ["1.2", "vv1.2.0", "1.2.0-rc1", "01.2.0", "1.2.0\n", ""]) expect(parseVersion(text)).toBeUndefined();
  });

  it("tells commits from versions, in any order", () => {
    expect(parseReleaseRequest(["1.3.0", "ABCDEF1"])).toEqual({ version: "1.3.0", commit: "abcdef1" });
    expect(parseReleaseRequest(["abcdef1", "v1.3.0"])).toEqual({ version: "1.3.0", commit: "abcdef1" });
    expect(() => parseReleaseRequest([])).toThrow(/Indicá qué liberar/);
    expect(() => parseReleaseRequest(["1.3.0", "1.4.0"])).toThrow(/como mucho/);
    expect(() => parseReleaseRequest(["abcdef1", "abcdef2"])).toThrow(/como mucho/);
    for (const text of ["main", "abcdef", "a".repeat(65), "--force", "HEAD~1"]) expect(() => parseReleaseRequest([text])).toThrow(/no es un commit/);
  });
});

describe("zero liberar", () => {
  it("releases a commit with the next patch of the newest release", async () => {
    const { repo, first, tag, merged, tags } = published();
    tag("v1.2.0", first);
    const second = merged("dos");
    merged("tres");
    const r = await release(repo, [second.slice(0, 9)]);
    expect(r.released).toBe(true);
    expect(r.text).toContain("v1.2.1");
    expect(r.text).toContain(second.slice(0, 12));
    expect(tags()).toEqual([`v1.2.0 ${first}`, `v1.2.1 ${second}`]);
    expect(r.said).toContain("v1.2.1");
    expect(r.said).toContain(`${second.slice(0, 12)} dos`);
  });

  it("releases a version from the tip of the remote's base branch, also when the local one is behind", async () => {
    const { repo, first, tag, merged, tags } = published();
    tag("v1.2.0", first);
    const tip = merged("dos");
    gitIn(repo, "reset", "-q", "--hard", first);
    expect((await release(repo, ["1.3.0"])).released).toBe(true);
    expect(tags()).toEqual([`v1.2.0 ${first}`, `v1.3.0 ${tip}`]);
  });

  it("takes a commit and a version together", async () => {
    const { repo, first, merged, tags } = published();
    merged("dos");
    expect((await release(repo, [first, "v2.0.0"])).released).toBe(true);
    expect(tags()).toEqual([`v2.0.0 ${first}`]);
  });

  it.each([
    ["the version of its package.json", '{"version":"0.4.2"}', "v0.4.2"],
    ["0.1.0 without a usable version", '{"version":"1.0.0-rc1"}', "v0.1.0"],
    ["0.1.0 with a broken package.json", "{", "v0.1.0"],
  ])("starts a repository without releases at %s", async (_name, json, expected) => {
    const { repo, first, tags } = published({ "package.json": json });
    expect((await release(repo, [first])).released).toBe(true);
    expect(tags()).toEqual([`${expected} ${first}`]);
  });

  it("uses the remote and branch of selfUpdate", async () => {
    const { repo, bare, first, merged, tags } = published();
    gitIn(repo, "remote", "rename", "origin", "arriba");
    gitIn(repo, "push", "-q", "arriba", `${first}:refs/heads/estable`);
    gitIn(repo, "remote", "add", "origin", bare);
    merged("dos");
    expect((await release(repo, ["1.0.0"], { ctx: factory([], { remote: "arriba", branch: "estable" }) })).released).toBe(true);
    expect(tags()).toEqual([`v1.0.0 ${first}`]);
  });

  it("releases another line on its own remote", async () => {
    const zero = published();
    const other = published();
    const ctx = factory([{ name: "zero", repo: zero.repo }, { name: "paquete", repo: other.repo }]);
    expect((await release(zero.repo, ["0.2.0"], { ctx, line: "paquete" })).released).toBe(true);
    expect(other.tags()).toEqual([`v0.2.0 ${other.first}`]);
    expect(zero.tags()).toEqual([]);
    await expect(release(zero.repo, ["0.2.0"], { ctx, line: "nada" })).rejects.toThrow(/No existe la línea/);
  });

  it("changes nothing local, whatever the repository's git configuration says", async () => {
    const { repo, first, tag, merged, tags } = published();
    const second = merged("dos");
    gitIn(repo, "fetch", "-q");
    gitIn(repo, "reset", "-q", "--hard", first);
    // A local annotated tag git would push along, a remote one it would bring, and a push hook.
    gitIn(repo, "tag", "-a", "local", "-m", "x", first);
    tag("remota", first);
    gitIn(repo, "config", "push.followTags", "true");
    gitIn(repo, "config", "remote.origin.tagOpt", "--tags");
    gitIn(repo, "config", "fetch.prune", "true");
    gitIn(repo, "config", "fetch.pruneTags", "true");
    writeTree(repo, { ".git/hooks/pre-push": "#!/bin/sh\nexit 1\n", "sin-commitear.txt": "x" });
    const state = () => [gitIn(repo, "status", "--porcelain", "--branch"), gitIn(repo, "symbolic-ref", "HEAD"), gitIn(repo, "for-each-ref"), readdirSync(join(repo, ".git")).includes("FETCH_HEAD") && readFileSync(join(repo, ".git", "FETCH_HEAD"), "utf8")];
    const before = state();
    expect((await release(repo, ["1.0.0"])).text).toContain("liberada");
    expect(state()).toEqual(before);
    expect(tags()).toEqual([`remota ${first}`, `v1.0.0 ${second}`]);
  });

  it("pushes nothing without a yes, after showing what it would publish", async () => {
    const { repo, tags } = published();
    const confirm = vi.fn(async () => false);
    const r = await release(repo, ["1.0.0"], { confirm });
    expect(confirm).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ released: false, pushes: [], text: expect.stringContaining("No publiqué nada") });
    expect(r.said).toContain("v1.0.0");
    expect(await release(repo, ["1.0.0"], { confirm: undefined })).toMatchObject({ released: false, pushes: [] });
    expect(tags()).toEqual([]);
  });

  /** A refusal: its reason in Spanish, nothing asked and nothing pushed. */
  async function refused(repo: string, args: string[], why: RegExp, opts: Parameters<typeof release>[2] = {}) {
    const confirm = vi.fn(async () => true);
    const r = await release(repo, args, { confirm, ...opts });
    expect(r).toMatchObject({ released: false, pushes: [], text: expect.stringMatching(/^No publiqué nada: /) });
    expect(r.text).toMatch(why);
    expect(confirm).not.toHaveBeenCalled();
  }

  it("refuses a version that exists, and leaves it where it was", async () => {
    const { repo, first, tag, merged, tags } = published();
    tag("v1.2.0", first);
    const second = merged("dos");
    await refused(repo, ["1.2.0"], /v1\.2\.0 ya existe/);
    await refused(repo, ["1.2.0", second], /v1\.2\.0 ya existe/);
    expect(tags()).toEqual([`v1.2.0 ${first}`]);
  });

  it("refuses a version that is not higher than the newest", async () => {
    const { repo, first, tag, merged, tags } = published();
    tag("v1.10.0", first);
    merged("dos");
    await refused(repo, ["1.9.0"], /v1\.9\.0 no es mayor que la última versión liberada \(v1\.10\.0\)/);
    expect(tags()).toEqual([`v1.10.0 ${first}`]);
  });

  it("refuses a commit that is only on another branch, here or on the remote", async () => {
    const { repo, tags } = published();
    gitIn(repo, "checkout", "-q", "-b", "otra");
    const elsewhere = commit(repo, "otra");
    await refused(repo, [elsewhere], /no está en main de origin/, { ctx: factory([], { branch: "main" }) });
    gitIn(repo, "push", "-q", "origin", "otra");
    await refused(repo, [elsewhere], /no está en main de origin/, { ctx: factory([], { branch: "main" }) });
    expect(tags()).toEqual([]);
  });

  it("refuses a local commit that was not pushed, and one nobody has", async () => {
    const { repo, tags } = published();
    await refused(repo, [commit(repo, "local")], /no está en main de origin/);
    await refused(repo, [sha("a")], /no encontré el commit aaaaaaaaaaaa/);
    expect(tags()).toEqual([]);
  });

  it("does not take a branch named like a commit for that commit", async () => {
    const { repo, first, tags } = published();
    const name = first.startsWith("deadbee") ? "beefdea" : "deadbee";
    gitIn(repo, "branch", name, first);
    await refused(repo, [name], /no encontré el commit/);
    expect(tags()).toEqual([]);
  });

  it("refuses going back, and the newest release's own commit", async () => {
    const { repo, first, tag, merged, tags } = published();
    const second = merged("dos");
    tag("v1.2.0", second);
    await refused(repo, [first], /las instalaciones solo avanzan/);
    await refused(repo, [second], /ya es la última versión liberada \(v1\.2\.0\)/);
    await refused(repo, ["1.3.0"], /ya es la última versión liberada \(v1\.2\.0\)/);
    expect(tags()).toEqual([`v1.2.0 ${second}`]);
  });

  it("refuses when the newest release is not in the branch's history", async () => {
    const { repo, first, bare, tags } = published();
    const clone = tempDir("zero-clone-");
    gitIn(clone, "clone", "-q", bare, ".");
    const aside = commit(clone, "aparte");
    gitIn(clone, "push", "-q", "origin", `${aside}:refs/tags/v9.0.0`);
    await refused(repo, [first], /no es posterior a la última versión liberada \(v9\.0\.0/);
    expect(tags()).toEqual([`v9.0.0 ${aside}`]);
  });

  it("refuses a repository without that remote or branch, and a folder that is not its own repository", async () => {
    const { repo } = published();
    await refused(repo, ["1.0.0"], /no tiene un remoto arriba/, { ctx: factory([], { remote: "arriba" }) });
    await refused(repo, ["1.0.0"], /no tiene la rama estable/, { ctx: factory([], { branch: "estable" }) });
    await refused(tempDir(), ["1.0.0"], /no es la raíz de su propio repositorio/);
    writeTree(repo, { "node_modules/zero/package.json": "{}" });
    await refused(join(repo, "node_modules", "zero"), ["1.0.0"], /no es la raíz de su propio repositorio/);
    gitIn(repo, "checkout", "-q", "--detach");
    await refused(repo, ["1.0.0"], /no está en una rama/);
  });

  it("refuses when a release came out while it was asking", async () => {
    const { repo, first, tag, merged, tags } = published();
    merged("dos");
    const r = await release(repo, ["1.0.0"], {
      confirm: async () => {
        tag("v1.5.0", first);
        return true;
      },
    });
    expect(r).toMatchObject({ released: false, pushes: [], text: expect.stringContaining("cambiaron mientras confirmabas") });
    expect(tags()).toEqual([`v1.5.0 ${first}`]);
  });

  it("never forces, and tells when the remote says no", async () => {
    const { repo, bare, first, tags } = published();
    const ok = await release(repo, ["1.0.0"]);
    expect(ok.pushes).toHaveLength(1);
    expect(ok.pushes[0]!.filter((a) => /force|^-f|^\+/.test(a))).toEqual([]);
    expect(ok.pushes[0]).toEqual(expect.arrayContaining(["--no-verify", "origin", `${first}:refs/tags/v1.0.0`]));
    const second = commit(repo, "dos");
    gitIn(repo, "push", "-q", "origin", "main");
    // Git for Windows runs hooks whatever their mode; elsewhere they need it.
    writeFileSync(join(bare, "hooks", "pre-receive"), "#!/bin/sh\necho etiqueta protegida >&2\nexit 1\n", { mode: 0o755 });
    const r = await release(repo, [second]);
    expect(r).toMatchObject({ released: false, text: expect.stringContaining("no aceptó la etiqueta v1.0.1") });
    expect(tags()).toEqual([`v1.0.0 ${first}`]);
  });
});

describe("zero liberar on the terminal", () => {
  function cli(ctx: FactoryContext, ...args: string[]) {
    ctx.store.setKv(LAUNCH_KEY, new Date(Date.now() + 600_000).toISOString());
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
    return { out: r.stdout + r.stderr, status: r.status };
  }

  it("publishes only with --yes when there is no terminal", () => {
    const { repo, first, tags } = published();
    const ctx = factory([{ name: "paquete", repo }]);
    const no = cli(ctx, "liberar", "0.2.0", "--line", "paquete");
    expect(no.out).toContain("No publiqué nada");
    expect(no.status).toBe(1);
    expect(tags()).toEqual([]);
    const yes = cli(ctx, "liberar", "0.2.0", "--line", "paquete", "--yes");
    expect(yes.out).toContain(`Versión v0.2.0 liberada en origin: commit ${first.slice(0, 12)}.`);
    expect(yes.status).toBe(0);
    expect(tags()).toEqual([`v0.2.0 ${first}`]);
  }, 60_000);

  it("is in the usage text", () => {
    expect(readFileSync("src/cli.ts", "utf8")).toMatch(/^  zero liberar \[<commit>\] \[<versión>\] \[--line <nombre>\] \[--yes\]$/m);
  });

  it("is only there: no chat tool nor panel route releases", async () => {
    const server = createZeroMcpServer(factory().home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const tools = (await client.listTools()).tools;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((t) => t.name).filter((n) => /release|liberar/i.test(n))).toEqual([]);
    const sources = ["src/mcp", "src/panel"].flatMap((dir) => readdirSync(dir).map((f) => join(dir, f)));
    expect(sources.filter((f) => /releaseVersion|publishRelease|["'`^]\\?\/(liberar|release)/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
