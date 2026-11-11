import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, requestWork } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { cleanupKey, cleanupPass } from "../src/line/cleanup.js";
import { busyRetryKey, isLockedFolderError, runJob, type RunnerDeps } from "../src/line/runner.js";
import { log } from "../src/log.js";
import { removeWorkCopy } from "../src/workspace.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const passes = `node -e "process.exit(0)"`;
const locked = () => new Error("EBUSY: resource busy or locked, rmdir 'C:\\work\\copy'");
const writeHealth = () => (req: { cwd: string }) => void writeTree(req.cwd, { "src/health.ts": "export const ok = true;\n" });

function factory(level = "L2") {
  const repo = gitRepo();
  const ctx = testFactory({ level, isolation: "worktree", lines: [{ name: "demo", repo, verify: [passes] }] });
  return { ctx, repo };
}

type Ctx = ReturnType<typeof factory>["ctx"];
const deps = (ctx: Ctx, runner: RunnerDeps["runAgent"], extra: Partial<RunnerDeps> = {}): RunnerDeps => ({ ...ctx, runAgent: runner, ...extra });

describe("a locked folder while a job runs", () => {
  it("puts a resumed job back in the queue and kills what was left in its copy", async () => {
    const { ctx } = factory();
    vi.spyOn(log, "info").mockImplementation(() => {});
    const agents = fakeAgents({
      build: (_req, n) => {
        if (n === 1) throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        throw locked();
      },
    });
    const { job } = requestWork(ctx, { text: "health" });
    // A first cut leaves the work copy made, so the next run is a resume.
    const cut = await runJob(job.id, deps(ctx, agents.runner));
    expect(cut.status).toBe("queued");
    expect(cut.worktree && existsSync(cut.worktree)).toBe(true);

    const killLeftovers = vi.fn(() => 0);
    const again = await runJob(job.id, deps(ctx, agents.runner, { killLeftovers }));
    expect(again).toMatchObject({ status: "queued", checkpoint: cut.checkpoint });
    expect(ctx.store.getKv(busyRetryKey(job.id))).toBe("1");
    expect(killLeftovers).toHaveBeenCalledWith(cut.worktree);
    expect(ctx.store.getJob(job.id)!.reason ?? "").not.toContain("Error inesperado");
  });

  it("recognizes the code in the cause", async () => {
    const { ctx } = factory();
    vi.spyOn(log, "info").mockImplementation(() => {});
    const agents = fakeAgents({
      build: () => {
        throw new Error("could not finish", { cause: Object.assign(new Error("gone"), { code: "EBUSY" }) });
      },
    });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner, { killLeftovers: () => 0 }))).toMatchObject({ status: "queued" });
    expect(ctx.store.getKv(busyRetryKey(job.id))).toBe("1");
  });

  it("fails once the retries are used up, naming the locked folder", async () => {
    const { ctx } = factory();
    vi.spyOn(log, "error").mockImplementation(() => {});
    const agents = fakeAgents({
      build: () => {
        throw locked();
      },
    });
    const { job } = requestWork(ctx, { text: "health" });
    ctx.store.setKv(busyRetryKey(job.id), "2");
    const failed = await runJob(job.id, deps(ctx, agents.runner, { killLeftovers: () => 0 }));
    expect(failed).toMatchObject({ status: "failed", reason: expect.stringContaining("bloqueada") });
    expect(failed.finishedAt).toBeTruthy();
  });

  it("changes nothing for other errors", async () => {
    const { ctx } = factory();
    vi.spyOn(log, "error").mockImplementation(() => {});
    const agents = fakeAgents({
      build: () => {
        throw new Error("boom");
      },
    });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "failed", reason: "Error inesperado: boom" });
    expect(ctx.store.getKv(busyRetryKey(job.id))).toBeUndefined();
  });

  it("does not requeue a first preparation that fails with EBUSY", async () => {
    const repo = gitRepo();
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, setup: [`node -e "console.log('EBUSY: resource busy or locked');process.exit(1)"`], verify: [passes] }] });
    const agents = fakeAgents({});
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "failed" });
    expect(ctx.store.getKv(busyRetryKey(job.id))).toBeUndefined();
  });

  it("tells EBUSY apart in codes, messages and causes", () => {
    expect(isLockedFolderError(locked())).toBe(true);
    expect(isLockedFolderError("EBUSY")).toBe(true);
    expect(isLockedFolderError(new Error("EBUSYNESS"))).toBe(false);
    expect(isLockedFolderError(undefined)).toBe(false);
  });
});

