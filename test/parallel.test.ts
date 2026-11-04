import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRequest, AgentRun, AgentRunner } from "../src/agent.js";
import { answer, requestWork, type FactoryContext } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { declaredPaths, mayStart, patternsOverlap, undeclaredFiles } from "../src/line/parallel.js";
import { runJob } from "../src/line/runner.js";
import type { Job, JobSource } from "../src/state/store.js";
import { renderTrace } from "../src/telemetry/tracer.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, simulatedBox, tempDir, testFactory, validSpec, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("pattern overlap", () => {
  it("only rules an overlap out on a differing literal segment", () => {
    expect(patternsOverlap("src/a/**", "src/b/**")).toBe(false);
    expect(patternsOverlap("src/a.ts", "src/b.ts")).toBe(false);
    expect(patternsOverlap("./docs/", "src/**")).toBe(false);
    for (const [a, b] of [
      ["src/**", "src/a.ts"],
      ["src/", "SRC/a.ts"],
      ["src\\a", "src/a/b.ts"],
      ["src/*.ts", "src/a.ts"],
      ["**/*.ts", "docs/x.md"],
      ["../x", "docs/x.md"],
      ["src/../docs", "docs/x.md"],
      ["/etc/x", "docs/x.md"],
      ["C:/x", "docs/x.md"],
      ["", "docs/x.md"],
      ["src/{a,b}/x", "src/c/y"],
    ] as const) {
      expect(patternsOverlap(a, b), `${a} / ${b}`).toBe(true);
      expect(patternsOverlap(b, a), `${b} / ${a}`).toBe(true);
    }
  });

  it("lists the changed files outside the declared patterns", () => {
    expect(undeclaredFiles(["src/a/x.ts", "SRC/a/y.ts", "docs/x.md", "b.md", "c.ts"], ["src/a/**", "docs/x.md", "*.ts"])).toEqual(["b.md"]);
    expect(undeclaredFiles(["src/a/x.ts"], ["src/a/"])).toEqual([]);
    expect(undeclaredFiles(["a"], [])).toEqual(["a"]);
  });

  it("treats an older spec as having declared nothing", () => {
    expect(declaredPaths({})).toBeUndefined();
    expect(declaredPaths({ spec: { title: "old" } })).toEqual([]);
    expect(declaredPaths({ spec: validSpec({ paths: ["a"] }) })).toEqual(["a"]);
  });
});

describe("whether a job may start", () => {
  const job = (paths?: string[], source?: JobSource) => ({ id: "j", ...(paths && { spec: validSpec({ paths }) }), ...(source && { source }) }) as unknown as Job;
  const auto: JobSource = { kind: "night-shift", proposal: "p", autonomy: "auto" };

  it("respects the line's limit", () => {
    expect(mayStart(job(["a"]), [], 1)).toBe(true);
    expect(mayStart(job(["a"]), [job(["b"])], 1)).toBe(false);
    expect(mayStart(job(), [job(["b"])], 1)).toBe(false);
    expect(mayStart(job(["a"]), [job(["b"])], 2)).toBe(true);
    expect(mayStart(job(["c"]), [job(["a"]), job(["b"])], 2)).toBe(false);
  });

  it("keeps overlapping jobs apart, but lets a job without a spec read", () => {
    expect(mayStart(job(["src/**"]), [job(["src/a.ts"])], 2)).toBe(false);
    expect(mayStart(job(), [job(["src/a.ts"])], 2)).toBe(true);
    expect(mayStart(job(["src/a.ts"]), [job()], 2)).toBe(true);
  });

  it("lets a job that declared nothing run alone", () => {
    expect(mayStart(job([]), [job(["a"])], 2)).toBe(false);
    expect(mayStart(job([]), [job()], 2)).toBe(false);
    expect(mayStart(job(["a"]), [job([])], 2)).toBe(false);
    expect(mayStart(job(), [job([])], 2)).toBe(false);
    expect(mayStart(job([]), [], 2)).toBe(true);
  });

  it("gives the line to the night shift's own jobs", () => {
    expect(mayStart(job(["a"]), [job(["b"], auto)], 2)).toBe(false);
    expect(mayStart(job(), [job(["b"], auto)], 2)).toBe(false);
    expect(mayStart(job(["a"], auto), [job(["b"])], 2)).toBe(false);
    expect(mayStart(job(["a"], auto), [], 2)).toBe(true);
  });
});

