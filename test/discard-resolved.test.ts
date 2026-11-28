import { afterEach, describe, expect, it } from "vitest";
import { quotaAttrs } from "../src/agent.js";
import { requestUnjam, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { mergeKey, type MergeApi } from "../src/line/automerge.js";
import { discardResolved, RESOLVED_MS } from "../src/line/discard.js";
import { finalizeJob } from "../src/line/finish.js";
import { readDiagnosis, readUnjamRun, unjamOnDemandPass, unjamPass, urgentUnjamPass } from "../src/line/unjam.js";
import type { Job } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 12, minute));

/** A factory whose line has a bare repository as its remote. */
function withRemote(over: Record<string, unknown> = {}) {
  const repo = gitRepo();
  const origin = tempDir("zero-origin-");
  gitIn(origin, "init", "-q", "--bare", "-b", "main");
  gitIn(repo, "remote", "add", "origin", origin);
  gitIn(repo, "push", "-q", "origin", "main");
  return { ctx: testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request" }], ...over }), repo };
}

const create = (ctx: FactoryContext) => ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });

function commit(repo: string, files: Record<string, string>, message: string) {
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", message);
}

/** A failed job with its branch one commit ahead of main. */
async function failed(ctx: FactoryContext, repo: string, delivery?: Job["delivery"]): Promise<Job> {
  const job = create(ctx);
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
  it("tells the callback each job it closes, with its line", async () => {
    const { ctx, repo } = withRemote();
    const one = await failed(ctx, repo);
    const two = await failed(ctx, repo);
    merge(repo, one);
    merge(repo, two);
    const seen: { line: string; job: string }[] = [];
    expect(await discardResolved(ctx, at(0), undefined, (c) => seen.push(c))).toBe(2);
    expect(seen).toHaveLength(2);
    expect(seen).toEqual(expect.arrayContaining([{ line: "demo", job: one.id }, { line: "demo", job: two.id }]));
  });

  it("never calls the callback when nothing is closed", async () => {
    const { ctx, repo } = withRemote();
    await failed(ctx, repo);
    const seen: unknown[] = [];
    expect(await discardResolved(ctx, at(0), undefined, (c) => seen.push(c))).toBe(0);
    expect(seen).toEqual([]);
  });

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

  it("an unjam run on demand records what it closed on every line, though asked for one", async () => {
    const { ctx, repo } = withRemote();
    const other = withRemote();
    ctx.config.lines.push({ ...other.ctx.config.lines[0]!, name: "blog" });
    const job = await failed(ctx, repo);
    merge(repo, job);
    const blogJob = ctx.store.createJob({ line: "blog", kind: "request", request: "x", budgetUsd: 3 });
    gitIn(other.repo, "checkout", "-q", "-b", `zero/${blogJob.id}`);
    commit(other.repo, { [`${blogJob.id}.txt`]: blogJob.id }, "work");
    gitIn(other.repo, "checkout", "-q", "main");
    await finalizeJob(ctx, blogJob, "failed", { reason: "verify falló" });
    merge(other.repo, blogJob);
    expect(requestUnjam(ctx, "demo", new Date())).toMatchObject({ ok: true });
    await unjamOnDemandPass(ctx, fakeAgents({}).runner, new Date());
    expect(readUnjamRun(ctx.store)?.closed).toEqual([
      { line: "demo", job: job.id },
      { line: "blog", job: blogJob.id },
    ]);
  });

  it("an unjam run on demand that closes nothing records no closed", async () => {
    const { ctx, repo } = withRemote();
    await failed(ctx, repo);
    expect(requestUnjam(ctx, "demo", new Date())).toMatchObject({ ok: true });
    await unjamOnDemandPass(ctx, fakeAgents({ unjam: () => ({ output: { causes: [] } }) }).runner, new Date());
    const run = readUnjamRun(ctx.store)!;
    expect(run.outcome).toBe("ok");
    expect(run).not.toHaveProperty("closed");
  });

  /** Runs `then` right after the factory closes a job as `stopped`. */
  function whenClosed(ctx: FactoryContext, then: () => void) {
    const finish = ctx.store.finishJob.bind(ctx.store);
    ctx.store.finishJob = (...args: Parameters<typeof finish>) => {
      const done = finish(...args);
      if (args[1] === "stopped") then();
      return done;
    };
  }

  it("an unjam run on demand cut by the budget after closing still records it", async () => {
    const { ctx, repo } = withRemote({ limits: { usdPerDay: 1 } });
    const job = await failed(ctx, repo);
    merge(repo, job);
    await failed(ctx, repo);
    expect(requestUnjam(ctx, "demo", new Date())).toMatchObject({ ok: true });
    // The budget is reached while the resolved job is closed, before the line, still jammed, is looked at.
    whenClosed(ctx, () => ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": 5, ...quotaAttrs({ billing: "api", windows: [] }) }));
    const agents = fakeAgents({});
    await unjamOnDemandPass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: "se alcanzó el presupuesto", closed: [{ line: "demo", job: job.id }] });
  });

  it("an unjam run on demand cut by a shutdown after closing still records it", async () => {
    const { ctx, repo } = withRemote();
    const job = await failed(ctx, repo);
    merge(repo, job);
    expect(requestUnjam(ctx, "demo", new Date())).toMatchObject({ ok: true });
    const stop = new AbortController();
    // The shutdown arrives while the resolved job is closed, so before the first line.
    whenClosed(ctx, () => stop.abort());
    const agents = fakeAgents({});
    await unjamOnDemandPass(ctx, agents.runner, new Date(), { signal: stop.signal });
    expect(agents.calls).toEqual([]);
    expect(read(ctx, job).status).toBe("stopped");
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: "la fábrica se apagó", closed: [{ line: "demo", job: job.id }] });
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
