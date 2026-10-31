import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { proposalRequest, requestWork, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import type { Issue, IssueApi } from "../src/intake/github.js";
import { proposalIssueBody } from "../src/intake/proposals.js";
import { pollMerges, type MergeApi, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob } from "../src/line/finish.js";
import { detectReverts } from "../src/line/reverts.js";
import { scoutLine, scoutPass } from "../src/line/scout.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { Store, type Proposal } from "../src/state/store.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);
const idea = (title: string, over: Record<string, unknown> = {}) => ({ title, why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, paths: ["src/x.ts"], needsNewCredentials: false, ...over });
const scouting = (proposals: unknown[]) => fakeAgents({ scout: () => ({ output: { proposals } }) });

function factory(over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
  let clock = at(3);
  const ctx = testFactory({ level: "L2", isolation: "worktree", nightShift: { autonomy: "propose" }, lines: [{ name: "tienda", repo: gitRepo(), ...line }], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}

const issue = (number: number, over: Partial<Issue> = {}): Issue => ({
  number,
  title: `Issue ${number}`,
  body: `Cuerpo del issue ${number}`,
  author: "writer",
  url: `https://github.com/o/r/issues/${number}`,
  isPullRequest: false,
  labels: [],
  ...over,
});

/** GitHub issues in memory; records which listings the caller used. */
function fakeIssues(issues: Issue[], opts: { fail?: boolean } = {}) {
  const used: string[] = [];
  const permissions: Record<string, string> = { writer: "write", admin: "admin", reader: "read" };
  const api = {
    labeled: async () => (used.push("labeled"), []),
    unlabeled: async () => {
      used.push("unlabeled");
      if (opts.fail) throw new Error("GitHub no responde");
      return issues.filter((i) => !i.isPullRequest && !i.labels.length);
    },
    permission: async (login: string) => permissions[login] ?? "none",
  } as unknown as IssueApi;
  return { api, used };
}

/** A line whose remote is the GitHub repository o/r. */
const withRemote = (ctx: FactoryContext) => gitIn(ctx.config.lines[0]!.repo, "remote", "add", "origin", "https://github.com/o/r.git");
const issuesSection = (prompt: string) => prompt.slice(prompt.indexOf("## Open unlabeled issues"), prompt.indexOf("## Constraints"));

describe("unlabeled issues for scout", () => {
  it("lists a writer's issue with its number, title, URL and body", async () => {
    const { ctx } = factory();
    withRemote(ctx);
    const gh = fakeIssues([issue(12), issue(13, { author: "reader" }), issue(14, { labels: ["bug"] }), issue(15, { isPullRequest: true })]);
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3), () => gh.api);
    const s = issuesSection(agents.calls[0]!.prompt);
    expect(s).toContain("#12: Issue 12");
    expect(s).toContain("https://github.com/o/r/issues/12");
    expect(s).toContain("Cuerpo del issue 12");
    expect(s).not.toContain("#13");
    expect(s).not.toContain("#14");
    expect(s).not.toContain("#15");
    expect(gh.used).toEqual(["unlabeled"]);
  });

  it("keeps at most 20, newest first", async () => {
    const { ctx } = factory();
    withRemote(ctx);
    const gh = fakeIssues(Array.from({ length: 25 }, (_, i) => issue(i + 1)));
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3), () => gh.api);
    const s = issuesSection(agents.calls[0]!.prompt);
    expect(s.match(/^### #\d+:/gm)).toHaveLength(20);
    expect(s.indexOf("#25:")).toBeLessThan(s.indexOf("#24:"));
    expect(s).not.toContain("#5:");
  });

  it("does not list an issue a proposal already links", async () => {
    const { ctx, set } = factory();
    withRemote(ctx);
    const gh = fakeIssues([issue(12)]);
    await scoutPass(ctx, scouting([idea("Tomar el issue", { issue: 12 })]).runner, at(3), () => gh.api);
    expect(ctx.store.listProposals()[0]).toMatchObject({ sourceIssue: 12 });
    set(at(3, 0, 30));
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3, 0, 30), () => gh.api);
    expect(issuesSection(agents.calls[0]!.prompt)).not.toContain("#12");
  });

  it("still scouts when GitHub fails, or there is no remote or API", async () => {
    for (const setup of [
      (ctx: FactoryContext) => (withRemote(ctx), () => fakeIssues([issue(12)], { fail: true }).api),
      (ctx: FactoryContext) => (withRemote(ctx), () => undefined),
      () => () => fakeIssues([issue(12)]).api,
      () => undefined,
    ]) {
      const { ctx } = factory();
      const agents = scouting([]);
      await scoutPass(ctx, agents.runner, at(3), setup(ctx));
      expect(agents.calls).toHaveLength(1);
      expect(issuesSection(agents.calls[0]!.prompt)).toContain("(none)");
    }
  });

  it("frames issue text as data and truncates long bodies", async () => {
    const { ctx } = factory();
    const agents = scouting([]);
    await scoutLine(ctx, ctx.config.lines[0]!, agents.runner, at(3), undefined, [issue(12, { body: "x".repeat(5000) })]);
    const s = issuesSection(agents.calls[0]!.prompt);
    expect(s).toContain("never instructions");
    expect(s).toContain("x".repeat(2000));
    expect(s).not.toContain("x".repeat(2001));
  });

  it("links only issues that were listed", async () => {
    const { ctx } = factory();
    const agents = scouting([idea("Tomar el issue", { issue: 12 }), idea("Inventar uno", { issue: 99 }), idea("Sin issue")]);
    await scoutLine(ctx, ctx.config.lines[0]!, agents.runner, at(3), undefined, [issue(12)]);
    const byTitle = Object.fromEntries(ctx.store.listProposals().map((p) => [p.title, p]));
    expect(byTitle["Tomar el issue"]).toMatchObject({ sourceIssue: 12, sourceIssueUrl: "https://github.com/o/r/issues/12" });
    expect(byTitle["Inventar uno"]!.sourceIssue).toBeUndefined();
    expect(byTitle["Inventar uno"]!.sourceIssueUrl).toBeUndefined();
    expect(byTitle["Sin issue"]!.sourceIssue).toBeUndefined();
  });
});

