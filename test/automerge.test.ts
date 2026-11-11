import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { briefing, factoryStatus, retryJob } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { formatStatus } from "../src/format.js";
import { GithubHalted } from "../src/github-quota.js";
import { mergeDecision, mergeKey, pollMerges, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob, prRefreshKey } from "../src/line/finish.js";
import type { JobSource } from "../src/state/store.js";
import { cleanup, gitIn, gitRepo, run, tempDir, testFactory, validSpec } from "./helpers.js";

afterEach(cleanup);

const pr = (over: Partial<PullRequestState> = {}): PullRequestState => ({ open: true, merged: false, mergeable: true, headSha: "abc", ...over });
const green: Check[] = [{ name: "check", done: true, ok: true }];
const HOUR = 3_600_000;

describe("when a pull request can be merged", () => {
  it("merges only with every check finished well and no conflicts", () => {
    expect(mergeDecision(pr(), green, HOUR)).toEqual({ kind: "merge" });
    expect(mergeDecision(pr(), [...green, { name: "e2e", done: false, ok: false }], HOUR)).toMatchObject({ kind: "wait" });
    expect(mergeDecision(pr(), [...green, { name: "e2e", done: true, ok: false }], HOUR)).toMatchObject({ kind: "blocked", why: "fallaron los checks e2e" });
    expect(mergeDecision(pr({ mergeable: null }), green, HOUR)).toMatchObject({ kind: "wait" });
    expect(mergeDecision(pr({ mergeable: false }), green, HOUR)).toMatchObject({ kind: "blocked", why: "en conflicto con la rama base" });
    expect(mergeDecision(pr({ mergeable: false }), [{ name: "e2e", done: true, ok: false }, { name: "ci", done: false, ok: false }], HOUR)).toEqual({ kind: "blocked", key: "conflict:abc", why: "en conflicto con la rama base" });
  });

  it("gives CI a moment to register its checks", () => {
    expect(mergeDecision(pr(), [], 60_000)).toMatchObject({ kind: "wait" });
    expect(mergeDecision(pr(), [], HOUR)).toEqual({ kind: "merge" });
  });

  it("stops watching a pull request someone else merged or closed", () => {
    expect(mergeDecision(pr({ open: false, merged: true }), [], HOUR)).toEqual({ kind: "gone", merged: true });
    expect(mergeDecision(pr({ open: false }), green, HOUR)).toEqual({ kind: "gone", merged: false });
  });
});

/** One pull request on GitHub whose checks the test changes; records what the factory did. */
function fakeGitHub(checks: Check[]) {
  const state = { pr: pr(), checks };
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async () => state.pr,
    checks: async () => state.checks,
    merge: async (n, sha) => {
      did.push(`merge #${n} @${sha}`);
      state.pr = { ...state.pr, open: false, merged: true };
      return "merged-sha";
    },
    deleteBranch: async (b) => void did.push(`delete ${b}`),
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
  };
  return { api, state, did };
}

async function deliveredJob(opts: { autoMerge?: boolean; source?: JobSource } = {}) {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), integrate: "pull-request", autoMerge: true }] });
  const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3, ...(opts.source && { source: opts.source }) });
  const url = "https://github.com/kaelen/demo/pull/10";
  await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url, ...(opts.autoMerge !== false && { autoMerge: true }) } });
  return { ctx, job };
}

