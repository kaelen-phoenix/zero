import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { requestStationRun, type FactoryContext } from "../src/app.js";
import { loadFactory } from "../src/config.js";
import { onDemandPass, packageLineName } from "../src/line/packages.js";
import { runJob } from "../src/line/runner.js";
import { scoutPass } from "../src/line/scout.js";
import { factoryConfig, packageDataDir } from "../src/packages.js";
import { unzip } from "../src/unzip.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";
import { makeZip } from "./zip.js";

afterEach(() => cleanup());

const passes = `node -e "process.exit(0)"`;

/** One thing the station does with its context; what each returns is noted in order. */
type Step =
  | { op: "create"; name: string; opts?: unknown }
  | { op: "archive"; name: string; file: string }
  | { op: "remove"; name: string }
  | { op: "request"; req: unknown }
  | { op: "lines" }
  | { op: "unzip"; zip: string; dest: string };

/** A package `exp` whose on-demand station `s` runs the steps of a file and writes what each gave back. */
function stationPackage(opts: { name?: string; repositories?: unknown; requests?: boolean } = {}) {
  const dir = tempDir("zero-pkg-");
  const io = tempDir("zero-io-");
  const steps = join(io, "steps.json");
  const out = join(io, "out.json");
  const station = {
    name: "s",
    module: "s.mjs",
    onDemand: true,
    ...(opts.repositories !== undefined && { repositories: opts.repositories }),
    ...(opts.requests !== false && { requests: { perLinePerDay: 5 } }),
  };
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: opts.name ?? "exp", version: "1.0.0", stations: [station] }),
    "s.mjs": `import { readFileSync, writeFileSync } from "node:fs";
export async function pass(ctx) {
  const out = [];
  for (const s of JSON.parse(readFileSync(${JSON.stringify(steps)}, "utf8"))) {
    if (s.op === "create") out.push(await ctx.repos.create(s.name, s.opts));
    else if (s.op === "archive") out.push(await ctx.repos.archive(s.name, s.file));
    else if (s.op === "remove") out.push(await ctx.repos.remove(s.name));
    else if (s.op === "request") out.push(ctx.requestJob(s.req));
    else if (s.op === "lines") out.push(ctx.lines);
    else if (s.op === "unzip") out.push(await ctx.unzip(s.zip, s.dest));
  }
  writeFileSync(${JSON.stringify(out)}, JSON.stringify(out));
}
`,
  });
  return { dir, steps, out };
}

type Pkg = ReturnType<typeof stationPackage>;

async function factory(dirs: string[], over: Record<string, unknown> = {}): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", limits: { usdPerJob: 3 }, lines: [{ name: "web", repo: gitRepo(), verify: [passes] }], packages: dirs.map((path) => ({ path, allowCode: true })), ...over });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

/** Runs the station once on demand with these steps and gives back what each one returned. */
async function run(ctx: FactoryContext, pkg: Pkg, steps: Step[], pkgName = "exp"): Promise<any[]> {
  writeFileSync(pkg.steps, JSON.stringify(steps));
  expect(requestStationRun(ctx, `${pkgName}/s`)).toMatchObject({ ok: true });
  await onDemandPass(ctx, fakeAgents({}).runner, new Date());
  return JSON.parse(readFileSync(pkg.out, "utf8"));
}

/** A zip in the package's data folder. */
function dataZip(ctx: FactoryContext, rel: string, entries: Parameters<typeof makeZip>[0], pkg = "exp") {
  const file = join(packageDataDir(ctx.home, pkg), rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, makeZip(entries));
}

const repoDir = (ctx: FactoryContext, name: string, pkg = "exp") => join(ctx.home.packageRepos, pkg, name);

