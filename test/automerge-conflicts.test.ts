import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, requestWork, retryJob, stop } from "../src/app.js";
import type { AgentRequest, AgentRun } from "../src/agent.js";
import type { QuotaReport } from "../src/engines/index.js";
import { mergeKey, pollMerges, watchedJobs, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { cleanupKey } from "../src/line/cleanup.js";
import { prRefreshKey } from "../src/line/finish.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { conflictMarkers, workCopyAt } from "../src/workspace.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, simulatedBox, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  return cleanup();
});

const URL = "https://github.com/kaelen/demo/pull/10";
const green: Check[] = [{ name: "check", done: true, ok: true }];
const usedUp: QuotaReport = { billing: "subscription", limited: true, windows: [{ name: "five_hour", label: "5 horas", utilization: 1, status: "exhausted", resetsAt: new Date(Date.now() + 3_600_000).toISOString() }] };

type Build = (req: AgentRequest<any>) => Partial<AgentRun<any>> | void;

/**
 * A line with a real bare remote (its path looks like GitHub, so the first
 * delivery goes the normal way), with a job delivered as a pull request that
 * changed `shared.txt`, and a second clone standing for other people.
 */
async function delivered(opts: { level?: string; maxAttempts?: number; verify?: string[]; isolation?: string; change?: Record<string, string>; over?: Record<string, unknown> } = {}) {
  const bare = join(tempDir("zero-remote-"), "github.com", "kaelen", "demo.git").replace(/\\/g, "/");
  mkdirSync(bare, { recursive: true });
  run("git", ["init", "-q", "--bare", "-b", "main"], bare);
  const repo = gitRepo({ "shared.txt": "base\n", "README.md": "# demo\n" });
  gitIn(repo, "remote", "add", "origin", bare);
  gitIn(repo, "push", "-q", "origin", "main");
  const other = tempDir("zero-other-");
  run("git", ["clone", "-q", "-c", "core.autocrlf=false", bare, "."], other);
  vi.stubEnv("GH_TOKEN", "test-token");

  const isolation = opts.isolation ?? "worktree";
  const ctx = testFactory({ level: opts.level ?? "L2", isolation, lines: [{ name: "demo", repo, integrate: "pull-request", autoMerge: true, maxAttempts: opts.maxAttempts ?? 3, verify: opts.verify ?? [`node -e "process.exit(0)"`] }], ...opts.over });
  let build: Build = (req) => void writeTree(req.cwd, opts.change ?? { "shared.txt": "job\n" });
  const agents = fakeAgents({ build: (req) => build(req) });
  const opened: string[] = [];
  const box = isolation === "container" ? simulatedBox(agents.runner).box : undefined;
  const deps: RunnerDeps = { ...ctx, runAgent: agents.runner, box, pullRequests: () => ({ openPullRequest: async ({ head }) => (opened.push(head), URL) }) };

  const { job } = requestWork(ctx, { text: "cambiá shared.txt" });
  let first = await runJob(job.id, deps);
  while (first.status === "waiting") {
    await answer(ctx, job.id, "approve");
    first = await runJob(job.id, deps);
  }
  expect(first).toMatchObject({ status: "delivered", attempt: 1, delivery: { url: URL, autoMerge: true } });
  const branch = `zero/${job.id}`;
  const remoteTip = () => run("git", ["rev-parse", `refs/heads/${branch}`], bare);
  const localTip = () => run("git", ["rev-parse", `refs/heads/${branch}`], repo);
  const head = remoteTip();
  expect(localTip()).toBe(head);

  /** The base moves on GitHub, in a way that conflicts with the job unless told otherwise. */
  const moveBase = (file = "shared.txt", content = "theirs\n") => {
    gitIn(other, "checkout", "-q", "main");
    gitIn(other, "pull", "-q", "origin", "main");
    writeTree(other, { [file]: content });
    gitIn(other, "add", "-A");
    gitIn(other, "commit", "-q", "-m", `base: ${file}`);
    gitIn(other, "push", "-q", "origin", "main");
    return run("git", ["rev-parse", "refs/heads/main"], bare);
  };

  const did: string[] = [];
  const state = { pr: { open: true, merged: false, mergeable: false, headSha: head } as PullRequestState, checks: green };
  const gh: MergeApi = {
    pullRequest: async () => state.pr,
    checks: async () => state.checks,
    merge: async (_n, sha) => {
      did.push(`merge ${sha}`);
      state.pr = { ...state.pr, open: false, merged: true };
      return "merged-sha";
    },
    deleteBranch: async () => {},
    comment: async (_n, body) => void did.push(`comment: ${body}`),
  };
  const pass = () => pollMerges(ctx, () => gh);
  const merge = () => JSON.parse(ctx.store.getKv(mergeKey(job.id))!) as MergeState;
  const again = () => runJob(job.id, deps);
  const parents = (rev: string) => run("git", ["rev-list", "--parents", "-n", "1", rev], bare).split(" ").length - 1;
  const contained = (rev: string, tip: string) => run("git", ["merge-base", "--is-ancestor", rev, tip], bare);
  return { ctx, repo, bare, other, job, branch, head, remoteTip, localTip, moveBase, did, state, pass, merge, again, parents, contained, agents, opened, delivery: first.delivery, setBuild: (b: Build) => void (build = b) };
}

