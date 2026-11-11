import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ACCESS, agentName, quotaAttrs } from "../src/agent.js";
import { ANDON_KEY, approveProposal, briefing, factoryStatus, monthlyReport, retryJob } from "../src/app.js";
import { AGENT_STATIONS, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { intakeProblemKey } from "../src/intake/keys.js";
import { mergeKey, type MergeApi, type MergeState } from "../src/line/automerge.js";
import { scoutSpent } from "../src/line/scout.js";
import { collectJams, readDiagnosis, unjamKey, unjamLine, unjamPass, unjamRetriedKey } from "../src/line/unjam.js";
import { cleanupKey } from "../src/line/cleanup.js";
import { formatStatus } from "../src/format.js";
import { overviewPage } from "../src/panel/html.js";
import { reportHtml, reportMarkdown } from "../src/report.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory, validSpec } from "./helpers.js";

afterEach(cleanup);

const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);

function factory(over: Record<string, unknown> = {}, start = at(3)) {
  let clock = start;
  const ctx = testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}
type Ctx = ReturnType<typeof factory>["ctx"];

function failedJob(ctx: Ctx, reason = "verify falló", finishedAt = at(2, 0, 28)) {
  const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "arreglar el carrito", budgetUsd: 1 });
  return ctx.store.updateJob(job.id, { status: "failed", reason, feedback: "test/panel-line.test.ts timed out", attempt: 3, finishedAt: finishedAt.toISOString() });
}

function blockedPr(ctx: Ctx, n: number, state: Partial<MergeState> = {}) {
  const job = ctx.store.createJob({ line: "tienda", kind: "request", request: `pedido ${n}`, budgetUsd: 1 });
  ctx.store.updateJob(job.id, { status: "delivered", delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: `https://github.com/acme/tienda/pull/${n}`, autoMerge: true } });
  ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked", why: "fallaron los checks: android", ...state }));
  return job;
}

const cause = (over: Record<string, unknown> = {}) => ({ title: "Checks de android rotos", kind: "ci", jams: [], diagnosis: "El workflow de android falla", action: "none", todo: "Revisá el workflow", ...over });
const diagnosing = (causes: unknown[], cost = 0.1) => fakeAgents({ unjam: () => ({ output: { causes } }) }, cost);

describe("unjam station", () => {
  it("is read-only and has its own instructions", () => {
    expect(AGENT_STATIONS).toContain("unjam");
    expect(AGENT_ACCESS.unjam).toBe("read");
    expect(existsSync(new URL("../agents/unjam.md", import.meta.url))).toBe(true);
  });

  it("is on by default with two jobs a day, and can be turned off", () => {
    expect(parseFactory("").unjam).toEqual({ maxJobsPerDay: 2 });
    expect(parseFactory("unjam: off").unjam).toBe("off");
    expect(parseFactory("").stations.unjam.maxTurns).toBe(40);
  });
});

describe("collecting jams", () => {
  it("a failed job and a pull request in conflict", () => {
    const { ctx } = factory();
    const failed = failedJob(ctx);
    const pr = blockedPr(ctx, 7, { why: "tiene conflictos con la rama base", backoff: { sha: "abc", mergeable: false, why: "conflicto", delayMs: 1, nextChecksAt: at(4).toISOString() } });
    const jams = collectJams(ctx, ctx.config.lines[0]!, at(3));
    expect(jams.find((j) => j.kind === "failed-job")).toMatchObject({ id: `job:${failed.id}`, job: failed.id });
    expect(jams.find((j) => j.kind === "failed-job")!.text).toContain("verify falló");
    expect(jams.find((j) => j.kind === "pull-request")).toMatchObject({ id: `pr:${pr.id}`, conflict: true, url: "https://github.com/acme/tienda/pull/7" });
  });

  it("leaves out stopped jobs and old failures", () => {
    const { ctx } = factory();
    const stopped = ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
    ctx.store.updateJob(stopped.id, { status: "stopped", finishedAt: at(2).toISOString() });
    failedJob(ctx, "viejo", at(2, 0, 19));
    expect(collectJams(ctx, ctx.config.lines[0]!, at(3))).toEqual([]);
  });

  it("an intake problem", () => {
    const { ctx } = factory();
    ctx.store.setKv(intakeProblemKey("tienda"), "GitHub respondió 403");
    const jams = collectJams(ctx, ctx.config.lines[0]!, at(3));
    expect(jams).toHaveLength(1);
    expect(jams[0]).toMatchObject({ kind: "intake", line: "tienda" });
    expect(jams[0]!.text).toContain("GitHub respondió 403");
  });

  it("a waiting job", () => {
    const { ctx } = factory();
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
    ctx.store.updateJob(job.id, { status: "waiting" });
    expect(collectJams(ctx, ctx.config.lines[0]!, at(3)).map((j) => j.kind)).toEqual(["waiting-job"]);
  });
});

