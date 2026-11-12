import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { mergePullRequest, trace, type FactoryContext } from "../src/app.js";
import { mergeKey, pollMerges, watchedJobs, type Check, type MergeApi, type MergeState, type PullRequestState } from "../src/line/automerge.js";
import { finalizeJob } from "../src/line/finish.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { jobPage } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import type { Job, JobSource } from "../src/state/store.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const green: Check[] = [{ name: "ci", done: true, ok: true }];

/** One pull request on GitHub; records every call that writes. */
function fakeGitHub(checks: Check[] = green, over: Partial<PullRequestState> = {}) {
  const state = { pr: { open: true, merged: false, mergeable: true, headSha: "abc", ...over } as PullRequestState, checks, refuse: undefined as string | undefined };
  const did: string[] = [];
  const asked: string[] = [];
  const api: MergeApi = {
    pullRequest: async (n) => {
      asked.push(`pr #${n}`);
      return state.pr;
    },
    checks: async () => state.checks,
    merge: async (n, sha) => {
      if (state.refuse) throw new Error(state.refuse);
      did.push(`merge #${n} @${sha}`);
      state.pr = { ...state.pr, open: false, merged: true, mergeCommitSha: "merged-sha" };
      return "merged-sha";
    },
    deleteBranch: async (b) => void did.push(`delete ${b}`),
    comment: async (n, body) => void did.push(`comment #${n}: ${body}`),
    behind: async () => true,
    updateBranch: async (n) => void did.push(`update #${n}`),
    rerun: async (run) => void did.push(`rerun ${run}`),
  };
  return { api, state, did, asked };
}

async function delivered(opts: { autoMerge?: boolean; number?: number; source?: JobSource; mode?: "merge" } = {}) {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), integrate: "pull-request", autoMerge: opts.autoMerge ?? false }] });
  const job = await deliver(ctx, opts);
  return { ctx, job };
}

async function deliver(ctx: FactoryContext, opts: { autoMerge?: boolean; number?: number; source?: JobSource; mode?: "merge" } = {}): Promise<Job> {
  const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3, ...(opts.source && { source: opts.source }) });
  ctx.tracer.start("zero.job", { id: ctx.tracer.jobSpanId(job.id), jobId: job.id });
  const delivery = opts.mode === "merge"
    ? { mode: "merge" as const, branch: `zero/${job.id}`, commit: "c0ffee" }
    : { mode: "pull-request" as const, branch: `zero/${job.id}`, url: `https://github.com/kaelen/demo/pull/${opts.number ?? 5}`, ...(opts.autoMerge && { autoMerge: true }) };
  return finalizeJob(ctx, job, "delivered", { delivery });
}

const mergeState = (ctx: FactoryContext, job: Job) => JSON.parse(ctx.store.getKv(mergeKey(job.id)) ?? "{}") as MergeState;

describe("merging on request", () => {
  it("merges a ready pull request of a line without autoMerge, by url", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    const r = await mergePullRequest(ctx, "https://github.com/kaelen/demo/pull/5", { via: "cli", api: () => gh.api });
    expect(r).toMatchObject({ merged: true, commit: "merged-sha", job: job.id });
    expect(gh.did.filter((d) => d.startsWith("merge"))).toEqual(["merge #5 @abc"]);
    expect(ctx.store.getJob(job.id)!.delivery!.commit).toBe("merged-sha");
    expect(mergeState(ctx, job)).toMatchObject({ status: "merged", why: "fundido a pedido de quien está a cargo" });
    expect(gh.did).toContain(`delete zero/${job.id}`);
  });

  it("finds the pull request by job id, and by url regardless of case", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api })).toMatchObject({ merged: true });
    expect(gh.did[0]).toBe("merge #5 @abc");

    const other = await deliver(ctx, { number: 6 });
    const gh2 = fakeGitHub();
    expect(await mergePullRequest(ctx, "https://github.com/Kaelen/Demo/pull/6", { via: "cli", api: () => gh2.api })).toMatchObject({ merged: true, job: other.id });
  });

  it("refuses a pull request the factory did not deliver", async () => {
    const { ctx } = await delivered();
    const gh = fakeGitHub();
    await expect(mergePullRequest(ctx, "https://github.com/kaelen/demo/pull/99", { via: "cli", api: () => gh.api })).rejects.toThrow(/no entregó/);
    expect(gh.did).toEqual([]);
  });

  it("refuses a job that is not delivered or has no pull request", async () => {
    const { ctx } = await delivered();
    const failed = await finalizeJob(ctx, ctx.store.createJob({ line: "demo", kind: "request", request: "y", budgetUsd: 3 }), "failed", { reason: "no" });
    const merged = await deliver(ctx, { mode: "merge" });
    const gh = fakeGitHub();
    await expect(mergePullRequest(ctx, failed.id, { via: "cli", api: () => gh.api })).rejects.toThrow(/no está entregado/);
    await expect(mergePullRequest(ctx, merged.id, { via: "cli", api: () => gh.api })).rejects.toThrow(/pull request/);
    expect(gh.did).toEqual([]);
  });

  it("says how to sign in without a token, merging nothing", async () => {
    const { ctx, job } = await delivered();
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => undefined })).toMatchObject({ merged: false, why: expect.stringContaining("gh auth login") });
  });
});