describe("declaring repositories in the manifest", () => {
  it("carries perDay to the loaded station", async () => {
    const ctx = await factory([stationPackage({ repositories: { perDay: 5 } }).dir]);
    expect(ctx.config.loadedPackages!.stations[0]!.repositories).toEqual({ perDay: 5 });
  });

  it("refuses a wrong declaration", async () => {
    const ctx = await factory([stationPackage({ repositories: { perDay: 0 } }).dir]);
    expect(ctx.config.loadedPackages!.stations).toEqual([]);
    expect(ctx.config.loadedPackages!.problems[0]!.reason).toContain("repositories");
  });
});

describe("creating a package repository", () => {
  it("makes a git repository from a zip and a line of the package", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    dataZip(ctx, "uploads/s/a.zip", [{ name: "src/a.txt", data: "hola\n" }, { name: "README.md", data: "# d1\n" }]);

    const [created, lines] = await run(ctx, pkg, [{ op: "create", name: "d1", opts: { from: "uploads/s/a.zip", verify: ["npm test"] } }, { op: "lines" }]);

    expect(created).toEqual({ ok: true, line: "exp-d1" });
    expect(lines).toContain("exp-d1");
    const repo = repoDir(ctx, "d1");
    expect(gitIn(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(gitIn(repo, "rev-list", "--count", "main")).toBe("1");
    expect(gitIn(repo, "ls-tree", "-r", "--name-only", "main").split("\n").sort()).toEqual(["README.md", "src/a.txt"]);
    expect(gitIn(repo, "remote")).toBe("");
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
    const line = ctx.config.lines.find((l) => l.name === "exp-d1");
    expect(line).toMatchObject({ package: "exp", integrate: "merge", baseBranch: "main", verify: ["npm test"], setup: [], repo });
    expect((await loadFactory(ctx.home.config)).lines.map((l) => l.name)).toContain("exp-d1");
  });

  it("makes an empty repository without from", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    const [created] = await run(ctx, pkg, [{ op: "create", name: "vacio" }]);
    expect(created).toMatchObject({ ok: true });
    expect(gitIn(repoDir(ctx, "vacio"), "rev-list", "--count", "main")).toBe("1");
  });

  it("refuses a station without repositories and changes nothing", async () => {
    const pkg = stationPackage();
    const ctx = await factory([pkg.dir]);
    const before = readFileSync(ctx.home.config, "utf8");
    const [created] = await run(ctx, pkg, [{ op: "create", name: "d1" }]);
    expect(created.reason).toContain("repositories");
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
    expect(existsSync(repoDir(ctx, "d1"))).toBe(false);
  });

  it("stops at the daily count", async () => {
    const pkg = stationPackage({ repositories: { perDay: 1 } });
    const ctx = await factory([pkg.dir]);
    const [first, second] = await run(ctx, pkg, [{ op: "create", name: "d1" }, { op: "create", name: "d2" }]);
    expect(first).toMatchObject({ ok: true });
    expect(second.reason).toContain("1 de 1");
    expect(existsSync(repoDir(ctx, "d2"))).toBe(false);
  });

  it.each(["../x", "Mayus", "", "a".repeat(41), "a/b"])("refuses the name %j", async (name) => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    const [created] = await run(ctx, pkg, [{ op: "create", name }]);
    expect(created.reason).toBeTruthy();
    expect(ctx.config.lines.map((l) => l.name)).toEqual(["web"]);
  });

  it("refuses a name whose line is taken by a line the package does not own", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir], { lines: [{ name: "web", repo: gitRepo() }, { name: "exp-d1", repo: gitRepo() }] });
    const [created] = await run(ctx, pkg, [{ op: "create", name: "d1" }]);
    expect(created.reason).toContain("exp-d1");
    expect(existsSync(repoDir(ctx, "d1"))).toBe(false);
  });

  it("refuses a zip with a path leaving the folder or reaching .git, and leaves nothing", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    dataZip(ctx, "bad.zip", [{ name: "../../x.txt", data: "x" }]);
    dataZip(ctx, "git.zip", [{ name: ".git/hooks/pre-commit", data: "x" }]);
    const [bad, git] = await run(ctx, pkg, [{ op: "create", name: "d1", opts: { from: "bad.zip" } }, { op: "create", name: "d2", opts: { from: "git.zip" } }]);
    expect(bad.reason).toBeTruthy();
    expect(git.reason).toContain(".git");
    expect(existsSync(repoDir(ctx, "d1"))).toBe(false);
    expect(existsSync(repoDir(ctx, "d2"))).toBe(false);
    expect(ctx.config.lines.map((l) => l.name)).toEqual(["web"]);
  });

  it("refuses a from outside the data folder", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    const [created] = await run(ctx, pkg, [{ op: "create", name: "d1", opts: { from: "../../zero.factory.yaml" } }]);
    expect(created.reason).toBeTruthy();
    expect(existsSync(repoDir(ctx, "d1"))).toBe(false);
  });
});

