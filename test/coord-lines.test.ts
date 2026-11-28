import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, joinFactory, requestWork, SHUTDOWN_KEY, type FactoryContext } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { gitCloneLine, lineKey, linesPass, readLineState, type LineCloner, type LinesOptions } from "../src/coord/lines.js";
import { PROBE_KEY, readProbe } from "../src/coord/pass.js";
import { lineRef, machineRef, memoryCoord, readLineRecord, type LineRecord } from "../src/coord/protocol.js";
import { primaryEngines } from "../src/coord/queue.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { HALT_KEY } from "../src/github-quota.js";
import { machineIdentity } from "../src/machine.js";
import { overviewPage } from "../src/panel/html.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const REPOSITORY = "me/zero-coord";
const passes = `node -e "process.exit(0)"`;

/** A machine of the factory, with its probe passed. */
function factory(machine: string, over: Record<string, unknown> = {}): FactoryContext {
  const ctx = testFactory({ level: "L2", isolation: "worktree", distributed: { repository: REPOSITORY, machine }, lines: [], ...over });
  ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: new Date().toISOString(), ok: true }));
  return ctx;
}

/** A repository whose origin is on GitHub, and the bare repository that stands for it there. */
function githubRepo(slug = "acme/tienda", origin = `https://github.com/${slug}.git`) {
  const repo = gitRepo();
  const bare = join(tempDir("zero-bare-"), "r.git");
  run("git", ["clone", "-q", "--bare", repo, bare], repo);
  run("git", ["remote", "add", "origin", origin], repo);
  return { repo, bare };
}