const resolves = (content = "resolved\n"): Build => (req) => void writeTree(req.cwd, { "shared.txt": content });
const leavesMarkers: Build = (req) => void writeTree(req.cwd, { "shared.txt": "<<<<<<< HEAD\njob\n=======\ntheirs\n>>>>>>> origin/main\n" });
const merging = (cwd: string) => gitIn(cwd, "rev-parse", "--git-path", "MERGE_HEAD");
const inMerge = (cwd: string) => existsSync(resolve(cwd, merging(cwd)));
const unmerged = (cwd: string) => gitIn(cwd, "diff", "--name-only", "--diff-filter=U");

describe("a pull request in conflict with its base", () => {
  it("merges the base, resolves the conflict as one more attempt and pushes to the same pull request", async () => {
    const f = await delivered();
    const base = f.moveBase();
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)).toMatchObject({ status: "queued", delivery: f.delivery });
    expect(f.ctx.store.getJob(f.job.id)!.finishedAt).toBeUndefined();
    expect(f.did).toEqual([]);
    expect(f.merge().resolving).toBe(f.head);

    const prompts: string[] = [];
    f.setBuild((req) => {
      prompts.push(req.prompt);
      expect(inMerge(req.cwd)).toBe(true);
      return resolves()(req);
    });
    const done = await f.again();

    expect(prompts[0]).toContain("shared.txt");
    expect(done).toMatchObject({ status: "delivered", attempt: 2, delivery: f.delivery });
    expect(f.opened).toHaveLength(1);
    const tip = f.remoteTip();
    expect(tip).not.toBe(f.head);
    f.contained(f.head, tip);
    f.contained(base, tip);
    expect(f.parents(tip)).toBe(2);
    expect(run("git", ["show", `${tip}:shared.txt`], f.bare)).toBe("resolved");
    expect(f.ctx.store.getKv(prRefreshKey(f.job.id))).toBeUndefined();
    expect(watchedJobs(f.ctx).map((j) => j.id)).toEqual([f.job.id]);
    expect(f.did).toEqual([]);
  });

  it("resolves it even when the first build spent every attempt", async () => {
    const f = await delivered();
    f.ctx.store.updateJob(f.job.id, { attempt: 3 });
    f.moveBase();
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)).toMatchObject({ status: "queued", attempt: 2 });
    expect(f.merge()).toMatchObject({ resolving: f.head, resolutions: 1 });
    f.setBuild(resolves());
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 3, delivery: f.delivery });
    expect(f.remoteTip()).not.toBe(f.head);
    expect(run("git", ["show", `${f.remoteTip()}:shared.txt`], f.bare)).toBe("resolved");
    expect(f.opened).toHaveLength(1);
  });

  it("concludes the merge with two parents even when the resolution equals HEAD", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    f.setBuild(resolves("job\n"));
    expect((await f.again()).status).toBe("delivered");
    expect(f.parents(f.remoteTip())).toBe(2);
  });

  it("spends no attempt and calls no build when the merge is clean, but verifies again", async () => {
    const log = join(tempDir("zero-log-"), "verify.log").replace(/\\/g, "/");
    const f = await delivered({ verify: [`node -e "require('fs').appendFileSync('${log}','x')"`] });
    const verified = readFileSync(log, "utf8").length;
    const builds = f.agents.count.build;
    const reviews = f.agents.count.review!;
    const base = f.moveBase("other.txt", "new\n");
    await f.pass();
    const done = await f.again();
    expect(done).toMatchObject({ status: "delivered", attempt: 1, delivery: f.delivery });
    expect(f.agents.count.build).toBe(builds);
    expect(f.agents.count.review).toBe(reviews + 1);
    expect(readFileSync(log, "utf8").length).toBe(verified + 1);
    f.contained(base, f.remoteTip());
    f.contained(f.head, f.remoteTip());
    expect(f.remoteTip()).not.toBe(f.head);
  });

  /** The pull request blocked in conflict, as the merges pass leaves it, then retried by the person in charge. */
  const retried = (f: Awaited<ReturnType<typeof delivered>>) => {
    const state: MergeState = { status: "blocked", why: "en conflicto con la rama base", backoff: { sha: f.head, mergeable: false, why: "en conflicto con la rama base", delayMs: 300_000, nextChecksAt: new Date(Date.now() - 1000).toISOString() } };
    f.ctx.store.setKv(mergeKey(f.job.id), JSON.stringify(state));
    expect(retryJob(f.ctx, f.job.id)).toMatchObject({ kind: "pull-request", job: { attempt: 0 } });
  };

  it("resumes at verify without building when a retried pull request at attempt 0 merges the base cleanly", async () => {
    const log = join(tempDir("zero-log-"), "verify.log").replace(/\\/g, "/");
    const f = await delivered({ verify: [`node -e "require('fs').appendFileSync('${log}','x')"`] });
    retried(f);
    const verified = readFileSync(log, "utf8").length;
    const builds = f.agents.count.build;
    const reviews = f.agents.count.review!;
    const base = f.moveBase("other.txt", "new\n");
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)).toMatchObject({ status: "queued", attempt: 0 });
    const spansBefore = new Set(f.ctx.store.spansForJob(f.job.id).map((s) => s.id));
    const done = await f.again();
    expect(done).toMatchObject({ status: "delivered", attempt: 0, delivery: f.delivery });
    expect(f.agents.count.build).toBe(builds);
    expect(f.agents.count.review).toBe(reviews + 1);
    expect(readFileSync(log, "utf8").length).toBe(verified + 1);
    f.contained(base, f.remoteTip());
    f.contained(f.head, f.remoteTip());
    const attempts = f.ctx.store.spansForJob(f.job.id).filter((s) => s.name === "zero.attempt" && !spansBefore.has(s.id));
    expect(attempts.map((s) => s.attrs["zero.attempt"])).toEqual([1]);
  });

  it("still builds a retried pull request at attempt 0 when its base merge conflicts", async () => {
    const f = await delivered();
    retried(f);
    f.moveBase();
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)).toMatchObject({ status: "queued", attempt: 0 });
    const builds = f.agents.count.build!;
    f.setBuild((req) => {
      expect(inMerge(req.cwd)).toBe(true);
      return resolves()(req);
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 1, delivery: f.delivery });
    expect(f.agents.count.build).toBe(builds + 1);
  });

  it("builds a fresh job, which has no refresh mark", async () => {
    const f = await delivered();
    expect(f.agents.count.build).toBe(1);
    expect(f.ctx.store.getJob(f.job.id)!.attempt).toBe(1);
  });

  it("gives the replacement engine the same merge in progress when the plan cuts the build", async () => {
    const f = await delivered({ over: { engine: "claude", fallback: ["codex"] } });
    f.moveBase();
    await f.pass();
    const seen: { engine?: string; inMerge: boolean; unmerged: string }[] = [];
    f.setBuild((req) => {
      seen.push({ engine: req.engine?.name, inMerge: inMerge(req.cwd), unmerged: unmerged(req.cwd) });
      if (seen.length > 1) return resolves()(req);
      writeTree(req.cwd, { "half-done.txt": "x" });
      return { ok: false, text: "limit", quota: usedUp };
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2 });
    expect(seen).toEqual([
      { engine: "claude", inMerge: true, unmerged: "shared.txt" },
      { engine: "codex", inMerge: true, unmerged: "shared.txt" },
    ]);
    expect(f.parents(f.remoteTip())).toBe(2);
    expect(run("git", ["ls-tree", "--name-only", f.remoteTip()], f.bare)).not.toContain("half-done");
  });

  it("updates through the isolation box's clone too", async () => {
    const f = await delivered({ isolation: "container" });
    const base = f.moveBase();
    await f.pass();
    f.setBuild(resolves());
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2, delivery: f.delivery });
    const tip = f.remoteTip();
    f.contained(base, tip);
    f.contained(f.head, tip);
    expect(f.parents(tip)).toBe(2);
    expect(f.localTip()).toBe(tip);
  });

  it("goes back to the queue once more when the base moves again after a good update", async () => {
    const f = await delivered({ maxAttempts: 4 });
    f.moveBase();
    await f.pass();
    f.setBuild(resolves());
    await f.again();
    const updated = f.remoteTip();
    f.moveBase("shared.txt", "theirs again\n");
    f.state.pr = { ...f.state.pr, headSha: updated };
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.status).toBe("queued");
    expect(f.merge().resolving).toBe(updated);
    f.setBuild(resolves("resolved twice\n"));
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 3 });
    f.contained(updated, f.remoteTip());
  });
});