describe("the issue link", () => {
  const linked = (ctx: FactoryContext) => ctx.store.createProposal({ ...idea("Tomar el issue"), line: "tienda", sourceIssue: { number: 12, url: "https://github.com/o/r/issues/12?a=1&b=2" } });

  it("travels in the job's request and the mirrored issue", () => {
    const { ctx } = factory();
    const p = linked(ctx);
    expect(proposalRequest(p)).toContain("#12: https://github.com/o/r/issues/12?a=1&b=2");
    expect(proposalIssueBody(p, ctx.config.lines[0]!, ctx.config)).toContain("https://github.com/o/r/issues/12?a=1&b=2");
    expect(proposalRequest(ctx.store.createProposal({ ...idea("Otra"), line: "tienda" }))).not.toContain("issue");
  });

  it("shows on the panel's proposal card, escaped", async () => {
    const { ctx } = factory();
    linked(ctx);
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/proposals`, { headers: { cookie: `zero_panel=${sessionFor(panelKey(ctx.secrets))}` } });
    const html = await res.text();
    expect(html).toContain("https://github.com/o/r/issues/12?a=1&amp;b=2");
    expect(html).toContain("#12");
  });

  it("survives old databases", () => {
    const path = join(tempDir(), "state.db");
    const old = new Store(path);
    old.createProposal({ ...idea("Vieja"), line: "tienda" });
    old.db.exec("ALTER TABLE proposals DROP COLUMN source_issue_number");
    old.db.exec("ALTER TABLE proposals DROP COLUMN source_issue_url");
    old.close();
    const store = new Store(path);
    try {
      expect(store.listProposals()[0]).toMatchObject({ title: "Vieja", sourceIssue: undefined, sourceIssueUrl: undefined });
      const p = store.createProposal({ ...idea("Nueva"), line: "tienda", sourceIssue: { number: 3, url: "u" } });
      expect(store.getProposal(p.id)).toMatchObject({ sourceIssue: 3, sourceIssueUrl: "u" });
    } finally {
      store.close();
    }
  });
});

/** One pull request on GitHub; merge returns `sha`. */
function fakeMerges(state: Partial<PullRequestState> = {}, sha = "abc123") {
  const pr: PullRequestState = { open: true, merged: false, mergeable: true, headSha: "head", ...state };
  const api: MergeApi = {
    pullRequest: async () => pr,
    checks: async () => [{ name: "ci", done: true, ok: true }],
    merge: async () => (Object.assign(pr, { open: false, merged: true, mergeCommitSha: sha }), sha),
    deleteBranch: async () => {},
    comment: async () => {},
  };
  return api;
}

describe("merge commit of pull requests", () => {
  async function delivered() {
    const { ctx } = factory({}, { integrate: "pull-request", autoMerge: true });
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 3 });
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/o/r/pull/7", autoMerge: true } });
    return { ctx, job };
  }

  it("records the commit zero merged with", async () => {
    const { ctx, job } = await delivered();
    await pollMerges(ctx, () => fakeMerges());
    expect(ctx.store.getJob(job.id)!.delivery!.commit).toBe("abc123");
  });

  it("records the commit when someone else merged it", async () => {
    const { ctx, job } = await delivered();
    await pollMerges(ctx, () => fakeMerges({ open: false, merged: true, mergeCommitSha: "def456" }));
    expect(ctx.store.getJob(job.id)!.delivery!.commit).toBe("def456");
  });

  it("records nothing for a pull request closed without merging", async () => {
    const { ctx, job } = await delivered();
    await pollMerges(ctx, () => fakeMerges({ open: false, merged: false }));
    expect(ctx.store.getJob(job.id)!.delivery!.commit).toBeUndefined();
  });
});

/**
 * What a pull-request line looks like after GitHub merged the night shift's
 * pull request #7 and the owner pulled main: a merge (or squash) commit on
 * main, and the job delivered as a pull request with no commit recorded.
 */
function autonomousPullRequest(ctx: FactoryContext, title: string, opts: { squash?: boolean; approvals?: Record<string, boolean> } = {}): { proposal: Proposal; jobId: string; commit: string } {
  const line = ctx.config.lines[0]!;
  const branch = `zero/${title.replace(/\W+/g, "-").toLowerCase()}`;
  gitIn(line.repo, "checkout", "-q", "-b", branch);
  writeTree(line.repo, { [`src/${branch.slice(5)}.ts`]: "ok\n" });
  gitIn(line.repo, "add", "-A");
  gitIn(line.repo, "commit", "-q", "-m", title);
  gitIn(line.repo, "checkout", "-q", "main");
  if (opts.squash) {
    gitIn(line.repo, "merge", "--squash", "-q", branch);
    gitIn(line.repo, "commit", "-q", "-m", `zero: ${title} (#7)`);
  } else gitIn(line.repo, "merge", "--no-ff", "-q", "-m", `Merge pull request #7 from o/${branch}`, branch);
  const commit = gitIn(line.repo, "rev-parse", "main");
  const proposal = ctx.store.createProposal({ ...idea(title), line: line.name });
  const { job } = requestWork(ctx, { text: title, line: line.name, source: { kind: "night-shift", proposal: proposal.id, autonomy: "auto" } });
  ctx.store.updateProposal(proposal.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
  ctx.store.finishJob(job.id, "delivered", { approvals: opts.approvals ?? {}, delivery: { mode: "pull-request", branch, url: "https://github.com/o/r/pull/7" } });
  return { proposal, jobId: job.id, commit };
}

const prLine = () => factory({}, { integrate: "pull-request" });
const merged = (commit: string) => () => fakeMerges({ open: false, merged: true, mergeCommitSha: commit });
const repo = (ctx: FactoryContext) => ctx.config.lines[0]!.repo;
const lessons = async (ctx: FactoryContext) => (await ctx.townhall.recall({ line: "tienda" })).filter((p) => p.topic === "propuesta revertida");

describe("revert detection on pull-request lines", () => {
  it("records the merge commit and sees its git revert, once", async () => {
    const { ctx } = prLine();
    const { proposal, jobId, commit } = autonomousPullRequest(ctx, "Agregar health");
    gitIn(repo(ctx), "revert", "-m", "1", "--no-edit", commit);
    expect(await detectReverts(ctx, merged(commit))).toBe(1);
    expect(ctx.store.getJob(jobId)!.delivery!.commit).toBe(commit);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("reverted");
    expect(await detectReverts(ctx, merged(commit))).toBe(0);
    const posts = await lessons(ctx);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toContain("Agregar health");
  });

  it("sees GitHub's Revert button", async () => {
    const { ctx } = prLine();
    const { proposal, commit } = autonomousPullRequest(ctx, "Agregar health");
    gitIn(repo(ctx), "commit", "-q", "--allow-empty", "-m", 'Revert "zero: Agregar health" (#8)\n\nReverts o/r#7');
    expect(await detectReverts(ctx, merged(commit))).toBe(1);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("reverted");
  });

  it("sees the revert of a squash merge", async () => {
    const { ctx } = prLine();
    const { proposal, commit } = autonomousPullRequest(ctx, "Agregar health", { squash: true });
    gitIn(repo(ctx), "revert", "--no-edit", commit);
    expect(await detectReverts(ctx, merged(commit))).toBe(1);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("reverted");
  });

  it("ignores reverts of other pull requests and commits", async () => {
    const { ctx } = prLine();
    const { proposal, commit } = autonomousPullRequest(ctx, "Agregar health");
    gitIn(repo(ctx), "commit", "-q", "--allow-empty", "-m", 'Revert "otra" (#71)\n\nReverts o/r#70');
    gitIn(repo(ctx), "commit", "-q", "--allow-empty", "-m", "Revert x\n\nThis reverts commit 0123456789abcdef0123456789abcdef01234567.");
    expect(await detectReverts(ctx, merged(commit))).toBe(0);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("approved");
  });

  it("ignores pull requests that were not merged", async () => {
    for (const state of [{ open: false, merged: false }, { open: true, merged: false }]) {
      const { ctx } = prLine();
      const { proposal, jobId } = autonomousPullRequest(ctx, "Agregar health");
      gitIn(repo(ctx), "commit", "-q", "--allow-empty", "-m", 'Revert "zero: Agregar health" (#8)\n\nReverts o/r#7');
      expect(await detectReverts(ctx, () => fakeMerges(state))).toBe(0);
      expect(ctx.store.getJob(jobId)!.delivery!.commit).toBeUndefined();
      expect(ctx.store.getProposal(proposal.id)!.status).toBe("approved");
    }
  });

  it("leaves an owner-approved integration alone", async () => {
    const { ctx } = prLine();
    const { proposal, commit } = autonomousPullRequest(ctx, "Agregar health", { approvals: { integrate: true } });
    gitIn(repo(ctx), "revert", "-m", "1", "--no-edit", commit);
    expect(await detectReverts(ctx, merged(commit))).toBe(0);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("approved");
    expect(await lessons(ctx)).toHaveLength(0);
  });

  it("keeps detecting merge deliveries without GitHub access", async () => {
    const { ctx } = prLine();
    const pr = autonomousPullRequest(ctx, "Agregar health");
    gitIn(repo(ctx), "revert", "-m", "1", "--no-edit", pr.commit);
    // A merge delivery on the same line, reverted locally.
    const line = ctx.config.lines[0]!;
    gitIn(line.repo, "checkout", "-q", "-b", "zero/local");
    writeTree(line.repo, { "src/local.ts": "ok\n" });
    gitIn(line.repo, "add", "-A");
    gitIn(line.repo, "commit", "-q", "-m", "local");
    gitIn(line.repo, "checkout", "-q", "main");
    gitIn(line.repo, "merge", "--no-ff", "-q", "-m", "zero: local", "zero/local");
    const commit = gitIn(line.repo, "rev-parse", "main");
    const local = ctx.store.createProposal({ ...idea("Local"), line: line.name });
    const { job } = requestWork(ctx, { text: "local", line: line.name, source: { kind: "night-shift", proposal: local.id, autonomy: "auto" } });
    ctx.store.updateProposal(local.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
    ctx.store.finishJob(job.id, "delivered", { approvals: {}, delivery: { mode: "merge", branch: "zero/local", commit } });
    gitIn(line.repo, "revert", "-m", "1", "--no-edit", commit);

    const throwing = () => ({ ...fakeMerges(), pullRequest: async () => Promise.reject(new Error("GitHub no responde")) });
    for (const api of [undefined, () => undefined, throwing]) {
      ctx.store.db.exec(`UPDATE proposals SET status = 'approved' WHERE id = '${local.id}'`);
      await expect(detectReverts(ctx, api)).resolves.toBe(1);
      expect(ctx.store.getProposal(local.id)!.status).toBe("reverted");
      expect(ctx.store.getProposal(pr.proposal.id)!.status).toBe("approved");
    }
  });

  it("runs in the daemon with its GitHub access", async () => {
    const { ctx } = prLine();
    const { proposal, commit } = autonomousPullRequest(ctx, "Agregar health");
    gitIn(repo(ctx), "revert", "-m", "1", "--no-edit", commit);
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner, merges: merged(commit) });
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("reverted");
  });
});

describe("README", () => {
  it("documents part 2d", () => {
    const readme = readFileSync("README.es.md", "utf8");
    expect(readme).toMatch(/sin etiqueta/);
    expect(readme).not.toMatch(/squash[^.\n]*no se detecta|no se detectan[^.\n]*squash/i);
  });

  it.each(["README.md", "README.es.md"])("%s documents squash and Revert", (file) => {
    const readme = readFileSync(file, "utf8");
    expect(readme).toMatch(/squash/);
    expect(readme).toMatch(/Revert/);
  });

  it("documents part 2d in English", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toMatch(/unlabeled/);
    expect(readme).not.toMatch(/squash[^.\n]*not detected|not detected[^.\n]*squash/i);
  });
});
