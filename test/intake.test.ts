import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answer, factoryStatus, requestWork, setIssueIntake } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { formatStatus } from "../src/format.js";
import { pollIssues, type Issue, type IssueApi } from "../src/intake/github.js";
import { askOwner, finalizeJob } from "../src/line/finish.js";
import { deliveryBody, runJob } from "../src/line/runner.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, simulatedBox, tempDir, testFactory, validSpec, writeTree } from "./helpers.js";

afterEach(cleanup);

describe("pull requests start from the remote's base", () => {
  /** The owner's clone of a remote that moved on: a pull request was accepted on GitHub. */
  function ownerBehindRemote() {
    const remote = tempDir("zero-remote-");
    run("git", ["init", "-q", "--bare", "-b", "main"], remote);
    const owner = gitRepo();
    gitIn(owner, "remote", "add", "origin", remote);
    gitIn(owner, "push", "-q", "origin", "main");
    const other = tempDir("zero-other-");
    run("git", ["clone", "-q", remote, other], tempDir());
    writeTree(other, { "accepted.txt": "merged on GitHub\n" });
    gitIn(other, "add", "-A");
    gitIn(other, "commit", "-q", "-m", "accepted PR");
    gitIn(other, "push", "-q", "origin", "main");
    return { owner, localMain: gitIn(owner, "rev-parse", "main") };
  }

  for (const isolation of ["worktree", "container"] as const) {
    it(`builds on what was accepted, without moving the owner's branch (${isolation} copy)`, async () => {
      const { owner, localMain } = ownerBehindRemote();
      const ctx = testFactory({ level: "L2", isolation, lines: [{ name: "demo", repo: owner, integrate: "pull-request", verify: [] }] });
      let sawAccepted = false;
      const agents = fakeAgents({
        build: (req) => {
          sawAccepted = existsSync(join(req.cwd, "accepted.txt"));
          writeTree(req.cwd, { "src/feature.ts": "export const x = 1;\n" });
        },
      });
      const { job } = requestWork(ctx, { text: "feature" });
      const box = isolation === "container" ? { box: simulatedBox(agents.runner).box, boxAvailability: { ready: true, problems: [] } } : {};
      // There is no GitHub here, so the job stops at publishing; what matters is where it started.
      const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, ...box });

      expect(sawAccepted).toBe(true);
      expect(done.base).toBe("origin/main");
      expect(gitIn(owner, "rev-parse", "main")).toBe(localMain);
      expect(gitIn(owner, "diff", "--name-only", `origin/main...zero/${job.id}`).split("\n").filter((f) => !f.startsWith("openspec/"))).toEqual(["src/feature.ts"]);
    });
  }

  it("starts from the local branch when the remote does not answer", async () => {
    const owner = gitRepo();
    gitIn(owner, "remote", "add", "origin", join(tempDir(), "missing.git"));
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: owner, integrate: "pull-request", verify: [] }] });
    const agents = fakeAgents({ build: (req) => writeTree(req.cwd, { "a.ts": "1\n" }) });
    const { job } = requestWork(ctx, { text: "x" });
    expect((await runJob(job.id, { ...ctx, runAgent: agents.runner })).base).toBe("main");
  });

  it("keeps merge lines on the owner's local branch", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [] }] });
    const agents = fakeAgents({ build: (req) => writeTree(req.cwd, { "a.ts": "1\n" }) });
    const { job } = requestWork(ctx, { text: "x" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered", base: "main" });
  });
});

/** GitHub with issues, labels and permissions in memory; records every comment. */
function fakeGitHub(opts: { permissions?: Record<string, string> } = {}) {
  const issues: (Issue & { labels: string[] })[] = [];
  const labeledAt = new Map<number, { actor: string; at: string }>();
  const comments: { number: number; body: string }[] = [];
  let clock = 0;
  const api: IssueApi = {
    labeled: async (label) => issues.filter((i) => i.labels.includes(label)),
    lastLabeled: async (n) => labeledAt.get(n),
    permission: async (login) => opts.permissions?.[login] ?? (login === "owner" ? "admin" : "read"),
    comment: async (number, body) => void comments.push({ number, body }),
    ensureLabel: async () => false,
  };
  const label = (number: number, actor = "owner") => {
    const issue = issues.find((i) => i.number === number)!;
    if (!issue.labels.includes("zero")) issue.labels.push("zero");
    labeledAt.set(number, { actor, at: new Date(Date.UTC(2030, 0, 1, 0, 0, ++clock)).toISOString() });
  };
  const open = (number: number, over: Partial<Issue> = {}) => {
    issues.push({ number, title: `Issue ${number}`, body: "Agregá un endpoint de salud.", author: "owner", url: `https://github.com/kaelen/demo/issues/${number}`, isPullRequest: false, labels: [], ...over });
    label(number, over.author === "stranger" ? "owner" : (over.author ?? "owner"));
  };
  return { api, open, label, comments };
}

