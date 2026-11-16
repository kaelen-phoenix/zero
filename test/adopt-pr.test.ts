import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptPullRequest, answer, requestWork } from "../src/app.js";
import type { AgentRequest } from "../src/agent.js";
import type { MergeApi, PullRequestState } from "../src/line/automerge.js";
import { prRefreshKey } from "../src/line/finish.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { specProblems, type Spec } from "../src/line/spec.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  return cleanup();
});

const PR_URL = "https://github.com/kaelen/demo/pull/7";

/**
 * A pull-request line with a bare remote whose path looks like GitHub, and a second clone standing for other
 * people that pushed the branch `feature` of pull request #7 (unknown to the line's repository) and moved `main`.
 */
function fixture(opts: { feature?: Record<string, string>; conflict?: boolean } = {}) {
  const bare = join(tempDir("zero-remote-"), "github.com", "kaelen", "demo.git").replace(/\\/g, "/");
  mkdirSync(bare, { recursive: true });
  run("git", ["init", "-q", "--bare", "-b", "main"], bare);
  const repo = gitRepo({ "shared.txt": "base\n", "README.md": "# demo\n" });
  gitIn(repo, "remote", "add", "origin", bare);
  gitIn(repo, "push", "-q", "origin", "main");
  const other = tempDir("zero-other-");
  run("git", ["clone", "-q", "-c", "core.autocrlf=false", bare, "."], other);
  gitIn(other, "checkout", "-q", "-b", "feature");
  writeTree(other, opts.feature ?? { "shared.txt": "feature\n" });
  gitIn(other, "add", "-A");
  gitIn(other, "commit", "-q", "-m", "feature");
  gitIn(other, "push", "-q", "origin", "feature");
  const head = run("git", ["rev-parse", "HEAD"], other);
  gitIn(other, "checkout", "-q", "main");
  writeTree(other, { "shared.txt": opts.conflict === false ? "base\n" : "main\n", "other.txt": "main\n" });
  gitIn(other, "add", "-A");
  gitIn(other, "commit", "-q", "-m", "main moves");
  gitIn(other, "push", "-q", "origin", "main");
  const mainTip = run("git", ["rev-parse", "HEAD"], other);
  vi.stubEnv("GH_TOKEN", "test-token");

  const ctx = testFactory({ level: "L2", lines: [{ name: "demo", repo, integrate: "pull-request", autoMerge: true, maxAttempts: 3, verify: [`node -e "process.exit(0)"`] }] });
  const prompts: string[] = [];
  let build = (req: AgentRequest<any>) => void writeTree(req.cwd, { "shared.txt": "resolved\n" });
  const agents = fakeAgents({
    build: (req) => {
      prompts.push(req.prompt);
      return build(req);
    },
  });
  const opened: string[] = [];
  const deps: RunnerDeps = { ...ctx, runAgent: agents.runner, pullRequests: () => ({ openPullRequest: async ({ head }) => (opened.push(head), "https://github.com/kaelen/demo/pull/99") }) };
  const state = { pr: { open: true, merged: false, mergeable: false, headSha: head, base: "main", headRef: "feature", headRepository: "kaelen/demo" } as PullRequestState };
  const asked: string[] = [];
  const gh: MergeApi = {
    pullRequest: async () => state.pr,
    checks: async () => [],
    merge: async () => undefined,
    deleteBranch: async () => {},
    comment: async () => {},
  };
  const api = (repository: string) => (asked.push(repository), gh);
  const adopt = (number = 7) => adoptPullRequest(ctx, { line: "demo", number, api });
  const runToEnd = async (id: string) => {
    let job = await runJob(id, deps);
    while (job.status === "waiting") {
      await answer(ctx, id, "approve");
      job = await runJob(id, deps);
    }
    return job;
  };
  const localRef = (name: string) => tryRev(repo, `refs/heads/${name}`);
  const remoteRef = (name: string) => tryRev(bare, `refs/heads/${name}`);
  return { ctx, repo, bare, other, head, mainTip, state, adopt, runToEnd, localRef, remoteRef, prompts, opened, asked, setBuild: (b: typeof build) => void (build = b) };
}

function tryRev(cwd: string, rev: string): string | undefined {
  try {
    return run("git", ["rev-parse", "--verify", "--quiet", rev], cwd);
  } catch {
    return undefined;
  }
}

const isAncestor = (cwd: string, rev: string, tip: string) => {
  try {
    run("git", ["merge-base", "--is-ancestor", rev, tip], cwd);
    return true;
  } catch {
    return false;
  }
};