describe("conflict markers", () => {
  it("fails the attempt without a commit, names the file and starts the merge again", async () => {
    const f = await delivered();
    const base = f.moveBase();
    await f.pass();
    const prompts: string[] = [];
    const heads: string[] = [];
    f.setBuild((req) => {
      prompts.push(req.prompt);
      heads.push(gitIn(req.cwd, "rev-parse", "HEAD"));
      expect(inMerge(req.cwd)).toBe(true);
      expect(unmerged(req.cwd)).toBe("shared.txt");
      return prompts.length === 1 ? leavesMarkers(req) : resolves()(req);
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 3 });
    expect(heads).toEqual([f.head, f.head]);
    expect(prompts[1]).toMatch(/marcadores de conflicto/);
    expect(prompts[1]).toContain("shared.txt");
    for (const commit of run("git", ["rev-list", `${base}..${f.remoteTip()}`], f.bare).split("\n")) {
      expect(run("git", ["show", `${commit}:shared.txt`], f.bare)).not.toContain("<<<<<<<");
    }
  });

  it("pushes nothing when every attempt leaves markers, and tells the pull request once", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    f.setBuild(leavesMarkers);
    const done = await f.again();
    expect(done).toMatchObject({ status: "delivered", attempt: 3, delivery: f.delivery });
    expect(done.reason).toBeUndefined();
    expect(f.remoteTip()).toBe(f.head);
    expect(f.localTip()).toBe(f.head);
    expect(watchedJobs(f.ctx).map((j) => j.id)).toEqual([f.job.id]);
    expect((await f.ctx.townhall.recall({ kinds: ["blocker"] })).map((p) => p.body).join()).toMatch(/No se actualizó el pull request/);

    await f.pass();
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.status).toBe("delivered");
    expect(f.did).toEqual([expect.stringMatching(/^comment: .*en conflicto con la rama base/)]);

    // A person fixes it with a push: it merges like any other.
    f.state.pr = { ...f.state.pr, mergeable: true, headSha: "fixed" };
    await f.pass();
    expect(f.did.at(-1)).toBe("merge fixed");
  });

  it("does not keep a commit the agent made on its own with markers", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    let calls = 0;
    let own = "";
    f.setBuild((req) => {
      if (++calls > 1) {
        expect(gitIn(req.cwd, "rev-parse", "HEAD")).toBe(f.head);
        expect(inMerge(req.cwd)).toBe(true);
        return resolves()(req);
      }
      leavesMarkers(req);
      gitIn(req.cwd, "add", "-A");
      gitIn(req.cwd, "commit", "-q", "-m", "yo commiteo");
      own = gitIn(req.cwd, "rev-parse", "HEAD");
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 3 });
    expect(calls).toBe(2);
    const history = run("git", ["rev-list", f.remoteTip()], f.bare).split("\n");
    expect(history).not.toContain(own);
  });

  it("does not take an aborted merge for a resolved one", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    let calls = 0;
    f.setBuild((req) => {
      if (++calls > 1) return resolves()(req);
      gitIn(req.cwd, "merge", "--abort");
      writeTree(req.cwd, { "shared.txt": "sin mezcla\n" });
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 3 });
    expect(f.parents(f.remoteTip())).toBe(2);
    expect(run("git", ["show", `${f.remoteTip()}:shared.txt`], f.bare)).toBe("resolved");
  });

  it("finds them per file: regular files only, CRLF tolerated, bare ======= allowed", () => {
    const dir = tempDir();
    writeTree(dir, {
      "conflict.txt": "a\n<<<<<<< HEAD\nb\n",
      "crlf.txt": "a\r\n|||||||\r\nb\r\n",
      "closing.txt": ">>>>>>> main\n",
      "doc.md": "Title\n=======\n",
      "inner.txt": "x <<<<<<< y\n",
    });
    mkdirSync(join(dir, "folder"));
    expect(conflictMarkers(dir, ["conflict.txt", "crlf.txt", "closing.txt", "doc.md", "inner.txt", "folder", "gone.txt"])).toEqual(["conflict.txt", "crlf.txt", "closing.txt"]);
  });
});