describe("the parallel option", () => {
  const yaml = (extra: string) => `version: 1\nlines:\n  - name: demo\n    repo: /tmp/demo\n${extra}`;
  it("defaults to one and refuses less", () => {
    expect(parseFactory(yaml("")).lines[0]!.parallel).toBe(1);
    expect(parseFactory(yaml("    parallel: 3\n")).lines[0]!.parallel).toBe(3);
    expect(() => parseFactory(yaml("    parallel: 0\n"))).toThrow();
  });
});

/** Every agent call's time in the air, by job and station. */
function timed(inner: AgentRunner) {
  const calls: { job: string; station: string; start: number; end: number }[] = [];
  const runner: AgentRunner = async <T>(req: AgentRequest<T>): Promise<AgentRun<T>> => {
    const call = { job: req.trace!.jobId!, station: req.station, start: performance.now(), end: Infinity };
    calls.push(call);
    try {
      return await inner(req);
    } finally {
      call.end = performance.now();
    }
  };
  const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
  return { runner, calls, overlap };
}

/** A line that runs jobs together; each job declares what its request text says, and builds a file of its own. */
function parallelLine(over: { parallel?: number; concurrency?: number; pathsOf: Record<string, string[]>; onBuild?: (name: string, jobId: string) => Promise<void> | void; onSpec?: (name: string) => void }) {
  const repo = gitRepo();
  const ctx = testFactory({ level: "L2", isolation: "worktree", concurrency: over.concurrency ?? 2, lines: [{ name: "demo", repo, verify: [passes], parallel: over.parallel ?? 2 }] });
  const nameOf = (req: AgentRequest<any>) => Object.keys(over.pathsOf).find((n) => req.prompt.includes(`<<${n}>>`))!;
  const agents = fakeAgents({
    spec: (req) => {
      over.onSpec?.(nameOf(req));
      return { output: validSpec({ paths: over.pathsOf[nameOf(req)]! }) };
    },
    build: async (req) => {
      const name = nameOf(req);
      await over.onBuild?.(name, req.trace!.jobId!);
      writeTree(req.cwd, { [`out/${name}.txt`]: name });
    },
  });
  const clock = timed(agents.runner);
  const go = () => runDaemon(ctx, { once: true, pollMs: 5, agentRunner: () => clock.runner });
  return { repo, ctx, agents, clock, go };
}

const ask = (ctx: FactoryContext, name: string) => requestWork(ctx, { text: `<<${name}>>` }).job;