/** Clones from a bare repository instead of GitHub, recording what it was asked for. */
function cloner(bare: string) {
  const asked: { url: string; branch: string; dir: string }[] = [];
  const clone: LineCloner = async ({ url, branch, dir }) => {
    asked.push({ url, branch, dir });
    const r = spawnSync("git", ["clone", "-q", `--branch=${branch}`, "--", bare, dir], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    gitIn(dir, "remote", "set-url", "origin", url);
  };
  return { asked, clone };
}

const recordOf = (over: Record<string, unknown> = {}) => ({
  name: "tienda",
  repository: "acme/tienda",
  baseBranch: "main",
  setup: [],
  verify: [passes],
  integrate: "pull-request",
  autoMerge: false,
  needs: { engines: ["claude"], platforms: [] },
  machine: "otra-maquina",
  at: new Date().toISOString(),
  ...over,
});

const put = (api: ReturnType<typeof memoryCoord>, name: string, data: string) => void api.refs.set(name, { name, sha: "d".repeat(40), data });
const published = (api: ReturnType<typeof memoryCoord>, over: Record<string, unknown> = {}) => put(api, lineRef((over.name as string) ?? "tienda"), JSON.stringify(recordOf(over)));
const file = (ctx: FactoryContext) => readFileSync(ctx.home.config, "utf8");
const writes = (api: ReturnType<typeof memoryCoord>) => api.calls.filter((c) => /^(create|update|write|delete) lines\//.test(c));

/** A cloner nobody should call: what it throws would only count as a failed clone, so the calls are counted. */
function neverClones() {
  let calls = 0;
  const clone: LineCloner = async () => {
    calls++;
    throw new Error("no debería clonar");
  };
  return { clone, calls: () => calls };
}

/** A pass that must not clone anything, unless it brings its own cloner. */
async function pass(ctx: FactoryContext, api: ReturnType<typeof memoryCoord>, opts: LinesOptions = {}) {
  const never = neverClones();
  const result = await linesPass(ctx, api, { clone: never.clone, ...opts });
  expect(never.calls()).toBe(0);
  return result;
}

describe("publishing the lines", () => {
  it("publishes a line on GitHub with its commands and integration, and nothing of this machine", async () => {
    const { repo } = githubRepo();
    const ctx = factory("pc-a", {
      lines: [{ name: "tienda", repo, setup: ["npm ci"], verify: [passes], verifyTimeoutMinutes: 30, integrate: "pull-request", autoMerge: true, platforms: ["linux", "win32"], issues: { label: "zero" }, linear: { team: "ENG" }, services: { vercel: { project: "tienda" } }, agents: [{ name: "extra", instructions: "a.md" }] }],
    });
    const api = memoryCoord();
    await pass(ctx, api);
    const data = api.refs.get(lineRef("tienda"))!.data;
    expect(JSON.parse(data)).toEqual({
      name: "tienda",
      repository: "acme/tienda",
      baseBranch: "main",
      setup: ["npm ci"],
      verify: [passes],
      verifyTimeoutMinutes: 30,
      integrate: "pull-request",
      autoMerge: true,
      needs: { engines: primaryEngines(ctx.config), platforms: ["linux", "win32"] },
      machine: machineIdentity(ctx.store, ctx.config).id,
      at: expect.any(String),
    });
    expect(data).not.toContain(JSON.stringify(repo).slice(1, -1));
    for (const key of ["issues", "linear", "jira", "agents", "services", "repo"]) expect(JSON.parse(data)).not.toHaveProperty(key);
  });

  it("updates its own record only when the line changed", async () => {
    const { repo } = githubRepo();
    const ctx = factory("pc-a", { lines: [{ name: "tienda", repo, verify: [passes] }] });
    const api = memoryCoord();
    await pass(ctx, api);
    await pass(ctx, api);
    expect(writes(api)).toEqual(["create lines/tienda"]);
    ctx.config.lines[0]!.verify = [passes, passes];
    await pass(ctx, api);
    expect(writes(api)).toEqual(["create lines/tienda", "update lines/tienda"]);
    expect(JSON.parse(api.refs.get(lineRef("tienda"))!.data).verify).toEqual([passes, passes]);
  });

  it("does not leak a credential in the remote's address", async () => {
    const { repo } = githubRepo("acme/tienda", "https://usuario:clavesecreta@github.com/acme/tienda.git");
    const ctx = factory("pc-a", { lines: [{ name: "tienda", repo, verify: [passes] }] });
    const api = memoryCoord();
    await pass(ctx, api);
    expect(api.refs.get(lineRef("tienda"))!.data).not.toContain("clavesecreta");
  });

  it("publishes no package line, none without a GitHub remote, none with a credential and none with a local path", async () => {
    const own = githubRepo("acme/paquete").repo;
    const elsewhere = githubRepo("acme/x", "https://gitlab.com/acme/x.git").repo;
    const lookalike = githubRepo("acme/x", "https://example.com/github.com/acme/x.git").repo;
    const secret = githubRepo("acme/secreto").repo;
    const path = githubRepo("acme/ruta").repo;
    const line = (name: string, repo: string, verify: string[]) => ({ name, repo, verify });
    const ctx = factory("pc-a", {
      lines: [
        { ...line("paquete", own, [passes]), package: "plus" },
        line("sin-remoto", gitRepo(), [passes]),
        line("gitlab", elsewhere, [passes]),
        line("parecido", lookalike, [passes]),
        line("secreto", secret, [passes]),
        line("ruta", path, [`node ${path}/check.js`]),
        line("ruta-windows", path, ["node C:\\tools\\check.js"]),
        line("ruta-linux", path, ["/opt/tools/check"]),
        line("ruta-casa", path, ["~/bin/check"]),
      ],
    });
    // The factory file itself refuses a credential: this is the last barrier.
    ctx.config.lines.find((l) => l.name === "secreto")!.verify = [`curl -H ghp_${"a1".repeat(18)} https://example.com`];
    const api = memoryCoord();
    await expect(pass(ctx, api)).resolves.toBeDefined();
    expect([...api.refs.keys()]).toEqual([]);
  });

  it("leaves the record of another machine and the local line as they are", async () => {
    const { repo } = githubRepo("acme/otra");
    const ctx = factory("pc-a", { lines: [{ name: "tienda", repo, verify: [passes] }] });
    const api = memoryCoord();
    published(api);
    const before = api.refs.get(lineRef("tienda"))!.data;
    const text = file(ctx);
    await pass(ctx, api);
    expect(api.refs.get(lineRef("tienda"))!.data).toBe(before);
    expect(writes(api)).toEqual([]);
    expect(file(ctx)).toBe(text);
  });

  it("does nothing while GitHub holds a pause or the probe has not passed", async () => {
    const ctx = factory("pc-a", { lines: [{ name: "tienda", repo: githubRepo().repo, verify: [passes] }] });
    const api = memoryCoord();
    ctx.store.setKv(HALT_KEY, JSON.stringify({ until: new Date(Date.now() + 60_000).toISOString(), why: "límite" }));
    expect(await pass(ctx, api)).toBeUndefined();
    ctx.store.deleteKv(HALT_KEY);
    ctx.store.deleteKv(PROBE_KEY);
    expect(await pass(ctx, api)).toBeUndefined();
    expect(api.calls).toEqual([]);
  });
});

describe("cloning the published lines", () => {
  it("clones a new line with the same branch, commands and integration", async () => {
    const { repo, bare } = githubRepo();
    const api = memoryCoord();
    const a = factory("pc-a", { lines: [{ name: "tienda", repo, setup: [passes], verify: [passes], verifyTimeoutMinutes: 30, integrate: "pull-request", autoMerge: true, platforms: ["win32", "darwin", "linux"] }] });
    const b = factory("nube");
    await pass(a, api);
    const { asked, clone } = cloner(bare);
    expect(await pass(b, api, { clone })).toMatchObject({ cloned: ["tienda"], unattended: [], failed: [] });
    const dir = join(b.home.lines, "tienda");
    expect(asked).toEqual([{ url: "https://github.com/acme/tienda.git", branch: "main", dir: expect.any(String) }]);
    expect(existsSync(join(dir, "README.md"))).toBe(true);
    expect(readdirSync(b.home.lines)).toEqual(["tienda"]);
    const line = parseFactory(file(b)).lines[0]!;
    expect(line).toMatchObject({ name: "tienda", repo: dir, baseBranch: "main", setup: [passes], verify: [passes], verifyTimeoutMinutes: 30, integrate: "pull-request", autoMerge: true, platforms: ["win32", "darwin", "linux"] });
    expect(b.config.lines.map((l) => l.name)).toEqual(["tienda"]);
    // Neither published again by the machine that cloned it, nor cloned twice.
    const text = file(b);
    const written = writes(api);
    await pass(b, api);
    expect(file(b)).toBe(text);
    expect(writes(api)).toEqual(written);
  });

  it("touches nothing of a line that exists with other commands", async () => {
    const api = memoryCoord();
    published(api);
    const b = factory("nube", { lines: [{ name: "tienda", repo: gitRepo(), verify: ["npm run otro"] }] });
    const text = file(b);
    await pass(b, api);
    expect(file(b)).toBe(text);
    expect(existsSync(b.home.lines)).toBe(false);
  });

  it("drops invalid records without calling the cloner", async () => {
    const api = memoryCoord();
    put(api, lineRef("roto"), "{no es json");
    put(api, "lines/../../fuera", JSON.stringify(recordOf({ name: "../../fuera" })));
    const bad: Record<string, unknown>[] = [
      { name: "url", repository: "https://evil.example/acme/x" },
      { name: "puntos", repository: "acme/.." },
      { name: "rama", baseBranch: "--upload-pack=x" },
      { name: "control", verify: ["npm test\nrm -rf x"] },
      { name: "largo", verify: ["x".repeat(2001)] },
      { name: "modo", integrate: "push" },
      { name: "automerge", integrate: "merge", autoMerge: true },
      { name: "plataforma", needs: { engines: [], platforms: ["amiga"] } },
      { name: "motor", needs: { engines: ["../x"], platforms: [] } },
      { name: "tiempo", verifyTimeoutMinutes: -1 },
      { name: "con" },
      { name: "credencial", verify: [`echo ghp_${"a1".repeat(18)}`] },
    ];
    for (const over of bad) published(api, over);
    put(api, lineRef("distinto"), JSON.stringify(recordOf()));
    const b = factory("nube");
    const text = file(b);
    expect(await pass(b, api)).toEqual({ cloned: [], unattended: [], failed: [] });
    expect(file(b)).toBe(text);
    expect(existsSync(b.home.lines)).toBe(false);
  });

  it("gives back only the known fields of a record", () => {
    const read = readLineRecord({ name: lineRef("tienda"), sha: "", data: JSON.stringify(recordOf({ repo: "/x", agents: [], issues: {} })) }) as LineRecord & Record<string, unknown>;
    expect(read.name).toBe("tienda");
    for (const key of ["repo", "agents", "issues"]) expect(read).not.toHaveProperty(key);
  });

  it("leaves neither the line nor a partial folder when the clone fails, and tries again only after an hour", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api);
    const b = factory("nube");
    const text = file(b);
    let at = new Date("2026-11-20T10:00:00Z");
    const now = () => at;
    let tried = 0;
    const failing: LineCloner = async ({ dir }) => {
      tried++;
      writeTree(dir, { "a-medias.txt": "x" });
      throw new Error(`no hay permiso para https://u:clave@github.com/acme/tienda en ${b.home.root}/lines`);
    };
    const first = await pass(b, api, { clone: failing, now });
    expect(first!.failed).toEqual([{ name: "tienda", why: expect.stringContaining("no hay permiso") }]);
    expect(file(b)).toBe(text);
    expect(readdirSync(b.home.lines)).toEqual([]);
    const state = readLineState(b.store, "tienda")!;
    expect(state).toMatchObject({ state: "failed", repository: "acme/tienda", why: expect.stringContaining("no hay permiso") });
    expect(state.why).not.toContain("clave@");
    expect(state.why).not.toContain(b.home.root);
    at = new Date("2026-11-20T10:59:00Z");
    expect((await pass(b, api, { clone: failing, now }))!.failed).toHaveLength(1);
    expect(tried).toBe(1);
    at = new Date("2026-11-20T11:01:00Z");
    expect((await pass(b, api, { clone: cloner(bare).clone, now }))!.cloned).toEqual(["tienda"]);
    expect(readLineState(b.store, "tienda")!.state).toBe("cloned");
  });

  it("counts a repository without the base branch as a failed clone", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api, { baseBranch: "otra" });
    const b = factory("nube");
    const clone: LineCloner = (i) => cloner(bare).clone({ ...i, branch: "main" });
    expect((await pass(b, api, { clone }))!.failed[0]!.why).toContain("otra");
    expect(b.config.lines).toEqual([]);
    expect(readdirSync(b.home.lines)).toEqual([]);
  });

  it("goes on from a clone a cut pass left, and refuses a folder that is not that clone", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api);
    const b = factory("nube");
    const dir = join(b.home.lines, "tienda");
    await cloner(bare).clone({ url: "https://github.com/acme/tienda.git", branch: "main", dir });
    expect((await pass(b, api))!.cloned).toEqual(["tienda"]);
    const c = factory("otra");
    writeTree(join(c.home.lines, "tienda"), { "mio.txt": "x" });
    expect((await pass(c, api))!.failed[0]!.why).toContain("no es un clon");
    expect(existsSync(join(c.home.lines, "tienda", "mio.txt"))).toBe(true);
    expect(c.config.lines).toEqual([]);
  });

  it("does not clone again a line taken out by hand", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api);
    const b = factory("nube");
    await pass(b, api, { clone: cloner(bare).clone });
    const doc = parseDocument(file(b));
    doc.deleteIn(["lines", 0]);
    writeFileSync(b.home.config, doc.toString());
    b.config = parseFactory(file(b));
    await pass(b, api);
    expect(b.config.lines).toEqual([]);
  });

  it("does not clone back a line it published itself and took out", async () => {
    const api = memoryCoord();
    const a = factory("pc-a", { lines: [{ name: "tienda", repo: githubRepo().repo, verify: [passes] }] });
    await pass(a, api);
    a.config = { ...a.config, lines: [] };
    expect(await pass(a, api)).toEqual({ cloned: [], unattended: [], failed: [] });
  });
});

