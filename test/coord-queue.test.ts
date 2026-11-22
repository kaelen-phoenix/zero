import { afterEach, describe, expect, it } from "vitest";
import { currentBox, requestWork } from "../src/app.js";
import { coordPass, PROBE_KEY } from "../src/coord/pass.js";
import { claimJob, claimRef, memoryCoord, queueRef, releaseJob } from "../src/coord/protocol.js";
import { canTake, primaryEngines, queuedKey, readQueued, sourceKey } from "../src/coord/queue.js";
import { runDaemon } from "../src/daemon.js";
import { endedOn, TAKEN_BY_ANOTHER } from "../src/line/finish.js";
import { machineIdentity } from "../src/machine.js";
import { cleanup, fakeAgents, gitRepo, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const REPOSITORY = "me/zero-coord";
const passes = `node -e "process.exit(0)"`;

/** A factory of the distributed test, with its probe passed unless told otherwise. */
function factory(machine: string, over: Record<string, unknown> = {}) {
  const ctx = testFactory({ level: "L2", isolation: "worktree", distributed: { repository: REPOSITORY, machine }, lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }], ...over });
  ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: new Date().toISOString(), ok: true }));
  return ctx;
}

const builder = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${Math.random().toString(36).slice(2)}.ts`]: "ok" }) });

/** A record another machine left on the shared queue. */
function queued(api: ReturnType<typeof memoryCoord>, id: string, over: Record<string, unknown> = {}) {
  const record = { id, line: "demo", kind: "request", request: "hacer algo", priority: "media", createdAt: new Date().toISOString(), needs: { box: false, engines: ["claude"] }, ...over };
  api.refs.set(queueRef(id), { name: queueRef(id), sha: "d".repeat(40), data: JSON.stringify(record) });
}

const pass = (ctx: ReturnType<typeof factory>, api: ReturnType<typeof memoryCoord>) => coordPass(ctx, api, undefined, new Date());

describe("the shared queue", () => {
  it("publishes a queued job without local paths, and the other machine imports it with the same id", async () => {
    const api = memoryCoord();
    const a = factory("pc-a");
    const b = factory("pc-b");
    const repo = a.config.lines[0]!.repo;
    const { job } = requestWork(a, { text: `Arreglar ${repo}/src/x.ts` });
    await pass(a, api);
    await pass(b, api);
    const published = api.refs.get(queueRef(job.id))!.data;
    expect(published).not.toContain(repo);
    expect(JSON.parse(published)).toMatchObject({ id: job.id, line: "demo", kind: "request", needs: { box: false, engines: primaryEngines(a.config) } });
    const there = b.store.getJob(job.id)!;
    expect(there).toMatchObject({ id: job.id, line: "demo", status: "queued", request: JSON.parse(published).request, createdAt: job.createdAt });
    expect(readQueued(b.store, job.id)?.origin).toBe("imported");
    expect(readQueued(a.store, job.id)?.origin).toBe("published");
    // Published once: a second pass creates nothing.
    const creates = api.calls.filter((c) => c === `create ${queueRef(job.id)}`).length;
    await pass(a, api);
    await pass(b, api);
    expect(api.calls.filter((c) => c === `create ${queueRef(job.id)}`).length).toBe(creates);
  });

  it("drops broken records and ids out of [A-Za-z0-9-] without creating jobs or failing", async () => {
    const api = memoryCoord();
    const b = factory("pc-b");
    api.refs.set(queueRef("roto"), { name: queueRef("roto"), sha: "1".repeat(40), data: "{no es json" });
    queued(api, "mal_id!");
    queued(api, "otro-id", { id: "distinto" });
    queued(api, "sin-necesidades", { needs: undefined });
    await expect(pass(b, api)).resolves.toBeDefined();
    expect(b.store.listJobs({})).toEqual([]);
  });

  it("does not import a job of a line this machine lacks, and fails nothing", async () => {
    const api = memoryCoord();
    const b = factory("pc-b");
    queued(api, "abc123", { line: "otra-linea" });
    await pass(b, api);
    expect(b.store.getJob("abc123")).toBeUndefined();
    expect(b.store.listJobs({ status: ["failed"] })).toEqual([]);
  });

  it("does not import a job that already ended on another machine", async () => {
    const api = memoryCoord();
    const b = factory("pc-b");
    queued(api, "abc123");
    api.refs.set(claimRef("abc123"), { name: claimRef("abc123"), sha: "2".repeat(40), data: JSON.stringify({ job: "abc123", machine: "otra", name: "mac", at: new Date().toISOString(), released: true, status: "delivered" }) });
    await pass(b, api);
    expect(b.store.getJob("abc123")).toBeUndefined();
  });

  it("does nothing with the queue while the probe has not passed", async () => {
    const api = memoryCoord();
    const a = factory("pc-a");
    a.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: new Date().toISOString(), ok: false, problem: "x" }));
    const { job } = requestWork(a, { text: "x" });
    await pass(a, api);
    expect(api.calls.filter((c) => /\b(claims|queue|sources)\//.test(c))).toEqual([]);
    expect(a.store.getKv(queuedKey(job.id))).toBeUndefined();
  });
});

describe("one request, one job", () => {
  const issue = (ctx: ReturnType<typeof factory>) => {
    const { job } = requestWork(ctx, { text: "Issue #7", source: { kind: "github-issue", repository: "kaelen/demo", number: 7, url: "https://github.com/kaelen/demo/issues/7" } });
    ctx.store.setKv("issue:kaelen/demo#7", JSON.stringify({ job: job.id, reported: "queued", labeledAt: "2030-01-01T00:00:00Z" }));
    return job;
  };

  it("leaves the same issue on the queue once, and the second machine's job ends as a duplicate pointing its issue to the first", async () => {
    const api = memoryCoord();
    const a = factory("pc-a");
    const b = factory("pc-b");
    const first = issue(a);
    const second = issue(b);
    await pass(a, api);
    await pass(b, api);
    expect([...api.refs.keys()].filter((k) => k.startsWith("queue/"))).toEqual([queueRef(first.id)]);
    expect(b.store.getJob(second.id)).toMatchObject({ status: "stopped", reason: TAKEN_BY_ANOTHER });
    expect(JSON.parse(b.store.getKv("issue:kaelen/demo#7")!).job).toBe(first.id);
    expect(b.store.getJob(first.id)?.status).toBe("queued");
    expect(a.store.getJob(first.id)?.status).toBe("queued");
  });

  it("keys the same origin alike on every machine, whatever the job", () => {
    const source = { kind: "github-issue" as const, repository: "Kaelen/Demo", number: 7, url: "u" };
    expect(sourceKey(source, "a1")).toBe(sourceKey({ ...source, repository: "kaelen/demo" }, "b2"));
    expect(sourceKey(source, "a1")).toMatch(/^github-issue-[0-9a-f]{32}$/);
    const pkg = { kind: "package" as const, package: "p", station: "s" };
    expect(sourceKey(pkg, "a1")).not.toBe(sourceKey(pkg, "b2"));
  });
});

describe("only what the machine can do", () => {
  it("compares the box and every engine", () => {
    const config = factory("pc-b").config;
    expect(canTake({ box: false, engines: ["claude"] }, config, false)).toBe(true);
    expect(canTake({ box: true, engines: ["claude"] }, config, false)).toBe(false);
    expect(canTake({ box: true, engines: ["claude"] }, config, true)).toBe(true);
    expect(canTake({ box: false, engines: ["codex"] }, config, true)).toBe(false);
  });

  it("does not claim an imported job that needs a box this machine lacks", async () => {
    const api = memoryCoord();
    const b = factory("pc-b");
    queued(api, "caja1", { needs: { box: true, engines: ["claude"] } });
    await pass(b, api);
    expect(currentBox(b).availability.ready).toBe(false);
    const agents = builder();
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api });
    expect(api.calls.filter((c) => c.endsWith(claimRef("caja1")))).toEqual([]);
    expect(agents.calls).toEqual([]);
    expect(b.store.getJob("caja1")?.status).toBe("queued");
  });

  it("does not claim an imported job that needs an engine this machine does not declare", async () => {
    const api = memoryCoord();
    const b = factory("pc-b", { engine: "claude" });
    queued(api, "motor1", { needs: { box: false, engines: ["codex"] } });
    await pass(b, api);
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => builder().runner, coord: () => api });
    expect(api.calls.filter((c) => c.endsWith(claimRef("motor1")))).toEqual([]);
    expect(b.store.getJob("motor1")?.status).toBe("queued");
  });

  it("takes and runs an imported job it can do", async () => {
    const api = memoryCoord();
    const b = factory("pc-b");
    queued(api, "puede1");
    await pass(b, api);
    await runDaemon(b, { once: true, pollMs: 10, agentRunner: () => builder().runner, coord: () => api });
    expect(b.store.getJob("puede1")?.status).toBe("delivered");
  });
});

describe("finished on another machine", () => {
  it("ends the local copy with the other machine's status and runs no station", async () => {
    const api = memoryCoord();
    const a = factory("pc-a");
    const { job } = requestWork(a, { text: "x" });
    await pass(a, api);
    const other = { id: "otra", name: "mac" };
    expect((await claimJob(api, job.id, other, new Date())).claimed).toBe(true);
    expect(await releaseJob(api, job.id, other, "delivered", new Date())).toBe(true);
    await pass(a, api);
    expect(a.store.getJob(job.id)).toMatchObject({ status: "delivered", reason: endedOn("mac") });
  });

  it("ends it too when the daemon meets the closing record while claiming", async () => {
    const api = memoryCoord();
    const a = factory("pc-a");
    const { job } = requestWork(a, { text: "x" });
    const other = { id: "otra", name: "mac" };
    await claimJob(api, job.id, other, new Date());
    await releaseJob(api, job.id, other, "failed", new Date());
    const agents = builder();
    await runDaemon(a, { once: true, pollMs: 10, agentRunner: () => agents.runner, coord: () => api });
    expect(agents.calls).toEqual([]);
    expect(a.store.getJob(job.id)).toMatchObject({ status: "failed", reason: endedOn("mac") });
  });

  it("claims over a closing record unless asked to keep finished ones", async () => {
    const api = memoryCoord();
    const other = { id: "otra", name: "mac" };
    const me = { id: "yo", name: "pc" };
    await claimJob(api, "j1", other, new Date());
    await releaseJob(api, "j1", other, "delivered", new Date());
    expect(await claimJob(api, "j1", me, new Date(), 10, { keepFinished: true })).toMatchObject({ claimed: false, holder: { machine: "otra", released: true } });
    expect((await claimJob(api, "j1", me, new Date())).claimed).toBe(true);
  });
});

describe("two daemons at once", () => {
  it("runs a shared job on exactly one of the two machines", async () => {
    const api = memoryCoord();
    const a = factory("pc-a");
    const b = factory("pc-b");
    const { job } = requestWork(a, { text: "x" });
    await pass(a, api);
    await pass(b, api);
    expect(b.store.getJob(job.id)?.status).toBe("queued");
    const agentsA = builder();
    const agentsB = builder();
    await Promise.all([
      runDaemon(a, { once: true, pollMs: 10, agentRunner: () => agentsA.runner, coord: () => api }),
      runDaemon(b, { once: true, pollMs: 10, agentRunner: () => agentsB.runner, coord: () => api }),
    ]);
    expect((agentsA.count.spec ?? 0) + (agentsB.count.spec ?? 0)).toBe(1);
    const ids = [machineIdentity(a.store, a.config).id, machineIdentity(b.store, b.config).id];
    expect(ids).toContain(JSON.parse(api.refs.get(claimRef(job.id))!.data).machine);
  });
});