describe("when unjam runs", () => {
  it("never calls the agent without jams", async () => {
    const { ctx } = factory();
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("diagnoses each line once per period, on the line's repo", async () => {
    const { ctx, set } = factory();
    failedJob(ctx);
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3));
    await unjamPass(ctx, agents.runner, at(15));
    expect(agents.calls.map((c) => [c.station, c.cwd])).toEqual([["unjam", ctx.config.lines[0]!.repo]]);
    set(at(3, 0, 30));
    await unjamPass(ctx, agents.runner, at(3, 0, 30));
    expect(agents.count.unjam).toBe(2);
  });

  it("steps aside for andon, owner work and when off", async () => {
    const agents = diagnosing([]);
    const andon = factory();
    failedJob(andon.ctx);
    andon.ctx.store.setKv(ANDON_KEY, "on");
    await unjamPass(andon.ctx, agents.runner, at(3));
    const busy = factory();
    failedJob(busy.ctx);
    busy.ctx.store.createJob({ line: "tienda", kind: "request", request: "y", budgetUsd: 1 });
    await unjamPass(busy.ctx, agents.runner, at(3));
    const off = factory({ unjam: "off" });
    failedJob(off.ctx);
    await unjamPass(off.ctx, agents.runner, at(3));
    const night = factory({ nightShift: "off" });
    failedJob(night.ctx);
    await unjamPass(night.ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("shares usdPerNight with scout", async () => {
    const { ctx } = factory({ limits: { usdPerNight: 1 } });
    failedJob(ctx);
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout", "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 1, ...quotaAttrs({ billing: "api", windows: [] }) });
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("passes what is left as the call's cap, and its spend counts", async () => {
    const { ctx } = factory({ limits: { usdPerNight: 1 } });
    failedJob(ctx);
    const agents = diagnosing([], 0.5);
    await unjamPass(ctx, agents.runner, at(3));
    expect(agents.calls[0]!.maxBudgetUsd).toBeCloseTo(1);
    expect(scoutSpent(ctx.store, at(0), at(3))).toBeCloseTo(0.5);
  });
});

describe("the daemon's idle run", () => {
  it("runs unjam after scout and before research", async () => {
    const { ctx } = factory({ level: "L2", lines: [{ name: "tienda", repo: gitRepo(), stations: { research: { skills: ["investigar"] } } }] }, new Date());
    failedJob(ctx, "verify falló", new Date());
    const agents = fakeAgents({});
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, scout: true, unjam: true, research: true, agentRunner: () => agents.runner });
    expect(agents.calls.map(agentName)).toEqual(["scout", "unjam", "research"]);
  });
});

describe("failed checks' logs", () => {
  function fakeMerges(failedLog: (run: number, check: string) => Promise<string | undefined>) {
    const logs: [number, string][] = [];
    const api: MergeApi = {
      pullRequest: async (n) => ({ open: true, merged: false, mergeable: true, headSha: `sha${n}` }),
      checks: async (sha) => [
        { name: "android", done: true, ok: false, run: Number(sha.slice(3)) * 100 },
        { name: "lint", done: true, ok: true, run: 1 },
      ],
      merge: async () => undefined,
      deleteBranch: async () => {},
      comment: async () => {},
      failedLog: (run, check) => {
        logs.push([run, check]);
        return failedLog(run, check);
      },
    };
    const repos: string[] = [];
    return { logs, repos, factory: (repository: string) => (repos.push(repository), api) };
  }

  it("reads one log per repository and check, and puts its end in the prompt", async () => {
    const { ctx } = factory();
    const prs = [1, 2, 3].map((n) => blockedPr(ctx, n));
    const merges = fakeMerges(async () => `${"x".repeat(5000)}\nGradle falló en C:\\Users\\alguien\\app\\build.gradle`);
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3), undefined, merges.factory);
    expect(merges.logs).toEqual([[100, "android"]]);
    expect(merges.repos).toEqual(["acme/tienda", "acme/tienda", "acme/tienda"]);
    const prompt = agents.calls[0]!.prompt;
    for (const p of prs) expect(prompt).toContain(`pr:${p.id}`);
    expect(prompt.split("failed check android, end of its log")).toHaveLength(4);
    expect(prompt).toContain("Gradle falló en (ruta local)");
    expect(prompt).not.toContain("alguien");
    expect(prompt).not.toContain("x".repeat(3001));
    expect(prompt).not.toContain("failed check lint");
  });

  it("keeps the jam without a log when the read fails", async () => {
    const { ctx } = factory();
    const pr = blockedPr(ctx, 1);
    const job = failedJob(ctx);
    const merges = fakeMerges(async () => {
      throw new Error("404");
    });
    const agents = diagnosing([cause({ jams: [`pr:${pr.id}`, `job:${job.id}`] })]);
    await unjamPass(ctx, agents.runner, at(3), undefined, merges.factory);
    expect(agents.calls[0]!.prompt).toContain(`pr:${pr.id}`);
    expect(agents.calls[0]!.prompt).toContain("failed check android (no log)");
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.jams).toHaveLength(2);
  });

  it("keeps the jam as it was when GitHub cannot be read", async () => {
    const { ctx } = factory();
    const pr = blockedPr(ctx, 1);
    const api = fakeMerges(async () => "log");
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3), undefined, () => ({ ...api.factory("acme/tienda"), pullRequest: async () => Promise.reject(new Error("GitHub en pausa")) }));
    expect(agents.calls[0]!.prompt).toContain(`pr:${pr.id}`);
    expect(api.logs).toEqual([]);
  });
});

