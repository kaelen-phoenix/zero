import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, jamViews, type FactoryContext } from "../src/app.js";
import { formatDiscard } from "../src/format.js";
import { githubMerges, mergeKey, type MergeApi, type PullRequestState } from "../src/line/automerge.js";
import { discardJob } from "../src/line/discard.js";
import { finalizeJob, prRefreshKey, reasonForOthers } from "../src/line/finish.js";
import { unjamKey } from "../src/line/unjam.js";
import { signedMerges } from "../src/signature.js";
import type { Job } from "../src/state/store.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

/** One pull request on GitHub; records every call that writes. */
function fakeGitHub(over: Partial<PullRequestState> = {}) {
  const did: string[] = [];
  const api: MergeApi = {
    pullRequest: async () => ({ open: true, merged: false, mergeable: true, headSha: "abc", base: "main", ...over }),
    checks: async () => [],
    merge: async () => undefined,
    deleteBranch: async (b) => void did.push(`delete ${b}`),
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
    close: async (n) => void did.push(`close #${n}`),
  };
  return { api, did };
}

function factory() {
  const repo = gitRepo();
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request" }] });
  return { ctx, repo };
}

/** A job with its branch in the repository, one commit ahead of main. */
function newJob(ctx: FactoryContext, repo: string): Job {
  const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
  ctx.tracer.start("zero.job", { id: ctx.tracer.jobSpanId(job.id), jobId: job.id });
  gitIn(repo, "checkout", "-q", "-b", `zero/${job.id}`);
  writeTree(repo, { "a.txt": job.id });
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "work");
  gitIn(repo, "checkout", "-q", "main");
  return job;
}

const deliver = (ctx: FactoryContext, job: Job, branch = `zero/${job.id}`) =>
  finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch, url: "https://github.com/kaelen/demo/pull/7" } });

const branches = (repo: string) => gitIn(repo, "branch", "--format=%(refname:short)").split("\n").sort();