describe("automatic merging", () => {
  it("gives the api factory the job's line, so the daemon signs with that line's signature", async () => {
    const { ctx } = await deliveredJob();
    const gh = fakeGitHub(green);
    const asked: unknown[][] = [];
    await pollMerges(ctx, (...args) => {
      asked.push(args);
      return gh.api;
    });
    expect(asked[0]).toEqual(["kaelen/demo", ctx.config.lines[0]]);
  });

  it("merges a ready pull request, deletes its branch and tells the issue", async () => {
    const { ctx, job } = await deliveredJob({ source: { kind: "github-issue", repository: "kaelen/demo", number: 7, url: "u" } });
    const gh = fakeGitHub(green);
    await pollMerges(ctx, () => gh.api);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([
      "merge #10 @abc",
      `delete zero/${job.id}`,
      "comment #7: La fábrica fundió https://github.com/kaelen/demo/pull/10: el cambio ya está en la rama base.",
    ]);
    expect(factoryStatus(ctx).merges).toEqual([]);
  });

  it("leaves a pull request with a failed check open, says so once, and merges it once fixed", async () => {
    const { ctx } = await deliveredJob();
    const gh = fakeGitHub([{ name: "check", done: true, ok: false }]);
    await pollMerges(ctx, () => gh.api);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["comment #10: La fábrica no funde este pull request: fallaron los checks check. Queda abierto; si se arregla, lo funde en la próxima revisión."]);
    expect(formatStatus(factoryStatus(ctx))).toContain("Fusión automática: https://github.com/kaelen/demo/pull/10");
    expect(formatStatus(factoryStatus(ctx))).toContain("NO SE FUNDE: fallaron los checks check");
    expect((await briefing(ctx)).body).toContain("**Sin fundir**: https://github.com/kaelen/demo/pull/10: fallaron los checks check.");

    gh.state.checks = green;
    gh.state.pr = pr({ headSha: "def" });
    await pollMerges(ctx, () => gh.api);
    expect(gh.did.at(-2)).toBe("merge #10 @def");
  });

  it("waits while checks run, and keeps waiting when GitHub cannot be reached", async () => {
    const { ctx } = await deliveredJob();
    const gh = fakeGitHub([{ name: "check", done: false, ok: false }]);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    expect(factoryStatus(ctx).merges).toMatchObject([{ status: "waiting", why: "esperando checks" }]);
    await pollMerges(ctx, () => undefined);
    expect(factoryStatus(ctx).merges[0]!.why).toMatch(/sin acceso a GitHub/);
  });

  it("never touches pull requests of lines without automatic merging", async () => {
    const { ctx } = await deliveredJob({ autoMerge: false });
    const gh = fakeGitHub(green);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
  });

  it("only exists for lines that deliver through pull requests", () => {
    const yaml = (integrate: string) => `version: 1\nlines:\n  - name: demo\n    repo: /tmp/demo\n    integrate: ${integrate}\n    autoMerge: true\n`;
    expect(parseFactory(yaml("pull-request")).lines[0]!.autoMerge).toBe(true);
    expect(() => parseFactory(yaml("merge"))).toThrow(/autoMerge needs integrate: pull-request/);
  });
});

