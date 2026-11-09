import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryStatus, requestWork } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { cleanupKey, cleanupPass, recordCleanup } from "../src/line/cleanup.js";
import { finalizeJob } from "../src/line/finish.js";
import { runJob } from "../src/line/runner.js";
import { log } from "../src/log.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const passes = `node -e "process.exit(0)"`;
const busy = () => {
  throw new Error("EBUSY: resource busy or locked, rmdir 'C:\\work\\copy'");
};

function factory(level = "L2") {
  const repo = gitRepo();
  const ctx = testFactory({ level, isolation: "worktree", lines: [{ name: "demo", repo, verify: [passes] }] });
  return { ctx, repo };
}

/** A job that already has a work copy, as it would just before ending. */
function withCopy(ctx: ReturnType<typeof factory>["ctx"]) {
  const job = ctx.store.createJob({ line: "demo", kind: "request", request: "health", budgetUsd: 1 });
  const worktree = tempDir("zero-copy-");
  return ctx.store.updateJob(job.id, { worktree });
}

const delivery = { mode: "pull-request" as const, branch: "zero/x", url: "https://github.com/kaelen/demo/pull/1" };

describe("finalizeJob with a work copy that cannot be removed", () => {
  it("keeps a delivered pull request delivered and records the cleanup", async () => {
    const { ctx, repo } = factory();
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const job = withCopy(ctx);
    const done = await finalizeJob({ ...ctx, removeCopy: busy }, job, "delivered", { delivery });
    expect(done).toMatchObject({ status: "delivered", delivery });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
    const posts = await ctx.townhall.recall({ line: "demo" });
    expect(posts.filter((p) => p.job === job.id).map((p) => p.kind)).toEqual(["run"]);
    const record = JSON.parse(ctx.store.getKv(cleanupKey(job.id))!);
    expect(record).toMatchObject({ repo, path: job.worktree, error: expect.stringContaining("EBUSY") });
    expect(typeof record.since).toBe("string");
  });

  it("keeps failed and stopped jobs as they were ended", async () => {
    const { ctx } = factory();
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const failed = await finalizeJob({ ...ctx, removeCopy: busy }, withCopy(ctx), "failed", { reason: "verify" });
    expect(failed).toMatchObject({ status: "failed", reason: "verify" });
    const stopped = await finalizeJob({ ...ctx, removeCopy: busy }, withCopy(ctx), "stopped", { reason: "stop" });
    expect(stopped).toMatchObject({ status: "stopped", reason: "stop" });
  });

  it("records nothing when the copy is removed", async () => {
    const { ctx } = factory();
    const job = withCopy(ctx);
    await finalizeJob(ctx, job, "delivered", { delivery });
    expect(existsSync(job.worktree!)).toBe(false);
    expect(ctx.store.getKv(cleanupKey(job.id))).toBeUndefined();
  });

  it("does not turn a job runJob delivered into a failed one", async () => {
    const { ctx } = factory("L3");
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/health.ts": "export const ok = true;\n" }) });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, removeCopy: busy });
    expect(done.status).toBe("delivered");
    expect(ctx.store.getJob(job.id)!.reason ?? "").not.toContain("Error inesperado");
    expect(ctx.store.getKv(cleanupKey(job.id))).toBeDefined();
  });
});

describe("the cleanup pass", () => {
  const pending = (ctx: ReturnType<typeof factory>["ctx"], repo: string, path: string) => {
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "health", budgetUsd: 1 });
    ctx.store.finishJob(job.id, "delivered", {});
    recordCleanup(ctx.store, job.id, { repo, path, error: "EBUSY", since: new Date().toISOString() });
    return job.id;
  };

  it("removes the copy and forgets the record", async () => {
    const { ctx, repo } = factory();
    const id = pending(ctx, repo, "/some/copy");
    const remove = vi.fn();
    await cleanupPass(ctx, remove);
    expect(remove).toHaveBeenCalledWith(repo, "/some/copy");
    expect(ctx.store.getKv(cleanupKey(id))).toBeUndefined();
    expect(ctx.store.getJob(id)!.status).toBe("delivered");
  });

  it("keeps the record with the new error when it fails again", async () => {
    const { ctx, repo } = factory();
    const id = pending(ctx, repo, "/some/copy");
    await expect(
      cleanupPass(ctx, () => {
        throw new Error("EPERM: still locked");
      }),
    ).resolves.toBeUndefined();
    expect(JSON.parse(ctx.store.getKv(cleanupKey(id))!)).toMatchObject({ path: "/some/copy", error: "EPERM: still locked" });
    expect(ctx.store.getJob(id)!.status).toBe("delivered");
  });

  it("forgets a copy that is already gone", async () => {
    const { ctx, repo } = factory();
    const id = pending(ctx, repo, join(tempDir(), "gone"));
    await cleanupPass(ctx);
    expect(ctx.store.getKv(cleanupKey(id))).toBeUndefined();
  });

  it("removes a real folder left behind", async () => {
    const { ctx, repo } = factory();
    const path = join(tempDir(), "left");
    mkdirSync(path);
    writeTree(path, { "a.txt": "a\n" });
    const id = pending(ctx, repo, path);
    await cleanupPass(ctx);
    expect(existsSync(path)).toBe(false);
    expect(ctx.store.getKv(cleanupKey(id))).toBeUndefined();
  });

  it("skips records that are not JSON", async () => {
    const { ctx } = factory();
    ctx.store.setKv(cleanupKey("broken"), "{not json");
    await expect(cleanupPass(ctx, vi.fn())).resolves.toBeUndefined();
  });
});

describe("pending cleanups in zero status", () => {
  it("shows the count while there is one", () => {
    const { ctx, repo } = factory();
    recordCleanup(ctx.store, "j1", { repo, path: "/some/copy", error: "EBUSY", since: new Date().toISOString() });
    expect(factoryStatus(ctx).cleanups).toEqual([{ job: "j1", path: "/some/copy", since: expect.any(String) }]);
    const text = formatStatus(factoryStatus(ctx));
    expect(text).toContain("Limpiezas pendientes:");
    expect(text).toContain("1 copia de trabajo");
  });

  it("says nothing without one", () => {
    const { ctx } = factory();
    expect(formatStatus(factoryStatus(ctx))).not.toContain("Limpiezas pendientes");
  });
});
