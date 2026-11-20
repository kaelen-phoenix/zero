import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, requestWork } from "../src/app.js";
import type { AgentRequest, AgentRun } from "../src/agent.js";
import { mergeKey, pollMerges, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { prRefreshKey, type PrRefresh } from "../src/line/finish.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { renderTrace } from "../src/telemetry/tracer.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  return cleanup();
});

const URL = "https://github.com/kaelen/demo/pull/10";
const green: Check[] = [{ name: "check", done: true, ok: true }];
const RESOLVER = "# resolver\nResolve the conflicts.\n";
const FEEDBACK = /Mezclar origin\/main en la rama de este trabajo dio conflictos/;

type Handler = (req: AgentRequest<any>, n: number) => Partial<AgentRun<any>> | void | Promise<Partial<AgentRun<any>> | void>;

/**
 * A line with a bare remote that looks like GitHub and a job delivered as a pull request that changed
 * `shared.txt`; `conflict()` moves the base so that the next run merges it in conflict.
 */
async function delivered(opts: { agents?: unknown[]; files?: Record<string, string>; change?: Record<string, string> } = {}) {
  const bare = join(tempDir("zero-remote-"), "github.com", "kaelen", "demo.git").replace(/\\/g, "/");
  mkdirSync(bare, { recursive: true });
  run("git", ["init", "-q", "--bare", "-b", "main"], bare);
  const repo = gitRepo({ "shared.txt": "base\n", "README.md": "# demo\n", ...(opts.files ?? { ".zero/agents/resolver.md": RESOLVER }) });
  gitIn(repo, "remote", "add", "origin", bare);
  gitIn(repo, "push", "-q", "origin", "main");
  const other = tempDir("zero-other-");
  run("git", ["clone", "-q", "-c", "core.autocrlf=false", bare, "."], other);
  vi.stubEnv("GH_TOKEN", "test-token");

  const ctx = testFactory({
    level: "L2",
    isolation: "worktree",
    lines: [{ name: "demo", repo, integrate: "pull-request", autoMerge: true, maxAttempts: 3, verify: [`node -e "process.exit(0)"`], agents: opts.agents ?? [{ name: "resolver", type: "conflict" }] }],
  });
  const handlers: Record<string, Handler> = { build: (req) => void writeTree(req.cwd, opts.change ?? { "shared.txt": "job\n" }) };
  const agents = fakeAgents(new Proxy({}, { get: (_t, name: string) => (req: AgentRequest<any>, n: number) => handlers[name]?.(req, n) }));
  const deps: RunnerDeps = { ...ctx, runAgent: agents.runner, pullRequests: () => ({ openPullRequest: async () => URL }) };

  const { job } = requestWork(ctx, { text: "cambiá shared.txt" });
  let first = await runJob(job.id, deps);
  while (first.status === "waiting") {
    await answer(ctx, job.id, "approve");
    first = await runJob(job.id, deps);
  }
  expect(first).toMatchObject({ status: "delivered", attempt: 1 });
  expect(agents.count.resolver).toBeUndefined();
  const branch = `zero/${job.id}`;
  const remoteTip = () => run("git", ["rev-parse", `refs/heads/${branch}`], bare);
  const head = remoteTip();

  /** The base moves on GitHub and the merges pass takes the pull request back. */
  const conflict = async (file = "shared.txt", content = "theirs\n") => {
    gitIn(other, "checkout", "-q", "main");
    gitIn(other, "pull", "-q", "origin", "main");
    writeTree(other, { [file]: content });
    gitIn(other, "add", "-A");
    gitIn(other, "commit", "-q", "-m", `base: ${file}`);
    gitIn(other, "push", "-q", "origin", "main");
    const state = { pr: { open: true, merged: false, mergeable: false, headSha: head } as PullRequestState, checks: green };
    const gh: MergeApi = {
      pullRequest: async () => state.pr,
      checks: async () => state.checks,
      merge: async () => "merged-sha",
      deleteBranch: async () => {},
      comment: async () => {},
    };
    await pollMerges(ctx, () => gh);
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "queued" });
    expect((JSON.parse(ctx.store.getKv(mergeKey(job.id))!) as MergeState).resolving).toBe(head);
    return run("git", ["rev-parse", "refs/heads/main"], bare);
  };
  const again = (signal?: AbortSignal) => runJob(job.id, deps, signal);
  const mark = () => JSON.parse(ctx.store.getKv(prRefreshKey(job.id)) ?? "null") as PrRefresh | null;
  const contained = (rev: string, tip: string) => run("git", ["merge-base", "--is-ancestor", rev, tip], bare);
  const spans = (name: string) => ctx.store.spansForJob(job.id).filter((s) => s.name === name);
  return { ctx, repo, bare, job, head, remoteTip, conflict, again, mark, contained, spans, agents, handlers, on: (name: string, h: Handler) => void (handlers[name] = h) };
}

