import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approveProposal, rejectProposal } from "../src/app.js";
import { pollIssues, type Issue, type IssueApi, type IssueState } from "../src/intake/github.js";
import { issueKey } from "../src/intake/keys.js";
import { PROPOSAL_LABEL, syncProposalIssues } from "../src/intake/proposals.js";
import { deliveryBody } from "../src/line/runner.js";
import { cleanup, gitIn, gitRepo, testFactory, validSpec } from "./helpers.js";

afterEach(cleanup);

const idea = { title: "Cubrir el egress con tests", why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, paths: ["test/egress.test.ts"] };

/** GitHub in memory: records every call the sync makes. */
function fakeGitHub(opts: { failCreate?: boolean } = {}) {
  const calls: { op: string; number?: number; title?: string; body?: string; labels?: string[] }[] = [];
  const issues: (Issue & { labels: string[]; state: "open" | "closed" })[] = [];
  const labeledAt = new Map<number, { actor: string; at: string }>();
  let clock = 0;
  const api: IssueApi = {
    labeled: async (label) => issues.filter((i) => i.state === "open" && i.labels.includes(label)),
    lastLabeled: async (n) => labeledAt.get(n),
    permission: async (login) => (login === "owner" ? "admin" : "read"),
    comment: async (number, body) => void calls.push({ op: "comment", number, body }),
    comments: async () => [],
    ensureLabel: async (label) => {
      calls.push({ op: "ensureLabel", labels: [label] });
      return false;
    },
    createIssue: async (title, body, labels) => {
      if (opts.failCreate) throw new Error("GitHub no responde");
      const number = issues.length + 5;
      issues.push({ number, title, body, author: "owner", url: `https://github.com/kaelen/demo/issues/${number}`, isPullRequest: false, labels: [...labels], state: "open" });
      calls.push({ op: "createIssue", number, title, body, labels });
      return { number, url: `https://github.com/kaelen/demo/issues/${number}` };
    },
    addLabels: async (number, labels) => {
      issues.find((i) => i.number === number)!.labels.push(...labels);
      labeledAt.set(number, { actor: "owner", at: new Date(Date.UTC(2030, 0, 1, 0, 0, ++clock)).toISOString() });
      calls.push({ op: "addLabels", number, labels });
    },
    close: async (number) => {
      issues.find((i) => i.number === number)!.state = "closed";
      calls.push({ op: "close", number });
    },
  };
  const ops = (op: string, number?: number) => calls.filter((c) => c.op === op && (number === undefined || c.number === number));
  return { api, calls, ops };
}

function githubRepo(remote = "https://github.com/kaelen/demo.git") {
  const repo = gitRepo();
  gitIn(repo, "remote", "add", "origin", remote);
  return repo;
}

function factory(lines = [{ name: "demo", repo: githubRepo() }]) {
  return testFactory({ level: "L2", isolation: "worktree", lines: lines.map((l) => ({ integrate: "pull-request", ...l })) });
}