describe("a base that keeps moving during the update", () => {
  type Delivered = Awaited<ReturnType<typeof delivered>>;
  /** A fetch by anyone else in the line's repository, like the daemon's passes: origin/main is shared with this job's worktree. */
  const moveAndFetch = (f: Delivered, file: string, content: string) => {
    const moved = f.moveBase(file, content);
    gitIn(f.repo, "fetch", "-q", "origin", "main");
    expect(gitIn(f.repo, "rev-parse", "refs/remotes/origin/main")).toBe(moved);
    return moved;
  };
  const isAncestor = (f: Delivered, rev: string, tip: string) => spawnSync("git", ["merge-base", "--is-ancestor", rev, tip], { cwd: f.bare }).status === 0;
  const twoFiles = { "shared.txt": "job\n", "second.txt": "job second\n" };

  it("restarts the same merge after a failed attempt, so no conflict appears that the mark does not name", async () => {
    const f = await delivered({ change: twoFiles });
    const base = f.moveBase();
    await f.pass();
    let later = "";
    const prompts: string[] = [];
    f.setBuild((req) => {
      prompts.push(req.prompt);
      expect(unmerged(req.cwd)).toBe("shared.txt");
      expect(readFileSync(join(req.cwd, "second.txt"), "utf8")).toBe("job second\n");
      if (prompts.length > 1) return resolves()(req);
      // Merged as it is now, this base would also conflict in second.txt, which no marker check looks at.
      later = moveAndFetch(f, "second.txt", "theirs second\n");
      return leavesMarkers(req);
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 3, delivery: f.delivery });
    expect(prompts).toHaveLength(2);
    const tip = f.remoteTip();
    expect(run("git", ["show", `${tip}:second.txt`], f.bare)).toBe("job second");
    expect(run("git", ["show", `${tip}:shared.txt`], f.bare)).toBe("resolved");
    expect(isAncestor(f, base, tip)).toBe(true);
    expect(isAncestor(f, later, tip)).toBe(false);
  });

  it("restarts the same merge for the replacement engine when the plan cuts the build", async () => {
    const f = await delivered({ change: twoFiles, over: { engine: "claude", fallback: ["codex"] } });
    f.moveBase();
    await f.pass();
    const seen: string[] = [];
    f.setBuild((req) => {
      seen.push(unmerged(req.cwd));
      if (seen.length > 1) return resolves()(req);
      moveAndFetch(f, "second.txt", "theirs second\n");
      return { ok: false, text: "limit", quota: usedUp };
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2 });
    expect(seen).toEqual(["shared.txt", "shared.txt"]);
  });

  it("keeps a good resolution when the base moved during the build, and the new tip gets its own turn", async () => {
    const f = await delivered();
    const base = f.moveBase();
    await f.pass();
    let later = "";
    f.setBuild((req) => {
      later = moveAndFetch(f, "other.txt", "new\n");
      return resolves()(req);
    });
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2, delivery: f.delivery });
    const tip = f.remoteTip();
    expect(tip).not.toBe(f.head);
    expect(isAncestor(f, base, tip)).toBe(true);
    expect(isAncestor(f, later, tip)).toBe(false);
    expect(f.parents(tip)).toBe(2);

    f.state.pr = { ...f.state.pr, headSha: tip };
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.status).toBe("queued");
    expect(f.merge().resolving).toBe(tip);
    expect(f.did).toEqual([]);
  });

  it("still pushes when the base moved during the approval wait", async () => {
    const f = await delivered({ level: "L0" });
    const base = f.moveBase();
    await f.pass();
    f.setBuild(resolves());
    expect(await f.again()).toMatchObject({ status: "waiting", question: { kind: "before-integrate" } });
    const later = moveAndFetch(f, "other.txt", "new\n");
    await answer(f.ctx, f.job.id, "approve");
    expect(await f.again()).toMatchObject({ status: "delivered", delivery: f.delivery });
    const tip = f.remoteTip();
    expect(tip).not.toBe(f.head);
    expect(isAncestor(f, base, tip)).toBe(true);
    expect(isAncestor(f, later, tip)).toBe(false);
  });
});