describe("adoptPullRequest", () => {
  it("fetches the pull request's branch and queues a job on it with zero's own spec and the refresh mark", async () => {
    const f = fixture();
    expect(f.localRef("feature")).toBeUndefined();
    const job = await f.adopt();

    expect(f.asked).toEqual(["kaelen/demo"]);
    expect(f.localRef("feature")).toBe(f.head);
    expect(f.ctx.store.listJobs({ limit: -1 })).toHaveLength(1);
    expect(job).toMatchObject({
      status: "queued",
      branch: "feature",
      base: "origin/main",
      delivery: { mode: "pull-request", branch: "feature", url: PR_URL, autoMerge: true },
      source: { kind: "pull-request", repository: "kaelen/demo", number: 7, url: PR_URL },
    });
    expect(specProblems(job.spec as Spec)).toEqual([]);
    expect((job.spec as Spec).feasible).toBe(true);
    expect(JSON.parse(f.ctx.store.getKv(prRefreshKey(job.id))!)).toEqual({ head: f.head });
  });

  it("leaves a backup branch at the head, only locally", async () => {
    const f = fixture();
    await f.adopt();
    expect(f.localRef("respaldo/pr7")).toBe(f.head);
    expect(f.remoteRef("respaldo/pr7")).toBeUndefined();
  });

  it("never moves a backup left at another commit and makes one named after the job", async () => {
    const f = fixture();
    const unrelated = run("git", ["rev-parse", "HEAD"], f.repo);
    gitIn(f.repo, "branch", "respaldo/pr7", unrelated);
    const job = await f.adopt();
    expect(f.localRef("respaldo/pr7")).toBe(unrelated);
    expect(f.localRef(`respaldo/pr7-${job.id}`)).toBe(f.head);
  });

  describe("refuses before writing anything", () => {
    const nothingWritten = (f: ReturnType<typeof fixture>) => {
      expect(f.ctx.store.listJobs({ limit: -1 })).toHaveLength(0);
      expect(f.localRef("respaldo/pr7")).toBeUndefined();
    };

    it("a pull request from a fork", async () => {
      const f = fixture();
      f.state.pr = { ...f.state.pr, headRepository: "otro/demo" };
      await expect(f.adopt()).rejects.toThrow(/fork/);
      nothingWritten(f);
      expect(f.localRef("feature")).toBeUndefined();
    });

    it("a closed pull request", async () => {
      const f = fixture();
      f.state.pr = { ...f.state.pr, open: false };
      await expect(f.adopt()).rejects.toThrow(/no está abierto/);
      nothingWritten(f);
    });

    it("a merged pull request", async () => {
      const f = fixture();
      f.state.pr = { ...f.state.pr, merged: true, open: false };
      await expect(f.adopt()).rejects.toThrow(/fundió/);
      nothingWritten(f);
    });

    it("a pull request to another base", async () => {
      const f = fixture();
      f.state.pr = { ...f.state.pr, base: "develop" };
      await expect(f.adopt()).rejects.toThrow(/develop/);
      nothingWritten(f);
    });

    it("a branch name git would not take or would read as an option", async () => {
      const f = fixture();
      for (const headRef of ["-x", "bad..name", ""]) {
        f.state.pr = { ...f.state.pr, headRef };
        await expect(f.adopt()).rejects.toThrow(/nombre/);
      }
      nothingWritten(f);
    });

    it("a branch that already belongs to a job", async () => {
      const f = fixture();
      const { job } = requestWork(f.ctx, { text: "otra cosa" });
      f.ctx.store.updateJob(job.id, { branch: "feature" });
      await expect(f.adopt()).rejects.toThrow(new RegExp(job.id));
      expect(f.ctx.store.listJobs({ limit: -1 })).toHaveLength(1);
      expect(f.localRef("respaldo/pr7")).toBeUndefined();
    });

    it("a branch a delivered job pushed", async () => {
      const f = fixture();
      const { job } = requestWork(f.ctx, { text: "otra cosa" });
      f.ctx.store.finishJob(job.id, "delivered", { delivery: { mode: "pull-request", branch: "feature", url: PR_URL } });
      await expect(f.adopt()).rejects.toThrow(new RegExp(job.id));
      expect(f.ctx.store.listJobs({ limit: -1 })).toHaveLength(1);
    });

    it("a branch checked out in a worktree", async () => {
      const f = fixture();
      gitIn(f.repo, "fetch", "-q", "origin", "feature:feature");
      gitIn(f.repo, "worktree", "add", "-q", join(tempDir("zero-wt-"), "wt"), "feature");
      await expect(f.adopt()).rejects.toThrow(/copia de trabajo/);
      nothingWritten(f);
    });

    it("a local branch of that name at another commit", async () => {
      const f = fixture();
      const mine = run("git", ["rev-parse", "HEAD"], f.repo);
      gitIn(f.repo, "branch", "feature", mine);
      await expect(f.adopt()).rejects.toThrow(/otro commit/);
      expect(f.localRef("feature")).toBe(mine);
      nothingWritten(f);
    });

    it("a fetch that fails", async () => {
      const f = fixture();
      f.state.pr = { ...f.state.pr, headRef: "missing" };
      await expect(f.adopt()).rejects.toThrow(/No pude traer/);
      nothingWritten(f);
    });

    it("a line that does not integrate by pull request", async () => {
      const f = fixture();
      const ctx = testFactory({ level: "L2", lines: [{ name: "demo", repo: f.repo, integrate: "merge" }] });
      await expect(adoptPullRequest(ctx, { line: "demo", number: 7, api: () => undefined })).rejects.toThrow(/pull request/);
      expect(ctx.store.listJobs({ limit: -1 })).toHaveLength(0);
    });

    it("no GitHub adapter", async () => {
      const f = fixture();
      await expect(adoptPullRequest(f.ctx, { line: "demo", number: 7, api: () => undefined })).rejects.toThrow(/GitHub/);
      nothingWritten(f);
    });
  });
});

