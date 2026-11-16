import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, startTrain, briefing } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { mergeKey, pollMerges, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob } from "../src/line/finish.js";
import { advanceTrains, readTrain, trainKey } from "../src/line/train.js";
import { overviewPage } from "../src/panel/html.js";
import { cleanup, gitIn, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const MINUTE = 60_000;
const AT = "2026-11-10T11:50:00Z";
const ok = (name: string): Check => ({ name, done: true, ok: true, at: AT });
const failed = (name: string, run: number): Check => ({ name, done: true, ok: false, run, at: AT, started: AT });

interface FakePr {
  pr: PullRequestState;
  checks: Check[];
}

/** GitHub with several pull requests of one repository, all behind their base; records what the factory did. */
function fakeGitHub(prs: Record<number, FakePr>) {
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async (n) => prs[n]!.pr,
    checks: async (ref) => Object.values(prs).find((p) => p.pr.headSha === ref)?.checks ?? [],
    merge: async (n, sha) => {
      did.push(`merge #${n} @${sha}`);
      prs[n]!.pr = { ...prs[n]!.pr, open: false, merged: true };
      return `merged-${n}`;
    },
    deleteBranch: async () => {},
    comment: async (n) => void did.push(`comment #${n}`),
    behind: async () => true,
    updateBranch: async (n, sha) => void did.push(`update #${n} @${sha}`),
    rerun: async (run) => void did.push(`rerun ${run}`),
  };
  return { api, did };
}

const pull = (headSha: string, checks: Check[]): FakePr => ({ pr: { open: true, merged: false, mergeable: true, headSha, base: "main" }, checks });
const url = (n: number) => `https://github.com/kaelen/demo/pull/${n}`;

async function factoryWith(numbers: number[], opts: { autoMerge?: boolean; integrate?: string } = {}) {
  const autoMerge = opts.autoMerge ?? true;
  const clock = { ms: Date.parse("2026-11-10T12:00:00Z") };
  const repo = gitRepo();
  gitIn(repo, "remote", "add", "origin", "https://github.com/kaelen/demo.git");
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: opts.integrate ?? "pull-request", ...(autoMerge && { autoMerge: true }) }] }, () => new Date(clock.ms));
  const jobs: Record<number, string> = {};
  for (const n of numbers) {
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: `x${n}`, budgetUsd: 3 });
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: url(n), ...(autoMerge && { autoMerge: true }) } });
    jobs[n] = job.id;
    clock.ms += 1_000;
  }
  const state = (n: number) => JSON.parse(ctx.store.getKv(mergeKey(jobs[n]!)) ?? "{}") as MergeState;
  const pass = async (gh: { api: MergeApi }) => {
    clock.ms += 10 * MINUTE;
    await pollMerges(ctx, () => gh.api);
  };
  return { ctx, clock, state, jobs, pass };
}

