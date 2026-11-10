import type { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it } from "vitest";
import { checksOutageKey, githubMerges, mergeKey, pollMerges, type Check, type ChecksOutage, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob } from "../src/line/finish.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const MINUTE = 60_000;
const red = (check: string, at: string, run?: number): Check[] => [{ name: "ci", done: true, ok: true, at }, { name: check, done: true, ok: false, at, ...(run && { run }) }];
const passed = (check: string, at: string): Check[] => [{ name: check, done: true, ok: true, at }];
const running: Check[] = [{ name: "e2e", done: false, ok: false }];

interface FakePr {
  pr: PullRequestState;
  checks: Check[];
  behind: boolean;
}

/** GitHub with several pull requests of one repository and the checks of its base branch; records what the factory did. */
function fakeGitHub(prs: Record<number, FakePr>, base: { checks: Check[] } = { checks: [] }) {
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async (n) => prs[n]!.pr,
    checks: async (ref) => (ref === "main" ? base.checks : Object.values(prs).find((p) => p.pr.headSha === ref)!.checks),
    merge: async (n, sha) => {
      did.push(`merge #${n} @${sha}`);
      prs[n]!.pr = { ...prs[n]!.pr, open: false, merged: true };
      return "merged-sha";
    },
    deleteBranch: async () => {},
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
    behind: async (_base, sha) => Object.values(prs).find((p) => p.pr.headSha === sha)!.behind,
    updateBranch: async (n, sha) => void did.push(`update #${n} @${sha}`),
    rerun: async (run) => void did.push(`rerun ${run}`),
  };
  return { api, did };
}

const pull = (headSha: string, checks: Check[], behind = false): FakePr => ({ pr: { open: true, merged: false, mergeable: true, headSha, base: "main" }, checks, behind });

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
  const outage = () => {
    const raw = ctx.store.getKv(checksOutageKey("kaelen/demo"));
    return raw ? (JSON.parse(raw) as ChecksOutage) : undefined;
  };
  return { ctx, clock, state, outage };
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

describe("the same check failing in several pull requests", () => {
  it("marks the repository's environment down, with the earliest failure as its start", async () => {
    const { ctx, clock, state, outage } = await factoryWith([10, 11]);
    const prs = { 10: pull("a", running), 11: pull("b", running) };
    const gh = fakeGitHub(prs, { checks: passed("e2e", "2026-11-10T09:00:00Z") });
    const pass = () => pollMerges(ctx, () => gh.api);
    await pass();

    // #11 still waits for its first checks, so #10 waits its turn.
    prs[10] = pull("a", red("e2e", "2026-11-10T11:30:00Z", 1));
    clock.ms += MINUTE;
    await pass();
    expect(outage()).toBeUndefined();
    expect(state(10).why).toBe("fallaron los checks e2e; espera su turno para correr de nuevo sus checks");

    prs[11] = pull("b", red("e2e", "2026-11-10T12:00:00Z", 2));
    clock.ms += MINUTE;
    await pass();
    expect(outage()).toMatchObject({ since: "2026-11-10T11:30:00Z", checks: ["e2e"], lastFailure: { e2e: "2026-11-10T12:00:00Z" }, nextProbeAt: "2026-11-10T12:30:00.000Z" });
    const why = `entorno caído en kaelen/demo desde ${hhmm("2026-11-10T11:30:00Z")} (checks: e2e)`;
    expect(state(11)).toMatchObject({ status: "blocked", why, outage: "2026-11-10T11:30:00Z" });
    expect(state(10)).toMatchObject({ status: "blocked", why, outage: "2026-11-10T11:30:00Z" });
    expect(gh.did).toEqual([]);

    // Seen again later, each stays held without anything spent or said.
    clock.ms += 30 * MINUTE;
    await pass();
    expect(gh.did).toEqual([]);
    expect(state(10)).toMatchObject({ status: "blocked", why });
    expect(state(10).rerun).toBeUndefined();
  });

  it("is not an outage when the failures are hours apart", async () => {
    const { ctx, outage, state } = await factoryWith([10, 11]);
    const gh = fakeGitHub({ 10: pull("a", red("e2e", "2026-11-10T09:00:00Z", 1)), 11: pull("b", red("e2e", "2026-11-10T12:00:00Z", 2)) });
    await pollMerges(ctx, () => gh.api);
    expect(outage()).toBeUndefined();
    expect(gh.did).toEqual(["rerun 1"]);
    expect(state(11)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e; espera su turno para correr de nuevo sus checks" });
    expect(state(11).outage).toBeUndefined();
  });

  it("is not an outage with a single pull request", async () => {
    const { ctx, outage } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", red("e2e", "2026-11-10T11:50:00Z", 1)) });
    await pollMerges(ctx, () => gh.api);
    expect(outage()).toBeUndefined();
    expect(gh.did).toEqual(["rerun 1"]);
  });
});

describe("the base branch failing the same check", () => {
  it("marks the environment down instead of running the check again", async () => {
    const { ctx, state, outage } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", red("db-tests", "2026-11-10T11:50:00Z", 5)) }, { checks: red("db-tests", "2026-11-10T11:40:00Z") });
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    expect(outage()).toMatchObject({ since: "2026-11-10T11:40:00Z", checks: ["db-tests"], base: "main", lastFailure: { "db-tests": "2026-11-10T11:50:00Z" } });
    expect(state(10)).toMatchObject({ status: "blocked", why: `entorno caído en kaelen/demo desde ${hhmm("2026-11-10T11:40:00Z")} (checks: db-tests)`, outage: "2026-11-10T11:40:00Z" });
    expect(state(10).rerun).toBeUndefined();
  });

  it("does not bring the base in either", async () => {
    const { ctx, state, outage } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", red("db-tests", "2026-11-10T11:50:00Z", 5), true) }, { checks: red("db-tests", "2026-11-10T11:40:00Z") });
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    expect(outage()?.checks).toEqual(["db-tests"]);
    expect(state(10).refreshes).toBeUndefined();
  });

  it("runs the failed check again as before when the base passes it", async () => {
    const { ctx, outage } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("a", red("e2e", "2026-11-10T11:50:00Z", 5)) }, { checks: passed("e2e", "2026-11-10T11:00:00Z") });
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 5"]);
    expect(outage()).toBeUndefined();
  });
});

