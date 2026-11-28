import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, requestUnjam, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { mergeKey, type MergeApi } from "../src/line/automerge.js";
import { discardResolved, RESOLVED_MS } from "../src/line/discard.js";
import { finalizeJob } from "../src/line/finish.js";
import { closeInterruptedUnjam, readDiagnosis, readUnjamRun, UNJAM_RUN_KEY, unjamOnDemandPass, unjamPass, urgentUnjamPass } from "../src/line/unjam.js";
import type { Job } from "../src/state/store.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 12, minute));

/** A repository with a bare repository as its remote. */
function remoteRepo() {
  const repo = gitRepo();
  const origin = tempDir("zero-origin-");
  gitIn(origin, "init", "-q", "--bare", "-b", "main");
  gitIn(repo, "remote", "add", "origin", origin);
  gitIn(repo, "push", "-q", "origin", "main");
  return repo;
}

/** A factory whose line has a bare repository as its remote. */
function withRemote(over: Record<string, unknown> = {}) {
  const repo = remoteRepo();
  return { ctx: testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request" }], ...over }), repo };
}

const create = (ctx: FactoryContext, line = "demo") => ctx.store.createJob({ line, kind: "request", request: "x", budgetUsd: 3 });

function commit(repo: string, files: Record<string, string>, message: string) {
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", message);
}

/** A failed job with its branch one commit ahead of main. */
async function failed(ctx: FactoryContext, repo: string, delivery?: Job["delivery"], line = "demo"): Promise<Job> {
  const job = create(ctx, line);
  gitIn(repo, "checkout", "-q", "-b", `zero/${job.id}`);
  commit(repo, { [`${job.id}.txt`]: job.id }, "work");
  gitIn(repo, "checkout", "-q", "main");
  return finalizeJob(ctx, job, "failed", { reason: "verify falló", ...(delivery && { delivery }) });
}

const push = (repo: string) => gitIn(repo, "push", "-q", "origin", "main");

function merge(repo: string, job: Job, ...how: string[]) {
  gitIn(repo, "merge", "-q", ...(how.length ? how : ["--no-ff", "-m", "merge"]), `zero/${job.id}`);
  push(repo);
}

const pullRequest = (n: number): Job["delivery"] => ({ mode: "pull-request", branch: "otra", url: `https://github.com/kaelen/demo/pull/${n}` });

const github = (answer: MergeApi["pullRequest"]): MergeApi => ({
  pullRequest: answer,
  checks: async () => [],
  merge: async () => undefined,
  deleteBranch: async () => {},
  comment: async () => {},
});

const read = (ctx: FactoryContext, job: Job) => ctx.store.getJob(job.id)!;

describe("failed jobs already resolved", () => {
  it.each([
    ["a merge commit", ["--no-ff", "-m", "merge"]],
    ["a fast-forward", ["--ff-only"]],
  ])("closes one whose branch entered the remote base with %s", async (_name, how) => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    merge(repo, job, ...how);
    // The line's own record of the remote is behind: it is fetched first.
    gitIn(repo, "update-ref", "refs/remotes/origin/main", "main~1");
    expect(await discardResolved(ctx, at(0))).toBe(1);
    const reason = `Descartado por la fábrica: su rama zero/${job.id} ya está en origin/main.`;
    expect(read(ctx, job)).toMatchObject({ status: "stopped", reason });
    const posts = (await ctx.townhall.recall({ line: "demo" })).filter((p) => p.kind === "run" && p.job === job.id);
    expect(posts.map((p) => p.body)).toContain(reason);
    expect(gitIn(repo, "branch", "--format=%(refname:short)")).toContain(`zero/${job.id}`);
    expect(await discardResolved(ctx, at(5))).toBe(0);
  });

  it("reports each job it closes, with its line, and nothing when it closes none", async () => {
    const { ctx, repo } = withRemote();
    const seen: unknown[] = [];
    expect(await discardResolved(ctx, at(0), undefined, (c) => seen.push(c))).toBe(0);
    expect(seen).toEqual([]);
    const jobs = [await failed(ctx, repo), await failed(ctx, repo), await failed(ctx, repo)];
    merge(repo, jobs[0]!);
    expect(await discardResolved(ctx, at(5), undefined, (c) => seen.push(c))).toBe(1);
    expect(seen).toEqual([{ line: "demo", job: jobs[0]!.id }]);
    merge(repo, jobs[1]!);
    merge(repo, jobs[2]!);
    expect(await discardResolved(ctx, at(10), undefined, (c) => seen.push(c))).toBe(2);
    expect(seen.slice(1)).toEqual(jobs.slice(1).map((j) => ({ line: "demo", job: j.id })));
  });

  it("a failing report neither undoes a closure nor stops the others", async () => {
    const { ctx, repo } = withRemote();
    const jobs = [await failed(ctx, repo), await failed(ctx, repo)];
    for (const job of jobs) merge(repo, job);
    const fails = () => {
      throw new Error("x");
    };
    expect(await discardResolved(ctx, at(0), undefined, fails)).toBe(2);
    expect(jobs.map((j) => read(ctx, j).status)).toEqual(["stopped", "stopped"]);
  });

  it("closes one whose branch came from a box, told by its commit's message", async () => {
    const { ctx, repo } = withRemote();
    const job = create(ctx);
    commit(repo, { "b.txt": "b" }, `zero(${job.id}): intento 1`);
    gitIn(repo, "branch", `zero/${job.id}`);
    push(repo);
    await finalizeJob(ctx, job, "failed", { reason: "no" });
    await discardResolved(ctx, at(0));
    expect(read(ctx, job).status).toBe("stopped");
  });

  it("closes one whose content is in the remote base through other commits", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    commit(repo, { [`${job.id}.txt`]: job.id, "other.txt": "otra cosa" }, "a mano");
    push(repo);
    await discardResolved(ctx, at(0));
    expect(read(ctx, job)).toMatchObject({ status: "stopped", reason: `Descartado por la fábrica: los cambios de su rama zero/${job.id} ya están en origin/main.` });
  });

  it("closes one whose pull request was merged, and only that one", async () => {
    const { ctx, repo } = withRemote();
    const jobs: Job[] = [];
    for (const n of [9, 10, 11]) jobs.push(await failed(ctx, repo, pullRequest(n)));
    const asked: number[] = [];
    const api = github(async (n) => {
      asked.push(n);
      if (n === 10) throw new Error("sin red");
      return { open: false, merged: n === 9, mergeable: null, headSha: "abc", base: "main" };
    });
    expect(await discardResolved(ctx, at(0), () => api)).toBe(1);
    const url = pullRequest(9)!.url!;
    expect(read(ctx, jobs[0]!)).toMatchObject({ status: "stopped", reason: `Descartado por la fábrica: su pull request ${url} ya se fundió.`, delivery: { url } });
    expect(jobs.slice(1).map((j) => read(ctx, j).status)).toEqual(["failed", "failed"]);
    // A closed one waits a day; one GitHub did not answer for is asked about again on the next look.
    await discardResolved(ctx, at(5), () => api);
    expect(asked).toEqual([9, 10, 11, 10]);
    await discardResolved(ctx, at(24 * 60 + 5), () => api);
    expect(asked.slice(4)).toEqual([10, 11]);
  });

  it("leaves a job retried while GitHub answered", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo, pullRequest(9));
    const api = github(async () => {
      ctx.store.updateJob(job.id, { status: "queued" });
      return { open: false, merged: true, mergeable: null, headSha: "a", base: "main" };
    });
    expect(await discardResolved(ctx, at(0), () => api)).toBe(0);
    expect(read(ctx, job).status).toBe("queued");
  });

  it("leaves real failures as they are", async () => {
    const { ctx, repo } = withRemote();
    const pending = await failed(ctx, repo);
    // Failed before its first commit: its branch is where it started, which is an ancestor of the base.
    const empty = create(ctx);
    gitIn(repo, "branch", `zero/${empty.id}`, "main");
    const none = create(ctx);
    const onBase = create(ctx);
    for (const j of [empty, none]) await finalizeJob(ctx, j, "failed", { reason: "no" });
    await finalizeJob(ctx, onBase, "failed", { reason: "no", delivery: { mode: "branch", branch: "main" } });
    commit(repo, { "other.txt": "otra cosa" }, "otra");
    push(repo);
    expect(await discardResolved(ctx, at(0))).toBe(0);
    for (const j of [pending, empty, none, onBase]) expect(read(ctx, j)).toMatchObject({ status: "failed" });
  });

  it("does not take part of the content as all of it", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    gitIn(repo, "checkout", "-q", `zero/${job.id}`);
    commit(repo, { "b.txt": "falta" }, "more");
    gitIn(repo, "checkout", "-q", "main");
    commit(repo, { [`${job.id}.txt`]: job.id }, "a mano");
    push(repo);
    expect(await discardResolved(ctx, at(0))).toBe(0);
    expect(read(ctx, job).status).toBe("failed");
  });

  it("has nothing to compare with on a line without a remote", async () => {
    const repo = gitRepo();
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "demo", repo }] });
    const job = await failed(ctx, repo);
    gitIn(repo, "merge", "-q", `zero/${job.id}`);
    expect(await discardResolved(ctx, at(0))).toBe(0);
    expect(read(ctx, job).status).toBe("failed");
  });

  it("looks at a line once a minute, or as soon as another job fails", async () => {
    const { ctx, repo } = withRemote();
    const first = await failed(ctx, repo);
    await discardResolved(ctx, at(0));
    merge(repo, first);
    const soon = new Date(at(0).getTime() + RESOLVED_MS - 1);
    expect(await discardResolved(ctx, soon)).toBe(0);
    const second = await failed(ctx, repo);
    expect(await discardResolved(ctx, soon)).toBe(1);
    expect([first, second].map((j) => read(ctx, j).status)).toEqual(["stopped", "failed"]);
  });

  it("are closed by the daemon", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    merge(repo, job);
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner, merges: () => undefined });
    expect(read(ctx, job).status).toBe("stopped");
  });

  it("are closed before unjam looks: no agent, no diagnosis", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    merge(repo, job);
    const agents = fakeAgents({});
    await unjamPass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(readDiagnosis(ctx.store, "demo")).toBeUndefined();
    expect(read(ctx, job).status).toBe("stopped");
  });

  it("are closed by an unjam run on demand before it looks: no agent, and the line has no jams", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    merge(repo, job);
    expect(requestUnjam(ctx, "demo", new Date())).toMatchObject({ ok: true });
    const agents = fakeAgents({});
    await unjamOnDemandPass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(read(ctx, job).status).toBe("stopped");
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok", reason: "la línea demo no tiene trabas", lines: [{ line: "demo", jams: 0, causes: 0 }], closed: [{ line: "demo", job: job.id }] });
  });

  it("an unjam run on demand records each job it closed, in order", async () => {
    const { ctx, repo } = withRemote();
    const jobs = [await failed(ctx, repo), await failed(ctx, repo)];
    for (const job of jobs) merge(repo, job);
    requestUnjam(ctx, "demo", new Date());
    await unjamOnDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(readUnjamRun(ctx.store)?.closed).toEqual(jobs.map((j) => ({ line: "demo", job: j.id })));
  });

  it("an unjam run on demand for one line records the closures of every line", async () => {
    const repo = remoteRepo();
    const blog = remoteRepo();
    const ctx = testFactory({
      level: "L2",
      isolation: "worktree",
      lines: [
        { name: "demo", repo, integrate: "pull-request" },
        { name: "blog", repo: blog, integrate: "pull-request" },
      ],
    });
    const job = await failed(ctx, blog, undefined, "blog");
    merge(blog, job);
    requestUnjam(ctx, "demo", new Date());
    await unjamOnDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok", lines: [{ line: "demo", jams: 0, causes: 0 }], closed: [{ line: "blog", job: job.id }] });
  });

  it("an unjam run on demand that closes nothing records no closures", async () => {
    const { ctx } = withRemote();
    const asked = new Date();
    requestUnjam(ctx, "demo", asked);
    await unjamOnDemandPass(ctx, fakeAgents({}).runner, new Date());
    const record = readUnjamRun(ctx.store)!;
    expect(record).not.toHaveProperty("closed");
    expect(record).toEqual({ asked: asked.toISOString(), line: "demo", startedAt: record.startedAt, endedAt: record.endedAt, outcome: "ok", reason: "la línea demo no tiene trabas", lines: [{ line: "demo", jams: 0, causes: 0 }] });
  });

  it("an unjam run on demand cut after closing keeps its closures", async () => {
    const { ctx, repo } = withRemote();
    await failed(ctx, repo);
    const job = await failed(ctx, repo, pullRequest(9));
    requestUnjam(ctx, "demo", new Date());
    // The andon goes on while GitHub answers, once the run has started.
    const api = github(async () => {
      ctx.store.setKv(ANDON_KEY, "on");
      return { open: false, merged: true, mergeable: null, headSha: "a", base: "main" };
    });
    const agents = fakeAgents({});
    await unjamOnDemandPass(ctx, agents.runner, new Date(), { merges: () => api });
    expect(agents.calls).toEqual([]);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("andon"), closed: [{ line: "demo", job: job.id }] });
  });

  it("an unjam run on demand that crashes after closing keeps its closures", async () => {
    const { ctx, repo } = withRemote();
    const first = await failed(ctx, repo, pullRequest(9));
    await failed(ctx, repo, pullRequest(10));
    requestUnjam(ctx, "demo", new Date());
    let during: string | undefined;
    const api = github(async (n) => {
      // What a daemon that crashed here would leave: the first job is already closed.
      if (n === 10) during = ctx.store.getKv(UNJAM_RUN_KEY);
      return { open: false, merged: n === 9, mergeable: null, headSha: "a", base: "main" };
    });
    await unjamOnDemandPass(ctx, fakeAgents({}).runner, new Date(), { merges: () => api });
    ctx.store.setKv(UNJAM_RUN_KEY, during!);
    expect(readUnjamRun(ctx.store)).toMatchObject({ closed: [{ line: "demo", job: first.id }] });
    expect(readUnjamRun(ctx.store)?.endedAt).toBeUndefined();
    closeInterruptedUnjam(ctx, new Date());
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", endedAt: expect.any(String), closed: [{ line: "demo", job: first.id }] });
  });

  it("are closed before the daytime unjam looks: only what is left is diagnosed", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    merge(repo, job);
    const pr = create(ctx);
    ctx.store.updateJob(pr.id, { status: "delivered", delivery: { mode: "pull-request", branch: `zero/${pr.id}`, url: "https://github.com/kaelen/demo/pull/7", autoMerge: true } });
    ctx.store.setKv(mergeKey(pr.id), JSON.stringify({ status: "blocked", blockedSince: "2026-01-01T00:00:00.000Z" }));
    const agents = fakeAgents({ unjam: () => ({ output: { causes: [] } }) });
    expect(await urgentUnjamPass(ctx, agents.runner, new Date(), { running: 0 })).toBe(1);
    expect(read(ctx, job).status).toBe("stopped");
    expect(agents.calls[0]!.prompt).toContain(`pr:${pr.id}`);
    expect(agents.calls[0]!.prompt).not.toContain(`job:${job.id}`);
  });
});