describe("jobs on package repositories", () => {
  it("opens a job on the package's line by repo", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    const [, asked] = await run(ctx, pkg, [{ op: "create", name: "d1" }, { op: "request", req: { repo: "d1", text: "agregá un archivo", maxUsd: 1 } }]);
    const job = ctx.store.getJob(asked.id)!;
    expect(job).toMatchObject({ line: "exp-d1", budgetUsd: 1, source: { kind: "package", package: "exp", station: "s" } });
  });

  it("refuses another package's line and hides it from ctx.lines", async () => {
    const a = stationPackage({ name: "a", repositories: { perDay: 5 } });
    const b = stationPackage({ name: "b" });
    const ctx = await factory([a.dir, b.dir]);
    await run(ctx, a, [{ op: "create", name: "d1" }], "a");
    expect(ctx.config.lines.map((l) => l.name)).toContain(packageLineName("a", "d1"));

    const [byLine, byRepo, lines] = await run(ctx, b, [{ op: "request", req: { line: "a-d1", text: "x" } }, { op: "request", req: { repo: "d1", text: "x" } }, { op: "lines" }], "b");

    expect(byLine.reason).toBeTruthy();
    expect(byRepo.reason).toBeTruthy();
    expect(lines).toEqual(["web"]);
    expect(ctx.store.listJobs({})).toEqual([]);
  });

  it("delivers a merge commit on main with no remote", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    const [, asked] = await run(ctx, pkg, [{ op: "create", name: "d1", opts: { verify: [passes] } }, { op: "request", req: { repo: "d1", text: "agregá hola.txt" } }]);
    const agents = fakeAgents({ build: (req) => writeTree(req.cwd, { "hola.txt": "hola\n" }) });

    const done = await runJob(asked.id, { ...ctx, runAgent: agents.runner });

    const repo = repoDir(ctx, "d1");
    expect(done.status).toBe("delivered");
    expect(done.delivery).toMatchObject({ mode: "merge", commit: gitIn(repo, "rev-parse", "main") });
    expect(gitIn(repo, "show", "main:hola.txt")).toBe("hola");
    expect(gitIn(repo, "remote")).toBe("");
    expect(agents.count).toMatchObject({ spec: 1, build: 1, review: 1, security: 1 });

    const [archived, bad, absolute] = await run(ctx, pkg, [
      { op: "archive", name: "d1", file: "out/d1.zip" },
      { op: "archive", name: "d1", file: "../x.zip" },
      { op: "archive", name: "d1", file: join(tempDir(), "y.zip") },
    ]);
    expect(archived).toEqual({ ok: true, file: "out/d1.zip" });
    expect(bad.reason).toBeTruthy();
    expect(absolute.reason).toBeTruthy();
    expect(existsSync(join(ctx.home.packageData, "x.zip"))).toBe(false);
    const unpacked = tempDir();
    const r = await unzip(join(packageDataDir(ctx.home, "exp"), "out/d1.zip"), unpacked);
    expect(r).toMatchObject({ ok: true });
    expect(readFileSync(join(unpacked, "hola.txt"), "utf8")).toBe("hola\n");
  });
});