describe("jobs of a line running together", () => {
  it("builds two disjoint jobs at the same time and delivers both on the base", async () => {
    const started = new Set<string>();
    const { repo, ctx, go, clock } = parallelLine({
      pathsOf: { a: ["src/a/**"], b: ["src/b/**"] },
      onBuild: async (name) => {
        started.add(name);
        // Each build waits until the other one started; alone, this times out.
        for (let i = 0; i < 1000 && started.size < 2; i++) await sleep(5);
        if (started.size < 2) throw new Error("the other build never started");
      },
    });
    const a = ask(ctx, "a");
    const b = ask(ctx, "b");
    await go();
    expect(ctx.store.getJob(a.id)).toMatchObject({ status: "delivered", attempt: 1 });
    expect(ctx.store.getJob(b.id)).toMatchObject({ status: "delivered", attempt: 1 });
    expect(ctx.store.getJob(a.id)!.spec).toMatchObject({ paths: ["src/a/**"] });
    const [ba, bb] = [a, b].map((j) => clock.calls.find((c) => c.job === j.id && c.station === "build")!);
    expect(clock.overlap(ba!, bb!)).toBe(true);
    expect(readFileSync(join(repo, "out/a.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(repo, "out/b.txt"), "utf8")).toBe("b");
  });

  it("never builds overlapping jobs at the same time", async () => {
    const { ctx, go, clock } = parallelLine({ pathsOf: { a: ["src/**"], b: ["src/a.ts"] }, onBuild: () => sleep(50) });
    const a = ask(ctx, "a");
    const b = ask(ctx, "b");
    await go();
    expect(ctx.store.getJob(a.id)!.status).toBe("delivered");
    expect(ctx.store.getJob(b.id)!.status).toBe("delivered");
    const builds = clock.calls.filter((c) => c.station === "build");
    expect(builds).toHaveLength(2);
    expect(clock.overlap(builds[0]!, builds[1]!)).toBe(false);
  });

  it("lets a job that declared nothing build with the line to itself", async () => {
    const { ctx, go, clock } = parallelLine({ pathsOf: { a: [], b: ["src/b/**"] }, onBuild: () => sleep(50) });
    const a = ask(ctx, "a");
    const b = ask(ctx, "b");
    await go();
    expect(ctx.store.getJob(a.id)!.status).toBe("delivered");
    expect(ctx.store.getJob(b.id)!.status).toBe("delivered");
    const alone = clock.calls.find((c) => c.job === a.id && c.station === "build")!;
    for (const other of clock.calls.filter((c) => c.job === b.id)) expect(clock.overlap(alone, other)).toBe(false);
  });

  it("still respects the factory's concurrency", async () => {
    const { ctx, go, clock } = parallelLine({ parallel: 3, concurrency: 1, pathsOf: { a: ["src/a/**"], b: ["src/b/**"] }, onBuild: () => sleep(30) });
    const a = ask(ctx, "a");
    const b = ask(ctx, "b");
    await go();
    expect(ctx.store.getJob(a.id)!.status).toBe("delivered");
    expect(ctx.store.getJob(b.id)!.status).toBe("delivered");
    const builds = clock.calls.filter((c) => c.station === "build");
    expect(clock.overlap(builds[0]!, builds[1]!)).toBe(false);
  });

  it("runs a new job's spec while another job builds", async () => {
    let specOfB = false;
    const { ctx, go } = parallelLine({
      pathsOf: { a: ["src/a/**"], b: ["src/b/**"] },
      onSpec: (name) => void (name === "b" && (specOfB = true)),
      onBuild: async (name) => {
        if (name !== "a") return;
        ask(ctx, "b");
        for (let i = 0; i < 1000 && !specOfB; i++) await sleep(5);
        if (!specOfB) throw new Error("spec of b did not run during the build of a");
      },
    });
    const a = ask(ctx, "a");
    await go();
    expect(ctx.store.getJob(a.id)).toMatchObject({ status: "delivered", attempt: 1 });
    expect(ctx.store.listJobs({ status: ["delivered"] })).toHaveLength(2);
  });

  it("goes back to the queue after spec, with no build", async () => {
    const { ctx, agents } = parallelLine({ pathsOf: { a: ["src/a/**"] } });
    const a = ask(ctx, "a");
    const back = await runJob(a.id, { ...ctx, runAgent: agents.runner });
    expect(back).toMatchObject({ status: "queued", checkpoint: "spec" });
    expect(back.spec).toMatchObject({ paths: ["src/a/**"] });
    expect(agents.count.build).toBeUndefined();
  });

  it("stays in the same run with parallel 1", async () => {
    const repo = gitRepo();
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, verify: [passes] }] });
    const agents = fakeAgents({ build: (req) => writeTree(req.cwd, { "x.txt": "x" }) });
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
  });

  describe("with the night shift's own jobs", () => {
    const autonomousJob = (ctx: FactoryContext, name: string) => ctx.store.createJob({ line: "demo", kind: "request", request: `<<${name}>>`, budgetUsd: 3, source: { kind: "night-shift", proposal: name, autonomy: "auto" } });

    it("makes the owner's job wait until the autonomous one finished", async () => {
      let owner: Job | undefined;
      const { ctx, go, clock } = parallelLine({
        pathsOf: { night: ["src/a/**"], owner: ["src/b/**"] },
        onBuild: async (name) => {
          if (name !== "night") return;
          owner = ask(ctx, "owner");
          await sleep(60);
        },
      });
      const night = autonomousJob(ctx, "night");
      await go();
      expect(ctx.store.getJob(night.id)!.status).toBe("delivered");
      expect(ctx.store.getJob(owner!.id)!.status).toBe("delivered");
      const lastOfNight = Math.max(...clock.calls.filter((c) => c.job === night.id).map((c) => c.end));
      expect(Math.min(...clock.calls.filter((c) => c.job === owner!.id).map((c) => c.start))).toBeGreaterThanOrEqual(lastOfNight);
    });

    it("runs two of them one after the other", async () => {
      const { ctx, go, clock } = parallelLine({ pathsOf: { x: ["src/a/**"], y: ["src/b/**"] }, onBuild: () => sleep(20) });
      const x = autonomousJob(ctx, "x");
      const y = autonomousJob(ctx, "y");
      await go();
      expect(ctx.store.getJob(x.id)!.status).toBe("delivered");
      expect(ctx.store.getJob(y.id)!.status).toBe("delivered");
      for (const a of clock.calls.filter((c) => c.job === x.id)) for (const b of clock.calls.filter((c) => c.job === y.id)) expect(clock.overlap(a, b)).toBe(false);
    });
  });
});