describe("proposals as GitHub issues", () => {
  it("publishes a new proposal once, with only the proposal label", async () => {
    const ctx = factory();
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    await syncProposalIssues(ctx, () => gh.api);

    expect(gh.ops("ensureLabel")).toEqual([{ op: "ensureLabel", labels: [PROPOSAL_LABEL] }]);
    expect(gh.ops("createIssue")).toHaveLength(1);
    expect(gh.ops("createIssue")[0]).toMatchObject({ title: idea.title, labels: ["zero:propuesta"] });
    expect(ctx.store.getProposal(p.id)).toMatchObject({ issueNumber: 5, issueUrl: "https://github.com/kaelen/demo/issues/5" });
  });

  it("leaves lines without GitHub alone", async () => {
    const ctx = factory([{ name: "demo", repo: githubRepo("https://gitlab.com/kaelen/demo.git") }]);
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    let asked = 0;
    await syncProposalIssues(ctx, () => {
      asked++;
      return fakeGitHub().api;
    });
    expect(asked).toBe(0);
    expect(ctx.store.getProposal(p.id)!.issueNumber).toBeUndefined();
  });

  it("does not publish a proposal rejected before it had an issue", async () => {
    const ctx = factory();
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    await rejectProposal(ctx, p.id, "no");
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    expect(gh.calls).toEqual([]);
  });

  it("publishes no secrets and no paths of the owner's machine", async () => {
    const ctx = factory();
    const repo = ctx.config.lines[0]!.repo;
    const token = `ghp_${"a1B2".repeat(9)}`;
    const p = ctx.store.createProposal({
      ...idea,
      line: "demo",
      why: `el token ${token} quedó en el log`,
      change: `cambiar ${join(repo, "src", "log.ts")} y ${repo.replace(/\\/g, "/")}/src/x.ts y ${join(homedir(), ".zero", "state.db")}`,
    });
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    const body = gh.ops("createIssue")[0]!.body!;
    expect(body).not.toContain(token);
    expect(body.toLowerCase()).not.toContain(repo.toLowerCase());
    expect(body.toLowerCase()).not.toContain(repo.replace(/\\/g, "/").toLowerCase());
    expect(body.toLowerCase()).not.toContain(homedir().toLowerCase());
    expect(body).toContain(p.id);
    expect(body).toContain("Costo estimado: $0.50");
  });

  it("tells the issue about an approval once, labels it, and the intake opens no second job", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: githubRepo(), integrate: "pull-request", issues: { label: "zero" } }] });
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    const { job } = approveProposal(ctx, p.id);
    await syncProposalIssues(ctx, () => gh.api);
    await syncProposalIssues(ctx, () => gh.api);

    expect(gh.ops("comment", 5)).toEqual([{ op: "comment", number: 5, body: expect.stringContaining(job.id) }]);
    expect(gh.ops("addLabels", 5)).toEqual([{ op: "addLabels", number: 5, labels: ["zero"] }]);
    const state = JSON.parse(ctx.store.getKv(issueKey("kaelen/demo", 5))!) as IssueState;
    expect(state).toMatchObject({ job: job.id, labeledAt: expect.stringMatching(/^2030-/) });

    await pollIssues(ctx, () => gh.api);
    expect(ctx.store.listJobs()).toHaveLength(1);
    // Even once the job is over, the label the factory put on is not a new request.
    ctx.store.finishJob(job.id, "delivered", {});
    await pollIssues(ctx, () => gh.api);
    expect(ctx.store.listJobs()).toHaveLength(1);
  });

  it("uses the 'zero' label on lines that take no issues", async () => {
    const ctx = factory();
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    approveProposal(ctx, p.id);
    await syncProposalIssues(ctx, () => gh.api);
    expect(gh.ops("addLabels")).toEqual([{ op: "addLabels", number: 5, labels: ["zero"] }]);
  });

  it("comments the owner's reason on a rejection and closes the issue, once", async () => {
    const ctx = factory();
    ctx.store.createProposal({ ...idea, line: "demo" });
    const p = ctx.store.createProposal({ ...idea, title: "Otra cosa", line: "demo" });
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    expect(ctx.store.getProposal(p.id)!.issueNumber).toBe(6);
    await rejectProposal(ctx, p.id, "ya lo hicimos a mano");
    await syncProposalIssues(ctx, () => gh.api);
    await syncProposalIssues(ctx, () => gh.api);

    expect(gh.ops("comment", 6)).toEqual([{ op: "comment", number: 6, body: expect.stringContaining("ya lo hicimos a mano") }]);
    expect(gh.ops("close", 6)).toHaveLength(1);
    expect(gh.ops("close", 5)).toHaveLength(0);
  });

  it("says no reason was given when there was none", async () => {
    const ctx = factory();
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    await rejectProposal(ctx, p.id);
    await syncProposalIssues(ctx, () => gh.api);
    expect(gh.ops("comment", 5)[0]!.body).toContain("sin dar motivo");
  });

  it("publishes, comments and labels in one pass a proposal approved before it had an issue", async () => {
    const ctx = factory();
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    const { job } = approveProposal(ctx, p.id);
    const gh = fakeGitHub();
    await syncProposalIssues(ctx, () => gh.api);
    expect(gh.calls.map((c) => c.op)).toEqual(["ensureLabel", "createIssue", "comment", "addLabels"]);
    expect(gh.ops("comment", 5)[0]!.body).toContain(job.id);
  });

  it("keeps a GitHub failure on one line from stopping the others, and retries it", async () => {
    const ctx = factory([
      { name: "rota", repo: githubRepo("https://github.com/kaelen/rota.git") },
      { name: "demo", repo: githubRepo() },
    ]);
    const broken = ctx.store.createProposal({ ...idea, line: "rota" });
    const ok = ctx.store.createProposal({ ...idea, line: "demo" });
    const failing = fakeGitHub({ failCreate: true });
    const gh = fakeGitHub();
    const api = (repository: string) => (repository === "kaelen/rota" ? failing.api : gh.api);
    await expect(syncProposalIssues(ctx, api)).resolves.toBeUndefined();
    expect(ctx.store.getProposal(ok.id)!.issueNumber).toBe(5);
    expect(ctx.store.getProposal(broken.id)!.issueNumber).toBeUndefined();

    await syncProposalIssues(ctx, () => gh.api);
    expect(ctx.store.getProposal(broken.id)!.issueNumber).toBe(6);
  });
});

describe("the pull request closes the proposal's issue", () => {
  it("adds Closes #n when the proposal has an issue, and nothing otherwise", () => {
    const ctx = factory();
    const p = ctx.store.createProposal({ ...idea, line: "demo" });
    const { job } = approveProposal(ctx, p.id);
    expect(deliveryBody(validSpec(), job, ctx.store)).not.toContain("Closes");
    ctx.store.setProposalIssue(p.id, { number: 5, url: "https://github.com/kaelen/demo/issues/5" });
    expect(deliveryBody(validSpec(), job, ctx.store)).toContain("\n\nCloses #5\n");
  });
});