const resolves = (content = "resolved\n"): Handler => (req) => {
  writeTree(req.cwd, { "shared.txt": content });
  return { output: { files: [{ path: "shared.txt", status: "resolved", reason: "" }], summary: "ok" } };
};
const returns: Handler = (req) => {
  writeTree(req.cwd, { "shared.txt": "half\n" });
  return { output: { files: [{ path: "shared.txt", status: "returned", reason: "both sides rewrite the same line" }], summary: "no" } };
};
const inMerge = (cwd: string) => existsSync(resolve(cwd, gitIn(cwd, "rev-parse", "--git-path", "MERGE_HEAD")));
const hasMarkers = (cwd: string) => readFileSync(join(cwd, "shared.txt"), "utf8").includes("<<<<<<<");
const buildPrompts = (f: Awaited<ReturnType<typeof delivered>>) => f.agents.calls.filter((c) => c.station === "build" && !c.custom).map((c) => c.prompt);

describe("a conflict agent", () => {
  it("gets the request, the spec, the conflict blocks and the base commits, and its resolution resumes at verify", async () => {
    const f = await delivered();
    const marks: PrRefresh[] = [];
    const setKv = f.ctx.store.setKv.bind(f.ctx.store);
    vi.spyOn(f.ctx.store, "setKv").mockImplementation((key, value) => {
      if (key === prRefreshKey(f.job.id)) marks.push(JSON.parse(value) as PrRefresh);
      return setKv(key, value);
    });
    const builds = f.agents.count.build;
    const reviews = f.agents.count.review!;
    const base = await f.conflict();
    let seen: AgentRequest<any> | undefined;
    f.on("resolver", (req, n) => {
      seen = req;
      expect(inMerge(req.cwd)).toBe(true);
      expect(readFileSync(join(req.cwd, "shared.txt"), "utf8")).toMatch(/^<{7}[^\n]*\njob\n\|{7}[^\n]*\nbase\n={7}\ntheirs\n>{7}/m);
      return resolves()(req, n);
    });
    f.on("build", () => {
      throw new Error("build must not be called");
    });

    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 1 });
    expect(marks.at(-1)).toMatchObject({ resolved: true, head: f.head, paths: ["shared.txt"] });
    expect(f.agents.count.resolver).toBe(1);
    expect(f.agents.count.build).toBe(builds);
    expect(f.agents.count.review).toBe(reviews + 1);
    expect(seen).toMatchObject({ station: "build", custom: { name: "resolver", access: "write" } });
    expect(seen!.schema).toBeDefined();
    const spec = f.ctx.store.getJob(f.job.id)!.spec as { title: string };
    expect(seen!.prompt).toContain("cambiá shared.txt");
    expect(seen!.prompt).toContain(spec.title);
    expect(seen!.prompt).toContain("shared.txt");
    expect(seen!.prompt).toMatch(/<<<<<<<[^\n]*\njob\n\|{7}[^\n]*\nbase\n=======\ntheirs\n>>>>>>>/);
    expect(seen!.prompt).toMatch(/between `\|{7}` and `=======`, the common base: the version before either side changed it/);
    expect(seen!.prompt).toContain("base: shared.txt");

    const [span] = f.spans("zero.station.resolver");
    expect(span).toMatchObject({ status: "ok", attrs: { "zero.agent.type": "conflict", "zero.conflicts.files": 1, "zero.conflicts.resolved": 1, "zero.conflicts.outcome": "resolved" } });
    expect(span!.parentId).toBe(f.ctx.tracer.jobSpanId(f.job.id));
    expect(renderTrace(f.ctx.store.spansForJob(f.job.id))).toMatch(/zero\.station\.resolver .*conflictos: resolved/);

    const tip = f.remoteTip();
    f.contained(base, tip);
    f.contained(f.head, tip);
    expect(run("git", ["rev-list", "--parents", "-n", "1", tip], f.bare).split(" ")).toHaveLength(3);
    expect(run("git", ["show", `${tip}:shared.txt`], f.bare)).toBe("resolved");
  });

  it("is not called when the conflict is simple", async () => {
    const f = await delivered({ change: { "shared.txt": `import { a } from "./a.js";\nbase\n` } });
    await f.conflict("shared.txt", `import { b } from "./b.js";\nbase\n`);
    f.on("resolver", () => {
      throw new Error("the conflict agent must not be called");
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 1 });
    expect(f.agents.count.resolver).toBeUndefined();
    expect(f.spans("zero.conflicts.simple")).toHaveLength(1);
  });

  it("hands the next agent a merge started again from the head when the first returns a file", async () => {
    const f = await delivered({
      agents: [
        { name: "resolver", type: "conflict" },
        { name: "second", type: "conflict" },
      ],
      files: { ".zero/agents/resolver.md": RESOLVER, ".zero/agents/second.md": "# second\n" },
    });
    const builds = f.agents.count.build;
    await f.conflict();
    f.on("resolver", returns);
    f.on("second", (req, n) => {
      expect(inMerge(req.cwd)).toBe(true);
      expect(hasMarkers(req.cwd)).toBe(true);
      expect(readFileSync(join(req.cwd, "shared.txt"), "utf8")).not.toContain("half");
      return resolves("second\n")(req, n);
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 1 });
    expect(f.agents.calls.map((c) => c.custom?.name).filter(Boolean)).toEqual(["resolver", "second"]);
    expect(f.agents.count.build).toBe(builds);
    expect(run("git", ["show", `${f.remoteTip()}:shared.txt`], f.bare)).toBe("second");
    expect(f.spans("zero.station.resolver")[0]!.attrs).toMatchObject({ "zero.conflicts.outcome": "returned", "zero.conflicts.returned": 1 });
    expect(f.spans("zero.station.second")[0]!.attrs).toMatchObject({ "zero.conflicts.outcome": "resolved" });
  });
});