describe("during an outage", () => {
  it("spends nothing and says nothing on another pull request failing its check", async () => {
    const { ctx, state, outage } = await factoryWith([10, 11, 12]);
    const gh = fakeGitHub({
      10: pull("a", red("e2e", "2026-11-10T11:40:00Z", 1)),
      11: pull("b", red("e2e", "2026-11-10T11:50:00Z", 2)),
      12: pull("c", red("e2e", "2026-11-10T11:55:00Z", 3)),
    });
    await pollMerges(ctx, () => gh.api);
    // The first one seen, alone yet, follows the usual path; from the second on the outage is known.
    expect(gh.did).toEqual(["rerun 1"]);
    expect(outage()?.checks).toEqual(["e2e"]);
    expect(state(12)).toMatchObject({ status: "blocked", outage: "2026-11-10T11:40:00Z" });
    expect(state(12).why).toMatch(/^entorno caído en kaelen\/demo desde \d\d:\d\d \(checks: e2e\)$/);
    expect(state(12).rerun).toBeUndefined();
    expect(state(12).refreshes).toBeUndefined();
    expect(state(12).reported).toBeUndefined();
  });

  it("keeps the outage mark through later saves", async () => {
    const { ctx, clock, state } = await factoryWith([10, 11]);
    const prs = { 10: pull("a", red("e2e", "2026-11-10T11:40:00Z")), 11: pull("b", red("e2e", "2026-11-10T11:50:00Z")) };
    const gh = fakeGitHub(prs);
    await pollMerges(ctx, () => gh.api);
    expect(state(11).outage).toBe("2026-11-10T11:40:00Z");
    prs[11] = pull("b2", running);
    clock.ms += 6 * MINUTE;
    await pollMerges(ctx, () => gh.api);
    expect(state(11)).toMatchObject({ status: "waiting", outage: "2026-11-10T11:40:00Z" });
  });
});

describe("the GitHub adapter", () => {
  it("tells when each check ended", async () => {
    const client = {
      paginate: async () => [{ name: "e2e", status: "completed", conclusion: "failure", details_url: "https://github.com/k/d/actions/runs/9/job/1", completed_at: "2026-11-10T11:00:00Z" }, { name: "lint", status: "in_progress", conclusion: null, details_url: null, completed_at: null }],
      checks: { listForRef: {} },
      repos: { getCombinedStatusForRef: async () => ({ data: { statuses: [{ context: "vercel", state: "failure", updated_at: "2026-11-10T11:05:00Z" }] } }) },
    } as unknown as Octokit;
    expect(await githubMerges("t", "k/d", client).checks("main")).toEqual([
      { name: "e2e", done: true, ok: false, run: 9, at: "2026-11-10T11:00:00Z" },
      { name: "lint", done: false, ok: false },
      { name: "vercel", done: true, ok: false, at: "2026-11-10T11:05:00Z" },
    ]);
  });
});