describe("lines a machine cannot take", () => {
  it("does not clone a line for another platform, and keeps why", async () => {
    const api = memoryCoord();
    published(api, { needs: { engines: [], platforms: ["darwin"] } });
    const b = factory("nube");
    const result = await pass(b, api, { platform: "linux" });
    expect(result!.unattended).toEqual([{ name: "tienda", why: expect.stringContaining("plataforma") }]);
    expect(readLineState(b.store, "tienda")).toMatchObject({ state: "unattended", why: expect.stringMatching(/darwin.*linux/) });
  });

  it("names the missing engine, and clones once the chain has it", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api, { needs: { engines: ["codex"], platforms: [] } });
    const b = factory("nube");
    expect((await pass(b, api))!.unattended[0]!.why).toContain("codex");
    const doc = parseDocument(file(b));
    doc.setIn(["fallback"], ["codex"]);
    writeFileSync(b.home.config, doc.toString());
    b.config = parseFactory(file(b));
    expect((await pass(b, api, { clone: cloner(bare).clone }))!.cloned).toEqual(["tienda"]);
    expect(readLineState(b.store, "tienda")!.state).toBe("cloned");
  });

  it("forgets what it kept of a line nobody publishes any more", async () => {
    const api = memoryCoord();
    published(api, { needs: { engines: ["codex"], platforms: [] } });
    const b = factory("nube");
    await pass(b, api);
    api.refs.delete(lineRef("tienda"));
    await pass(b, api);
    expect(b.store.getKv(lineKey("tienda"))).toBeUndefined();
  });
});