const commitOnBase = (repo: string, files: Record<string, string>) => {
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "moved on");
  return gitIn(repo, "rev-parse", "HEAD");
};
const contains = (repo: string, commit: string, branch: string) => gitIn(repo, "branch", "--contains", commit, "--format=%(refname:short)").split("\n").includes(branch);
const verifyRuns = (ctx: FactoryContext, id: string) => ctx.store.spansForJob(id).filter((s) => s.name === "zero.verify.command").length;
const spanOf = (ctx: FactoryContext, id: string, name: string) => ctx.store.spansForJob(id).find((s) => s.name === name)!;

function line(opts: { level?: string; integrate?: string; maxAttempts?: number; verify?: string[]; files?: Record<string, string>; isolation?: string; setup?: string[] } = {}) {
  const repo = gitRepo(opts.files ?? { "src/a.ts": "base\n" });
  const ctx = testFactory({
    level: opts.level ?? "L2",
    isolation: opts.isolation ?? "worktree",
    lines: [{ name: "demo", repo, verify: opts.verify ?? [passes], integrate: opts.integrate ?? "merge", maxAttempts: opts.maxAttempts ?? 3, setup: opts.setup ?? [] }],
  });
  return { repo, ctx };
}

describe("updating from the base before integrating", () => {
  it("merges a moved base as a signed factory commit and verifies again", async () => {
    const { repo, ctx } = line();
    let moved = "";
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        moved = commitOnBase(repo, { "other.txt": "other\n" });
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 1 });
    expect(contains(repo, moved, `zero/${job.id}`)).toBe(true);
    const update = gitIn(repo, "log", "-1", "--merges", "--format=%cn%n%B", `zero/${job.id}`);
    expect(update).toContain("zero\n");
    expect(update).toContain("Built-by: zero in the loop");
    expect(verifyRuns(ctx, job.id)).toBe(2);
    expect(agents.count).toMatchObject({ build: 1, review: 1, security: 1 });
    expect(spanOf(ctx, job.id, "zero.station.integrate").attrs["zero.paths.changed"]).toBe("src/job.ts");
    expect(readFileSync(join(repo, "other.txt"), "utf8")).toBe("other\n");
    expect(readFileSync(join(repo, "src/job.ts"), "utf8")).toBe("job\n");
  });

  it("does not verify again when the base did not move", async () => {
    const { ctx } = line();
    const agents = fakeAgents({ build: (req) => writeTree(req.cwd, { "src/job.ts": "job\n" }) });
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    expect(verifyRuns(ctx, job.id)).toBe(1);
  });

  it("works from a box's clone, whose base only moves when fetched", async () => {
    const { repo, ctx } = line({ isolation: "container" });
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        commitOnBase(repo, { "other.txt": "other\n" });
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    const box = simulatedBox(agents.runner).box;
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, box, boxAvailability: { ready: true, problems: [] } });
    expect(done).toMatchObject({ status: "delivered", isolation: "container" });
    expect(verifyRuns(ctx, job.id)).toBe(2);
    expect(readFileSync(join(repo, "other.txt"), "utf8")).toBe("other\n");
    expect(readFileSync(join(repo, "src/job.ts"), "utf8")).toBe("job\n");
  });

  it("brings the remote's newest base into a pull request's branch before pushing", async () => {
    const { repo, ctx } = line({ integrate: "pull-request" });
    const remote = tempDir("zero-remote-");
    run("git", ["init", "-q", "--bare", "-b", "main"], remote);
    gitIn(repo, "remote", "add", "origin", remote);
    gitIn(repo, "push", "-q", "origin", "main");
    let moved = "";
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        // Accepted on GitHub, not in the owner's local branch.
        moved = commitOnBase(repo, { "other.txt": "other\n" });
        gitIn(repo, "push", "-q", "origin", "main");
        gitIn(repo, "reset", "-q", "--hard", "HEAD~1");
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    // There is no GitHub here, so the job stops at publishing, with the branch already updated.
    const parked = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(parked.question).toMatchObject({ kind: "integration-blocked" });
    expect(contains(repo, moved, `zero/${job.id}`)).toBe(true);
    expect(verifyRuns(ctx, job.id)).toBe(2);
  });

  it("switches a pull request measured against the local base to the remote's once it answers", async () => {
    const { repo, ctx } = line({ integrate: "pull-request" });
    const remote = tempDir("zero-remote-");
    run("git", ["init", "-q", "--bare", "-b", "main"], remote);
    gitIn(repo, "remote", "add", "origin", remote);
    gitIn(repo, "push", "-q", "origin", "main");
    gitIn(repo, "remote", "set-url", "origin", join(remote, "missing"));
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        gitIn(repo, "remote", "set-url", "origin", remote);
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    const parked = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(parked.base).toBe("origin/main");
    expect(parked.question).toMatchObject({ kind: "integration-blocked" });
  });

  it("leaves branch lines alone", async () => {
    const { repo, ctx } = line({ integrate: "branch" });
    let moved = "";
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        moved = commitOnBase(repo, { "other.txt": "other\n" });
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    expect(contains(repo, moved, `zero/${job.id}`)).toBe(false);
    expect(verifyRuns(ctx, job.id)).toBe(1);
  });

  it("goes back to build when the update breaks verification", async () => {
    const { repo, ctx } = line({ verify: [`node -e "process.exit(require('fs').existsSync('breaks.txt') ? 1 : 0)"`] });
    const agents = fakeAgents({
      build: (req, n) => {
        if (n === 1) {
          writeTree(req.cwd, { "src/job.ts": "job\n" });
          commitOnBase(repo, { "breaks.txt": "x" });
        } else {
          writeTree(req.cwd, { "src/fix.ts": "fix\n" });
          // The second build fixes it the only way this fake command allows: the base takes the file back.
          gitIn(repo, "rm", "-q", "breaks.txt");
          gitIn(repo, "commit", "-q", "-m", "undo");
          run("git", ["rm", "-q", "breaks.txt"], req.cwd);
        }
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 2 });
    expect(agents.calls.filter((c) => c.station === "build")[1]!.prompt).toContain("Después de actualizar con la rama base");
  });

  it("verifies before integrating when interrupted after the update commit", async () => {
    const { repo, ctx } = line({ isolation: "container" });
    const controller = new AbortController();
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        commitOnBase(repo, { "other.txt": "other\n" });
      },
    });
    const sim = simulatedBox(agents.runner).box;
    let shells = 0;
    const box: typeof sim = {
      ...sim,
      shell: async (command, o) => {
        if (++shells === 2) {
          controller.abort("andon");
          return { code: 1, output: "killed", timedOut: false };
        }
        return sim.shell(command, o);
      },
    };
    const deps = { ...ctx, runAgent: agents.runner, box, boxAvailability: { ready: true, problems: [] } };
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, deps, controller.signal)).toMatchObject({ status: "queued", checkpoint: "review" });
    expect(await runJob(job.id, deps)).toMatchObject({ status: "delivered", attempt: 1 });
    expect(shells).toBe(3);
    expect(agents.count.build).toBe(1);
  });

  it("parks when git refuses the merge without conflicts", async () => {
    const generate = `node -e "require('fs').writeFileSync('gen.txt','mine')"`;
    const { repo, ctx } = line({ setup: [generate] });
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/job.ts": "job\n" });
        commitOnBase(repo, { "gen.txt": "theirs\n" });
      },
    });
    const { job } = requestWork(ctx, { text: "x" });
    const parked = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(parked.question).toMatchObject({ kind: "integration-blocked" });
    expect(agents.count.build).toBe(1);
  });
});

