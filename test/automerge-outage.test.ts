import type { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it } from "vitest";
import { checksOutageKey, checksRecoveredKey, githubMerges, mergeKey, pollMerges, type Check, type ChecksOutage, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
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
function fakeGitHub(prs: Record<number, FakePr>, base: { checks: Check[] } = { checks: [] }, live = false) {
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
    rerun: async (run) => {
      did.push(`rerun ${run}`);
      // Live: the runs it was asked for start again on that pull request.
      const p = Object.values(prs).find((x) => x.checks.some((c) => c.run === run));
      if (live && p) p.checks = p.checks.map((c) => (c.run === run ? { name: c.name, done: false, ok: false, run } : c));
    },
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
  return { ctx, clock, state, outage, jobs };
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

    // Seen again later, before the first probe (12:30), each stays held without anything spent or said.
    clock.ms += 20 * MINUTE;
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

const at = (ms: number) => new Date(ms).toISOString();

/** An outage seen through the base: #10 and #11 failed `e2e` at 11:40 and 11:50, `main` at 11:30; looked at 12:00. */
async function downAtNoon(more: number[] = []) {
  const f = await factoryWith([10, 11, ...more]);
  const prs: Record<number, FakePr> = { 10: pull("a", red("e2e", "2026-11-10T11:40:00Z", 1)), 11: pull("b", red("e2e", "2026-11-10T11:50:00Z", 2)) };
  for (const n of more) prs[n] = pull(`h${n}`, running);
  const base = { checks: red("e2e", "2026-11-10T11:30:00Z") };
  const gh = fakeGitHub(prs, base, true);
  f.clock.ms = Date.parse("2026-11-10T12:00:00Z");
  const pass = () => pollMerges(f.ctx, () => gh.api);
  await pass();
  expect(f.outage()).toMatchObject({ since: "2026-11-10T11:30:00Z", lastFailure: { e2e: "2026-11-10T11:50:00Z" }, nextProbeAt: "2026-11-10T12:20:00.000Z" });
  expect(gh.did).toEqual([]);
  return { ...f, prs, base, gh, pass, tick: (minutes: number) => (f.clock.ms += minutes * MINUTE) };
}

describe("the environment coming back", () => {
  it("is seen in a run that passed at another pull request, and then each held one runs again once, one at a time", async () => {
    const { ctx, prs, gh, pass, tick, state, outage } = await downAtNoon([12]);
    prs[12] = pull("h12", passed("e2e", "2026-11-10T12:05:00Z"));
    tick(6);
    await pass();
    expect(gh.did).toEqual(["merge #12 @h12"]);
    expect(outage()).toBeUndefined();
    expect(ctx.store.getKv(checksRecoveredKey("kaelen/demo"))).toBe("2026-11-10T12:05:00.000Z");
    expect(state(10).backoff).toBeUndefined();
    expect(state(11).backoff).toBeUndefined();

    // The old failures, at the pull requests and at the base, no longer make an outage.
    tick(1);
    await pass();
    expect(gh.did.slice(1)).toEqual(["rerun 1"]);
    expect(state(10)).toMatchObject({ status: "waiting", rerun: "a" });
    expect(state(10).outage).toBeUndefined();
    expect(state(11)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e; espera su turno para correr de nuevo sus checks", outage: "2026-11-10T11:30:00Z" });
    expect(outage()).toBeUndefined();

    // #10 fails again on its own: told about it, never run again; then it is #11's turn.
    prs[10] = pull("a", red("e2e", "2026-11-10T12:20:00Z", 1));
    tick(14);
    await pass();
    expect(gh.did.slice(2)).toEqual(["comment #10: La fábrica no funde este pull request: fallaron los checks e2e. Queda abierto; si se arregla, lo funde en la próxima revisión.", "rerun 2"]);
    expect(state(10)).toMatchObject({ status: "blocked", why: "fallaron los checks e2e" });
    expect(state(11).outage).toBeUndefined();
    tick(60 * 3);
    await pass();
    expect(gh.did.filter((d) => d === "rerun 1")).toHaveLength(1);
  });

  it("is seen at the base branch, read at most every 5 minutes", async () => {
    const { base, pass, tick, outage } = await downAtNoon();
    base.checks = passed("e2e", "2026-11-10T12:01:00Z");
    tick(2);
    await pass();
    expect(outage()).toBeDefined();
    tick(3);
    await pass();
    expect(outage()).toBeUndefined();
  });

  it("does not count a run that passed before the last failure", async () => {
    const { base, pass, tick, outage } = await downAtNoon();
    base.checks = passed("e2e", "2026-11-10T11:45:00Z");
    tick(6);
    await pass();
    expect(outage()?.checks).toEqual(["e2e"]);
  });
});

describe("probing whether the environment is back", () => {
  it("runs the failed checks of the oldest held pull request again 30 minutes after the last failure, without spending its own", async () => {
    const { gh, pass, tick, state, outage, jobs } = await downAtNoon();
    tick(19);
    await pass();
    expect(gh.did).toEqual([]);
    tick(1);
    await pass();
    expect(gh.did).toEqual(["rerun 1"]);
    expect(outage()?.probe).toEqual({ job: jobs[10], head: "a", at: "2026-11-10T12:20:00.000Z" });
    expect(state(10)).toMatchObject({ status: "waiting", refreshing: { head: "a", at: "2026-11-10T12:20:00.000Z", rerun: true } });
    expect(state(10).rerun).toBeUndefined();
    expect(state(11).rerun).toBeUndefined();
  });

  it("probes right away when the failures are old", async () => {
    const { ctx, outage } = await factoryWith([10, 11]);
    const gh = fakeGitHub({ 10: pull("a", red("e2e", "2026-11-10T09:00:00Z", 1)), 11: pull("b", red("e2e", "2026-11-10T09:10:00Z", 2)) }, { checks: red("e2e", "2026-11-10T08:50:00Z") });
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 1"]);
    expect(outage()?.probe?.head).toBe("a");
  });

  it("waits twice as long after each probe that fails again, up to 240 minutes", async () => {
    const { prs, gh, pass, tick, clock, outage } = await downAtNoon();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      clock.ms = Date.parse(outage()!.nextProbeAt!);
      await pass();
      expect(outage()?.probe).toBeDefined();
      tick(3);
      prs[10] = pull("a", red("e2e", at(clock.ms - MINUTE), 1));
      await pass();
      expect(outage()?.probe).toBeUndefined();
      delays.push(outage()!.probeDelayMs! / MINUTE);
      expect(outage()!.nextProbeAt).toBe(at(clock.ms - MINUTE + outage()!.probeDelayMs!));
    }
    expect(delays).toEqual([60, 120, 240, 240]);
    expect(gh.did).toEqual(["rerun 1", "rerun 1", "rerun 1", "rerun 1"]);
  });

  it("runs one probe at a time and nothing else meanwhile; a probe that passes ends the outage", async () => {
    const { prs, gh, pass, tick, outage } = await downAtNoon([12]);
    prs[12] = pull("h12", red("lint", "2026-11-10T12:00:00Z"));
    tick(20);
    await pass();
    const spent = () => gh.did.filter((d) => !d.startsWith("comment"));
    expect(spent()).toEqual(["rerun 1"]);
    // Another pull request that could run its failed check again waits its turn while the probe runs.
    prs[12] = pull("h12b", red("lint", "2026-11-10T12:25:00Z", 3));
    for (let i = 0; i < 6; i++) {
      tick(15);
      await pass();
    }
    expect(spent()).toEqual(["rerun 1"]);
    prs[10] = pull("a", [{ name: "ci", done: true, ok: true, at: "2026-11-10T13:50:00Z" }, ...passed("e2e", "2026-11-10T13:50:00Z")]);
    tick(1);
    await pass();
    expect(gh.did).toContain("merge #10 @a");
    expect(outage()).toBeUndefined();
  });
});

describe("an outage with no pull request left", () => {
  it("is forgotten", async () => {
    const { prs, pass, tick, outage } = await downAtNoon();
    prs[10]!.pr = { ...prs[10]!.pr, merged: true, open: false };
    prs[11]!.pr = { ...prs[11]!.pr, open: false };
    tick(1);
    await pass();
    expect(outage()).toBeUndefined();
  });
});

describe("pull requests stuck before this change", () => {
  it("come unstuck on their own: each gets exactly one more run, one at a time, and those that pass merge", async () => {
    const numbers = [505, 475, 469, 467, 463, 448];
    const { ctx, clock, jobs, state, outage } = await factoryWith(numbers);
    const prs: Record<number, FakePr> = {};
    numbers.forEach((n, i) => {
      const head = `h${n}`;
      prs[n] = pull(head, red("e2e", at(Date.parse("2026-11-09T10:00:00Z") + i * 30 * MINUTE), n));
      const why = "fallaron los checks e2e";
      ctx.store.setKv(mergeKey(jobs[n]!), JSON.stringify({ status: "blocked", why, reported: `checks:${head}:e2e`, rerun: head, backoff: { sha: head, mergeable: true, why, delayMs: 60 * MINUTE, nextChecksAt: "2026-11-09T14:00:00Z" } } satisfies MergeState));
    });
    const gh = fakeGitHub(prs, { checks: [] }, true);
    clock.ms = Date.parse("2026-11-10T09:00:00Z");
    for (let i = 0; i < 40 && numbers.some((n) => !prs[n]!.pr.merged); i++) {
      // e2e passes again today: whatever was run again ends well.
      for (const n of numbers) if (prs[n]!.checks.some((c) => !c.done)) prs[n]!.checks = prs[n]!.checks.map((c) => ({ ...c, done: true, ok: true, at: at(clock.ms) }));
      await pollMerges(ctx, () => gh.api);
      expect(numbers.filter((n) => prs[n]!.checks.some((c) => !c.done)).length).toBeLessThanOrEqual(1);
      clock.ms += 10 * MINUTE;
    }
    for (const n of numbers) {
      expect(gh.did.filter((d) => d === `rerun ${n}`)).toHaveLength(1);
      expect(state(n).status).toBe("merged");
    }
    expect(gh.did.filter((d) => d.startsWith("comment") || d.startsWith("update"))).toEqual([]);
    expect(outage()).toBeUndefined();
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