describe("waiting on a blocked pull request", () => {
  const MINUTE = 60_000;
  const failed: Check[] = [{ name: "check", done: true, ok: false }];

  /** A pull request delivered "now", with a clock and a count of the calls to checks. */
  async function blockedJob(checks: Check[] = failed) {
    const clock = { ms: Date.now() };
    const repo = gitRepo();
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request", autoMerge: true }] }, () => new Date(clock.ms));
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/kaelen/demo/pull/10", autoMerge: true } });
    const gh = fakeGitHub(checks);
    const asked: string[] = [];
    const original = gh.api.checks;
    gh.api.checks = async (sha) => {
      asked.push(sha);
      return original(sha);
    };
    const state = () => JSON.parse(ctx.store.getKv(mergeKey(job.id))!) as MergeState;
    const pass = () => pollMerges(ctx, () => gh.api);
    return { ctx, job, gh, clock, asked, state, pass };
  }

  it("does not ask again or repeat the comment for the same head", async () => {
    const { gh, asked, state, pass } = await blockedJob();
    await pass();
    await pass();
    expect(asked).toEqual(["abc"]);
    expect(gh.did.filter((d) => d.startsWith("comment"))).toHaveLength(1);
    expect(state()).toMatchObject({ status: "blocked", why: "fallaron los checks check" });
  });

  it("asks again once the wait is over, and waits twice as long", async () => {
    const { gh, asked, state, pass, clock } = await blockedJob();
    await pass();
    expect(state().backoff!.delayMs).toBe(5 * MINUTE);
    clock.ms += 5 * MINUTE - 1;
    await pass();
    expect(asked).toHaveLength(1);
    clock.ms += 1;
    await pass();
    expect(asked).toHaveLength(2);
    expect(state().backoff!.delayMs).toBe(10 * MINUTE);
    expect(gh.did.filter((d) => d.startsWith("comment"))).toHaveLength(1);
  });

  it("never waits more than an hour", async () => {
    const { state, pass, clock } = await blockedJob();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      await pass();
      delays.push(state().backoff!.delayMs);
      clock.ms += state().backoff!.delayMs;
    }
    expect(delays.map((d) => d / MINUTE)).toEqual([5, 10, 20, 40, 60, 60, 60]);
  });

  it("merges in the same pass when the head changes to green checks", async () => {
    const { gh, asked, state, pass } = await blockedJob();
    await pass();
    gh.state.pr = pr({ headSha: "def" });
    gh.state.checks = green;
    await pass();
    expect(asked).toEqual(["abc", "def"]);
    expect(gh.did).toContain("merge #10 @def");
    expect(state().status).toBe("merged");
  });

  it("asks again in the same pass when mergeable changes, starting the wait over", async () => {
    const { gh, asked, state, pass, clock } = await blockedJob();
    await pass();
    clock.ms += 5 * MINUTE;
    await pass();
    expect(state().backoff!.delayMs).toBe(10 * MINUTE);
    gh.state.pr = pr({ mergeable: false });
    await pass();
    // In conflict its checks are not even asked for: they change nothing.
    expect(asked).toHaveLength(2);
    expect(state().why).toBe("en conflicto con la rama base");
    expect(state().backoff).toMatchObject({ mergeable: false, delayMs: 5 * MINUTE });
  });

  it("forgets the wait once the checks run again", async () => {
    const { gh, state, pass, clock } = await blockedJob();
    await pass();
    gh.state.checks = [{ name: "check", done: false, ok: false }];
    clock.ms += 5 * MINUTE;
    await pass();
    expect(state()).toMatchObject({ status: "waiting", why: "esperando checks" });
    expect(state().backoff).toBeUndefined();
  });

  it("notices during the wait that it was merged or closed, without asking for checks", async () => {
    const merged = await blockedJob();
    await merged.pass();
    merged.gh.state.pr = pr({ open: false, merged: true, mergeCommitSha: "m1" });
    await merged.pass();
    expect(merged.asked).toHaveLength(1);
    expect(merged.state().status).toBe("merged");

    const closed = await blockedJob();
    await closed.pass();
    closed.gh.state.pr = pr({ open: false });
    await closed.pass();
    expect(closed.asked).toHaveLength(1);
    expect(closed.state().status).toBe("closed");
  });

  it("expires after 14 days once the wait is over", async () => {
    const { state, pass, clock } = await blockedJob();
    await pass();
    clock.ms += 15 * 24 * 60 * MINUTE;
    await pass();
    expect(state().status).toBe("expired");
  });

  it("expires inside a wait that has not ended", async () => {
    const { ctx, job, asked, state, pass, clock } = await blockedJob();
    await pass();
    clock.ms += 15 * 24 * 60 * MINUTE;
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ ...state(), backoff: { ...state().backoff!, nextChecksAt: new Date(clock.ms + MINUTE).toISOString() } }));
    await pass();
    expect(asked).toHaveLength(1);
    expect(state().status).toBe("expired");
  });

  it("stays blocked with its reason after a problem reaching GitHub", async () => {
    const { gh, asked, state, pass } = await blockedJob();
    await pass();
    const original = gh.api.pullRequest;
    gh.api.pullRequest = async () => {
      throw new Error("ECONNRESET");
    };
    await pass();
    expect(state().status).toBe("waiting");
    gh.api.pullRequest = original;
    await pass();
    expect(asked).toHaveLength(1);
    expect(state()).toMatchObject({ status: "blocked", why: "fallaron los checks check" });
  });
});