describe("unzipping into a package repository", () => {
  it("writes inside the package's own repository, never in .git", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    dataZip(ctx, "a.zip", [{ name: "x.txt", data: "x" }]);
    const repo = repoDir(ctx, "d1");
    const [, ok, git] = await run(ctx, pkg, [{ op: "create", name: "d1" }, { op: "unzip", zip: "a.zip", dest: join(repo, "sub") }, { op: "unzip", zip: "a.zip", dest: join(repo, ".git", "hooks") }]);
    expect(ok).toEqual({ files: ["x.txt"] });
    expect(readFileSync(join(repo, "sub", "x.txt"), "utf8")).toBe("x");
    expect(git.reason).toContain(".git");
    expect(existsSync(join(repo, ".git", "hooks", "x.txt"))).toBe(false);
  });
});

describe("removing a package repository", () => {
  it("is refused while the line has a queued job, and done otherwise", async () => {
    const pkg = stationPackage({ repositories: { perDay: 5 } });
    const ctx = await factory([pkg.dir]);
    const [, asked, refused] = await run(ctx, pkg, [{ op: "create", name: "d1" }, { op: "request", req: { repo: "d1", text: "algo" } }, { op: "remove", name: "d1" }]);
    expect(refused.reason).toContain("sin terminar");
    expect(existsSync(repoDir(ctx, "d1"))).toBe(true);
    expect(ctx.config.lines.map((l) => l.name)).toContain("exp-d1");

    ctx.store.updateJob(asked.id, { status: "stopped" });
    const [removed] = await run(ctx, pkg, [{ op: "remove", name: "d1" }]);
    expect(removed).toEqual({ ok: true });
    expect(existsSync(repoDir(ctx, "d1"))).toBe(false);
    expect(ctx.config.lines.map((l) => l.name)).toEqual(["web"]);
    expect((await loadFactory(ctx.home.config)).lines.map((l) => l.name)).toEqual(["web"]);
  });

  it("refuses an owner line and another package's repository", async () => {
    const a = stationPackage({ name: "a", repositories: { perDay: 5 } });
    const b = stationPackage({ name: "b", repositories: { perDay: 5 } });
    const ctx = await factory([a.dir, b.dir], { lines: [{ name: "web", repo: gitRepo() }, { name: "b-web", repo: gitRepo() }] });
    await run(ctx, a, [{ op: "create", name: "d1" }], "a");
    const [other, owner, archive] = await run(ctx, b, [{ op: "remove", name: "d1" }, { op: "remove", name: "web" }, { op: "archive", name: "d1", file: "x.zip" }], "b");
    expect(other.reason).toBeTruthy();
    expect(owner.reason).toBeTruthy();
    expect(archive.reason).toBeTruthy();
    expect(existsSync(repoDir(ctx, "d1", "a"))).toBe(true);
    expect(ctx.config.lines.map((l) => l.name)).toEqual(["web", "b-web", "a-d1"]);
  });
});

describe("idle stations", () => {
  it("scout looks only at the owner's lines", async () => {
    const owner = gitRepo();
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "web", repo: owner }, { name: "exp-d1", repo: gitRepo(), package: "exp" }] }, () => new Date(2026, 9, 29, 3));
    const agents = fakeAgents({ scout: () => ({ output: { proposals: [] } }) });
    await scoutPass(ctx, agents.runner, new Date(2026, 9, 29, 3));
    expect(agents.count.scout).toBe(1);
    expect(agents.calls[0]!.cwd).toBe(owner);
  });

  it("the security alerts pass skips package lines", async () => {
    const { pollSecurityAlerts } = await import("../src/intake/security-alerts.js");
    const ctx = testFactory({ lines: [{ name: "exp-d1", repo: gitRepo(), package: "exp" }] });
    let asked = 0;
    await pollSecurityAlerts(ctx, () => {
      asked++;
      return undefined;
    });
    expect(asked).toBe(0);
  });
});