describe("what is not pushed", () => {
  it("keeps a commit that reached the remote branch during the update", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    let theirs = "";
    f.setBuild((req) => {
      gitIn(f.other, "fetch", "-q", "origin");
      gitIn(f.other, "checkout", "-q", "-b", "person", `origin/${f.branch}`);
      writeTree(f.other, { "person.txt": "mine\n" });
      gitIn(f.other, "add", "-A");
      gitIn(f.other, "commit", "-q", "-m", "a person's commit");
      gitIn(f.other, "push", "-q", "origin", `person:${f.branch}`);
      theirs = gitIn(f.other, "rev-parse", "HEAD");
      return resolves()(req);
    });
    const done = await f.again();
    expect(done).toMatchObject({ status: "delivered", delivery: f.delivery });
    expect(f.remoteTip()).toBe(theirs);
    expect(f.localTip()).toBe(f.head);
    expect(f.opened).toHaveLength(1);
  });

  it("leaves the remote branch alone when the verification fails and no attempts are left", async () => {
    const verify = `node -e "process.exit(require('fs').readFileSync('shared.txt','utf8').includes('malo') ? 1 : 0)"`;
    const f = await delivered({ maxAttempts: 2, verify: [verify] });
    f.moveBase();
    await f.pass();
    f.setBuild(resolves("malo\n"));
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 2, delivery: f.delivery });
    expect(f.remoteTip()).toBe(f.head);
    expect(f.localTip()).toBe(f.head);
    expect(watchedJobs(f.ctx).map((j) => j.id)).toEqual([f.job.id]);
  });

  it("returns to delivered when the person stops the job during the update", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    const controller = new AbortController();
    f.setBuild(() => (controller.abort("stop"), { ok: false, text: "cancelled" }));
    const done = await runJob(f.job.id, { ...f.ctx, runAgent: f.agents.runner }, controller.signal);
    expect(done).toMatchObject({ status: "delivered", delivery: f.delivery });
    expect(done.reason).toBeUndefined();
    expect(f.remoteTip()).toBe(f.head);
    expect(f.localTip()).toBe(f.head);
    expect(watchedJobs(f.ctx).map((j) => j.id)).toEqual([f.job.id]);
    expect(f.ctx.store.getKv(prRefreshKey(f.job.id))).toBeUndefined();
  });

  it("returns to delivered when a queued update is stopped", async () => {
    const f = await delivered();
    f.moveBase();
    await f.pass();
    const { job } = await stop(f.ctx, f.job.id);
    expect(job).toMatchObject({ status: "delivered", delivery: f.delivery });
    expect(f.localTip()).toBe(f.head);
  });

  it("waits while the job's last work copy is still pending removal, then takes it back", async () => {
    const f = await delivered();
    f.moveBase();
    f.ctx.store.setKv(cleanupKey(f.job.id), JSON.stringify({ repo: f.repo, path: "/some/copy", error: "EBUSY", since: new Date().toISOString() }));
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.status).toBe("delivered");
    expect(f.ctx.store.getKv(prRefreshKey(f.job.id))).toBeUndefined();
    expect(f.merge().resolving).toBeUndefined();

    f.ctx.store.deleteKv(cleanupKey(f.job.id));
    f.ctx.store.setKv(mergeKey(f.job.id), JSON.stringify({ ...f.merge(), backoff: undefined } satisfies MergeState));
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.status).toBe("queued");
    expect(f.merge().resolving).toBe(f.head);
  });

  it("gives up when the merge finds nothing to do", async () => {
    const f = await delivered();
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.status).toBe("queued");
    expect(await f.again()).toMatchObject({ status: "delivered", attempt: 1, delivery: f.delivery });
    expect(f.remoteTip()).toBe(f.head);
    await f.pass();
    expect(f.did).toEqual([expect.stringMatching(/en conflicto con la rama base; falló la resolución automática de este head/)]);
  });
});