describe("the daemon resuming interrupted jobs", () => {
  it("kills what was left in an interrupted job's copy before re-queuing it", async () => {
    const { ctx } = factory();
    ctx.store.setKv(ANDON_KEY, "on");
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "health", budgetUsd: 1 });
    const worktree = tempDir("zero-copy-");
    ctx.store.updateJob(job.id, { status: "running", worktree });
    const agents = fakeAgents({});
    const seen: string[] = [];
    const killLeftovers = vi.fn((folder: string) => {
      seen.push(ctx.store.getJob(job.id)!.status);
      return 0;
    });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, killLeftovers });
    expect(killLeftovers).toHaveBeenCalledTimes(1);
    expect(killLeftovers).toHaveBeenCalledWith(worktree);
    expect(seen).toEqual(["running"]);
    expect(agents.calls).toEqual([]);
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
  });

  it("skips a job without a copy and goes on when the kill throws", async () => {
    const { ctx } = factory();
    ctx.store.setKv(ANDON_KEY, "on");
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const bare = ctx.store.createJob({ line: "demo", kind: "request", request: "a", budgetUsd: 1 });
    ctx.store.updateJob(bare.id, { status: "running" });
    const gone = ctx.store.createJob({ line: "demo", kind: "request", request: "b", budgetUsd: 1 });
    ctx.store.updateJob(gone.id, { status: "running", worktree: join(tempDir(), "gone") });
    const held = ctx.store.createJob({ line: "demo", kind: "request", request: "c", budgetUsd: 1 });
    ctx.store.updateJob(held.id, { status: "running", worktree: tempDir("zero-copy-") });
    const killLeftovers = vi.fn(() => {
      throw new Error("no process list");
    });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner, killLeftovers });
    expect(killLeftovers).toHaveBeenCalledTimes(1);
    for (const id of [bare.id, gone.id, held.id]) expect(ctx.store.getJob(id)!.status).toBe("queued");
  });
});

describe("the temporary merge folder", () => {
  /** A merge line whose base is not checked out anywhere, so integration merges in a temporary copy. */
  function mergeLine() {
    const { ctx, repo } = factory("L3");
    gitIn(repo, "checkout", "-q", "-b", "side");
    return { ctx, repo, scratch: join(ctx.home.worktrees, "demo") };
  }
  const isMergeCopy = (path: string, scratch: string) => resolve(path).startsWith(resolve(scratch, "merge-"));

  it("keeps the job delivered when the folder cannot be removed after the merge", async () => {
    const { ctx, repo, scratch } = mergeLine();
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const removeCopy = (r: string, path: string) => {
      if (isMergeCopy(path, scratch) && existsSync(path)) throw locked();
      removeWorkCopy(r, path);
    };
    const agents = fakeAgents({ build: writeHealth() });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner, { removeCopy }));
    const tip = gitIn(repo, "rev-parse", "main").trim();
    expect(done).toMatchObject({ status: "delivered", delivery: { mode: "merge", commit: tip } });
    const record = JSON.parse(ctx.store.getKv(cleanupKey(`${job.id}-merge`))!);
    expect(record).toMatchObject({ repo, path: join(scratch, `merge-${job.id}`), error: expect.stringContaining("EBUSY") });

    const remove = vi.fn();
    await cleanupPass(ctx, remove);
    expect(remove).toHaveBeenCalledWith(repo, record.path);
    expect(ctx.store.getKv(cleanupKey(`${job.id}-merge`))).toBeUndefined();
  });

  it("merges in a fresh folder when an earlier one is locked", async () => {
    const { ctx, repo, scratch } = mergeLine();
    const agents = fakeAgents({ build: writeHealth() });
    const { job } = requestWork(ctx, { text: "health" });
    const stale = join(scratch, `merge-${job.id}`);
    mkdirSync(stale, { recursive: true });
    const removeCopy = (r: string, path: string) => {
      if (resolve(path) === resolve(stale)) throw locked();
      removeWorkCopy(r, path);
    };
    const done = await runJob(job.id, deps(ctx, agents.runner, { removeCopy }));
    expect(done.status).toBe("delivered");
    gitIn(repo, "merge-base", "--is-ancestor", done.delivery!.branch, "main");
  });
});