describe("discarding a job", () => {
  it("ends a failed job stopped with the reason, and tells the townhall", async () => {
    const { ctx, repo } = factory();
    const job = await finalizeJob(ctx, newJob(ctx, repo), "failed", { reason: "no" });
    const r = await discardJob(ctx, job.id, { reason: " ya está en main ", via: "cli" });
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", reason: "Lo descartaste vos: ya está en main" });
    expect(r).toMatchObject({ branch: { name: `zero/${job.id}`, local: true, remote: false }, problems: [] });
    expect(branches(repo)).toEqual(["main"]);
    const posts = (await ctx.townhall.recall({ line: "demo" })).filter((p) => p.kind === "run" && p.job === job.id);
    expect(posts.map((p) => p.body)).toContain("Lo descartó la persona responsable: ya está en main");
    expect(ctx.store.spansForJob(job.id).find((s) => s.name === "zero.job")!.attrs["zero.outcome"]).toBe("stopped");
  });

  it("discards queued and waiting jobs, without a reason too", async () => {
    const { ctx, repo } = factory();
    const queued = newJob(ctx, repo);
    const waiting = ctx.store.updateJob(newJob(ctx, repo).id, { status: "waiting" });
    for (const job of [queued, waiting]) {
      await discardJob(ctx, job.id, { via: "cli" });
      expect(ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", reason: "Lo descartaste vos." });
    }
    expect(reasonForOthers("Lo descartaste vos.")).toBe("Lo descartó la persona responsable.");
  });

  it("refuses a running, stopped or unknown job, and leaves it as it was", async () => {
    const { ctx, repo } = factory();
    const job = ctx.store.updateJob(newJob(ctx, repo).id, { status: "running" });
    await expect(discardJob(ctx, job.id, { via: "cli" })).rejects.toThrow(/zero stop/);
    expect(ctx.store.getJob(job.id)).toEqual(job);
    const stopped = await finalizeJob(ctx, newJob(ctx, repo), "stopped", { reason: "Lo detuviste vos." });
    await expect(discardJob(ctx, stopped.id, { via: "cli" })).rejects.toThrow(/ya está detenido/);
    expect(ctx.store.getJob(stopped.id)!.reason).toBe("Lo detuviste vos.");
    await expect(discardJob(ctx, "nope", { via: "cli" })).rejects.toThrow("No existe el trabajo nope.");
  });

  it("refuses a delivered job with no open pull request", async () => {
    const { ctx, repo } = factory();
    const branch = newJob(ctx, repo);
    await finalizeJob(ctx, branch, "delivered", { delivery: { mode: "branch", branch: `zero/${branch.id}` } });
    await expect(discardJob(ctx, branch.id, { via: "cli" })).rejects.toThrow(/no tiene un pull request abierto/);
    for (const over of [{ open: false, merged: true }, { open: false }]) {
      const job = await deliver(ctx, newJob(ctx, repo));
      const gh = fakeGitHub(over);
      await expect(discardJob(ctx, job.id, { via: "cli", api: () => gh.api })).rejects.toThrow(/ya no está abierto/);
      expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
      expect(gh.did).toEqual([]);
      expect(branches(repo)).toContain(`zero/${job.id}`);
    }
  });

  it("refuses a delivered job merged on record when GitHub cannot be read", async () => {
    const { ctx, repo } = factory();
    const job = await deliver(ctx, newJob(ctx, repo));
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "merged" }));
    await expect(discardJob(ctx, job.id, { via: "cli", api: () => undefined })).rejects.toThrow(/ya no está abierto/);
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("checks the job again after GitHub answers", async () => {
    const { ctx, repo } = factory();
    const job = await deliver(ctx, newJob(ctx, repo));
    const gh = fakeGitHub();
    const api: MergeApi = { ...gh.api, pullRequest: async (n) => (ctx.store.updateJob(job.id, { status: "running" }), gh.api.pullRequest(n)) };
    await expect(discardJob(ctx, job.id, { via: "cli", api: () => api })).rejects.toThrow(/zero stop/);
    expect(gh.did).toEqual([]);
  });
});