describe("an earlier approval", () => {
  it("does not cover the merged code: on L1 it asks again before pushing", async () => {
    const f = await delivered({ level: "L1" });
    f.ctx.store.updateJob(f.job.id, { approvals: { ...f.ctx.store.getJob(f.job.id)!.approvals, integrate: true } });
    f.moveBase();
    await f.pass();
    expect(f.ctx.store.getJob(f.job.id)!.approvals.integrate).toBeUndefined();
    f.setBuild(resolves());
    expect(await f.again()).toMatchObject({ status: "waiting", question: { kind: "before-integrate" } });
    expect(f.remoteTip()).toBe(f.head);

    await answer(f.ctx, f.job.id, "approve");
    expect(await f.again()).toMatchObject({ status: "delivered", delivery: f.delivery });
    expect(f.remoteTip()).not.toBe(f.head);
    expect(f.parents(f.remoteTip())).toBe(2);
  });

  it("does not ask on L1 when nobody approved anything before", async () => {
    const f = await delivered({ level: "L1" });
    f.moveBase();
    await f.pass();
    f.setBuild(resolves());
    expect(await f.again()).toMatchObject({ status: "delivered", delivery: f.delivery });
    expect(f.remoteTip()).not.toBe(f.head);
  });

  it("returns to delivered when the new question is rejected", async () => {
    const f = await delivered({ level: "L0" });
    f.moveBase();
    await f.pass();
    f.setBuild(resolves());
    await f.again();
    expect(await answer(f.ctx, f.job.id, "reject")).toMatchObject({ status: "delivered", delivery: f.delivery });
    expect(f.remoteTip()).toBe(f.head);
    expect(f.localTip()).toBe(f.head);
  });
});