describe("joining a factory", () => {
  const isPrivate = async () => ({ private: true });
  const single = () => testFactory({ isolation: "worktree", lines: [] });
  const CREATE = "gh repo create <cuenta>/<nombre> --private --add-readme";

  it("probes the repository, clones the lines it can take and names the ones it cannot", async () => {
    const { bare } = githubRepo();
    const { clone } = cloner(bare);
    const api = memoryCoord();
    published(api);
    published(api, { name: "ios", repository: "acme/ios", needs: { engines: [], platforms: ["darwin"] } });
    const b = single();
    const asked: string[] = [];
    const deps = { coord: (r: string) => (asked.push(r), api), clone, platform: "linux" as const };
    const result = await joinFactory(b, REPOSITORY, isPrivate, deps);
    expect(result.joined).toBe(true);
    expect(asked).toEqual([REPOSITORY]);
    expect(readProbe(b.store)).toMatchObject({ repository: REPOSITORY, ok: true });
    expect(existsSync(join(b.home.lines, "tienda", ".git"))).toBe(true);
    expect(b.config.lines.map((l) => l.name)).toEqual(["tienda"]);
    expect(parseFactory(file(b)).lines.map((l) => l.name)).toEqual(["tienda"]);
    expect(result.text).toContain("Líneas clonadas: tienda.");
    expect(result.text).toContain("ios: no se atiende en esta máquina por la plataforma");
    // A passed probe is not tried again, nor a line that is here cloned.
    const again = await joinFactory(b, REPOSITORY, isPrivate, deps);
    expect(again.text).not.toContain("Líneas clonadas");
    expect(api.calls.filter((c) => c.startsWith("create probe/"))).toHaveLength(2);
  });

  it("stays joined and tells it when the clone fails", async () => {
    const api = memoryCoord();
    published(api);
    const b = single();
    const result = await joinFactory(b, REPOSITORY, isPrivate, { coord: () => api, clone: async () => Promise.reject(new Error("sin permiso")) });
    expect(result.joined).toBe(true);
    expect(parseFactory(file(b)).distributed?.repository).toBe(REPOSITORY);
    expect(b.config.lines).toEqual([]);
    expect(result.text).toContain("tienda: no se pudo clonar (sin permiso)");
  });

  it("stays joined when the lines cannot be read, the probe fails, GitHub is paused or there is no token", async () => {
    const never = neverClones();
    const joins = async (api: ReturnType<typeof memoryCoord> | undefined, b = single()) => {
      const result = await joinFactory(b, REPOSITORY, isPrivate, { coord: () => api, clone: never.clone });
      expect(result.joined).toBe(true);
      expect(parseFactory(file(b)).distributed?.repository).toBe(REPOSITORY);
      return result.text;
    };
    const unreadable = memoryCoord();
    unreadable.list = async () => Promise.reject(new Error("503 https://u:clave@github.com/x"));
    const text = await joins(unreadable);
    expect(text).toContain("503");
    expect(text).not.toContain("clave");
    const empty = memoryCoord();
    empty.create = async () => Promise.reject(new Error("Git Repository is empty"));
    const b = single();
    expect(await joins(empty, b)).toContain("primer commit");
    // Joining again tries the failed probe at once.
    expect(await joins(memoryCoord(), b)).toContain("No hay líneas nuevas para clonar.");
    const paused = single();
    paused.store.setKv(HALT_KEY, JSON.stringify({ until: new Date(Date.now() + 3_600_000).toISOString(), why: "límite" }));
    const untouched = memoryCoord();
    expect(await joins(untouched, paused)).toContain("pausa");
    expect(untouched.calls).toEqual([]);
    expect(await joins(undefined)).toContain("no hay token");
    expect(never.calls()).toBe(0);
  });

  it("brings back a line cloned here and taken out by hand, in the folder that was still there", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api);
    const b = factory("nube");
    const c = cloner(bare);
    await pass(b, api, { clone: c.clone });
    const doc = parseDocument(file(b));
    doc.deleteIn(["lines", 0]);
    writeFileSync(b.home.config, doc.toString());
    b.config = parseFactory(file(b));
    writeTree(join(b.home.lines, "tienda"), { "mio.txt": "x" });
    const result = await joinFactory(b, REPOSITORY, isPrivate, { coord: () => api, clone: c.clone });
    expect(result.text).toContain("Líneas clonadas: tienda.");
    expect(b.config.lines.map((l) => l.name)).toEqual(["tienda"]);
    expect(c.asked).toHaveLength(1);
    expect(existsSync(join(b.home.lines, "tienda", "mio.txt"))).toBe(true);
  });

  it("counts as cloned a line the daemon added while it was cloning", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api);
    const b = factory("nube");
    const c = cloner(bare);
    const daemon: FactoryContext = { ...b };
    const clone: LineCloner = async (input) => {
      await linesPass(daemon, api, { clone: c.clone });
      await c.clone(input);
    };
    const result = await joinFactory(b, REPOSITORY, isPrivate, { coord: () => api, clone });
    expect(result.text).toContain("Líneas clonadas: tienda.");
    expect(parseFactory(file(b)).lines.map((l) => l.name)).toEqual(["tienda"]);
    expect(b.config.lines.map((l) => l.name)).toEqual(["tienda"]);
    expect(readLineState(b.store, "tienda")!.state).toBe("cloned");
    expect(readdirSync(b.home.lines)).toEqual(["tienda"]);
  });

  it("explains how to create the repository, and creates and writes nothing", async () => {
    const b = single();
    const before = file(b);
    const api = memoryCoord();
    const refused = async (name: string, check: () => Promise<{ private: boolean }> = isPrivate) => {
      const result = await joinFactory(b, name, check, { coord: () => api, clone: neverClones().clone });
      expect(result.joined).toBe(false);
      expect(result.text).toContain("primer commit");
      return result.text;
    };
    expect(await refused("")).toContain(CREATE);
    expect(await refused("zero-coord")).toContain(CREATE);
    expect(await refused("me/zero-coord", async () => ({ private: false }))).toContain(CREATE);
    expect(await refused("me/zero-coord", async () => Promise.reject(new Error("Not Found")))).toContain("gh repo create me/zero-coord --private --add-readme");
    expect(file(b)).toBe(before);
    expect(api.calls).toEqual([]);
    expect(b.store.kvWithPrefix("coord:")).toEqual([]);
  });

  it("explains it from the CLI without a repository", () => {
    const b = single();
    const before = file(b);
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "unirse"], { encoding: "utf8", env: { ...process.env, ZERO_HOME: b.home.root }, input: "", windowsHide: true });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(CREATE);
    expect(file(b)).toBe(before);
  });
});