describe("falling back to build", () => {
  /** Build resolves the conflict, checking that it starts from the merge redone at the head, without the agent's work. */
  const buildResolves = (f: Awaited<ReturnType<typeof delivered>>) =>
    f.on("build", (req) => {
      expect(inMerge(req.cwd)).toBe(true);
      expect(hasMarkers(req.cwd)).toBe(true);
      expect(gitIn(req.cwd, "rev-parse", "HEAD")).toBe(f.head);
      writeTree(req.cwd, { "shared.txt": "built\n" });
    });

  const fallsBack = async (f: Awaited<ReturnType<typeof delivered>>, outcome: string) => {
    const base = await f.conflict();
    buildResolves(f);
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2 });
    expect(buildPrompts(f).at(-1)).toMatch(FEEDBACK);
    f.contained(base, f.remoteTip());
    expect(run("git", ["show", `${f.remoteTip()}:shared.txt`], f.bare)).toBe("built");
    if (outcome) expect(f.spans("zero.station.resolver")[0]!.attrs).toMatchObject({ "zero.agent.type": "conflict", "zero.conflicts.outcome": outcome });
  };

  it("works as before without a conflict agent", async () => {
    const f = await delivered({ agents: [] });
    await fallsBack(f, "");
    expect(f.ctx.store.spansForJob(f.job.id).some((s) => s.attrs["zero.agent.type"] === "conflict")).toBe(false);
  });

  it("goes to build when the agent returns a file", async () => {
    const f = await delivered();
    f.on("resolver", returns);
    await fallsBack(f, "returned");
  });

  it("goes to build when the agent fails, discarding its changes", async () => {
    const f = await delivered();
    f.on("resolver", (req) => {
      writeTree(req.cwd, { "shared.txt": "broken\n", "stray.txt": "x\n" });
      return { ok: false, text: "crashed" };
    });
    await fallsBack(f, "failed");
    expect(run("git", ["ls-tree", "-r", "--name-only", f.remoteTip()], f.bare)).not.toContain("stray.txt");
  });

  it("goes to build when the agent gives no valid output", async () => {
    const f = await delivered();
    f.on("resolver", (req) => void writeTree(req.cwd, { "shared.txt": "resolved\n" }));
    await fallsBack(f, "invalid");
  });

  it("goes to build when the agent leaves markers", async () => {
    const f = await delivered();
    f.on("resolver", (req) => {
      writeTree(req.cwd, { "shared.txt": "<<<<<<< HEAD\njob\n=======\ntheirs\n>>>>>>> origin/main\n" });
      return { output: { files: [{ path: "shared.txt", status: "resolved", reason: "" }], summary: "ok" } };
    });
    await fallsBack(f, "invalid");
    expect(f.spans("zero.station.resolver")[0]!.attrs["zero.conflicts.reason"]).toMatch(/marcadores/);
  });

  it("goes to build when the agent leaves the base marker", async () => {
    const f = await delivered();
    f.on("resolver", (req) => {
      writeTree(req.cwd, { "shared.txt": "job\n||||||| base\nbase\ntheirs\n" });
      return { output: { files: [{ path: "shared.txt", status: "resolved", reason: "" }], summary: "ok" } };
    });
    await fallsBack(f, "invalid");
    expect(f.spans("zero.station.resolver")[0]!.attrs["zero.conflicts.reason"]).toMatch(/marcadores/);
  });

  it("goes to build when the agent aborts the merge", async () => {
    const f = await delivered();
    f.on("resolver", (req) => {
      gitIn(req.cwd, "merge", "--abort");
      writeTree(req.cwd, { "shared.txt": "mine\n" });
      return { output: { files: [{ path: "shared.txt", status: "resolved", reason: "" }], summary: "ok" } };
    });
    await fallsBack(f, "invalid");
    expect(f.spans("zero.station.resolver")[0]!.attrs["zero.conflicts.reason"]).toMatch(/no contiene/);
  });

  it("skips an agent whose instructions are missing", async () => {
    const f = await delivered({ files: {} });
    await fallsBack(f, "");
    expect(f.agents.count.resolver).toBeUndefined();
    const [skipped] = f.spans("zero.station.resolver");
    expect(skipped!.attrs).toMatchObject({ "zero.skipped": true, "zero.instructions.missing": expect.stringContaining("resolver.md") });
  });

  it("resumes at build when the job is interrupted during the agent's call", async () => {
    const f = await delivered();
    await f.conflict();
    const controller = new AbortController();
    f.on("resolver", (req) => {
      writeTree(req.cwd, { "shared.txt": "partial\n" });
      controller.abort("shutdown");
    });
    expect(await f.again(controller.signal)).toMatchObject({ status: "queued" });
    expect(f.mark()).toMatchObject({ started: true, paths: ["shared.txt"] });
    expect(f.mark()!.resolved).toBeUndefined();
    buildResolves(f);
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2 });
    expect(f.agents.count.resolver).toBe(1);
    expect(buildPrompts(f).at(-1)).toMatch(FEEDBACK);
  });

  it("still stops the job when stopped during the agent's call", async () => {
    const f = await delivered();
    await f.conflict();
    const controller = new AbortController();
    f.on("resolver", () => void controller.abort("stop"));
    const stopped = await f.again(controller.signal);
    // A stopped update goes back to the delivered pull request, with the branch at its head.
    expect(stopped.status).toBe("delivered");
    expect(f.agents.count.resolver).toBe(1);
    expect(run("git", ["rev-parse", `refs/heads/zero/${f.job.id}`], f.repo)).toBe(f.head);
  });
});

describe("the trace", () => {
  it("shows a conflict agent's outcome", () => {
    const out = renderTrace([
      { id: "s1", name: "zero.station.resolver", start: "2026-11-19T10:00:00.000Z", end: "2026-11-19T10:00:05.000Z", status: "ok", attrs: { "zero.agent.type": "conflict", "zero.conflicts.files": 1, "zero.conflicts.resolved": 0, "zero.conflicts.returned": 1, "zero.conflicts.outcome": "returned", "zero.conflicts.reason": "shared.txt: both sides" } },
    ]);
    expect(out).toContain("conflictos");
    expect(out).toContain("returned");
    expect(out).toContain("1 devueltos");
  });
});
