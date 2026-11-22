import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, requestWork } from "../src/app.js";
import { PROBE_KEY } from "../src/coord/pass.js";
import { claimRef, machineRef, memoryCoord, readClaimOf } from "../src/coord/protocol.js";
import { runDaemon } from "../src/daemon.js";
import { pollIssues, report, type IssueApi } from "../src/intake/github.js";
import { endedElsewhere, endedOn, finalizeJob, LOST_TO_ANOTHER, TAKEN_BY_ANOTHER } from "../src/line/finish.js";
import { runJob } from "../src/line/runner.js";
import { machineIdentity } from "../src/machine.js";
import { cleanup, fakeAgents, gitIn, gitRepo, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const DISTRIBUTED = { repository: "me/zero-coord", machine: "pc-vieja" };
const passes = `node -e "process.exit(0)"`;

function factory(over: Record<string, unknown> = {}) {
  return testFactory({ level: "L2", isolation: "worktree", distributed: DISTRIBUTED, lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }], ...over });
}

/** A probe of the configured repository, passed or not, as the coordination pass leaves it. */
const probed = (ctx: ReturnType<typeof factory>, ok = true) => ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: DISTRIBUTED.repository, at: new Date().toISOString(), ok, ...(!ok && { problem: "no dio conflicto" }) }));