describe("the integration train of a line", () => {
  it("acts only on its head: the others wait naming it, with nothing written to GitHub", async () => {
    const { ctx, state, pass } = await factoryWith([1, 2, 3]);
    await startTrain(ctx, { line: "demo" });
    const gh = fakeGitHub({ 1: pull("a", [ok("ci")]), 2: pull("b", [ok("ci")]), 3: pull("c", [ok("ci")]) });
    await pass(gh);
    expect(gh.did).toEqual(["merge #1 @a"]);
    for (const n of [2, 3]) expect(state(n)).toMatchObject({ status: "waiting", why: `en el tren: espera a ${url(1)}`, train: url(1) });
  });

  it("moves on once the head is merged, giving the new head back what earlier conflicts spent, once", async () => {
    const { ctx, state, jobs, pass } = await factoryWith([1, 2, 3]);
    await startTrain(ctx, { line: "demo" });
    ctx.store.setKv(mergeKey(jobs[2]!), JSON.stringify({ status: "blocked", why: "en conflicto con la rama base", resolutions: 2, resolving: "old", conflict: "old", refreshes: 3 } satisfies MergeState));
    const gh = fakeGitHub({ 1: pull("a", [ok("ci")]), 2: pull("b", [ok("ci")]), 3: pull("c", [ok("ci")]) });
    await pass(gh);
    // What the factory spent on #2 outlives its wait behind the head.
    expect(state(2)).toMatchObject({ resolutions: 2, refreshes: 3 });

    advanceTrains(ctx);
    expect(readTrain(ctx, "demo")!.entries.map((e) => e.url)).toEqual([url(2), url(3)]);
    expect(state(2).trainHead).toBe(true);
    for (const field of ["resolutions", "refreshes", "resolving", "conflict", "train"] as const) expect(state(2)[field]).toBeUndefined();
    // Only once: what it spends as head is kept.
    ctx.store.setKv(mergeKey(jobs[2]!), JSON.stringify({ ...state(2), resolutions: 1 }));
    advanceTrains(ctx);
    expect(state(2).resolutions).toBe(1);

    await pass(gh);
    expect(gh.did).toEqual(["merge #1 @a", "merge #2 @b"]);
    expect(state(3).why).toBe(`en el tren: espera a ${url(2)}`);
    await pass(gh);
    await pass(gh);
    expect(gh.did).toEqual(["merge #1 @a", "merge #2 @b", "merge #3 @c"]);
    expect(ctx.store.getKv(trainKey("demo"))).toBeUndefined();
  });

  it("never merges a head in red", async () => {
    const { ctx, pass } = await factoryWith([1, 2]);
    await startTrain(ctx, { line: "demo" });
    const gh = fakeGitHub({ 1: pull("a", [failed("e2e", 7)]), 2: pull("b", [ok("ci")]) });
    await pass(gh);
    await pass(gh);
    expect(gh.did.some((d) => d.startsWith("merge"))).toBe(false);
    expect(gh.did.some((d) => d.includes("#2"))).toBe(false);
  });

  it("merges a green head on a line without autoMerge", async () => {
    const { ctx, state, pass } = await factoryWith([1, 2], { autoMerge: false });
    const gh = fakeGitHub({ 1: pull("a", [ok("ci")]), 2: pull("b", [ok("ci")]) });
    // Without a train nothing of this line is watched.
    await pass(gh);
    expect(gh.did).toEqual([]);
    await startTrain(ctx, { line: "demo" });
    await pass(gh);
    expect(gh.did).toEqual(["merge #1 @a"]);
    expect(state(1).status).toBe("merged");
  });

  it("is shown in status, the panel and the briefing", async () => {
    const { ctx, pass } = await factoryWith([1, 2]);
    await startTrain(ctx, { line: "demo" });
    await pass(fakeGitHub({ 1: pull("a", [{ name: "ci", done: false, ok: false }]), 2: pull("b", [ok("ci")]) }));
    const line = `Tren de demo: 2 pull requests; ahora ${url(1)} (esperando checks)`;
    const status = factoryStatus(ctx);
    expect(formatStatus(status)).toContain(line);
    expect(overviewPage(status, ["demo"], "nonce")).toContain(line);
    expect((await briefing(ctx)).body).toContain(line);
  });
});

describe("startTrain", () => {
  it("orders the delivered pull requests oldest delivery first, or as given", async () => {
    const { ctx, jobs } = await factoryWith([5, 3, 4]);
    expect((await startTrain(ctx, { line: "demo" })).entries.map((e) => e.job)).toEqual([jobs[5], jobs[3], jobs[4]]);
    ctx.store.deleteKv(trainKey("demo"));
    expect((await startTrain(ctx, { line: "demo", numbers: ["4", "#5"] })).entries.map((e) => e.url)).toEqual([url(4), url(5)]);
  });

  it("leaves out pull requests already merged", async () => {
    const { ctx, jobs } = await factoryWith([1, 2]);
    ctx.store.setKv(mergeKey(jobs[1]!), JSON.stringify({ status: "merged" } satisfies MergeState));
    expect((await startTrain(ctx, { line: "demo" })).entries.map((e) => e.url)).toEqual([url(2)]);
  });

  it("refuses before writing anything", async () => {
    const { ctx } = await factoryWith([1]);
    await expect(startTrain(ctx, { line: "nope" })).rejects.toThrow(/No existe la línea/);
    await expect(startTrain(ctx, { line: "demo", numbers: ["9"] })).rejects.toThrow(/#9/);
    await expect(startTrain(ctx, { line: "demo", numbers: ["x"] })).rejects.toThrow(/no es un número/);
    expect(ctx.store.getKv(trainKey("demo"))).toBeUndefined();
    const first = await startTrain(ctx, { line: "demo" });
    await expect(startTrain(ctx, { line: "demo" })).rejects.toThrow(/ya tiene un tren/);
    expect(JSON.parse(ctx.store.getKv(trainKey("demo"))!)).toEqual(first);
  });

  it("refuses a line that integrates by merge", async () => {
    const { ctx } = await factoryWith([], { integrate: "merge", autoMerge: false });
    await expect(startTrain(ctx, { line: "demo" })).rejects.toThrow(/no integra por pull request/);
    expect(ctx.store.getKv(trainKey("demo"))).toBeUndefined();
  });

  it("refuses a line with nothing delivered", async () => {
    const { ctx } = await factoryWith([]);
    await expect(startTrain(ctx, { line: "demo" })).rejects.toThrow(/no tiene pull requests/);
  });
});