describe("the pull request and the branch of a discarded job", () => {
  it("comments, closes it and deletes the branch here and on GitHub", async () => {
    const { ctx, repo } = factory();
    const job = await deliver(ctx, newJob(ctx, repo));
    const gh = fakeGitHub();
    const r = await discardJob(ctx, job.id, { reason: "quedó viejo", via: "cli", api: () => gh.api });
    expect(gh.did[0]).toMatch(/^comment #7: La fábrica descartó .*: quedó viejo\. /);
    expect(gh.did.slice(1)).toEqual(["close #7", `delete zero/${job.id}`]);
    expect(branches(repo)).toEqual(["main"]);
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", delivery: { url: "https://github.com/kaelen/demo/pull/7" } });
    expect(r.problems).toEqual([]);
    const text = formatDiscard(r);
    expect(text).toContain("quedó detenido");
    expect(text).toContain("https://github.com/kaelen/demo/pull/7: cerrado.");
    expect(text).toContain(`Rama zero/${job.id}: borrada en el repositorio de la línea y en GitHub.`);
  });

  it("still discards the job when GitHub fails, and says so", async () => {
    const { ctx, repo } = factory();
    const job = await deliver(ctx, newJob(ctx, repo));
    const gh = fakeGitHub();
    const api: MergeApi = {
      ...gh.api,
      close: async () => {
        throw new Error("boom");
      },
    };
    const r = await discardJob(ctx, job.id, { via: "cli", api: () => api });
    expect(ctx.store.getJob(job.id)!.status).toBe("stopped");
    expect(r.pullRequest).toMatchObject({ closed: false });
    expect(r.problems).toEqual([expect.stringMatching(/pull request .*boom/)]);
    expect(formatDiscard(r)).toContain("Problema: No pude cerrar el pull request");

    const unread = await deliver(ctx, newJob(ctx, repo));
    const all = async () => {
      throw new Error("sin red");
    };
    const r2 = await discardJob(ctx, unread.id, { via: "cli", api: () => ({ ...gh.api, pullRequest: all, comment: all, close: all, deleteBranch: all }) });
    expect(ctx.store.getJob(unread.id)!.status).toBe("stopped");
    expect(r2.problems).toHaveLength(4);

    const noAccess = await deliver(ctx, newJob(ctx, repo));
    const r3 = await discardJob(ctx, noAccess.id, { via: "cli", api: () => undefined });
    expect(ctx.store.getJob(noAccess.id)!.status).toBe("stopped");
    expect(r3.problems).toEqual([expect.stringContaining("Sin acceso a GitHub")]);
  });

  it("does not count a branch that is not on GitHub as a problem", async () => {
    const { ctx, repo } = factory();
    const job = await deliver(ctx, newJob(ctx, repo));
    const gh = fakeGitHub();
    const api: MergeApi = {
      ...gh.api,
      deleteBranch: async () => {
        throw Object.assign(new Error("Reference does not exist"), { status: 422 });
      },
    };
    expect(await discardJob(ctx, job.id, { via: "cli", api: () => api })).toMatchObject({ branch: { local: true, remote: false }, problems: [] });
  });

  it("never deletes the base branch nor a branch outside zero/", async () => {
    const { ctx, repo } = factory();
    const gh = fakeGitHub();
    const base = await deliver(ctx, newJob(ctx, repo), "main");
    gitIn(repo, "checkout", "-q", "--detach");
    expect((await discardJob(ctx, base.id, { via: "cli", api: () => gh.api })).branch).toMatchObject({ local: false, remote: false, kept: "es una rama base" });
    gitIn(repo, "branch", "feature");
    const foreign = await deliver(ctx, newJob(ctx, repo), "feature");
    expect((await discardJob(ctx, foreign.id, { via: "cli", api: () => gh.api })).branch.kept).toMatch(/zero\//);
    expect(branches(repo)).toEqual(expect.arrayContaining(["main", "feature"]));
    expect(gh.did.filter((d) => d.startsWith("delete"))).toEqual([]);
  });

  it("leaves a branch that is checked out, and says so", async () => {
    const { ctx, repo } = factory();
    const job = await finalizeJob(ctx, newJob(ctx, repo), "failed", { reason: "no" });
    gitIn(repo, "worktree", "add", "-q", join(tempDir(), "copy"), `zero/${job.id}`);
    const r = await discardJob(ctx, job.id, { via: "cli" });
    expect(r).toMatchObject({ job: { status: "stopped" }, branch: { local: false }, problems: [expect.stringContaining("copia de trabajo")] });
    expect(branches(repo).some((b) => b.endsWith(`zero/${job.id}`))).toBe(true);
  });

  it("leaves a merged pull request of a failed job alone", async () => {
    const { ctx, repo } = factory();
    const delivered = await deliver(ctx, newJob(ctx, repo));
    const job = ctx.store.updateJob(delivered.id, { status: "failed" });
    const gh = fakeGitHub({ open: false, merged: true });
    const r = await discardJob(ctx, job.id, { via: "cli", api: () => gh.api });
    expect(r).toMatchObject({ job: { status: "stopped" }, pullRequest: { closed: false, was: "merged" } });
    expect(gh.did).toEqual([`delete zero/${job.id}`]);
  });

  it("ends stopped a job that was updating its pull request", async () => {
    const { ctx, repo } = factory();
    const delivered = await deliver(ctx, newJob(ctx, repo));
    const job = ctx.store.updateJob(delivered.id, { status: "queued" });
    ctx.store.setKv(prRefreshKey(job.id), JSON.stringify({ head: gitIn(repo, "rev-parse", `zero/${job.id}`) }));
    const gh = fakeGitHub();
    await discardJob(ctx, job.id, { via: "cli", api: () => gh.api });
    expect(ctx.store.getJob(job.id)!.status).toBe("stopped");
    expect(ctx.store.getKv(prRefreshKey(job.id))).toBeUndefined();
    expect(gh.did).toContain("close #7");
  });

  it("closes a pull request through the GitHub adapter, signed or not", async () => {
    const calls: unknown[] = [];
    const client = { pulls: { update: async (p: unknown) => void calls.push(p) } } as unknown as Octokit;
    const api = githubMerges("t", "kaelen/demo", client);
    await api.close!(7);
    await signedMerges(api, { text: "— firma", trailer: "Built-by: x" }).close!(8);
    expect(calls).toEqual([7, 8].map((n) => ({ owner: "kaelen", repo: "demo", pull_number: n, state: "closed" })));
    const { close: _close, ...old } = fakeGitHub().api;
    expect(signedMerges(old, { text: "— firma", trailer: "Built-by: x" }).close).toBeUndefined();
  });
});

describe("causes of closed jobs", () => {
  const store = (ctx: FactoryContext, jams: string[]) =>
    ctx.store.setKv(unjamKey("demo"), JSON.stringify({ at: "2026-11-20T03:00:00.000Z", causes: [{ title: "Trabajo viejo", kind: "code", jams, diagnosis: "d", action: "none", paths: [], estimatedUsd: 0, needsNewCredentials: false }] }));

  it("leave the status once their jobs are discarded", async () => {
    const { ctx, repo } = factory();
    const job = await finalizeJob(ctx, newJob(ctx, repo), "failed", { reason: "no" });
    store(ctx, [`job:${job.id}`]);
    expect(jamViews(ctx)).toHaveLength(1);
    await discardJob(ctx, job.id, { via: "cli" });
    expect(jamViews(ctx)).toEqual([]);
    expect(factoryStatus(ctx).jams).toEqual([]);
  });

  it("stay while any of their jams is not a closed job's", async () => {
    const { ctx, repo } = factory();
    const [a, b] = [await finalizeJob(ctx, newJob(ctx, repo), "failed", { reason: "no" }), await finalizeJob(ctx, newJob(ctx, repo), "failed", { reason: "no" })];
    store(ctx, [`job:${a!.id}`, `job:${b!.id}`]);
    await discardJob(ctx, a!.id, { via: "cli" });
    expect(jamViews(ctx)).toHaveLength(1);
    store(ctx, [`job:${a!.id}`, "install"]);
    expect(jamViews(ctx)).toHaveLength(1);
    store(ctx, ["job:unknown"]);
    expect(jamViews(ctx)).toHaveLength(1);
  });

  it("stay for a delivered pull request only while its merge is blocked", async () => {
    const { ctx, repo } = factory();
    const job = await deliver(ctx, newJob(ctx, repo));
    store(ctx, [`pr:${job.id}`]);
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked" }));
    expect(jamViews(ctx)).toHaveLength(1);
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "merged" }));
    expect(jamViews(ctx)).toEqual([]);
  });
});

describe("zero descartar", () => {
  const zero = (ctx: FactoryContext, ...args: string[]) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
    return { code: r.status, output: r.stdout + r.stderr };
  };

  it("discards from the terminal, and says how to use it", async () => {
    const { ctx, repo } = factory();
    const job = await finalizeJob(ctx, newJob(ctx, repo), "failed", { reason: "no" });
    const done = zero(ctx, "descartar", job.id, "--motivo", "ya está en main");
    expect(done.output).toContain("quedó detenido. Lo descartaste vos: ya está en main");
    expect(done.output).toContain("No tenía un pull request que cerrar.");
    expect(done.output).toContain("borrada en el repositorio de la línea");
    expect(done.code).toBe(0);
    expect(ctx.store.getJob(job.id)!.status).toBe("stopped");

    const usage = zero(ctx, "descartar");
    expect(usage.code).not.toBe(0);
    expect(usage.output).toContain("zero descartar <trabajo>");
    expect(zero(ctx, "help").output).toMatch(/^ {2}zero descartar <trabajo> /m);
  }, 60_000);
});