const builder = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${Math.random().toString(36).slice(2)}.ts`]: "ok" }) });

/** Another machine, alive, holding `jobId`. */
function otherHolds(api: ReturnType<typeof memoryCoord>, jobId: string) {
  const at = new Date().toISOString();
  api.refs.set(machineRef("otra"), { name: machineRef("otra"), sha: "f".repeat(40), data: JSON.stringify({ id: "otra", name: "mac", at, jobs: [jobId], capabilities: { platform: "darwin", box: false, engines: ["claude"] } }) });
  api.refs.set(claimRef(jobId), { name: claimRef(jobId), sha: "e".repeat(40), data: JSON.stringify({ job: jobId, machine: "otra", name: "mac", at }) });
}

const protocolCalls = (api: ReturnType<typeof memoryCoord>) => api.calls.filter((c) => /\b(claims|queue|progress)\//.test(c));

describe("the protocol only after the probe", () => {
  it("runs the job as today when the probe failed", async () => {
    const ctx = factory();
    probed(ctx, false);
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
    expect(protocolCalls(api)).toEqual([]);
  });

  it("calls nothing and writes no coord key without distributed", async () => {
    const ctx = factory({ distributed: undefined });
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
    expect(api.calls).toEqual([]);
    expect(ctx.store.kvWithPrefix("coord:")).toEqual([]);
  });
});

describe("taking, checking and releasing jobs", () => {
  it("does not start a job another machine holds, and leaves it queued", async () => {
    const ctx = factory();
    probed(ctx);
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    otherHolds(api, job.id);
    const agents = builder();
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api });
    expect(agents.calls).toEqual([]);
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    expect((await readClaimOf(api, job.id))?.machine).toBe("otra");
  });

  it("claims before running and releases a delivered job as a closing record", async () => {
    const ctx = factory();
    probed(ctx);
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
    const id = machineIdentity(ctx.store, ctx.config).id;
    expect(await readClaimOf(api, job.id)).toMatchObject({ job: job.id, machine: id, released: true, status: "delivered" });
    expect(api.calls.indexOf(`create ${claimRef(job.id)}`)).toBeGreaterThanOrEqual(0);
    expect(api.calls.some((c) => c.startsWith("delete claims/"))).toBe(false);
  });

  it("releases a failed job with its status", async () => {
    const ctx = factory({ lines: [{ name: "demo", repo: gitRepo(), verify: [passes], maxAttempts: 1 }] });
    probed(ctx);
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    // A build that changes nothing fails its only attempt.
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("failed");
    expect(await readClaimOf(api, job.id)).toMatchObject({ released: true, status: "failed" });
  });

  it("keeps the claim of a job the andon interrupted", async () => {
    const ctx = factory();
    probed(ctx);
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const agents = fakeAgents({
      build: async (req) => {
        ctx.store.setKv(ANDON_KEY, "on");
        await new Promise((resolve) => (req.signal?.aborted ? resolve(undefined) : req.signal?.addEventListener("abort", resolve)));
      },
    });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    const claim = await readClaimOf(api, job.id);
    expect(claim).toMatchObject({ machine: machineIdentity(ctx.store, ctx.config).id });
    expect(claim?.released).toBeUndefined();
  });

  it("ends a job lost after the spec without building or integrating it, and keeps the other machine's claim", async () => {
    const ctx = factory();
    probed(ctx);
    const api = memoryCoord();
    const { job } = requestWork(ctx, { text: "x" });
    const line = ctx.config.lines[0]!;
    const before = gitIn(line.repo, "rev-parse", "main");
    const agents = fakeAgents({
      spec: () => void otherHolds(api, job.id),
      build: (req) => void writeTree(req.cwd, { "src/a.ts": "ok" }),
    });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api });
    const done = ctx.store.getJob(job.id)!;
    expect(done).toMatchObject({ status: "stopped", reason: LOST_TO_ANOTHER });
    expect(agents.count.spec).toBe(1);
    expect(agents.count.build).toBeUndefined();
    expect(gitIn(line.repo, "rev-parse", "main")).toBe(before);
    expect((await readClaimOf(api, job.id))?.machine).toBe("otra");
  });
});

describe("the runner's check before every station", () => {
  const runner = () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] });
    return { ctx, job: requestWork(ctx, { text: "x" }).job };
  };

  it("asks before spec, build, verify, the reviews and integrate", async () => {
    const { ctx, job } = runner();
    let asked = 0;
    const done = await runJob(job.id, { ...ctx, runAgent: builder().runner, holds: async () => (++asked, true) });
    expect(done.status).toBe("delivered");
    expect(asked).toBeGreaterThanOrEqual(6);
  });

  it("stops at the next station once the claim is gone, before the reviews", async () => {
    const { ctx, job } = runner();
    const agents = builder();
    const line = ctx.config.lines[0]!;
    const before = gitIn(line.repo, "rev-parse", "main");
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, holds: async () => !agents.count.build });
    expect(done).toMatchObject({ status: "stopped", reason: LOST_TO_ANOTHER });
    expect(agents.count.build).toBe(1);
    expect(agents.count.review).toBeUndefined();
    expect(gitIn(line.repo, "rev-parse", "main")).toBe(before);
  });

  it("does nothing different without the check", async () => {
    const { ctx, job } = runner();
    expect((await runJob(job.id, { ...ctx, runAgent: builder().runner })).status).toBe("delivered");
  });
});

describe("nothing goes to the origin of a job another machine has", () => {
  it("marks the three reasons as ended elsewhere, and no other", () => {
    const base = { status: "stopped" as const };
    expect(endedElsewhere({ ...base, reason: LOST_TO_ANOTHER })).toBe(true);
    expect(endedElsewhere({ ...base, reason: TAKEN_BY_ANOTHER })).toBe(true);
    expect(endedElsewhere({ status: "delivered", reason: endedOn("mac") })).toBe(true);
    expect(endedElsewhere({ ...base, reason: "Lo detuviste vos." })).toBe(false);
    expect(endedElsewhere({ status: "queued", reason: LOST_TO_ANOTHER })).toBe(false);
  });

  function issueSetup() {
    const repo = gitRepo();
    gitIn(repo, "remote", "add", "origin", "https://github.com/kaelen/demo.git");
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request", issues: { label: "zero" } }] });
    const comments: { number: number; body: string }[] = [];
    const api: IssueApi = {
      labeled: async () => [],
      unlabeled: async () => [],
      issue: async () => ({ state: "open", labels: ["zero"] }),
      lastLabeled: async () => undefined,
      permission: async () => "admin",
      comment: async (number, body) => void comments.push({ number, body }),
      comments: async () => [],
      ensureLabel: async () => false,
      createIssue: async () => ({ number: 0, url: "" }),
      addLabels: async () => {},
      close: async () => {},
    };
    const onIssue = (number: number) => {
      const { job } = requestWork(ctx, { text: `issue ${number}`, source: { kind: "github-issue", repository: "kaelen/demo", number, url: `https://github.com/kaelen/demo/issues/${number}` } });
      ctx.store.setKv(`issue:kaelen/demo#${number}`, JSON.stringify({ job: job.id, reported: "queued", labeledAt: "2030-01-01T00:00:00Z" }));
      return job;
    };
    return { ctx, api, comments, onIssue };
  }

  it("does not comment on the issue of a lost job or a copy finished elsewhere, but does on one stopped here", async () => {
    const { ctx, api, comments, onIssue } = issueSetup();
    const lost = onIssue(7);
    const elsewhere = onIssue(8);
    const stopped = onIssue(9);
    await finalizeJob(ctx, lost, "stopped", { reason: LOST_TO_ANOTHER });
    await finalizeJob(ctx, elsewhere, "failed", { reason: endedOn("mac") });
    await finalizeJob(ctx, stopped, "stopped", { reason: "Lo detuviste vos." });
    expect(report(ctx.store.getJob(lost.id)!)).toBeUndefined();
    await pollIssues(ctx, () => api);
    expect(comments.map((c) => c.number)).toEqual([9]);
  });
});