describe("when it is not ready", () => {
  const writes = (did: string[]) => did.filter((d) => /^(merge|comment|update|rerun)/.test(d));

  it("says the failed checks and touches nothing", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub([...green, { name: "e2e", done: true, ok: false, run: 42 }]);
    const r = await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api });
    expect(r.merged).toBe(false);
    expect(r.why).toContain("fallaron los checks e2e");
    expect(writes(gh.did)).toEqual([]);
  });

  it("waits for running checks", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub([{ name: "ci", done: false, ok: false }]);
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api })).toMatchObject({ merged: false, why: "esperando checks" });
    expect(writes(gh.did)).toEqual([]);
  });

  it("says it has conflicts", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub(green, { mergeable: false });
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api })).toMatchObject({ merged: false, why: "en conflicto con la rama base" });
    expect(writes(gh.did)).toEqual([]);
  });

  it("says it was already merged and records it", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub(green, { open: false, merged: true, mergeCommitSha: "theirs" });
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api })).toMatchObject({ merged: false, why: "ya estaba fundido" });
    expect(mergeState(ctx, job).status).toBe("merged");
    expect(writes(gh.did)).toEqual([]);
  });

  it("says it is closed", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub(green, { open: false });
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api })).toMatchObject({ merged: false, why: "está cerrado sin fundir" });
  });

  it("brings back GitHub's refusal of the merge instead of throwing", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    gh.state.refuse = "Head branch was modified";
    const r = await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api });
    expect(r.merged).toBe(false);
    expect(r.why).toContain("Head branch was modified");
    expect(mergeState(ctx, job).status).not.toBe("merged");
  });
});

describe("what a merge on request leaves", () => {
  it("records a zero.merge span and a townhall post", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api });
    const span = ctx.store.spansForJob(job.id).find((s) => s.name === "zero.merge");
    expect(span).toMatchObject({ parentId: ctx.tracer.jobSpanId(job.id), attrs: { "zero.merge.via": "cli", "zero.merge.commit": "merged-sha", "zero.merge.url": "https://github.com/kaelen/demo/pull/5" } });
    expect(trace(ctx, job.id)).toContain("zero.merge");
    const posts = (await ctx.townhall.recall({ line: "demo" })).filter((p) => p.job === job.id && p.topic === "fundido a pedido");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toContain("https://github.com/kaelen/demo/pull/5");
    expect(posts[0]!.body).toContain("merged-sha");
  });

  it("tells the source issue, like the automatic merge", async () => {
    const { ctx, job } = await delivered({ source: { kind: "github-issue", repository: "kaelen/demo", number: 7, url: "u" } });
    const gh = fakeGitHub();
    await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api });
    expect(gh.did).toContain("comment #7: La fábrica fundió https://github.com/kaelen/demo/pull/5: el cambio ya está en la rama base.");
  });

  it("still merges when the townhall or the branch deletion fails", async () => {
    const { ctx, job } = await delivered();
    ctx.townhall.publish = async () => {
      throw new Error("townhall down");
    };
    const gh = fakeGitHub();
    gh.api.deleteBranch = async () => {
      throw new Error("no branch");
    };
    expect(await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api })).toMatchObject({ merged: true });
  });

  it("leaves the automatic pass nothing to do", async () => {
    const { ctx, job } = await delivered({ autoMerge: true });
    expect(watchedJobs(ctx).map((j) => j.id)).toEqual([job.id]);
    const gh = fakeGitHub();
    await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api });
    expect(watchedJobs(ctx)).toEqual([]);
    const calls = gh.asked.length + gh.did.length;
    await pollMerges(ctx, () => gh.api);
    expect(gh.asked.length + gh.did.length).toBe(calls);
  });
});