describe("conflicts with the base", () => {
  /** A build that changes the file the base changes too, on its first call. */
  const conflicting = (repo: string, then: (req: AgentRequest<any>, n: number) => void) =>
    fakeAgents({
      build: (req, n) => {
        if (n === 1) {
          writeTree(req.cwd, { "src/a.ts": "job\n" });
          commitOnBase(repo, { "src/a.ts": "theirs\n" });
        } else then(req, n);
      },
    });

  it("resolves them as one more attempt, without asking", async () => {
    const { repo, ctx } = line();
    const agents = conflicting(repo, (req) => {
      expect(readFileSync(join(req.cwd, "src/a.ts"), "utf8")).toContain("<<<<<<<");
      writeTree(req.cwd, { "src/a.ts": "resolved\n" });
    });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 2 });
    expect(agents.calls.filter((c) => c.station === "build")[1]!.prompt).toContain("src/a.ts");
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("resolved\n");
    expect(agents.count).toMatchObject({ review: 2, security: 2 });
  });

  it("concludes the merge even when the resolution equals the branch", async () => {
    const { repo, ctx } = line();
    const agents = conflicting(repo, (req) => writeTree(req.cwd, { "src/a.ts": "job\n" }));
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered", attempt: 2 });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("job\n");
  });

  it("fails when the attempts run out, naming the conflict and keeping the branch", async () => {
    const { repo, ctx } = line({ maxAttempts: 1 });
    const agents = conflicting(repo, () => {});
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done.status).toBe("failed");
    expect(done.reason).toMatch(/conflictos[\s\S]*src\/a\.ts/);
    expect(gitIn(repo, "rev-parse", "--verify", `refs/heads/zero/${job.id}`)).toBeTruthy();
  });

  it("keeps the branch when the attempts run out in a box's clone", async () => {
    const { repo, ctx } = line({ maxAttempts: 1, isolation: "container" });
    const agents = conflicting(repo, () => {});
    const { job } = requestWork(ctx, { text: "x" });
    const box = simulatedBox(agents.runner).box;
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner, box, boxAvailability: { ready: true, problems: [] } })).toMatchObject({ status: "failed" });
    expect(gitIn(repo, "rev-parse", "--verify", `refs/heads/zero/${job.id}`)).toBeTruthy();
  });

  it("never commits leftover markers, and starts the merge again", async () => {
    const { repo, ctx } = line();
    const agents = conflicting(repo, (req, n) => {
      expect(readFileSync(join(req.cwd, "src/a.ts"), "utf8")).toContain("<<<<<<<");
      if (n === 3) writeTree(req.cwd, { "src/a.ts": "resolved\n" });
    });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 3 });
    expect(gitIn(repo, "log", "-p", "-m", `zero/${job.id}`)).not.toContain("<<<<<<<");
    expect(agents.calls.filter((c) => c.station === "build")[2]!.prompt).toContain("marcadores");
  });

  it("still has the conflict after an interruption while resolving", async () => {
    const { repo, ctx } = line();
    const controller = new AbortController();
    const agents = conflicting(repo, (req, n) => {
      expect(readFileSync(join(req.cwd, "src/a.ts"), "utf8")).toContain("<<<<<<<");
      if (n === 2) controller.abort("andon");
      else writeTree(req.cwd, { "src/a.ts": "resolved\n" });
    });
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner }, controller.signal)).toMatchObject({ status: "queued" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done.status).toBe("delivered");
    expect(agents.calls.filter((c) => c.station === "build")[2]!.prompt).toContain("src/a.ts");
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("resolved\n");
  });

  it("asks again for approval after going back to build", async () => {
    // L0 is the level that asks before integrating.
    const { repo, ctx } = line({ level: "L0" });
    const agents = fakeAgents({ build: (req, n) => writeTree(req.cwd, { "src/a.ts": n === 1 ? "job\n" : "resolved\n" }) });
    const { job } = requestWork(ctx, { text: "x" });
    const deps = { ...ctx, runAgent: agents.runner };
    let current = await runJob(job.id, deps);
    while (current.question?.kind !== "before-integrate") {
      await answer(ctx, job.id, "approve");
      current = await runJob(job.id, deps);
    }
    commitOnBase(repo, { "src/a.ts": "theirs\n" });
    await answer(ctx, job.id, "approve");
    const again = await runJob(job.id, deps);
    expect(again).toMatchObject({ status: "waiting", attempt: 2 });
    expect(again.question).toMatchObject({ kind: "before-integrate" });
    await answer(ctx, job.id, "approve");
    expect(await runJob(job.id, deps)).toMatchObject({ status: "delivered", attempt: 2 });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("resolved\n");
  });
});