describe("what unjam keeps", () => {
  it("one cause for the same checks failing in fifteen pull requests", async () => {
    const { ctx } = factory();
    const prs = Array.from({ length: 15 }, (_, i) => blockedPr(ctx, i + 1));
    const ids = prs.map((p) => `pr:${p.id}`);
    const agents = diagnosing([cause({ jams: ids }), cause({ title: "checks de Android  rotos", jams: [ids[0]] })]);
    await unjamPass(ctx, agents.runner, at(3));
    for (const id of ids) expect(agents.calls[0]!.prompt).toContain(id);
    const saved = readDiagnosis(ctx.store, "tienda")!;
    expect(saved.at).toBe(at(3).toISOString());
    expect(saved.causes).toHaveLength(1);
    expect(saved.causes[0]).toMatchObject({ kind: "ci", action: "none", todo: "Revisá el workflow" });
    expect(saved.causes[0]!.jams).toEqual(ids);
  });

  it("drops a cause that only names a jam not in the prompt, and unknown jams of the others", async () => {
    const { ctx } = factory();
    const job = failedJob(ctx);
    const agents = diagnosing([cause({ title: "Inventada", jams: ["job:ffffffff"] }), cause({ jams: [`job:${job.id}`, "pr:00000000"] })]);
    await unjamPass(ctx, agents.runner, at(3));
    const saved = readDiagnosis(ctx.store, "tienda")!;
    expect(saved.causes.map((c) => c.title)).toEqual(["Checks de android rotos"]);
    expect(saved.causes[0]!.jams).toEqual([`job:${job.id}`]);
  });

  it("keeps at most ten causes", async () => {
    const { ctx } = factory();
    const job = failedJob(ctx);
    const agents = diagnosing(Array.from({ length: 12 }, (_, i) => cause({ title: `Causa ${i}`, jams: [`job:${job.id}`] })));
    await unjamPass(ctx, agents.runner, at(3));
    expect(readDiagnosis(ctx.store, "tienda")!.causes).toHaveLength(10);
  });

  it("scrubs local paths", async () => {
    const { ctx } = factory();
    const job = failedJob(ctx);
    const agents = diagnosing([cause({ jams: [`job:${job.id}`], diagnosis: "Falla en C:\\Users\\alguien\\repo\\test.ts", todo: "Borrá /home/alguien/.cache" })]);
    await unjamPass(ctx, agents.runner, at(3));
    const saved = readDiagnosis(ctx.store, "tienda")!.causes[0]!;
    expect(saved.diagnosis).toBe("Falla en (ruta local)");
    expect(saved.todo).toBe("Borrá (ruta local)");
  });

  it("replaces the diagnosis, and forgets it once the line has no jams", async () => {
    const { ctx, set } = factory();
    const job = failedJob(ctx);
    await unjamPass(ctx, diagnosing([cause({ jams: [`job:${job.id}`] })]).runner, at(3));
    expect(readDiagnosis(ctx.store, "tienda")!.causes).toHaveLength(1);
    ctx.store.updateJob(job.id, { status: "stopped" });
    set(at(3, 0, 30));
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3, 0, 30));
    expect(agents.calls).toHaveLength(0);
    expect(readDiagnosis(ctx.store, "tienda")).toBeUndefined();
  });

  it("lists the earlier causes in the next prompt", async () => {
    const { ctx, set } = factory();
    const job = failedJob(ctx);
    await unjamPass(ctx, diagnosing([cause({ jams: [`job:${job.id}`] })]).runner, at(3));
    set(at(3, 0, 30));
    const agents = diagnosing([]);
    await unjamPass(ctx, agents.runner, at(3, 0, 30));
    expect(agents.calls[0]!.prompt).toContain("- Checks de android rotos (ci, action none, 1 jam");
  });
});

