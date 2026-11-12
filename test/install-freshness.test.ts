import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { briefing, factoryStatus } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { checkInstall, INSTALL_FRESHNESS_KEY, readInstallFreshness, type InstallFreshness } from "../src/install-freshness.js";
import type { GitRunner } from "../src/package-install.js";
import { overviewPage } from "../src/panel/html.js";
import { cleanup, gitIn, gitRepo, run, tempDir, testFactory, testStore } from "./helpers.js";

afterEach(cleanup);

/** Real git in the test's folders, recording every call; `failFetch` makes the fetch fail like an unreachable remote. */
function recordingGit(opts: { failFetch?: boolean } = {}) {
  const calls: string[][] = [];
  const git: GitRunner = async (args, o = {}) => {
    calls.push(args);
    if (opts.failFetch && args[0] === "fetch") throw new Error("git fetch: could not read from remote");
    return run("git", args, o.cwd ?? process.cwd());
  };
  return { git, calls };
}

/** An installation cloned from a bare remote on GitHub's address, with `ahead` commits merged after the clone. */
function installation(ahead: number) {
  const source = gitRepo({ "src/cli.ts": "export {};\n", "README.md": "# zero\n" });
  const remote = tempDir("zero-remote-");
  run("git", ["clone", "-q", "--bare", source, remote], tempDir());
  const root = join(tempDir("zero-install-"), "zero");
  run("git", ["clone", "-q", remote, root], tempDir());
  for (let i = 0; i < ahead; i++) {
    gitIn(source, "commit", "-q", "--allow-empty", "-m", `merged ${i}`);
  }
  gitIn(source, "push", "-q", remote, "main");
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "cli.js"), "// built\n");
  // The build is newer than the code unless a test says otherwise.
  utimesSync(join(root, "src", "cli.ts"), new Date("2026-11-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
  utimesSync(join(root, "dist", "cli.js"), new Date("2026-11-02T00:00:00Z"), new Date("2026-11-02T00:00:00Z"));
  return { root, remote };
}

const at = (iso: string) => new Date(iso);

describe("installed copy freshness", () => {
  it("counts the merged commits the installation does not have", async () => {
    const { root } = installation(3);
    const store = testStore();
    const { git } = recordingGit();
    const record = await checkInstall(store, at("2026-11-12T10:00:00Z"), { root, git });
    expect(record).toMatchObject({ behind: 3, staleBuild: false, upstream: "origin/main", checkedAt: "2026-11-12T10:00:00.000Z" });
    expect(readInstallFreshness(store)).toEqual(record);
  });

  it("names the GitHub repository of the upstream remote", async () => {
    const { root } = installation(0);
    run("git", ["remote", "set-url", "origin", "git@github.com:kaelen/zero.git"], root);
    const store = testStore();
    // The address is not reachable here: the fetch fails and the record comes from the local refs.
    const { git } = recordingGit({ failFetch: true });
    expect(await checkInstall(store, at("2026-11-12T10:00:00Z"), { root, git })).toMatchObject({ behind: 0, repository: "kaelen/zero" });
  });

  it("says when the build is older than the code", async () => {
    const { root } = installation(0);
    utimesSync(join(root, "src", "cli.ts"), new Date("2026-11-03T00:00:00Z"), new Date("2026-11-03T00:00:00Z"));
    const store = testStore();
    expect(await checkInstall(store, at("2026-11-12T10:00:00Z"), { root, git: recordingGit().git })).toMatchObject({ behind: 0, staleBuild: true });
  });

  it("asks git at most once an hour", async () => {
    const { root } = installation(1);
    const store = testStore();
    const { git, calls } = recordingGit();
    await checkInstall(store, at("2026-11-12T10:00:00Z"), { root, git });
    const asked = calls.length;
    expect(asked).toBeGreaterThan(0);
    expect(await checkInstall(store, at("2026-11-12T10:59:00Z"), { root, git })).toBeUndefined();
    expect(calls).toHaveLength(asked);
    await checkInstall(store, at("2026-11-12T11:00:00Z"), { root, git });
    expect(calls.length).toBeGreaterThan(asked);
  });

  it("writes the record from the local refs when the fetch fails", async () => {
    const { root, remote } = installation(0);
    // Two merged commits the clone already fetched, then a remote that no longer answers.
    const other = tempDir();
    run("git", ["clone", "-q", remote, join(other, "c")], other);
    gitIn(join(other, "c"), "commit", "-q", "--allow-empty", "-m", "a");
    gitIn(join(other, "c"), "commit", "-q", "--allow-empty", "-m", "b");
    gitIn(join(other, "c"), "push", "-q", "origin", "main");
    run("git", ["fetch", "-q", "origin"], root);
    const store = testStore();
    const { git } = recordingGit({ failFetch: true });
    await expect(checkInstall(store, at("2026-11-12T10:00:00Z"), { root, git })).resolves.toMatchObject({ behind: 2 });
    expect(readInstallFreshness(store)).toMatchObject({ behind: 2 });
  });

  it("stores only a problem for a folder that is not a git repository", async () => {
    const root = tempDir("zero-install-");
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "cli.js"), "");
    const store = testStore();
    const record = await checkInstall(store, at("2026-11-12T10:00:00Z"), { root, git: recordingGit().git });
    expect(record?.problem).toBeTruthy();
    expect(record?.behind).toBeUndefined();
    expect(record?.staleBuild).toBeUndefined();
  });
});

describe("installed copy in the daemon", () => {
  it("looks at the installation in a once run only when it is injected", async () => {
    const { root } = installation(2);
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "demo", repo: gitRepo() }] });
    await runDaemon(ctx, { once: true, pollMs: 10 });
    expect(ctx.store.getKv(INSTALL_FRESHNESS_KEY)).toBeUndefined();
    await runDaemon(ctx, { once: true, pollMs: 10, install: { root, git: recordingGit().git } });
    expect(readInstallFreshness(ctx.store)).toMatchObject({ behind: 2 });
  });
});

describe("installed copy warning", () => {
  const factory = (record?: Partial<InstallFreshness>) => {
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "demo", repo: gitRepo() }] });
    if (record) ctx.store.setKv(INSTALL_FRESHNESS_KEY, JSON.stringify({ checkedAt: new Date().toISOString(), ...record }));
    return ctx;
  };

  it("warns in status, the panel and the briefing when merged commits are missing", async () => {
    const ctx = factory({ behind: 2, staleBuild: false, upstream: "origin/main" });
    const line = formatStatus(factoryStatus(ctx)).split("\n").find((l) => l.startsWith("Instalación atrasada"));
    expect(line).toContain("2 commits");
    expect(overviewPage(factoryStatus(ctx), ["demo"], "n")).toContain("Instalación atrasada");
    expect((await briefing(ctx)).body).toContain("## Instalación");
  });

  it("warns when the build is older than the code", async () => {
    const ctx = factory({ behind: 0, staleBuild: true });
    expect(formatStatus(factoryStatus(ctx))).toMatch(/^Instalación atrasada: .*npm run build/m);
    expect((await briefing(ctx)).body).toContain("## Instalación");
  });

  it("says nothing while the installation is up to date", async () => {
    for (const record of [{ behind: 0, staleBuild: false }, { problem: "La instalación de zero no es un repositorio de git." }, undefined]) {
      const ctx = factory(record);
      expect(factoryStatus(ctx).install).toBeUndefined();
      expect(formatStatus(factoryStatus(ctx))).not.toContain("Instalación");
      expect((await briefing(ctx)).body).not.toContain("Instalación");
    }
  });
});
