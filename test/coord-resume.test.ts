import { afterEach, describe, expect, it } from "vitest";
import { requestWork } from "../src/app.js";
import { PROBE_KEY } from "../src/coord/pass.js";
import { pushProgress, readProgress, resumeProgress, type ProgressRecord } from "../src/coord/progress.js";
import { claimJob, memoryCoord, progressRef, readClaimOf, stillHolds, type CoordApi } from "../src/coord/protocol.js";
import { runDaemon } from "../src/daemon.js";
import { LOST_TO_ANOTHER } from "../src/line/finish.js";
import { runJob } from "../src/line/runner.js";
import { machineIdentity } from "../src/machine.js";
import { tryGit } from "../src/shell.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, tempDir, testFactory, validSpec, writeTree } from "./helpers.js";

afterEach(cleanup);

const REPOSITORY = "me/zero-coord";
const passes = `node -e "process.exit(0)"`;
const LONG_AGO = () => new Date(Date.now() - 60 * 60_000);
const TWO_STAGES = () => validSpec({ stages: [{ title: "Base", tasks: ["a"] }, { title: "Vista", tasks: ["b"] }] });

/** Two machines whose lines share one bare `origin`: B's repository is a clone of A's. */
function machines() {
  const repoA = gitRepo();
  const remote = tempDir("zero-remote-");
  run("git", ["init", "-q", "--bare", "-b", "main"], remote);
  gitIn(repoA, "remote", "add", "origin", remote);
  gitIn(repoA, "push", "-q", "origin", "main");
  const repoB = tempDir("zero-clone-");
  run("git", ["clone", "-q", remote, repoB], tempDir());
  gitIn(repoB, "config", "user.name", "test");
  gitIn(repoB, "config", "user.email", "test@example.com");
  const make = (machine: string, repo: string) => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", distributed: { repository: REPOSITORY, machine }, lines: [{ name: "demo", repo, verify: [passes] }] });
    ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: new Date().toISOString(), ok: true }));
    return ctx;
  };
  return { a: make("pc-a", repoA), b: make("pc-b", repoB), remote };
}

type Ctx = ReturnType<typeof machines>["a"];

/** The runner deps the daemon gives a job it took, for a machine that took it at `at`. */
async function holding(ctx: Ctx, api: CoordApi, jobId: string, at = new Date()) {
  const machine = machineIdentity(ctx.store, ctx.config);
  const claim = await claimJob(api, jobId, machine, at, ctx.config.distributed!.leaseMinutes);
  expect(claim.claimed).toBe(true);
  const repo = ctx.config.lines[0]!.repo;
  return {
    machine,
    claim,
    deps: {
      holds: () => stillHolds(api, jobId, machine.id),
      pushProgress: (j: Parameters<typeof pushProgress>[1], copy: Parameters<typeof pushProgress>[2]) => pushProgress({ api, store: ctx.store, machine, repo, now: () => new Date() }, j, copy),
    },
  };
}

const progressOf = (api: ReturnType<typeof memoryCoord>, job: string) => JSON.parse(api.refs.get(progressRef(job))!.data) as ProgressRecord;
const remoteTip = (remote: string, branch: string) => tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], remote);
/** The same job, as the shared queue imports it on the other machine. */
const imported = (ctx: Ctx, id: string) => ctx.store.createJob({ id, line: "demo", kind: "request", request: "x", budgetUsd: 5 });

