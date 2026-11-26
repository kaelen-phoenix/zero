import { afterEach, describe, expect, it } from "vitest";
import { requestWork, SHUTDOWN_KEY } from "../src/app.js";
import { PROBE_KEY } from "../src/coord/pass.js";
import { pushProgress, pushedKey, type ProgressRecord } from "../src/coord/progress.js";
import { claimJob, claimRef, memoryCoord, progressRef, readClaimOf } from "../src/coord/protocol.js";
import { runDaemon } from "../src/daemon.js";
import { daemonLockHeld } from "../src/daemon-lock.js";
import { LOST_TO_ANOTHER } from "../src/line/finish.js";
import { runJob } from "../src/line/runner.js";
import { machineIdentity } from "../src/machine.js";
import { tryGit } from "../src/shell.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, tempDir, testFactory, validSpec, writeTree } from "./helpers.js";

afterEach(cleanup);

const DISTRIBUTED = { repository: "me/zero-coord", machine: "pc-vieja" };
const passes = `node -e "process.exit(0)"`;

/** A line whose repository has a bare `origin`, with its base already there. */
function factory() {
  const repo = gitRepo();
  const remote = tempDir("zero-remote-");
  run("git", ["init", "-q", "--bare", "-b", "main"], remote);
  gitIn(repo, "remote", "add", "origin", remote);
  gitIn(repo, "push", "-q", "origin", "main");
  const ctx = testFactory({ level: "L2", isolation: "worktree", distributed: DISTRIBUTED, lines: [{ name: "demo", repo, verify: [passes] }] });
  ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: DISTRIBUTED.repository, at: new Date().toISOString(), ok: true }));
  return { ctx, repo, remote };
}

const remoteTip = (remote: string, branch: string) => tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], remote);
const progressOf = (api: ReturnType<typeof memoryCoord>, job: string) => {
  const ref = api.refs.get(progressRef(job));
  return ref && (JSON.parse(ref.data) as ProgressRecord);
};
const pushes = (api: ReturnType<typeof memoryCoord>) => api.calls.filter((c) => c.includes("progress/"));

/** A runner with this machine's claim taken and the daemon's push dep, as the daemon builds it. */
async function claimed(ctx: ReturnType<typeof factory>["ctx"], api: ReturnType<typeof memoryCoord>, jobId: string) {
  const machine = machineIdentity(ctx.store, ctx.config);
  expect((await claimJob(api, jobId, machine, new Date())).claimed).toBe(true);
  const line = ctx.config.lines[0]!;
  return { machine, pushProgress: (j: Parameters<typeof pushProgress>[1], copy: Parameters<typeof pushProgress>[2]) => pushProgress({ api, store: ctx.store, machine, repo: line.repo, now: () => new Date() }, j, copy) };
}

const branchOf = (id: string) => `zero/${id}`;