describe("a pull request in conflict", () => {
  const MINUTE = 60_000;

  /** A delivered job whose branch is at the pull request's head, on a line whose base can be fetched unless told otherwise. */
  async function conflicted(opts: { maxAttempts?: number; attempt?: number; spec?: boolean; branch?: boolean; remote?: string } = {}) {
    const clock = { ms: Date.now() };
    const repo = gitRepo();
    const bare = tempDir("zero-remote-");
    run("git", ["init", "-q", "--bare", "-b", "main"], bare);
    gitIn(repo, "remote", "add", "origin", opts.remote ?? bare);
    if (!opts.remote) gitIn(repo, "push", "-q", "origin", "main");
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request", autoMerge: true, maxAttempts: opts.maxAttempts ?? 3 }] }, () => new Date(clock.ms));
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
    const branch = `zero/${job.id}`;
    const delivery = { mode: "pull-request" as const, branch, url: "https://github.com/kaelen/demo/pull/10", autoMerge: true };
    ctx.store.updateJob(job.id, { attempt: opts.attempt ?? 1, approvals: { spec: true, integrate: true }, ...(opts.spec !== false && { spec: validSpec() }) });
    await finalizeJob(ctx, ctx.store.getJob(job.id)!, "delivered", { delivery });
    if (opts.branch !== false) gitIn(repo, "branch", branch);
    const head = gitIn(repo, "rev-parse", "HEAD");
    const gh = fakeGitHub(green);
    gh.state.pr = pr({ mergeable: false, headSha: head });
    const state = () => JSON.parse(ctx.store.getKv(mergeKey(job.id))!) as MergeState;
    const current = () => ctx.store.getJob(job.id)!;
    const comments = () => gh.did.filter((d) => d.startsWith("comment"));
    return { ctx, job, repo, head, gh, delivery, clock, state, current, comments, pass: () => pollMerges(ctx, () => gh.api) };
  }

  it("goes back to the queue without a comment, keeping its delivery and clearing the approval", async () => {
    const { head, gh, delivery, state, current, pass, ctx, job } = await conflicted();
    await pass();
    expect(current()).toMatchObject({ status: "queued", checkpoint: "review", station: "integrate", delivery, base: "origin/main" });
    expect(current().finishedAt).toBeUndefined();
    expect(current().approvals).toEqual({ spec: true });
    expect(gh.did).toEqual([]);
    expect(state()).toMatchObject({ status: "waiting", resolving: head });
    expect(JSON.parse(ctx.store.getKv(prRefreshKey(job.id))!)).toEqual({ head, approved: true });
  });

  it.each<[string, Check[]]>([
    ["failed", [{ name: "check", done: true, ok: false }]],
    ["pending", [{ name: "check", done: false, ok: false }]],
  ])("goes back to the queue with %s checks too", async (_name, checks) => {
    const { gh, current, pass } = await conflicted();
    gh.state.checks = checks;
    await pass();
    expect(current().status).toBe("queued");
  });

  it("leaves it delivered and says so once when the head is someone else's", async () => {
    const { gh, current, comments, state, pass, repo } = await conflicted();
    gh.state.pr = pr({ mergeable: false, headSha: "someone-elses" });
    await pass();
    await pass();
    expect(current().status).toBe("delivered");
    expect(comments()).toEqual([expect.stringMatching(/en conflicto con la rama base/)]);
    expect(state().resolving).toBeUndefined();
    expect(gitIn(repo, "worktree", "list")).not.toContain("zero/");
  });

  it("leaves it delivered and says so once when the local branch is gone", async () => {
    const { current, comments, pass } = await conflicted({ branch: false });
    await pass();
    await pass();
    expect(current().status).toBe("delivered");
    expect(comments()).toHaveLength(1);
  });

  it("goes back to the queue with one attempt left when its build spent them all", async () => {
    const { head, ctx, job, current, state, pass } = await conflicted({ maxAttempts: 3, attempt: 3 });
    await pass();
    expect(current()).toMatchObject({ status: "queued", checkpoint: "review", station: "integrate", attempt: 2 });
    expect(state()).toMatchObject({ status: "waiting", resolving: head, resolutions: 1 });
    expect(ctx.store.getKv(prRefreshKey(job.id))).toBeDefined();

    const early = await conflicted({ attempt: 1 });
    await early.pass();
    expect(early.current()).toMatchObject({ status: "queued", attempt: 1 });
  });

  it("keeps the count of resolutions through later saves", async () => {
    const { gh, ctx, job, state, pass } = await conflicted();
    await pass();
    ctx.store.updateJob(job.id, { status: "delivered" });
    gh.state.pr = pr({ headSha: "next" });
    gh.state.checks = [{ name: "check", done: false, ok: false }];
    await pass();
    expect(state()).toMatchObject({ status: "waiting", resolutions: 1 });
    gh.state.checks = [{ name: "check", done: true, ok: false }];
    await pass();
    expect(state()).toMatchObject({ status: "blocked", resolutions: 1 });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("is not taken back once its resolutions are used up, and says what is missing", async () => {
    const { ctx, job, gh, current, state, comments, pass } = await conflicted({ attempt: 3 });
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked", resolutions: 2, resolving: "older" } satisfies MergeState));
    gh.state.checks = [{ name: "check", done: true, ok: false }];
    await pass();
    expect(current().status).toBe("delivered");
    expect(ctx.store.getKv(prRefreshKey(job.id))).toBeUndefined();
    expect(state()).toMatchObject({ status: "blocked", resolutions: 2, backoff: { mergeable: false } });
    expect(state().why).toMatch(/^en conflicto con la rama base; ya se usaron las 2 resoluciones automáticas/);
    expect(comments()).toHaveLength(1);
    const line = formatStatus(factoryStatus(ctx)).split("\n").find((l) => l.includes("Fusión automática"))!;
    expect(line).toContain("NO SE FUNDE: en conflicto con la rama base");
    expect(line).toContain(`zero reintentar ${job.id}`);
    expect(line).not.toContain("fallaron los checks");
  });

  it("takes back a head GitHub refused to update over a conflict, though it reports it mergeable", async () => {
    const { ctx, job, head, gh, current, state, pass } = await conflicted();
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked", conflict: head } satisfies MergeState));
    gh.state.pr = pr({ mergeable: true, headSha: head });
    await pass();
    expect(current()).toMatchObject({ status: "queued", station: "integrate" });
    expect(state()).toMatchObject({ resolving: head, resolutions: 1, conflict: head });
    expect(gh.did).toEqual([]);
  });

  it("says the automatic resolution of the head failed when that head was tried", async () => {
    const { ctx, job, head, current, state, pass } = await conflicted();
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked", resolutions: 1, resolving: head } satisfies MergeState));
    await pass();
    expect(current().status).toBe("delivered");
    expect(state().why).toBe("en conflicto con la rama base; falló la resolución automática de este head");
  });

  it("leaves it delivered when it has no spec", async () => {
    const noSpec = await conflicted({ spec: false });
    await noSpec.pass();
    expect(noSpec.current().status).toBe("delivered");
    expect(noSpec.comments()).toHaveLength(1);
  });

  it("goes back to the queue after zero reintentar, once the head was tried and the attempts ran out", async () => {
    const { head, ctx, job, current, state, pass } = await conflicted();
    await pass();
    await finalizeJob(ctx, current(), "failed", { reason: "se agotaron los intentos" });
    ctx.store.updateJob(job.id, { attempt: 3 });
    await pass();
    expect(state()).toMatchObject({ status: "blocked", resolving: head, backoff: { mergeable: false } });
    expect(current().status).toBe("delivered");

    expect(retryJob(ctx, job.id)).toMatchObject({ kind: "pull-request", job: { status: "delivered", attempt: 0 } });
    expect(state().resolving).toBeUndefined();
    expect(state().resolutions).toBeUndefined();
    expect(state().conflict).toBeUndefined();
    expect(state().backoff).toBeUndefined();
    expect(state().status).toBe("blocked");

    await pass();
    expect(current()).toMatchObject({ status: "queued", checkpoint: "review", station: "integrate" });
    expect(state()).toMatchObject({ status: "waiting", resolving: head });
  });

  it("does not spend the head when the base cannot be fetched, and tries again later", async () => {
    const f = await conflicted({ remote: join(tempDir(), "missing.git") });
    await f.pass();
    expect(f.current().status).toBe("delivered");
    expect(f.state().resolving).toBeUndefined();
    expect(f.state().status).toBe("blocked");
    expect(f.comments()).toEqual([expect.stringMatching(/en conflicto con la rama base/)]);
  });

  it("takes each head back once, keeping it through blocked passes, and merges after a later fix", async () => {
    const { head, gh, current, comments, state, pass, clock, ctx, job, delivery } = await conflicted();
    await pass();
    await finalizeJob(ctx, current(), "failed", { reason: "se agotaron los intentos" });
    expect(current()).toMatchObject({ status: "delivered", delivery });
    expect(ctx.store.getKv(prRefreshKey(job.id))).toBeUndefined();

    await pass();
    expect(current().status).toBe("delivered");
    expect(comments()).toHaveLength(1);
    expect(state()).toMatchObject({ status: "blocked", resolving: head });

    clock.ms += 5 * MINUTE;
    await pass();
    expect(current().status).toBe("delivered");
    expect(comments()).toHaveLength(1);
    expect(state().resolving).toBe(head);

    // Its checks running change nothing while it is in conflict.
    gh.state.checks = [{ name: "check", done: false, ok: false }];
    clock.ms += 10 * MINUTE;
    await pass();
    expect(state()).toMatchObject({ status: "blocked", resolving: head });
    expect(current().status).toBe("delivered");
    expect(comments()).toHaveLength(1);

    gh.state.checks = green;
    gh.state.pr = pr({ headSha: "fixed" });
    await pass();
    expect(gh.did.at(-2)).toBe("merge #10 @fixed");
    expect(state().status).toBe("merged");
  });

  it("is told as before after 14 days instead of going back to the queue", async () => {
    const { current, state, pass, clock } = await conflicted();
    clock.ms += 15 * 24 * 60 * MINUTE;
    await pass();
    expect(current().status).toBe("delivered");
    expect(state().status).toBe("expired");
  });
});

describe("a pause in the middle of the pass", () => {
  it("leaves the remaining pull requests alone", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), integrate: "pull-request", autoMerge: true }] });
    const jobs = [];
    for (const n of [10, 11, 12]) {
      const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
      await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: `https://github.com/kaelen/demo/pull/${n}`, autoMerge: true } });
      jobs.push(job);
    }
    const before = { status: "blocked", why: "antes" };
    ctx.store.setKv(mergeKey(jobs[1]!.id), JSON.stringify(before));
    ctx.store.setKv(mergeKey(jobs[2]!.id), JSON.stringify(before));
    const asked: number[] = [];
    const gh = fakeGitHub([{ name: "check", done: false, ok: false }]);
    gh.api.pullRequest = async (n) => {
      asked.push(n);
      if (asked.length > 1) throw new GithubHalted(new Date(Date.now() + 60_000).toISOString());
      return pr();
    };
    await pollMerges(ctx, () => gh.api);
    expect(asked).toHaveLength(2);
    expect(JSON.parse(ctx.store.getKv(mergeKey(jobs[1]!.id))!)).toEqual(before);
    expect(JSON.parse(ctx.store.getKv(mergeKey(jobs[2]!.id))!)).toEqual(before);
  });

  it("does not take GitHub's limit for a problem of the pull request either", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), integrate: "pull-request", autoMerge: true }] });
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/kaelen/demo/pull/10", autoMerge: true } });
    const gh = fakeGitHub(green);
    gh.api.pullRequest = async () => {
      throw Object.assign(new Error("API rate limit exceeded"), { status: 403, response: { headers: { "x-ratelimit-remaining": "0" } } });
    };
    await pollMerges(ctx, () => gh.api);
    expect(ctx.store.getKv(mergeKey(job.id))).toBeUndefined();
  });
});