describe("resuming from the last pushed checkpoint", () => {
  it("goes on after A's verified stage, from A's commit, without the spec or that stage again", async () => {
    const { a, b, remote } = machines();
    const api = memoryCoord();
    const { job } = requestWork(a, { text: "x" });
    // A took it long ago and never beat: its lease is over once it stops.
    const { deps } = await holding(a, api, job.id, LONG_AGO());
    const cut = new AbortController();
    const atA = fakeAgents({
      spec: () => ({ output: TWO_STAGES() }),
      build: async (req, n) => {
        writeTree(req.cwd, { [`src/${n}.ts`]: "ok" });
        if (n < 2) return;
        cut.abort("andon");
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });
    expect((await runJob(job.id, { ...a, runAgent: atA.runner, ...deps }, cut.signal)).status).toBe("queued");
    const fromA = progressOf(api, job.id);
    expect(fromA).toMatchObject({ checkpoint: "spec", stagesDone: 1 });

    imported(b, job.id);
    let startedAt: string | undefined;
    const atB = fakeAgents({
      build: (req) => {
        startedAt = gitIn(req.cwd, "rev-parse", "HEAD");
        writeTree(req.cwd, { "src/2.ts": "ok" });
      },
    });
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => atB.runner, coord: () => api });
    expect(b.store.getJob(job.id)).toMatchObject({ status: "delivered", title: TWO_STAGES().title });
    expect(atB.count.spec).toBeUndefined();
    expect(atB.count.build).toBe(1);
    expect(startedAt).toBe(fromA.sha);
    const fromB = progressOf(api, job.id);
    expect(fromB.machine).toBe(machineIdentity(b.store, b.config).id);
    expect(fromB.sha).not.toBe(fromA.sha);
    expect(remoteTip(remote, fromB.branch)).toBe(fromB.sha);
  });

  it("starts from scratch on a broken progress, without an error", async () => {
    const { a, b } = machines();
    const api = memoryCoord();
    const { job } = requestWork(a, { text: "x" });
    await holding(a, api, job.id, LONG_AGO());
    api.refs.set(progressRef(job.id), { name: progressRef(job.id), sha: "f".repeat(40), data: "{roto" });
    imported(b, job.id);
    const atB = fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/a.ts": "ok" }) });
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => atB.runner, coord: () => api });
    expect(atB.count.spec).toBe(1);
    expect(b.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("A, back after B took over, pushes, integrates and says nothing", async () => {
    const { a, b, remote } = machines();
    const api = memoryCoord();
    const { job } = requestWork(a, { text: "x" });
    const mainA = gitIn(a.config.lines[0]!.repo, "rev-parse", "main");
    const { deps } = await holding(a, api, job.id, LONG_AGO());
    let fromB: ProgressRecord | undefined;
    const atA = fakeAgents({
      build: async (req) => {
        // While A sleeps, B takes the job over, resumes it at A's spec and delivers it.
        imported(b, job.id);
        const taken = await holding(b, api, job.id);
        expect(taken.claim).toMatchObject({ claimed: true, takenFrom: { name: "pc-a" } });
        await resumeProgress({ api, store: b.store, machine: taken.machine, repo: b.config.lines[0]!.repo }, job.id, true);
        const atB = fakeAgents({ build: (r) => void writeTree(r.cwd, { "src/b.ts": "ok" }) });
        expect((await runJob(job.id, { ...b, runAgent: atB.runner, ...taken.deps })).status).toBe("delivered");
        expect(atB.count.spec).toBeUndefined();
        fromB = progressOf(api, job.id);
        // A wakes up and goes on with its build.
        writeTree(req.cwd, { "src/a.ts": "ok" });
      },
    });
    const done = await runJob(job.id, { ...a, runAgent: atA.runner, ...deps });
    expect(done).toMatchObject({ status: "stopped", reason: LOST_TO_ANOTHER });
    expect(remoteTip(remote, fromB!.branch)).toBe(fromB!.sha);
    expect(progressOf(api, job.id)).toEqual(fromB);
    expect(gitIn(a.config.lines[0]!.repo, "rev-parse", "main")).toBe(mainA);
    expect((await readClaimOf(api, job.id))?.name).toBe("pc-b");
  });
});

describe("reading progress", () => {
  const record = (over: Record<string, unknown> = {}) => ({
    name: progressRef("job1"),
    sha: "a".repeat(40),
    data: JSON.stringify({ job: "job1", machine: "m1", checkpoint: "spec", stagesDone: 1, branch: "zero/job1", base: "main", sha: "b".repeat(40), title: "t", spec: validSpec(), attempt: 0, at: new Date().toISOString(), ...over }),
  });

  it("takes a sound record and drops anything off", () => {
    expect(readProgress(record(), "job1")?.stagesDone).toBe(1);
    expect(readProgress(record(), "otro")).toBeUndefined();
    expect(readProgress(record({ branch: "--upload-pack=x" }), "job1")).toBeUndefined();
    expect(readProgress(record({ base: "../main" }), "job1")).toBeUndefined();
    expect(readProgress(record({ sha: "HEAD" }), "job1")).toBeUndefined();
    expect(readProgress(record({ checkpoint: "delivered" }), "job1")).toBeUndefined();
    expect(readProgress(record({ stagesDone: -1 }), "job1")).toBeUndefined();
    expect(readProgress(record({ spec: { title: "sin nada más" } }), "job1")).toBeUndefined();
    expect(readProgress({ ...record(), data: "{roto" }, "job1")).toBeUndefined();
  });
});
