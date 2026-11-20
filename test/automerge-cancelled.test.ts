import { afterEach, describe, expect, it } from "vitest";
import { checksFailuresKey, githubMerges, MAX_CANCELLED_RERUNS, mergeDecision, mergeKey, pollMerges, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import type { Octokit } from "@octokit/rest";
import { finalizeJob } from "../src/line/finish.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const MINUTE = 60_000;
const AT = "2026-11-10T11:50:00Z";
const ok = (name: string): Check => ({ name, done: true, ok: true, at: AT });
const cancelled = (name: string, run: number): Check => ({ name, done: true, ok: false, cancelled: true, run, at: AT, started: AT });
const failed = (name: string, run: number): Check => ({ name, done: true, ok: false, run, at: AT, started: AT });

interface FakePr {
  pr: PullRequestState;
  checks: Check[];
}

/** GitHub with several pull requests of one repository; records what the factory did. */
function fakeGitHub(prs: Record<number, FakePr>) {
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async (n) => prs[n]!.pr,
    checks: async (ref) => Object.values(prs).find((p) => p.pr.headSha === ref)?.checks ?? [],
    merge: async (n, sha) => {
      did.push(`merge #${n} @${sha}`);
      prs[n]!.pr = { ...prs[n]!.pr, open: false, merged: true };
      return "merged-sha";
    },
    deleteBranch: async () => {},
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
    behind: async () => false,
    updateBranch: async (n, sha) => void did.push(`update #${n} @${sha}`),
    rerun: async (run) => void did.push(`rerun ${run}`),
  };
  return { api, did };
}

const pull = (headSha: string, checks: Check[]): FakePr => ({ pr: { open: true, merged: false, mergeable: true, headSha, base: "main" }, checks });

async function factoryWith(numbers: number[]) {
  const clock = { ms: Date.parse("2026-11-10T12:00:00Z") };
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), integrate: "pull-request", autoMerge: true }] }, () => new Date(clock.ms));
  const jobs: Record<number, string> = {};
  for (const n of numbers) {
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: `x${n}`, budgetUsd: 3 });
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: `https://github.com/kaelen/demo/pull/${n}`, autoMerge: true } });
    jobs[n] = job.id;
    clock.ms += 1_000;
  }
  const state = (n: number) => JSON.parse(ctx.store.getKv(mergeKey(jobs[n]!))!) as MergeState;
  // Every pass starts well after the last one, so a rerun asked for has had time to show.
  const pass = async (gh: { api: MergeApi }) => {
    clock.ms += 10 * MINUTE;
    await pollMerges(ctx, () => gh.api);
  };
  return { ctx, clock, state, jobs, pass };
}

const pr = (over: Partial<PullRequestState> = {}): PullRequestState => ({ open: true, merged: false, mergeable: true, headSha: "abc", ...over });