describe("a night-shift job held before integrating", () => {
  it("waits for approval again after a conflict", async () => {
    const { repo, ctx } = line();
    const agents = fakeAgents({ build: (req, n) => writeTree(req.cwd, { "src/a.ts": n === 1 ? "job\n" : "resolved\n" }) });
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3, source: { kind: "night-shift", proposal: "p", autonomy: "build" } });
    const deps = { ...ctx, runAgent: agents.runner };
    expect((await runJob(job.id, deps)).question).toMatchObject({ kind: "before-integrate" });
    commitOnBase(repo, { "src/a.ts": "theirs\n" });
    await answer(ctx, job.id, "approve");
    expect(await runJob(job.id, deps)).toMatchObject({ status: "waiting", attempt: 2, question: { kind: "before-integrate" } });
  });
});

describe("declared against actual", () => {
  it("records the difference in the trace, without changing the outcome", async () => {
    const repo = gitRepo();
    writeTree(repo, { "openspec/project.md": "x" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "openspec");
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, verify: [passes] }] });
    const agents = fakeAgents({
      spec: () => ({ output: validSpec({ paths: ["src/a/**"] }) }),
      build: (req) => writeTree(req.cwd, { "src/a/x.ts": "x", "docs/x.md": "x" }),
    });
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    expect(spanOf(ctx, job.id, "zero.station.integrate").attrs).toMatchObject({
      "zero.paths.declared": "src/a/**",
      "zero.paths.changed": "docs/x.md, src/a/x.ts",
      "zero.paths.undeclared": "docs/x.md",
    });
    expect(renderTrace(ctx.store.spansForJob(job.id))).toContain("fuera de lo declarado: docs/x.md");
  });
});