describe("mergeBase", () => {
  it("merges, says when there is nothing to do, and refuses without leaving a merge behind", () => {
    const repo = gitRepo({ "a.txt": "a\n" });
    gitIn(repo, "checkout", "-q", "-b", "work");
    writeTree(repo, { "b.txt": "b\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "work");
    const copy = workCopyAt(repo, "main", "work");
    expect(copy.mergeBase("m")).toEqual({ outcome: "up-to-date" });

    gitIn(repo, "checkout", "-q", "main");
    writeTree(repo, { "c.txt": "c\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "main moves");
    gitIn(repo, "checkout", "-q", "work");
    writeTree(repo, { "c.txt": "untracked\n" });
    const refused = copy.mergeBase("m");
    expect(refused).toMatchObject({ outcome: "refused", reason: expect.stringContaining("c.txt") });
    expect(inMerge(repo)).toBe(false);

    const tip = gitIn(repo, "rev-parse", "HEAD");
    expect(copy.mergeBase("m", tip)).toEqual({ outcome: "merged" });
    expect(gitIn(repo, "log", "-1", "--format=%s %an")).toBe("m zero");
  });

  it("leaves a conflict in progress, and starts it again from the tip", () => {
    const repo = gitRepo({ "a.txt": "a\n" });
    gitIn(repo, "checkout", "-q", "-b", "work");
    writeTree(repo, { "a.txt": "work\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "work");
    gitIn(repo, "checkout", "-q", "main");
    writeTree(repo, { "a.txt": "main\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "main");
    gitIn(repo, "checkout", "-q", "work");
    const tip = gitIn(repo, "rev-parse", "HEAD");
    const copy = workCopyAt(repo, "main", "work");
    expect(copy.mergeBase("m")).toEqual({ outcome: "conflict", paths: ["a.txt"] });
    writeTree(repo, { "a.txt": "half\n" });
    expect(copy.mergeBase("m", tip)).toEqual({ outcome: "conflict", paths: ["a.txt"] });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("<<<<<<<");
    writeTree(repo, { "a.txt": "work\n" });
    expect(copy.commitAll("done")).toBe(true);
    expect(gitIn(repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);
    expect(copy.commitAll("nothing")).toBe(false);
  });

  it("merges the commit it is given, not where the base's ref is now", () => {
    const repo = gitRepo({ "a.txt": "a\n" });
    gitIn(repo, "checkout", "-q", "-b", "work");
    writeTree(repo, { "b.txt": "b\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "work");
    const tip = gitIn(repo, "rev-parse", "HEAD");
    gitIn(repo, "checkout", "-q", "main");
    writeTree(repo, { "c.txt": "c\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "pinned");
    const pinned = gitIn(repo, "rev-parse", "HEAD");
    writeTree(repo, { "d.txt": "d\n" });
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "later");
    gitIn(repo, "checkout", "-q", "work");
    expect(workCopyAt(repo, "main", "work").mergeBase("m", tip, pinned)).toEqual({ outcome: "merged" });
    expect(existsSync(join(repo, "c.txt"))).toBe(true);
    expect(existsSync(join(repo, "d.txt"))).toBe(false);
  });
});
