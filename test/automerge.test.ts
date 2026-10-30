import { afterEach, describe, expect, it } from "vitest";
import { briefing, factoryStatus } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { formatStatus } from "../src/format.js";
import { mergeDecision, pollMerges, type Check, type MergeApi, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob } from "../src/line/finish.js";
import type { JobSource } from "../src/state/store.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

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
    expect(mergeDecision(pr({ mergeable: false }), green, HOUR)).toMatchObject({ kind: "blocked", why: expect.stringMatching(/conflictos/) });
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