describe("from the chat and the CLI", () => {
  async function chat(ctx: FactoryContext, api: MergeApi) {
    const server = createZeroMcpServer(ctx.home, { autoStart: false, merges: () => api });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    return async (target: string) => {
      const r = (await client.callTool({ name: "zero_merge", arguments: { target } })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content[0]!.text, isError: r.isError ?? false };
    };
  }

  it("zero_merge merges a ready pull request and records the chat as where it came from", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    const r = await (await chat(ctx, gh.api))("https://github.com/kaelen/demo/pull/5");
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Fundí https://github.com/kaelen/demo/pull/5");
    expect(ctx.store.spansForJob(job.id).find((s) => s.name === "zero.merge")!.attrs["zero.merge.via"]).toBe("chat");
  });

  it("zero_merge says why it did not merge", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub([{ name: "e2e", done: true, ok: false }]);
    const r = await (await chat(ctx, gh.api))(job.id);
    expect(r.text.startsWith("No lo fundí:")).toBe(true);
    expect(r.text).toContain("fallaron los checks e2e");
  });

  it("lists zero fusionar in the CLI usage", () => {
    expect(readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8")).toContain("zero fusionar <trabajo | url>");
  });
});

describe("from the panel", () => {
  async function panel(ctx: FactoryContext, api: MergeApi) {
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets), merges: () => api });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
    return (path: string, form: Record<string, string> = {}) =>
      fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  }

  it("shows Fundir only on a delivered pull request not yet merged or closed", async () => {
    const { ctx } = await delivered({ number: 6 });
    const job = ctx.store.listJobs({ status: ["delivered"] })[0]!;
    const html = jobPage(job, "", "n");
    expect(html).toContain(`action="/job/${job.id}/merge"`);
    expect(html).toContain("Fundir");
    expect(jobPage(job, "", "n", undefined, false, "merged")).not.toContain("/merge\"");
    expect(jobPage(job, "", "n", undefined, false, "closed")).not.toContain("/merge\"");
    expect(jobPage(job, "", "n", undefined, false, "blocked")).toContain("/merge\"");

    const running = ctx.store.createJob({ line: "demo", kind: "request", request: "y", budgetUsd: 3 });
    expect(jobPage(running, "", "n")).not.toContain("/merge\"");
    const mergeMode = await deliver(ctx, { mode: "merge" });
    expect(jobPage(mergeMode, "", "n")).not.toContain("/merge\"");
  });

  it("hides it on the job page once the factory recorded the merge", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    await panel(ctx, gh.api);
    await mergePullRequest(ctx, job.id, { via: "cli", api: () => gh.api });
    const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
    const server = servers.at(-1)!;
    const html = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/job/${job.id}`, { headers: { cookie } })).text();
    expect(html).not.toContain(`/job/${job.id}/merge`);
  });

  it("asks for confirmation before merging", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    const post = await panel(ctx, gh.api);
    const r = await post(`/job/${job.id}/merge`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<input type="hidden" name="confirm" value="1">');
    expect(gh.did.filter((d) => d.startsWith("merge"))).toEqual([]);
  });

  it("merges once confirmed, records the panel and goes back to the job", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub();
    const post = await panel(ctx, gh.api);
    const r = await post(`/job/${job.id}/merge`, { confirm: "1" });
    expect(r.status).toBe(303);
    const location = r.headers.get("location")!;
    expect(location.startsWith(`/job/${job.id}`)).toBe(true);
    expect(new URL(location, "http://x").searchParams.get("msg")).toContain("Fundí");
    expect(gh.did.filter((d) => d.startsWith("merge"))).toEqual(["merge #5 @abc"]);
    expect(ctx.store.spansForJob(job.id).find((s) => s.name === "zero.merge")!.attrs["zero.merge.via"]).toBe("panel");
  });

  it("says why it did not merge, without forcing", async () => {
    const { ctx, job } = await delivered();
    const gh = fakeGitHub([{ name: "e2e", done: true, ok: false }]);
    const post = await panel(ctx, gh.api);
    const r = await post(`/job/${job.id}/merge`, { confirm: "1" });
    expect(new URL(r.headers.get("location")!, "http://x").searchParams.get("msg")).toMatch(/^No lo fundí: .*fallaron los checks e2e/);
    expect(gh.did).toEqual([]);
  });
});