describe("an adopted pull request's job", () => {
  it("merges the base, resolves the conflict and pushes to the same branch without opening a pull request", async () => {
    const f = fixture();
    const adopted = await f.adopt();
    const done = await f.runToEnd(adopted.id);

    expect(done).toMatchObject({ status: "delivered", delivery: { mode: "pull-request", branch: "feature", url: PR_URL } });
    expect(f.opened).toEqual([]);
    const tip = f.remoteRef("feature")!;
    expect(tip).not.toBe(f.head);
    expect(run("git", ["rev-list", "--parents", "-n", "1", tip], f.bare).split(" ")).toHaveLength(3);
    expect(isAncestor(f.bare, f.head, tip)).toBe(true);
    expect(isAncestor(f.bare, f.mainTip, tip)).toBe(true);
    const shared = run("git", ["show", `${tip}:shared.txt`], f.bare);
    expect(shared).toBe("resolved");
    expect(shared).not.toMatch(/<<<<<<<|>>>>>>>/);
    expect(f.ctx.store.getKv(prRefreshKey(adopted.id))).toBeUndefined();
    expect(f.localRef("respaldo/pr7")).toBe(f.head);
  });

  it("pushes nothing when the remote branch moved, and ends delivered as it was with the branch back at the head", async () => {
    const f = fixture();
    const adopted = await f.adopt();
    gitIn(f.other, "checkout", "-q", "feature");
    writeTree(f.other, { "late.txt": "late\n" });
    gitIn(f.other, "add", "-A");
    gitIn(f.other, "commit", "-q", "-m", "late push");
    gitIn(f.other, "push", "-q", "origin", "feature");
    const moved = run("git", ["rev-parse", "HEAD"], f.other);

    const done = await f.runToEnd(adopted.id);
    expect(done).toMatchObject({ status: "delivered", delivery: adopted.delivery });
    expect(f.remoteRef("feature")).toBe(moved);
    expect(f.localRef("feature")).toBe(f.head);
    expect(f.opened).toEqual([]);
  });

  it("gives build the branch's OpenSpec changes along with the conflicted files", async () => {
    const f = fixture({ feature: { "shared.txt": "feature\n", "openspec/changes/mi-cambio/proposal.md": "# Mi cambio\n" } });
    const adopted = await f.adopt();
    await f.runToEnd(adopted.id);
    expect(f.prompts[0]).toContain("shared.txt");
    expect(f.prompts[0]).toContain("openspec/changes/mi-cambio/");
  });

  it("is presented as a third party's pull request, not as the owner's request", async () => {
    const f = fixture();
    const adopted = await f.adopt();
    await f.runToEnd(adopted.id);
    expect(f.prompts[0]).toContain("pull request #7");
    expect(f.prompts[0]).not.toContain("The owner sent");
  });
});
