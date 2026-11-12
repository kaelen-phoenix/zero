import type { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it } from "vitest";
import { billingRefusal, billingText, checksBillingKey, githubMerges, mergeKey, pollMerges, type Check, type ChecksBilling, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { briefing, factoryStatus } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { finalizeJob } from "../src/line/finish.js";
import { overviewPage } from "../src/panel/html.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const REFUSED = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
const refused = (at: string, run: number): Check[] => [{ name: "ci", done: true, ok: true, at }, { name: "build", done: true, ok: false, at, run, billing: true }];

interface FakePr {
  pr: PullRequestState;
  checks: Check[];
}

/** GitHub with several pull requests of one repository and the checks of its base branch; records what the factory did. */
function fakeGitHub(prs: Record<number, FakePr>, base: { checks: Check[] } = { checks: [] }) {
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async (n) => prs[n]!.pr,
    checks: async (ref) => (ref === "main" ? base.checks : Object.values(prs).find((p) => p.pr.headSha === ref)!.checks),
    merge: async (n, sha) => {
      did.push(`merge #${n} @${sha}`);
      return "merged-sha";
    },
    deleteBranch: async () => {},
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
    behind: async () => true,
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
  const record = () => {
    const raw = ctx.store.getKv(checksBillingKey("kaelen/demo"));
    return raw ? (JSON.parse(raw) as ChecksBilling) : undefined;
  };
  return { ctx, clock, state, record, jobs };
}

describe("billingRefusal", () => {
  it("recognises GitHub's text, whole or either half", () => {
    expect(billingRefusal(REFUSED)).toBe(true);
    expect(billingRefusal("your spending limit needs to be increased")).toBe(true);
    expect(billingRefusal("RECENT ACCOUNT PAYMENTS HAVE FAILED")).toBe(true);
  });

  it("does not take another failure for it", () => {
    expect(billingRefusal("Process completed with exit code 1")).toBe(false);
    expect(billingRefusal(undefined)).toBe(false);
    expect(billingRefusal(null)).toBe(false);
  });
});

describe("the GitHub adapter", () => {
  it("marks failed runs GitHub refused over billing, from their output or their annotations, and tells when a run started", async () => {
    const runs = [
      { id: 1, name: "build", status: "completed", conclusion: "failure", details_url: "https://github.com/k/d/actions/runs/42/job/1", completed_at: "2026-11-10T11:00:00Z", started_at: "2026-11-10T11:00:00Z", output: { title: null, summary: REFUSED, text: null, annotations_count: 0 } },
      { id: 2, name: "lint", status: "completed", conclusion: "failure", details_url: "https://github.com/k/d/actions/runs/43/job/2", completed_at: "2026-11-10T11:01:00Z", started_at: "2026-11-10T11:00:30Z", output: { title: null, summary: null, text: null, annotations_count: 1 } },
      { id: 3, name: "test", status: "completed", conclusion: "failure", details_url: "https://github.com/k/d/actions/runs/44/job/3", completed_at: "2026-11-10T11:02:00Z", started_at: "2026-11-10T11:01:00Z", output: { title: "Tests failed", summary: "Process completed with exit code 1", text: null, annotations_count: 1 } },
      { id: 4, name: "ok", status: "completed", conclusion: "success", details_url: null, completed_at: "2026-11-10T11:03:00Z", started_at: "2026-11-10T11:02:00Z", output: { title: null, summary: null, text: null, annotations_count: 2 } },
      { id: 5, name: "queued", status: "queued", conclusion: null, details_url: null, completed_at: null, started_at: "2026-11-10T11:04:00Z", output: { title: null, summary: null, text: null, annotations_count: 0 } },
    ];
    const asked: number[] = [];
    const listForRef = {};
    const listAnnotations = {};
    const client = {
      paginate: async (method: unknown, params: { check_run_id?: number }) => {
        if (method === listForRef) return runs;
        asked.push(params.check_run_id!);
        return params.check_run_id === 2 ? [{ title: null, message: REFUSED }] : [{ title: "x", message: "Process completed with exit code 1" }];
      },
      checks: { listForRef, listAnnotations },
      repos: { getCombinedStatusForRef: async () => ({ data: { statuses: [] } }) },
    } as unknown as Octokit;
    const checks = await githubMerges("t", "k/d", client).checks("sha");
    expect(checks).toEqual([
      { name: "build", done: true, ok: false, run: 42, at: "2026-11-10T11:00:00Z", started: "2026-11-10T11:00:00Z", billing: true },
      { name: "lint", done: true, ok: false, run: 43, at: "2026-11-10T11:01:00Z", started: "2026-11-10T11:00:30Z", billing: true },
      { name: "test", done: true, ok: false, run: 44, at: "2026-11-10T11:02:00Z", started: "2026-11-10T11:01:00Z" },
      { name: "ok", done: true, ok: true, at: "2026-11-10T11:03:00Z", started: "2026-11-10T11:02:00Z" },
      { name: "queued", done: false, ok: false },
    ]);
    // Annotations are read only for failed runs that have them.
    expect(asked.sort()).toEqual([2, 3]);
  });
});

describe("a pull request whose checks GitHub did not start over billing", () => {
  it("is held without a comment, an update or a rerun, and counts toward no outage", async () => {
    const { ctx, state, record, jobs } = await factoryWith([5]);
    const gh = fakeGitHub({ 5: pull("a", refused("2026-11-10T11:30:00Z", 42)) });
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    const s = state(5);
    expect(s.status).toBe("blocked");
    expect(s.billing).toBe(true);
    expect(s.why).toBe(billingText("kaelen/demo", "2026-11-10T11:30:00Z"));
    expect(s.backoff).toBeDefined();
    expect(record()).toMatchObject({ since: "2026-11-10T11:30:00Z", last: "2026-11-10T11:30:00Z", jobs: [jobs[5]] });
    expect(ctx.store.kvWithPrefix("checks-outage:")).toEqual([]);
    expect(ctx.store.kvWithPrefix("checks-failures:")).toEqual([]);
  });

  it("keeps its mark through later saves", async () => {
    const { ctx, clock, state } = await factoryWith([5]);
    const prs = { 5: pull("a", refused("2026-11-10T11:30:00Z", 42)) };
    const gh = fakeGitHub(prs);
    await pollMerges(ctx, () => gh.api);
    prs[5] = pull("a", [{ name: "build", done: false, ok: false, run: 42 }]);
    clock.ms += 10 * 60_000;
    await pollMerges(ctx, () => gh.api);
    expect(state(5).status).toBe("waiting");
    expect(state(5).billing).toBe(true);
    expect(gh.did).toEqual([]);
  });

  it("makes one record per repository for two pull requests", async () => {
    const { ctx, state, record, jobs } = await factoryWith([5, 6]);
    const gh = fakeGitHub({ 5: pull("a", refused("2026-11-10T11:30:00Z", 42)), 6: pull("b", refused("2026-11-10T11:40:00Z", 43)) });
    await pollMerges(ctx, () => gh.api);
    expect(ctx.store.kvWithPrefix("checks-billing:")).toHaveLength(1);
    expect(record()).toMatchObject({ since: "2026-11-10T11:30:00Z", last: "2026-11-10T11:40:00Z", jobs: [jobs[5], jobs[6]] });
    expect(state(5).billing).toBe(true);
    expect(state(6).billing).toBe(true);
    expect(gh.did).toEqual([]);
  });
});

describe("telling a billing refusal", () => {
  async function held() {
    const f = await factoryWith([5, 6]);
    const gh = fakeGitHub({ 5: pull("a", refused("2026-11-10T11:30:00Z", 42)), 6: pull("b", refused("2026-11-10T11:40:00Z", 43)) });
    await pollMerges(f.ctx, () => gh.api);
    return f;
  }
  const line = billingText("kaelen/demo", "2026-11-10T11:30:00Z");
  const once = (text: string, part: string) => text.split(part).length - 1;

  it("is one line in zero status, with the pull requests it holds left out", async () => {
    const { ctx } = await held();
    const s = factoryStatus(ctx);
    expect(s.billing).toEqual([{ repository: "kaelen/demo", since: "2026-11-10T11:30:00Z", pulls: ["https://github.com/kaelen/demo/pull/5", "https://github.com/kaelen/demo/pull/6"] }]);
    expect(s.merges).toEqual([]);
    const text = formatStatus(s);
    expect(once(text, "GitHub no arranca los checks en kaelen/demo")).toBe(1);
    expect(text).toContain(`${line} · 2 pull requests esperan`);
    expect(text).not.toContain("Fusión automática");
  });

  it("is one line in the panel and in the briefing", async () => {
    const { ctx } = await held();
    const html = overviewPage(factoryStatus(ctx), ["demo"], "nonce");
    expect(once(html, line.replace("&", "&amp;"))).toBe(1);
    expect(html).not.toContain("Fusión automática");
    const body = (await briefing(ctx)).body;
    expect(once(body, line)).toBe(1);
    expect(body).not.toContain("**Sin fundir**");
  });

  it("says nothing without a record", async () => {
    const { ctx } = await factoryWith([5]);
    const s = factoryStatus(ctx);
    expect(s.billing).toEqual([]);
    expect(formatStatus(s)).not.toContain("GitHub no arranca los checks");
    expect(overviewPage(s, ["demo"], "nonce")).not.toContain("GitHub no arranca los checks");
    expect((await briefing(ctx)).body).not.toContain("GitHub no arranca los checks");
  });
});

describe("running again the checks GitHub refused over billing", () => {
  const minutes = (clock: { ms: number }, n: number) => void (clock.ms += n * 60_000);
  const started = (at: string): Check => ({ name: "deploy", done: true, ok: true, at, started: at });

  it("runs nothing again while GitHub gives no sign of starting runs", async () => {
    const { ctx, clock, state } = await factoryWith([5]);
    const base = { checks: [{ name: "deploy", done: true, ok: true, at: "2026-11-10T11:20:00Z", started: "2026-11-10T11:20:00Z" }] };
    const gh = fakeGitHub({ 5: pull("a", refused("2026-11-10T11:30:00Z", 42)) }, base);
    await pollMerges(ctx, () => gh.api);
    for (let i = 0; i < 4; i++) {
      minutes(clock, 30);
      await pollMerges(ctx, () => gh.api);
    }
    expect(gh.did).toEqual([]);
    expect(state(5).billing).toBe(true);
    expect(state(5).status).toBe("blocked");
  });

  it("runs the refused runs again once a check started after the refusal at the base", async () => {
    const { ctx, clock, state, record } = await factoryWith([5]);
    const base = { checks: [] as Check[] };
    const gh = fakeGitHub({ 5: pull("a", refused("2026-11-10T11:30:00Z", 42)) }, base);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    base.checks = [started("2026-11-10T12:03:00Z")];
    minutes(clock, 5);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 42"]);
    const s = state(5);
    expect(s.status).toBe("waiting");
    expect(s.refreshing?.rerun).toBe(true);
    expect(s.billingRerun).toEqual([42]);
    expect(s.billing).toBeUndefined();
    // No held pull request is left: the record is forgotten and nothing is told.
    expect(record()).toBeUndefined();
    expect(formatStatus(factoryStatus(ctx))).not.toContain("GitHub no arranca los checks");
  });

  it("takes a check started at another watched tip as the sign, without reading the base", async () => {
    const { ctx, clock, state } = await factoryWith([5, 6]);
    const prs = { 5: pull("a", refused("2026-11-10T11:30:00Z", 42)), 6: pull("b", [{ name: "ci", done: false, ok: false }]) };
    const gh = fakeGitHub(prs);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual([]);
    // The other pull request's checks did start, and passed: it merges, and the repository is free.
    prs[6] = pull("b", [started("2026-11-10T12:01:00Z")]);
    minutes(clock, 1);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["merge #6 @b", "rerun 42"]);
    expect(state(5).billingRerun).toEqual([42]);
  });

  it("runs again one pull request at a time, the oldest first", async () => {
    const { ctx, clock, state, record, jobs } = await factoryWith([5, 6]);
    const prs = { 5: pull("a", refused("2026-11-10T11:30:00Z", 42)), 6: pull("b", refused("2026-11-10T11:40:00Z", 43)) };
    const base = { checks: [] as Check[] };
    const gh = fakeGitHub(prs, base);
    await pollMerges(ctx, () => gh.api);
    base.checks = [started("2026-11-10T12:04:00Z")];
    minutes(clock, 5);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 42"]);
    expect(record()?.jobs).toEqual([jobs[6]]);
    expect(state(6).billing).toBe(true);
    // While the first one's checks run, the second waits.
    prs[5] = pull("a", [{ name: "ci", done: true, ok: true }, { name: "build", done: false, ok: false, run: 42 }]);
    minutes(clock, 1);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 42"]);
    // Once they all ended, the first merges and the second gets its turn.
    prs[5] = pull("a", [{ name: "ci", done: true, ok: true }, { name: "build", done: true, ok: true, run: 42 }]);
    minutes(clock, 5);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 42", "merge #5 @a", "rerun 43"]);
    expect(state(6).billingRerun).toEqual([43]);
    expect(record()).toBeUndefined();
  });

  it("runs each refused run again only once in its life", async () => {
    const { ctx, clock, state } = await factoryWith([5]);
    const prs = { 5: pull("a", refused("2026-11-10T11:30:00Z", 42)) };
    const base = { checks: [] as Check[] };
    const gh = fakeGitHub(prs, base);
    await pollMerges(ctx, () => gh.api);
    base.checks = [started("2026-11-10T12:04:00Z")];
    minutes(clock, 5);
    await pollMerges(ctx, () => gh.api);
    expect(gh.did).toEqual(["rerun 42"]);
    // Refused again, then GitHub starts runs again later.
    prs[5] = pull("a", refused("2026-11-10T12:08:00Z", 42));
    minutes(clock, 5);
    await pollMerges(ctx, () => gh.api);
    base.checks = [started("2026-11-10T12:30:00Z")];
    for (let i = 0; i < 3; i++) {
      minutes(clock, 30);
      await pollMerges(ctx, () => gh.api);
    }
    expect(gh.did).toEqual(["rerun 42"]);
    const s = state(5);
    expect(s.status).toBe("blocked");
    expect(s.why).toBe(billingText("kaelen/demo", "2026-11-10T12:08:00Z"));
    expect(s.billingRerun).toEqual([42]);
  });

  it("forgets the record once the pull requests it held are no longer watched", async () => {
    const { ctx, clock, record } = await factoryWith([5]);
    const prs = { 5: pull("a", refused("2026-11-10T11:30:00Z", 42)) };
    const gh = fakeGitHub(prs);
    await pollMerges(ctx, () => gh.api);
    expect(record()).toBeDefined();
    prs[5] = { ...prs[5], pr: { ...prs[5].pr, open: false, headSha: "a2" } };
    minutes(clock, 10);
    await pollMerges(ctx, () => gh.api);
    expect(record()).toBeUndefined();
    expect(factoryStatus(ctx).billing).toEqual([]);
    expect(formatStatus(factoryStatus(ctx))).not.toContain("GitHub no arranca los checks");
    expect(gh.did).toEqual([]);
  });
});