describe("lines that are not on this machine, in status and panel", () => {
  it("shows why, and nothing without distributed", async () => {
    const api = memoryCoord();
    published(api, { name: "ios", repository: "acme/ios", needs: { engines: [], platforms: ["darwin"] } });
    published(api);
    const b = factory("nube");
    await linesPass(b, api, { platform: "linux", clone: async () => Promise.reject(new Error("falló <b>algo</b>")) });
    const status = factoryStatus(b);
    const text = formatStatus(status);
    expect(text).toContain("Líneas que no están en esta máquina:");
    expect(text).toContain("- ios · no se atiende en esta máquina por la plataforma");
    expect(text).toContain("- tienda · no se pudo clonar: falló");
    const html = overviewPage(status, [], "n");
    expect(html).toContain("ios · no se atiende en esta máquina por la plataforma");
    expect(html).toContain("tienda · no se pudo clonar");
    expect(html).not.toContain("<b>algo</b>");

    b.config = { ...b.config, distributed: undefined };
    const alone = factoryStatus(b);
    expect(alone.linesAway).toBeUndefined();
    expect(formatStatus(alone)).not.toContain("Líneas que no están");
    expect(overviewPage(alone, [], "n")).not.toContain("Líneas que no están");
  });
});

describe("the real cloner", () => {
  it("speaks only https: a local path is refused, and an aborted one never starts", async () => {
    const { bare } = githubRepo();
    const dir = join(tempDir(), "clon");
    await expect(gitCloneLine({ url: `file://${bare}`, branch: "main", dir })).rejects.toThrow(/not allowed/);
    await expect(gitCloneLine({ url: "https://github.com/acme/tienda.git", branch: "main", dir, signal: AbortSignal.abort() })).rejects.toThrow("cortado");
    expect(existsSync(dir)).toBe(false);
  });
});

