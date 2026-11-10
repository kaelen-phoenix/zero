import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus } from "../src/app.js";
import { actionsRun, MAX_REFRESHES, mergeKey, pollMerges, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob } from "../src/line/finish.js";
import { signedMerges } from "../src/signature.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const MINUTE = 60_000;
const green: Check[] = [{ name: "check", done: true, ok: true }];
const red = (run?: number): Check[] => [{ name: "ci", done: true, ok: true }, { name: "e2e", done: true, ok: false, ...(run && { run }) }];
const running: Check[] = [{ name: "e2e", done: false, ok: false }];

interface FakePr {
  pr: PullRequestState;
  checks: Check[];
  behind: boolean;
}

/** GitHub with several pull requests of one repository; records what the factory did to each. */
function fakeGitHub(prs: Record<number, FakePr>, opts: { refuse?: "updateBranch" | "rerun" } = {}) {
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async (n) => prs[n]!.pr,
    checks: async (sha) => Object.values(prs).find((p) => p.pr.headSha === sha)!.checks,
    merge: async (n, sha) => {
      did.push(`merge #${n} @${sha}`);
      prs[n]!.pr = { ...prs[n]!.pr, open: false, merged: true };
      return "merged-sha";
    },
    deleteBranch: async () => {},
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
    behind: async (base, sha) => {
      did.push(`behind ${base} ${sha}`);
      return Object.values(prs).find((p) => p.pr.headSha === sha)!.behind;
    },
    updateBranch: async (n, sha) => {
      if (opts.refuse === "updateBranch") throw new Error("merge conflict between base and head");
      did.push(`update #${n} @${sha}`);
    },
    rerun: async (run) => {
      if (opts.refuse === "rerun") throw new Error("Resource not accessible by integration");
      did.push(`rerun ${run}`);
    },
  };
  return { api, did, acts: () => did.filter((d) => !d.startsWith("behind")) };
}

const pull = (headSha: string, checks: Check[], behind: boolean): FakePr => ({ pr: { open: true, merged: false, mergeable: true, headSha, base: "main" }, checks, behind });

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
  return { ctx, clock, state };
}

describe("a pull request whose checks failed against an older base", () => {
  it("gets the base merged in on GitHub, waits for the new checks and merges", async () => {
    const { ctx, clock, state } = await factoryWith([10]);
    const prs = { 10: pull("old", red(77), true) };
    const gh = fakeGitHub(prs);
    const pass = () => pollMerges(ctx, () => gh.api);

    await pass();
    expect(gh.acts()).toEqual(["update #10 @old"]);
    expect(state(10)).toMatchObject({ status: "waiting", why: "actualizado con la rama base; esperando sus checks", refreshes: 1, refreshing: { head: "old" } });
    expect(factoryStatus(ctx).merges).toMatchObject([{ status: "waiting" }]);

    // GitHub has not made the new tip yet: nothing is asked for twice.
    clock.ms += MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["update #10 @old"]);
    expect(state(10)).toMatchObject({ status: "waiting", why: "actualizándose con la rama base" });

    prs[10] = pull("new", running, false);
    clock.ms += MINUTE;
    await pass();
    expect(state(10)).toMatchObject({ status: "waiting", why: "esperando checks", refreshing: { head: "old" } });

    prs[10] = pull("new", green, false);
    clock.ms += MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["update #10 @old", "merge #10 @new"]);
    expect(state(10)).toMatchObject({ status: "merged" });
    expect(gh.did.some((d) => d.startsWith("comment"))).toBe(false);
  });

  it("refreshes the pull requests of one repository one at a time", async () => {
    const { ctx, clock, state } = await factoryWith([10, 11]);
    const prs = { 10: pull("a-old", red(1), true), 11: pull("b-old", red(2), true) };
    const gh = fakeGitHub(prs);
    const pass = () => pollMerges(ctx, () => gh.api);

    await pass();
    expect(gh.acts()).toEqual(["update #10 @a-old"]);
    expect(state(11)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e; espera su turno para actualizarse con la rama base" });
    expect(state(11).refreshes).toBeUndefined();

    // While the first one's checks run, the second is not even asked about on every pass.
    prs[10] = pull("a-new", running, false);
    clock.ms += MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["update #10 @a-old"]);

    // The first one merges; at its next look the second takes its turn.
    prs[10] = pull("a-new", green, false);
    clock.ms += 5 * MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["update #10 @a-old", "merge #10 @a-new", "update #11 @b-old"]);
    expect(state(11)).toMatchObject({ status: "waiting", refreshes: 1 });
  });

  it("is refreshed at most three times in its life, then told about like any blocked one", async () => {
    const { ctx, clock, state } = await factoryWith([10]);
    const prs = { 10: pull("t0", red(), true) };
    const gh = fakeGitHub(prs);
    for (let i = 1; i <= MAX_REFRESHES + 1; i++) {
      await pollMerges(ctx, () => gh.api);
      // Each refresh makes a new tip whose checks fail again, and the base moves on meanwhile.
      prs[10] = pull(`t${i}`, red(), true);
      clock.ms += 2 * 60 * MINUTE;
    }
    expect(gh.acts().filter((d) => d.startsWith("update"))).toEqual(["update #10 @t0", "update #10 @t1", "update #10 @t2"]);
    expect(state(10)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e", refreshes: 3 });
    expect(gh.acts().filter((d) => d.startsWith("comment"))).toHaveLength(1);
  });

  it("is left as it is when GitHub refuses the update", async () => {
    const { ctx, state } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("old", red(), true) }, { refuse: "updateBranch" });
    await pollMerges(ctx, () => gh.api);
    expect(state(10)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e" });
    expect(state(10).refreshes).toBeUndefined();
    expect(gh.acts().filter((d) => d.startsWith("comment"))).toHaveLength(1);
  });
});