describe("pushing the job's progress at each checkpoint", () => {
  it("pushes the branch and writes progress after the spec", async () => {
    const { ctx, repo, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const { pushProgress, machine } = await claimed(ctx, api, job.id);
    let atBuild: { remote?: string; local?: string; progress?: ProgressRecord } = {};
    const agents = fakeAgents({
      build: (req) => {
        atBuild = { remote: remoteTip(remote, branchOf(job.id)), local: tryGit(["rev-parse", `refs/heads/${branchOf(job.id)}`], repo), progress: progressOf(api, job.id) };
        writeTree(req.cwd, { "src/a.ts": "ok" });
      },
    });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, pushProgress });
    expect(done.status).toBe("delivered");
    expect(atBuild.remote).toBeDefined();
    expect(atBuild.remote).toBe(atBuild.local);
    expect(atBuild.progress).toMatchObject({ job: job.id, machine: machine.id, checkpoint: "spec", stagesDone: 0, branch: branchOf(job.id), sha: atBuild.remote });
    expect(atBuild.progress?.title).toBe(validSpec().title);
    // Before integrating the last state went up too.
    expect(ctx.store.getKv(pushedKey(job.id))).toBe(progressOf(api, job.id)?.sha);
    expect(progressOf(api, job.id)?.checkpoint).toBe("review");
  });

  it("pushes the job's commits without AI attribution, only by fast-forward", async () => {
    const { ctx, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const { pushProgress } = await claimed(ctx, api, job.id);
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/a.ts": "ok" });
        gitIn(req.cwd, "add", "-A");
        gitIn(req.cwd, "commit", "-q", "-m", "Add a\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
      },
    });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, pushProgress });
    expect(done.status).toBe("delivered");
    const pushed = remoteTip(remote, branchOf(job.id))!;
    expect(ctx.store.getKv(pushedKey(job.id))).toBe(pushed);
    const messages = run("git", ["log", "--format=%B", pushed, "--not", "main"], remote);
    expect(messages).toContain("Add a");
    expect(messages).not.toContain("noreply@anthropic.com");
  });

  it("pushes each stage that passes verify", async () => {
    const { ctx, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const { pushProgress } = await claimed(ctx, api, job.id);
    const seen: (ProgressRecord | undefined)[] = [];
    const agents = fakeAgents({
      spec: () => ({ output: validSpec({ stages: [{ title: "Base", tasks: ["a"] }, { title: "Vista", tasks: ["b"] }] }) }),
      build: (req, n) => {
        seen.push(progressOf(api, job.id));
        writeTree(req.cwd, { [`src/${n}.ts`]: "ok" });
      },
    });
    expect((await runJob(job.id, { ...ctx, runAgent: agents.runner, pushProgress })).status).toBe("delivered");
    const second = seen[1]!;
    expect(second).toMatchObject({ stagesDone: 1, checkpoint: "spec" });
    // The stage's commit is on the remote.
    expect(tryGit(["cat-file", "-e", `${second.sha}:src/1.ts`], remote)).toBeDefined();
  });

  it("ends the job as lost when someone else moved the remote branch, leaving it where it is", async () => {
    const { ctx, repo, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const { pushProgress } = await claimed(ctx, api, job.id);
    const before = gitIn(repo, "rev-parse", "main");
    let moved = "";
    const agents = fakeAgents({
      build: (req) => {
        // Another clone pushes a commit this machine never pushed onto the job's branch.
        const other = tempDir("zero-other-");
        run("git", ["clone", "-q", "-b", branchOf(job.id), remote, other], tempDir());
        writeTree(other, { "otro.txt": "x" });
        gitIn(other, "add", "-A");
        gitIn(other, "commit", "-q", "-m", "otro");
        gitIn(other, "push", "-q", "origin", branchOf(job.id));
        moved = gitIn(other, "rev-parse", "HEAD");
        writeTree(req.cwd, { "src/a.ts": "ok" });
      },
    });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, pushProgress });
    expect(done).toMatchObject({ status: "stopped", reason: LOST_TO_ANOTHER });
    expect(remoteTip(remote, branchOf(job.id))).toBe(moved);
    expect(gitIn(repo, "rev-parse", "main")).toBe(before);
  });

  it("runs no git push once the job is not this machine's", async () => {
    const { ctx, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const { pushProgress } = await claimed(ctx, api, job.id);
    const agents = fakeAgents({
      spec: () => {
        api.refs.set(claimRef(job.id), { name: claimRef(job.id), sha: "e".repeat(40), data: JSON.stringify({ job: job.id, machine: "otra", name: "mac", at: new Date().toISOString() }) });
        return undefined;
      },
    });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, pushProgress });
    expect(done).toMatchObject({ status: "stopped", reason: LOST_TO_ANOTHER });
    expect(remoteTip(remote, branchOf(job.id))).toBeUndefined();
    expect(pushes(api)).toEqual([]);
    expect(ctx.store.getKv(pushedKey(job.id))).toBeUndefined();
  });

  it("pushes from the daemon, and a delivered job's branch is on the remote", async () => {
    const { ctx, repo, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/a.ts": "ok" }) }).runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
    expect(remoteTip(remote, branchOf(job.id))).toBe(progressOf(api, job.id)?.sha);
    expect(tryGit(["rev-parse", `refs/heads/${branchOf(job.id)}`], repo)).toBe(progressOf(api, job.id)?.sha);
  });
});

describe("pushing and releasing at a shutdown on purpose", () => {
  it("pushes what is committed and releases the claim before the lock goes", async () => {
    const { ctx, remote } = factory();
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    let lockAtRelease: boolean | undefined;
    const update = api.update.bind(api);
    api.update = async (name, data, from) => {
      if (name === claimRef(job.id)) lockAtRelease = daemonLockHeld(ctx.home);
      return update(name, data, from);
    };
    let committed = "";
    const agents = fakeAgents({
      build: async (req) => {
        writeTree(req.cwd, { "src/a.ts": "ok" });
        gitIn(req.cwd, "add", "-A");
        gitIn(req.cwd, "commit", "-q", "-m", "a medias");
        committed = gitIn(req.cwd, "rev-parse", "HEAD");
        ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
        await new Promise((resolve) => (req.signal?.aborted ? resolve(undefined) : req.signal?.addEventListener("abort", resolve)));
      },
    });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    expect(remoteTip(remote, branchOf(job.id))).toBe(committed);
    expect(progressOf(api, job.id)?.sha).toBe(committed);
    expect(await readClaimOf(api, job.id)).toMatchObject({ released: true, status: "queued" });
    expect(lockAtRelease).toBe(true);
    expect(daemonLockHeld(ctx.home)).toBe(false);
  });
});