describe("a run cancelled by a concurrency group", () => {
  it("is not a failed check for mergeDecision", () => {
    const decision = mergeDecision(pr(), [ok("ci"), cancelled("e2e-flujos", 7)], 3_600_000);
    expect(decision).toMatchObject({ kind: "cancelled", runs: [7] });
    expect(decision.kind).not.toBe("blocked");
  });

  it("lists only the failed one next to a cancelled one", () => {
    expect(mergeDecision(pr(), [failed("lint", 3), cancelled("e2e-flujos", 7)], 3_600_000)).toMatchObject({ kind: "blocked", why: "fallaron los checks lint", failed: [{ name: "lint" }] });
  });

  it("waits while another check still runs", () => {
    expect(mergeDecision(pr(), [cancelled("e2e-flujos", 7), { name: "ci", done: false, ok: false }], 3_600_000)).toMatchObject({ kind: "wait" });
  });

  it("is read from GitHub's conclusion", async () => {
    const client = {
      paginate: async () => [
        { id: 1, name: "e2e-flujos", status: "completed", conclusion: "cancelled", details_url: "https://github.com/kaelen/demo/actions/runs/7/job/1", started_at: AT, completed_at: AT, output: {} },
        { id: 2, name: "lint", status: "completed", conclusion: "failure", details_url: "https://github.com/kaelen/demo/actions/runs/8/job/2", started_at: AT, completed_at: AT, output: {} },
      ],
      checks: { listForRef: {}, listAnnotations: {} },
      repos: { getCombinedStatusForRef: async () => ({ data: { statuses: [] } }) },
    } as unknown as Octokit;
    const checks = await githubMerges("t", "kaelen/demo", client).checks("abc");
    expect(checks.find((c) => c.name === "e2e-flujos")?.cancelled).toBe(true);
    expect(checks.find((c) => c.name === "lint")?.cancelled).toBeUndefined();
  });

  it("only cancelled: runs them again, without recording a failure, commenting or taking the job back", async () => {
    const { ctx, state, jobs, pass } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", [ok("ci"), cancelled("e2e-flujos", 7)]) });
    await pass(gh);
    expect(gh.did).toEqual(["rerun 7"]);
    expect(state(10)).toMatchObject({ status: "waiting", cancelledReruns: { head: "a", count: 1 }, refreshing: { head: "a", rerun: true } });
    expect(ctx.store.getKv(checksFailuresKey("kaelen/demo"))).toBeUndefined();
    expect(ctx.store.getJob(jobs[10]!)?.status).toBe("delivered");
  });

  it("cancelled and failed: the failed one goes the usual way and the cancelled one is not counted", async () => {
    const { ctx, pass } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", [failed("lint", 3), cancelled("e2e-flujos", 7)]) });
    await pass(gh);
    expect(gh.did).toEqual(["rerun 3"]);
    const failures = JSON.parse(ctx.store.getKv(checksFailuresKey("kaelen/demo"))!) as { check: string }[];
    expect(failures.map((f) => f.check)).toEqual(["lint"]);
  });

  it("two pull requests with cancelled runs: only the older one is run again, the other waits its turn", async () => {
    const { state, pass } = await factoryWith([10, 11]);
    const prs = { 10: pull("a", [cancelled("e2e-flujos", 7)]), 11: pull("b", [cancelled("e2e-flujos", 8)]) };
    const gh = fakeGitHub(prs);
    await pass(gh);
    expect(gh.did).toEqual(["rerun 7"]);
    expect(state(11)).toMatchObject({ status: "waiting", turn: true });
    expect(state(11).why).toContain("espera su turno para relanzar corridas canceladas");

    // #10's run is under way and holds the repository: #11 keeps waiting.
    prs[10] = pull("a", [{ name: "e2e-flujos", done: false, ok: false, run: 7, started: AT }]);
    await pass(gh);
    expect(gh.did).toEqual(["rerun 7"]);
    expect(state(11).why).toContain("espera su turno");

    // #10 passed and merged: now #11's turn.
    prs[10] = pull("a", [ok("e2e-flujos")]);
    await pass(gh);
    expect(gh.did).toEqual(["rerun 7", "merge #10 @a", "rerun 8"]);
    expect(state(11)).toMatchObject({ status: "waiting", cancelledReruns: { head: "b", count: 1 } });
  });

  it(`stops after ${MAX_CANCELLED_RERUNS} reruns of the same tip, without a comment`, async () => {
    const { state, pass } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", [cancelled("e2e-flujos", 7)]) });
    for (let i = 0; i < MAX_CANCELLED_RERUNS + 2; i++) await pass(gh);
    expect(gh.did).toEqual(Array.from({ length: MAX_CANCELLED_RERUNS }, () => "rerun 7"));
    expect(state(10).status).toBe("blocked");
    expect(state(10).why).toContain("las corridas se siguen cancelando (grupo de concurrencia)");
    expect(state(10).reported).toBeUndefined();
  });

  it("a new tip gets its own reruns", async () => {
    const { state, pass } = await factoryWith([10]);
    const prs = { 10: pull("a", [cancelled("e2e-flujos", 7)]) };
    const gh = fakeGitHub(prs);
    for (let i = 0; i < MAX_CANCELLED_RERUNS + 1; i++) await pass(gh);
    prs[10] = pull("b", [cancelled("e2e-flujos", 9)]);
    await pass(gh);
    expect(gh.did.at(-1)).toBe("rerun 9");
    expect(state(10).cancelledReruns).toEqual({ head: "b", count: 1 });
  });
});

describe("checks queued in another pull request", () => {
  it("holds a green pull request back until the other's checks start", async () => {
    const { state, pass } = await factoryWith([10, 11]);
    const prs = { 10: pull("a", [ok("ci")]), 11: pull("b", [{ name: "e2e-flujos", done: false, ok: false, run: 8 }]) };
    const gh = fakeGitHub(prs);
    // #10 is looked at first and merges: nothing was seen queued yet.
    prs[10] = pull("a", [{ name: "ci", done: false, ok: false, run: 1, started: AT }]);
    await pass(gh);
    expect(state(11).queued).toEqual(["e2e-flujos"]);

    prs[10] = pull("a", [ok("ci")]);
    await pass(gh);
    expect(gh.did).toEqual([]);
    expect(state(10)).toMatchObject({ status: "waiting", why: "espera que arranquen los checks de https://github.com/kaelen/demo/pull/11" });

    prs[11] = pull("b", [{ name: "e2e-flujos", done: false, ok: false, run: 8, started: AT }]);
    await pass(gh);
    expect(state(11).queued).toBeUndefined();
    await pass(gh);
    expect(gh.did).toEqual(["merge #10 @a"]);
  });
});