describe("a pull request whose checks failed on today's base", () => {
  it("gets its failed runs run again once per tip, and is blocked if they fail again", async () => {
    const { ctx, clock, state } = await factoryWith([10]);
    const prs = { 10: pull("abc", [...red(77), { name: "android", done: true, ok: false, run: 78 }, { name: "ios", done: true, ok: false, run: 78 }], false) };
    const gh = fakeGitHub(prs);
    const pass = () => pollMerges(ctx, () => gh.api);

    await pass();
    expect(gh.acts()).toEqual(["rerun 77", "rerun 78"]);
    expect(state(10)).toMatchObject({ status: "waiting", why: "sus checks fallidos corren de nuevo", rerun: "abc" });

    prs[10] = pull("abc", running, false);
    clock.ms += MINUTE;
    await pass();
    expect(state(10)).toMatchObject({ status: "waiting", why: "esperando checks" });

    prs[10] = pull("abc", red(77), false);
    clock.ms += MINUTE;
    await pass();
    expect(gh.acts().filter((d) => d.startsWith("rerun"))).toEqual(["rerun 77", "rerun 78"]);
    expect(state(10)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e", rerun: "abc" });
    expect(gh.acts().at(-1)).toMatch(/^comment #10: La fábrica no funde este pull request: fallaron los checks e2e/);
  });

  it("merges when the second run passes", async () => {
    const { ctx, clock } = await factoryWith([10]);
    const prs = { 10: pull("abc", red(77), false) };
    const gh = fakeGitHub(prs);
    await pollMerges(ctx, () => gh.api);
    prs[10] = pull("abc", green, false);
    clock.ms += MINUTE;
    await pollMerges(ctx, () => gh.api);
    expect(gh.acts()).toEqual(["rerun 77", "merge #10 @abc"]);
  });

  it("is blocked at once when the failed check is not a GitHub Actions run or the run cannot be started again", async () => {
    const one = await factoryWith([10]);
    const outside = fakeGitHub({ 10: pull("abc", red(), false) });
    await pollMerges(one.ctx, () => outside.api);
    expect(one.state(10)).toMatchObject({ status: "blocked" });
    expect(outside.acts().filter((d) => d.startsWith("rerun"))).toEqual([]);

    const two = await factoryWith([10]);
    const refused = fakeGitHub({ 10: pull("abc", red(77), false) }, { refuse: "rerun" });
    await pollMerges(two.ctx, () => refused.api);
    expect(two.state(10)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e" });
  });
});

describe("a repository whose checks share one environment", () => {
  const half = (run: number): Check[] => [{ name: "ci", done: true, ok: false, run }, { name: "e2e", done: false, ok: false, run }];

  it("starts nothing for a pull request while some of its checks are still running", async () => {
    const { ctx, clock, state } = await factoryWith([10]);
    const prs = { 10: pull("abc", half(77), true) };
    const gh = fakeGitHub(prs);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    expect(state(10)).toMatchObject({ status: "waiting", why: "fallaron los checks ci; esperando los demás checks" });

    prs[10] = pull("abc", red(77), false);
    clock.ms += MINUTE;
    await pollMerges(ctx, () => gh.api);
    expect(gh.acts()).toEqual(["rerun 77"]);
  });

  it("keeps the repository for a refreshed pull request until every check of its new tip ended", async () => {
    const { ctx, clock, state } = await factoryWith([10, 11]);
    const prs = { 10: pull("a-old", red(1), true), 11: pull("b-old", red(2), true) };
    const gh = fakeGitHub(prs);
    const pass = () => pollMerges(ctx, () => gh.api);
    await pass();
    expect(gh.acts()).toEqual(["update #10 @a-old"]);

    // One check of the new tip failed at once and the slow one still runs: the second waits.
    prs[10] = pull("a-new", half(3), false);
    clock.ms += 6 * MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["update #10 @a-old"]);
    expect(state(11).status).toBe("blocked");
    expect(state(11).refreshes).toBeUndefined();

    // The slow one ends: the first has its failed runs run again and keeps the repository.
    prs[10] = pull("a-new", red(3), false);
    clock.ms += 6 * MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["update #10 @a-old", "rerun 3"]);

    // It fails again: the first is told, and the second takes its turn.
    clock.ms += 6 * MINUTE;
    await pass();
    expect(state(10)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e" });
    expect(gh.acts().filter((d) => !d.startsWith("comment"))).toEqual(["update #10 @a-old", "rerun 3", "update #11 @b-old"]);
  });

  it("runs the failed checks of its pull requests again one at a time", async () => {
    const { ctx, clock, state } = await factoryWith([10, 11]);
    const prs = { 10: pull("a", red(1), false), 11: pull("b", red(2), false) };
    const gh = fakeGitHub(prs);
    const pass = () => pollMerges(ctx, () => gh.api);
    await pass();
    expect(gh.acts()).toEqual(["rerun 1"]);
    expect(state(11)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e; espera su turno para correr de nuevo sus checks" });
    expect(state(11).rerun).toBeUndefined();

    prs[10] = pull("a", running, false);
    clock.ms += 6 * MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["rerun 1"]);

    prs[10] = pull("a", green, false);
    clock.ms += 6 * MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["rerun 1", "merge #10 @a", "rerun 2"]);
  });

  it("starts nothing while a pull request delivered a moment ago waits for its first checks", async () => {
    const { ctx, clock, state } = await factoryWith([10, 11]);
    const prs = { 10: pull("a", running, false), 11: pull("b", running, false) };
    const gh = fakeGitHub(prs);
    const pass = () => pollMerges(ctx, () => gh.api);
    await pass();
    prs[11] = pull("b", red(2), false);
    clock.ms += MINUTE;
    await pass();
    expect(gh.acts()).toEqual([]);
    expect(state(11)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e; espera su turno para correr de nuevo sus checks" });

    prs[10] = pull("a", green, false);
    clock.ms += 6 * MINUTE;
    await pass();
    expect(gh.acts()).toEqual(["merge #10 @a", "rerun 2"]);
  });
});

describe("the pieces", () => {
  it("reads the run of a check from the address of its details", () => {
    expect(actionsRun("https://github.com/kaelen/demo/actions/runs/42745836620/job/129597588242")).toEqual({ run: 42745836620 });
    expect(actionsRun("https://vercel.com/kaelen/demo/abc")).toEqual({});
    expect(actionsRun(null)).toEqual({});
  });

  it("an adapter without the new calls behaves as before, and a signed one keeps them", async () => {
    const { ctx, state } = await factoryWith([10]);
    const gh = fakeGitHub({ 10: pull("old", red(77), true) });
    const { behind: _b, updateBranch: _u, rerun: _r, ...old } = gh.api;
    await pollMerges(ctx, () => old);
    expect(state(10)).toMatchObject({ status: "blocked" });

    const signed = signedMerges(gh.api, { text: "— firma", trailer: "Built-by: x" });
    expect(typeof signed.behind).toBe("function");
    expect(typeof signed.updateBranch).toBe("function");
    expect(typeof signed.rerun).toBe("function");
    expect(signedMerges(old, { text: "— firma", trailer: "Built-by: x" }).rerun).toBeUndefined();
  });
});