describe("fix jobs from unjam", () => {
  const fix = (over: Record<string, unknown> = {}) => cause({ title: "Actualizar el workflow de android", action: "fix", todo: null, request: "Arreglá el workflow de android", paths: ["android/app/build.gradle"], estimatedUsd: 0.5, needsNewCredentials: false, ...over });
  const lineOf = (ctx: Ctx) => ctx.config.lines[0]!;
  const unjamProposals = (ctx: Ctx) => ctx.store.listProposals({ line: "tienda" }).filter((p) => p.origin === "unjam");

  it("on a build line opens a low-priority night-shift job of origin unjam", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" } });
    const pr = blockedPr(ctx, 1);
    await unjamPass(ctx, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, at(3));
    const [proposal] = unjamProposals(ctx);
    expect(proposal).toMatchObject({ status: "approved", decidedBy: "night-shift", why: "El workflow de android falla", change: "Arreglá el workflow de android", paths: ["android/app/build.gradle"] });
    const job = ctx.store.getJob(proposal!.jobId!)!;
    expect(job).toMatchObject({ status: "queued", priority: "baja", source: { kind: "night-shift", proposal: proposal!.id, autonomy: "build", origin: "unjam" } });
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]).toMatchObject({ proposal: proposal!.id, job: job.id });
  });

  it("on a propose line leaves the proposal pending", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const pr = blockedPr(ctx, 1);
    await unjamPass(ctx, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, at(3));
    const [proposal] = unjamProposals(ctx);
    expect(proposal).toMatchObject({ status: "pending", origin: "unjam" });
    expect(proposal!.jobId).toBeUndefined();
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(0);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.proposal).toBe(proposal!.id);
  });

  it("opens at most unjam.maxJobsPerDay jobs, and the rest wait", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" }, unjam: { maxJobsPerDay: 1 } });
    const a = blockedPr(ctx, 1);
    const b = blockedPr(ctx, 2);
    await unjamPass(ctx, diagnosing([fix({ jams: [`pr:${a.id}`] }), fix({ title: "Estabilizar el test del panel", jams: [`pr:${b.id}`] })]).runner, at(3));
    expect(unjamProposals(ctx).map((p) => p.status)).toEqual(["approved", "pending"]);
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(1);
  });

  it("does not repeat a cause whose job is still open, or one the owner rejected", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" } });
    const pr = blockedPr(ctx, 1);
    const jams = collectJams(ctx, lineOf(ctx), at(3));
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, at(3));
    const [first] = unjamProposals(ctx);
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ title: "actualizar el workflow de  Android", jams: [`pr:${pr.id}`] })]).runner, at(4));
    expect(unjamProposals(ctx)).toHaveLength(1);
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(1);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]).toMatchObject({ proposal: first!.id, job: first!.jobId });

    const rejected = ctx.store.createProposal({ line: "tienda", title: "Estabilizar el test del panel", why: "x", change: "y", estimatedUsd: 0, paths: [], origin: "unjam" });
    ctx.store.updateProposal(rejected.id, { status: "rejected", decidedBy: "owner" });
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ title: "Estabilizar el test del panel", jams: [`pr:${pr.id}`] })]).runner, at(5));
    expect(unjamProposals(ctx)).toHaveLength(2);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.proposal).toBeUndefined();
  });

  it("proposes again once the earlier job finished", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" } });
    const pr = blockedPr(ctx, 1);
    const jams = collectJams(ctx, lineOf(ctx), at(3));
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, at(3));
    ctx.store.updateJob(unjamProposals(ctx)[0]!.jobId!, { status: "failed", finishedAt: at(4).toISOString() });
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, at(5));
    expect(unjamProposals(ctx)).toHaveLength(2);
  });

  it("drops a fix on protected paths or with new credentials", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" }, limits: { protectedPaths: ["infra/**"] } });
    const pr = blockedPr(ctx, 1);
    const jams = collectJams(ctx, lineOf(ctx), at(3));
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ paths: ["infra/ci.tf"], jams: [`pr:${pr.id}`] }), fix({ title: "Token nuevo", needsNewCredentials: true, jams: [`pr:${pr.id}`] })]).runner, at(3));
    expect(unjamProposals(ctx)).toHaveLength(0);
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(0);
    expect(readDiagnosis(ctx.store, "tienda")!.causes).toHaveLength(2);
  });

  it("keeps the origin when the owner approves a pending one", () => {
    const { ctx } = factory();
    const proposal = ctx.store.createProposal({ line: "tienda", title: "Arreglar CI", why: "x", change: "y", estimatedUsd: 0, paths: [], origin: "unjam" });
    const { job } = approveProposal(ctx, proposal.id);
    expect(job.source).toEqual({ kind: "night-shift", proposal: proposal.id, origin: "unjam" });
  });
});

describe("retrying a job", () => {
  const specFailed = (ctx: Ctx, finishedAt = at(2, 0, 28)) => {
    const job = failedJob(ctx, "verify falló", finishedAt);
    return ctx.store.updateJob(job.id, { spec: validSpec(), checkpoint: "spec", stagesDone: 1 });
  };

  it("puts a failed job with a spec back in the queue from its checkpoint", () => {
    const { ctx } = factory();
    const job = specFailed(ctx);
    expect(retryJob(ctx, job.id).kind).toBe("queued");
    const after = ctx.store.getJob(job.id)!;
    expect(after).toMatchObject({ status: "queued", attempt: 0, checkpoint: "spec", stagesDone: 1, stopRequested: false });
    expect(after.finishedAt).toBeUndefined();
    expect(after.feedback).toBeUndefined();
  });

  it("refuses a failed job without a spec, other statuses and a pending cleanup, changing nothing", () => {
    const { ctx } = factory();
    const noSpec = failedJob(ctx);
    expect(() => retryJob(ctx, noSpec.id)).toThrow(/sin especificación/);
    expect(ctx.store.getJob(noSpec.id)).toEqual(noSpec);

    const stopped = ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
    ctx.store.updateJob(stopped.id, { status: "stopped" });
    expect(() => retryJob(ctx, stopped.id)).toThrow(/solo se reintenta/);

    const pr = blockedPr(ctx, 3);
    expect(() => retryJob(ctx, pr.id)).toThrow(/solo se reintenta/);

    const busy = specFailed(ctx);
    ctx.store.setKv(cleanupKey(busy.id), JSON.stringify({ repo: "r", path: "p" }));
    expect(() => retryJob(ctx, busy.id)).toThrow(/no se pudo borrar/);
    expect(ctx.store.getJob(busy.id)!.status).toBe("failed");
  });

  const retry = (jams: string[]) => cause({ title: "Test intermitente del panel", kind: "flaky-test", action: "retry", todo: null, jams });

  it("unjam retries each job once in its life on a build line", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" } });
    const job = specFailed(ctx);
    const line = ctx.config.lines[0]!;
    await unjamLine(ctx, line, collectJams(ctx, line, at(3)), diagnosing([retry([`job:${job.id}`])]).runner, at(3));
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.job).toBe(job.id);
    expect(ctx.store.getKv(unjamRetriedKey(job.id))).toBe(at(3).toISOString());

    ctx.store.updateJob(job.id, { status: "failed", attempt: 3, finishedAt: at(4).toISOString() });
    await unjamLine(ctx, line, collectJams(ctx, line, at(3, 0, 30)), diagnosing([retry([`job:${job.id}`])]).runner, at(3, 0, 30));
    expect(ctx.store.getJob(job.id)!).toMatchObject({ status: "failed", attempt: 3 });
  });

  it("counts retries in the daily cap", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" }, unjam: { maxJobsPerDay: 1 } });
    const a = specFailed(ctx);
    const b = specFailed(ctx);
    const line = ctx.config.lines[0]!;
    await unjamLine(ctx, line, collectJams(ctx, line, at(3)), diagnosing([retry([`job:${a.id}`, `job:${b.id}`])]).runner, at(3));
    expect([a, b].map((j) => ctx.store.getJob(j.id)!.status).sort()).toEqual(["failed", "queued"]);
  });

  it("on a propose line retries nothing and says how", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const job = specFailed(ctx);
    const line = ctx.config.lines[0]!;
    await unjamLine(ctx, line, collectJams(ctx, line, at(3)), diagnosing([retry([`job:${job.id}`])]).runner, at(3));
    expect(ctx.store.getJob(job.id)!.status).toBe("failed");
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.todo).toContain(`zero reintentar ${job.id}`);
    expect(ctx.store.getKv(unjamRetriedKey(job.id))).toBeUndefined();
  });
});

describe("jams in sight", () => {
  function diagnosed(causes: unknown[]) {
    const { ctx } = factory();
    ctx.store.setKv(unjamKey("tienda"), JSON.stringify({ at: at(3).toISOString(), causes }));
    return ctx;
  }
  function withOpenJob() {
    const ctx = diagnosed([]);
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "arreglar el CI", budgetUsd: 1 });
    const prs = Array.from({ length: 15 }, (_, i) => `pr:${i}`);
    ctx.store.setKv(unjamKey("tienda"), JSON.stringify({ at: at(3).toISOString(), causes: [cause({ kind: "ci", action: "fix", jams: prs, job: job.id, todo: undefined })] }));
    return { ctx, job };
  }

  it("is a Trabas block in zero status, one line per cause", () => {
    const { ctx, job } = withOpenJob();
    const s = factoryStatus(ctx);
    expect(s.jams).toEqual([{ line: "tienda", title: "Checks de android rotos", kind: "ci", action: "fix", jams: 15, job: job.id, at: at(3).toISOString() }]);
    const text = formatStatus(s);
    expect(text).toContain("Trabas:");
    expect(text).toContain(`- tienda · Checks de android rotos · 15 trabas · CI · trabajo ${job.id}`);
  });

  it("shows what to do once the job is over", () => {
    const { ctx, job } = withOpenJob();
    ctx.store.updateJob(job.id, { status: "delivered", finishedAt: at(4).toISOString() });
    const s = factoryStatus(ctx);
    expect(s.jams[0]!.job).toBeUndefined();
    const machine = diagnosed([cause({ kind: "machine", jams: ["box"], todo: "Instalá Podman o Docker" })]);
    expect(formatStatus(factoryStatus(machine))).toContain("tienda · Checks de android rotos · 1 traba · máquina · qué hacer: Instalá Podman o Docker");
  });

  it("is in the panel's overview", () => {
    const { ctx } = withOpenJob();
    const html = overviewPage(factoryStatus(ctx), ["tienda"], "nonce");
    expect(html).toContain("Trabas:");
    expect(html).toContain("Checks de android rotos");
  });

  it("says nothing without a diagnosis", () => {
    const { ctx } = factory();
    const s = factoryStatus(ctx);
    expect(s.jams).toEqual([]);
    expect(formatStatus(s)).not.toContain("Trabas:");
    expect(overviewPage(s, ["tienda"], "nonce")).not.toContain("Trabas:");
  });

  it("is a section of the briefing", async () => {
    const { ctx } = withOpenJob();
    const body = (await briefing(ctx)).body;
    expect(body).toContain("## Trabas");
    expect(body).toContain("Checks de android rotos");
    const { ctx: none } = factory();
    expect((await briefing(none)).body).not.toContain("## Trabas");
  });

  it("is a section of the monthly report with what to do, only for causes code cannot fix", () => {
    const ctx = diagnosed([cause({ kind: "machine", jams: ["box"], title: "Sin caja de aislamiento", todo: "Instalá Podman o Docker" }), cause({ action: "fix", title: "Arreglar el CI", todo: undefined })]);
    const [line] = monthlyReport(ctx, { line: "tienda", month: "2026-09" }).lines;
    expect(line!.jams).toEqual([{ title: "Sin caja de aislamiento", kind: "máquina", todo: "Instalá Podman o Docker" }]);
    for (const text of [reportMarkdown(line!), reportHtml(line!)]) {
      expect(text).toContain("Trabas");
      expect(text).toContain("Instalá Podman o Docker");
      expect(text).not.toContain("Arreglar el CI");
    }
  });

  it("leaves the report without Trabas when every cause can be fixed with code", () => {
    const ctx = diagnosed([cause({ action: "fix", todo: undefined })]);
    const [line] = monthlyReport(ctx, { line: "tienda", month: "2026-09" }).lines;
    expect(line!.jams).toBeUndefined();
    expect(reportMarkdown(line!)).not.toContain("Trabas");
    expect(reportHtml(line!)).not.toContain("Trabas");
  });
});