function issueFactory() {
  const repo = gitRepo();
  gitIn(repo, "remote", "add", "origin", "https://github.com/kaelen/demo.git");
  return testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request", issues: { label: "zero" } }] });
}

describe("GitHub issues as requests", () => {
  it("turns a labeled issue into one job, says so on the issue, and remembers where it came from", async () => {
    const ctx = issueFactory();
    const gh = fakeGitHub();
    gh.open(7, { title: "Salud del servicio" });
    await pollIssues(ctx, () => gh.api);
    await pollIssues(ctx, () => gh.api);

    const jobs = ctx.store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      line: "demo",
      request: "Issue #7 de GitHub: Salud del servicio\n\nAgregá un endpoint de salud.",
      source: { kind: "github-issue", repository: "kaelen/demo", number: 7, url: "https://github.com/kaelen/demo/issues/7" },
    });
    expect(gh.comments).toEqual([{ number: 7, body: expect.stringContaining(`trabajo \`${jobs[0]!.id}\``) }]);
  });

  it("closes the issue from the pull request", () => {
    const ctx = issueFactory();
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3, source: { kind: "github-issue", repository: "kaelen/demo", number: 7, url: "u" } });
    expect(deliveryBody(validSpec(), job)).toContain("\n\nCloses #7\n");
    expect(deliveryBody(validSpec(), ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 }))).not.toContain("Closes");
  });

  it("does not take issues written or labeled by someone without write access, and says why once", async () => {
    const ctx = issueFactory();
    const gh = fakeGitHub({ permissions: { owner: "write", triager: "read" } });
    gh.open(3, { author: "stranger" });
    gh.open(4);
    gh.label(4, "triager");
    gh.open(5, { isPullRequest: true });
    await pollIssues(ctx, () => gh.api);
    await pollIssues(ctx, () => gh.api);

    expect(ctx.store.listJobs()).toHaveLength(0);
    expect(gh.comments.map((c) => c.number)).toEqual([3, 4]);
    expect(gh.comments[0]!.body).toMatch(/lo escribió @stranger, que no tiene permiso de escritura/);
    expect(gh.comments[1]!.body).toMatch(/la etiqueta la puso @triager/);
  });

  it("tells the issue when its job needs the owner and when it ends, once each", async () => {
    const ctx = issueFactory();
    const gh = fakeGitHub();
    gh.open(9);
    await pollIssues(ctx, () => gh.api);
    const job = ctx.store.listJobs()[0]!;

    askOwner(ctx, ctx.store.getJob(job.id)!, { kind: "before-integrate", text: "¿Lo integro?" });
    await pollIssues(ctx, () => gh.api);
    await pollIssues(ctx, () => gh.api);
    expect(gh.comments.at(-1)!.body).toContain("> ¿Lo integro?");
    expect(gh.comments).toHaveLength(2);

    await answer(ctx, job.id, "approve");
    await finalizeJob(ctx, ctx.store.getJob(job.id)!, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/kaelen/demo/pull/10" } });
    await pollIssues(ctx, () => gh.api);
    await pollIssues(ctx, () => gh.api);
    expect(gh.comments.at(-1)!.body).toBe("Listo: solicitud de cambio https://github.com/kaelen/demo/pull/10.");
    expect(gh.comments).toHaveLength(3);
  });

  it("takes the issue again only when it is labeled again after its job ended", async () => {
    const ctx = issueFactory();
    const gh = fakeGitHub();
    gh.open(2);
    await pollIssues(ctx, () => gh.api);
    const first = ctx.store.listJobs()[0]!;
    await finalizeJob(ctx, first, "failed", { reason: "no compila" });
    await pollIssues(ctx, () => gh.api);
    expect(ctx.store.listJobs()).toHaveLength(1);
    expect(gh.comments.at(-1)!.body).toMatch(/no se pudo completar:\n\n> no compila/);

    gh.label(2);
    await pollIssues(ctx, () => gh.api);
    expect(ctx.store.listJobs()).toHaveLength(2);
  });

  it("reports a line it cannot read, without stopping the others", async () => {
    const ctx = issueFactory();
    await pollIssues(ctx, () => undefined);
    expect(formatStatus(factoryStatus(ctx))).toContain('Issues de GitHub: la línea demo toma los issues con la etiqueta "zero" · PROBLEMA: sin acceso a GitHub');
    const gh = fakeGitHub();
    await pollIssues(ctx, () => gh.api);
    expect(formatStatus(factoryStatus(ctx))).not.toContain("PROBLEMA");
  });

  it("is turned on and off per line, keeping the file's comments", async () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo() }] });
    const text = () => readFileSync(ctx.home.config, "utf8");
    await setIssueIntake(ctx, { on: true });
    expect(parseFactory(text()).lines[0]!.issues).toEqual({ label: "zero" });
    await setIssueIntake(ctx, { on: true, label: "fabrica" });
    expect(parseFactory(text()).lines[0]!.issues).toEqual({ label: "fabrica" });
    await setIssueIntake(ctx, { on: false });
    expect(parseFactory(text()).lines[0]!.issues).toBeUndefined();
  });
});