describe("the lines pass in the daemon", () => {
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  it("beats and runs another line's job while a clone is still going", async () => {
    const { bare } = githubRepo();
    const api = memoryCoord();
    published(api);
    const b = factory("nube", { lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] });
    const beats = () => api.calls.filter((c) => c === `write ${machineRef(machineIdentity(b.store, b.config).id)}`).length;
    const { job } = requestWork(b, { text: "x" });
    let cloning = false;
    let release = () => {};
    const released = new Promise<void>((r) => (release = r));
    const clone: LineCloner = async (input) => {
      cloning = true;
      await released;
      await cloner(bare).clone(input);
    };
    let seen: { beats: number; cloning: boolean } | undefined;
    const agents = fakeAgents({
      build: async (req) => {
        writeTree(req.cwd, { "src/a.ts": "ok" });
        await until(() => cloning);
        const from = beats();
        await until(() => beats() > from + 1);
        seen = { beats: beats() - from, cloning: b.config.lines.every((l) => l.name !== "tienda") };
        release();
      },
    });
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api, cloneLine: clone });
    expect(seen).toMatchObject({ cloning: true });
    expect(seen!.beats).toBeGreaterThan(1);
    expect(b.store.getJob(job.id)!.status).toBe("delivered");
    expect(parseFactory(file(b)).lines.map((l) => l.name)).toEqual(["demo", "tienda"]);
  });

  it("cuts the clone at a shutdown without counting it as failed", async () => {
    const api = memoryCoord();
    published(api);
    const b = factory("nube", { lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] });
    requestWork(b, { text: "x" });
    let cut = false;
    const clone: LineCloner = ({ signal }) =>
      new Promise((_, reject) => {
        b.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
        signal!.addEventListener("abort", () => ((cut = true), reject(new Error("cortado"))));
      });
    const agents = fakeAgents({ build: (req) => new Promise((r) => req.signal?.addEventListener("abort", () => r(undefined))) });
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api, cloneLine: clone });
    expect(cut).toBe(true);
    expect(readLineState(b.store, "tienda")).toBeUndefined();
    expect(parseFactory(file(b)).lines.map((l) => l.name)).toEqual(["demo"]);
    expect(readdirSync(b.home.lines)).toEqual([]);
  });

  it("calls nothing, clones nothing and writes no coord key without distributed", async () => {
    const api = memoryCoord();
    published(api);
    const b = factory("nube", { distributed: undefined, lines: [{ name: "demo", repo: githubRepo().repo, verify: [passes] }] });
    b.store.deleteKv(PROBE_KEY);
    const never = neverClones();
    await runDaemon(b, { once: true, pollMs: 10, coord: () => api, cloneLine: never.clone });
    expect(never.calls()).toBe(0);
    expect(api.calls).toEqual([]);
    expect(existsSync(b.home.lines)).toBe(false);
    expect(b.store.kvWithPrefix("coord:")).toEqual([]);
  });

  it("does not run in a once run without an injected repository", async () => {
    const b = factory("nube", { lines: [{ name: "demo", repo: githubRepo().repo, verify: [passes] }] });
    const never = neverClones();
    await runDaemon(b, { once: true, pollMs: 10, cloneLine: never.clone });
    expect(never.calls()).toBe(0);
    expect(b.store.kvWithPrefix("coord:line:")).toEqual([]);
  });
});
