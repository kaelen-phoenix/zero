import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ACCESS, agentName, quotaAttrs } from "../src/agent.js";
import { ANDON_KEY, approveProposal, briefing, factoryStatus, monthlyReport, proposalsView, retryJob } from "../src/app.js";
import { AGENT_STATIONS, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { INSTALL_FRESHNESS_KEY } from "../src/install-freshness.js";
import { intakeProblemKey } from "../src/intake/keys.js";
import { mergeKey, pollMerges, stampBlocked, type Check, type MergeApi, type MergeState } from "../src/line/automerge.js";
import { readTrain } from "../src/line/train.js";
import { scoutSpent } from "../src/line/scout.js";
import { busyRetryKey, networkRetryKey, SPEC_REFUSAL } from "../src/line/runner.js";
import { recordSelfUpdate } from "../src/self-update.js";
import { collectJams, readDiagnosis, resendAfterCapability, unjamKey, unjamLine, unjamPass, unjamResentKey, unjamRetriedKey, unjamUrgentKey, urgentUnjamPass } from "../src/line/unjam.js";
import { cleanupKey } from "../src/line/cleanup.js";
import { formatStatus } from "../src/format.js";
import { overviewPage, proposalsPage } from "../src/panel/html.js";
import { reportHtml, reportMarkdown } from "../src/report.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitIn, gitRepo, testFactory, validSpec } from "./helpers.js";

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
    expect(parseFactory("").unjam).toEqual({ maxJobsPerDay: 2, urgentAfterHours: 2 });
    expect(parseFactory("unjam: { urgentAfterHours: 0 }").unjam).toEqual({ maxJobsPerDay: 2, urgentAfterHours: 0 });
    expect(parseFactory("unjam: off").unjam).toBe("off");
    expect(parseFactory("").stations.unjam.maxTurns).toBe(40);
  });
});

describe("collecting jams", () => {
  it("a failed job and a pull request in conflict", () => {
    const { ctx } = factory();
    const failed = failedJob(ctx);
    const pr = blockedPr(ctx, 7, { why: "en conflicto con la rama base", backoff: { sha: "abc", mergeable: false, why: "conflicto", delayMs: 1, nextChecksAt: at(4).toISOString() } });
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
    expect(proposal).toMatchObject({ status: "approved", decidedBy: "night-shift", change: "Arreglá el workflow de android", paths: ["android/app/build.gradle"] });
    expect(proposal!.why.startsWith("El workflow de android falla\n\nEvidencia:")).toBe(true);
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

  const refusedFix = async (finishedAt: Date, reason: string, again: Date) => {
    const { ctx } = factory({ nightShift: { autonomy: "build" } });
    const pr = blockedPr(ctx, 1);
    const jams = collectJams(ctx, lineOf(ctx), at(3));
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, at(3));
    const [first] = unjamProposals(ctx);
    ctx.store.updateJob(first!.jobId!, { status: "failed", reason, finishedAt: finishedAt.toISOString() });
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ jams: [`pr:${pr.id}`] })]).runner, again);
    return { ctx, first: first! };
  };

  it("keeps the title for seven days when the earlier job was refused at spec", async () => {
    const { ctx, first } = await refusedFix(at(4), `${SPEC_REFUSAL}: This is already done`, at(4, 0, 32));
    expect(unjamProposals(ctx)).toHaveLength(1);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]).toMatchObject({ proposal: first.id, job: first.jobId });
  });

  it("proposes again after seven days from a refusal at spec", async () => {
    const { ctx } = await refusedFix(at(4), `${SPEC_REFUSAL}: This is already done`, at(4, 0, 37));
    expect(unjamProposals(ctx)).toHaveLength(2);
  });

  it("proposes again at once when the earlier job failed at verify", async () => {
    const { ctx } = await refusedFix(at(4), "verify falló", at(4, 0, 30));
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

describe("evidence and lessons", () => {
  const fix = (over: Record<string, unknown> = {}) => cause({ title: "Actualizar el workflow de android", action: "fix", todo: null, request: "Arreglá el workflow de android", paths: [], estimatedUsd: 0.5, ...over });
  const lineOf = (ctx: Ctx) => ctx.config.lines[0]!;
  const lessons = async (ctx: Ctx) => (await ctx.townhall.recall({ line: "tienda", kinds: ["lesson"] })).filter((p) => p.topic.startsWith("traba repetida"));

  it("lists the jobs, the pull requests and how many jams on the proposal", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const job = failedJob(ctx);
    const pr = blockedPr(ctx, 9);
    const outage = { id: "outage:acme/tienda", line: "tienda", kind: "checks-outage" as const, text: "caído" };
    const jams = [...collectJams(ctx, lineOf(ctx), at(3)), outage];
    await unjamLine(ctx, lineOf(ctx), jams, diagnosing([fix({ jams: [`job:${job.id}`, `pr:${pr.id}`, outage.id] })]).runner, at(3));
    const [proposal] = ctx.store.listProposals({ line: "tienda" });
    expect(proposal!.why).toContain(job.id);
    expect(proposal!.why).toContain(pr.id);
    expect(proposal!.why).toContain("https://github.com/acme/tienda/pull/9");
    expect(proposal!.why).toContain("3 trabas");
    expect(proposal!.why).toContain("vista en 1 revisión");
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.seen).toBe(1);
  });

  it("counts a cause seen in consecutive diagnoses", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const job = failedJob(ctx);
    ctx.store.setKv(unjamKey("tienda"), JSON.stringify({ at: at(3, 0, 28).toISOString(), causes: [cause({ title: "actualizar el workflow de  Android", jams: [`job:${job.id}`], seen: 2 })] }));
    await unjamLine(ctx, lineOf(ctx), collectJams(ctx, lineOf(ctx), at(3)), diagnosing([fix({ jams: [`job:${job.id}`] }), cause({ title: "Otra", jams: [`job:${job.id}`] })]).runner, at(3));
    expect(readDiagnosis(ctx.store, "tienda")!.causes.map((c) => c.seen)).toEqual([3, 1]);
    expect(ctx.store.listProposals({ line: "tienda" })[0]!.why).toContain("3 revisiones");
  });

  it("publishes a lesson for a cause with two jams, none for a single new jam", async () => {
    const { ctx } = factory();
    const a = failedJob(ctx);
    const b = failedJob(ctx);
    await unjamLine(ctx, lineOf(ctx), collectJams(ctx, lineOf(ctx), at(3)), diagnosing([cause({ jams: [`job:${a.id}`, `job:${b.id}`] }), cause({ title: "Sola", jams: [`job:${a.id}`] })]).runner, at(3));
    const posts = await lessons(ctx);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.topic).toContain("Checks de android rotos");
    expect(posts[0]!.body).toContain("El workflow de android falla");
    expect(posts[0]!.body).toContain("2 trabas");
  });

  it("publishes a lesson for a cause seen before, even with one jam", async () => {
    const { ctx } = factory();
    const job = failedJob(ctx);
    ctx.store.setKv(unjamKey("tienda"), JSON.stringify({ at: at(3, 0, 28).toISOString(), causes: [cause({ jams: [`job:${job.id}`] })] }));
    await unjamLine(ctx, lineOf(ctx), collectJams(ctx, lineOf(ctx), at(3)), diagnosing([cause({ jams: [`job:${job.id}`] })]).runner, at(3));
    expect((await lessons(ctx)).map((p) => p.body)).toEqual([expect.stringContaining("vista en 2 revisiones seguidas")]);
  });

  it("stores the diagnosis when the townhall is down", async () => {
    const { ctx } = factory();
    const a = failedJob(ctx);
    const b = failedJob(ctx);
    ctx.townhall = { publish: async () => Promise.reject(new Error("disco lleno")), recall: async () => [] };
    const causes = await unjamLine(ctx, lineOf(ctx), collectJams(ctx, lineOf(ctx), at(3)), diagnosing([cause({ jams: [`job:${a.id}`, `job:${b.id}`] })]).runner, at(3));
    expect(causes).toHaveLength(1);
    expect(readDiagnosis(ctx.store, "tienda")!.causes).toHaveLength(1);
  });
});

describe("an installed copy behind", () => {
  function withRemote(url: string) {
    const repo = gitRepo();
    execFileSync("git", ["remote", "add", "origin", url], { cwd: repo });
    return repo;
  }
  const record = (over: Record<string, unknown> = {}) => JSON.stringify({ checkedAt: at(2).toISOString(), behind: 4, staleBuild: false, repository: "owner/zero", upstream: "origin/main", ...over });

  it("is a jam of zero's own line", () => {
    const { ctx } = factory({ lines: [{ name: "zero", repo: withRemote("https://github.com/owner/zero.git") }, { name: "tienda", repo: withRemote("https://github.com/acme/tienda.git") }] });
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, record());
    const [zero, tienda] = ctx.config.lines;
    const jams = collectJams(ctx, zero!, at(3));
    expect(jams).toEqual([expect.objectContaining({ id: "install", kind: "install", line: "zero" })]);
    expect(jams[0]!.text).toContain("4 merged commits of origin/main");
    expect(collectJams(ctx, tienda!, at(3))).toEqual([]);
  });

  it("says a stale build, and nothing once up to date or without a repository", () => {
    const { ctx } = factory({ lines: [{ name: "zero", repo: withRemote("git@github.com:owner/zero.git") }] });
    const line = ctx.config.lines[0]!;
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: 0, staleBuild: true }));
    expect(collectJams(ctx, line, at(3))[0]!.text).toContain("older than its code");
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: 0 }));
    expect(collectJams(ctx, line, at(3))).toEqual([]);
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, JSON.stringify({ checkedAt: at(2).toISOString(), problem: "no es un repositorio" }));
    expect(collectJams(ctx, line, at(3))).toEqual([]);
  });

  it("is no jam for unreleased commits in the stable channel, only for a stale build", () => {
    const { ctx } = factory({ selfUpdate: { channel: "estable" }, lines: [{ name: "zero", repo: withRemote("https://github.com/owner/zero.git") }] });
    const line = ctx.config.lines[0]!;
    const stable = { behind: undefined, channel: "estable", unreleased: 3 };
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, record(stable));
    expect(collectJams(ctx, line, at(3))).toEqual([]);
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ ...stable, staleBuild: true }));
    const [jam] = collectJams(ctx, line, at(3));
    expect(jam!.text).toContain("older than its code");
    expect(jam!.text).not.toContain("merged commit");
  });

  it("tells the real selfUpdate setting", () => {
    const repo = withRemote("https://github.com/owner/zero.git");
    const on = factory({ selfUpdate: { enabled: true }, lines: [{ name: "zero", repo }] }).ctx;
    on.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: 2 }));
    recordSelfUpdate(on.store, { entry: { from: "a", to: "b", at: at(1).toISOString(), outcome: "updated" } });
    const text = collectJams(on, on.config.lines[0]!, at(3))[0]!.text;
    expect(text).toContain("selfUpdate is enabled");
    expect(text).toContain("updated");
    const off = factory({ lines: [{ name: "zero", repo }] }).ctx;
    off.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: 2 }));
    expect(collectJams(off, off.config.lines[0]!, at(3))[0]!.text).toContain("selfUpdate is off");
  });
});

describe("the isolation box as a jam", () => {
  const line = (name: string, over: Record<string, unknown> = {}) => ({ name, repo: gitRepo(), ...over });

  it("is a single machine jam, on the first line", () => {
    const { ctx } = factory({ isolation: "container", lines: [line("a"), line("b"), line("c")] });
    const [a, b, c] = ctx.config.lines;
    expect(collectJams(ctx, a!, at(3))).toEqual([expect.objectContaining({ id: "box", kind: "box", line: "a" })]);
    expect(collectJams(ctx, b!, at(3)).filter((j) => j.kind === "box")).toEqual([]);
    expect(collectJams(ctx, c!, at(3)).filter((j) => j.kind === "box")).toEqual([]);
  });

  it("skips a package line that comes first", () => {
    const { ctx } = factory({ isolation: "container", lines: [line("exp-d1", { package: "exp" }), line("web")] });
    const [pkg, web] = ctx.config.lines;
    expect(collectJams(ctx, pkg!, at(3)).filter((j) => j.kind === "box")).toEqual([]);
    expect(collectJams(ctx, web!, at(3))).toEqual([expect.objectContaining({ id: "box", line: "web" })]);
  });

  it("is never a jam with isolation: worktree, and status says the box is off", () => {
    const { ctx } = factory({ isolation: "worktree", lines: [line("a"), line("b")] });
    for (const l of ctx.config.lines) expect(collectJams(ctx, l, at(3)).filter((j) => j.kind === "box")).toEqual([]);
    const text = formatStatus(factoryStatus(ctx));
    expect(text).toContain("Caja de aislamiento: desactivada (isolation: worktree)");
    expect(text).not.toContain("no lista");
  });

  it("shows a machine cause diagnosed on several lines once", () => {
    const { ctx } = factory({ lines: [line("a"), line("b")] });
    const box = cause({ kind: "machine", title: "La caja de aislamiento no está lista", jams: ["box"], todo: "Instalá Podman o Docker" });
    ctx.store.setKv(unjamKey("a"), JSON.stringify({ at: at(3).toISOString(), causes: [box] }));
    ctx.store.setKv(unjamKey("b"), JSON.stringify({ at: at(3).toISOString(), causes: [box, cause({ title: "Checks rotos" })] }));
    expect(factoryStatus(ctx).jams.map((j) => `${j.line}:${j.title}`)).toEqual(["a:La caja de aislamiento no está lista", "b:Checks rotos"]);
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

  it("puts a failed job without a spec back in the queue from the start", () => {
    const { ctx } = factory();
    const failed = failedJob(ctx, "La estación spec no produjo una especificación válida: Failed to authenticate");
    const job = ctx.store.updateJob(failed.id, { attempt: 2, station: "spec", worktree: "/tmp/w", branch: `zero/${failed.id}`, base: "abc" });
    ctx.store.setKv(networkRetryKey(job.id), "1");
    ctx.store.setKv(busyRetryKey(job.id), "2");
    expect(retryJob(ctx, job.id).kind).toBe("queued");
    const after = ctx.store.getJob(job.id)!;
    expect(after).toMatchObject({ status: "queued", attempt: 0, checkpoint: "none", stagesDone: 0, stopRequested: false });
    for (const field of ["station", "finishedAt", "feedback", "worktree", "branch", "base", "spec"] as const) expect(after[field]).toBeUndefined();
    expect(ctx.store.getKv(networkRetryKey(job.id))).toBeUndefined();
    expect(ctx.store.getKv(busyRetryKey(job.id))).toBeUndefined();
  });

  it("refuses a job refused at spec, other statuses and a pending cleanup, changing nothing", () => {
    const { ctx } = factory();
    const noSpec = failedJob(ctx, `${SPEC_REFUSAL}: falta una capacidad`);
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
    expect(formatStatus(factoryStatus(machine))).toContain("tienda · Checks de android rotos · 1 traba · máquina · qué falta: Instalá Podman o Docker · lo tiene que hacer: vos");
  });

  it("says what is missing and who has to do it, in status, panel and briefing", async () => {
    const ctx = diagnosed([cause({ kind: "code", jams: ["pr:1"], todo: "Volvé a subir el commit que verificó zero", who: "author" })]);
    const s = factoryStatus(ctx);
    expect(s.jams[0]).toMatchObject({ todo: "Volvé a subir el commit que verificó zero", who: "author" });
    const missing = "qué falta: Volvé a subir el commit que verificó zero · lo tiene que hacer: quien abrió el pull request";
    expect(formatStatus(s)).toContain(missing);
    expect(overviewPage(s, ["tienda"], "nonce")).toContain(missing);
    expect((await briefing(ctx)).body).toContain(missing);
    const github = diagnosed([cause({ jams: ["pr:1"], todo: "Esperar a que vuelva Actions", who: "github" })]);
    expect(formatStatus(factoryStatus(github))).toContain("lo tiene que hacer: GitHub");
    const factoryWho = diagnosed([cause({ jams: ["pr:1"], todo: "Esperar la próxima pasada", who: "factory" })]);
    expect(formatStatus(factoryStatus(factoryWho))).toContain("lo tiene que hacer: la fábrica");
  });

  it("keeps the agent's who and makes a none cause without one the owner's", async () => {
    const { ctx } = factory();
    const a = failedJob(ctx);
    const line = ctx.config.lines[0]!;
    const jams = collectJams(ctx, line, at(3));
    const id = `job:${a.id}`;
    const drafts = [cause({ title: "Uno", jams: [id], who: "github" }), cause({ title: "Dos", jams: [id] }), cause({ title: "Tres", jams: [id], action: "retry", todo: undefined })];
    const causes = (await unjamLine(ctx, line, jams, diagnosing(drafts).runner, at(3)))!;
    expect(causes.find((c) => c.title === "Uno")!.who).toBe("github");
    expect(causes.find((c) => c.title === "Dos")!.who).toBe("owner");
    expect(causes.find((c) => c.title === "Tres")!.who).toBeUndefined();
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

describe("missing capabilities", () => {
  function withRemote(url: string) {
    const repo = gitRepo();
    execFileSync("git", ["remote", "add", "origin", url], { cwd: repo });
    return repo;
  }
  const lines = () => [{ name: "tienda", repo: gitRepo() }, { name: "zero", repo: withRemote("https://github.com/owner/zero.git") }];
  const capability = (over: Record<string, unknown> = {}) =>
    cause({ title: "Agregar exportar a PDF", kind: "code", action: "capability", line: "zero", todo: null, request: "Agregá a zero la capacidad de exportar a PDF", paths: ["src/pdf.ts"], estimatedUsd: 1, ...over });
  const refused = (ctx: Ctx) => failedJob(ctx, `${SPEC_REFUSAL}: falta exportar a PDF`);
  const tienda = (ctx: Ctx) => ctx.config.lines[0]!;
  const onZero = (ctx: Ctx) => ctx.store.listProposals({ line: "zero" });

  it("proposes the capability on the target line, tied to the refused job", async () => {
    const { ctx } = factory({ lines: lines(), nightShift: { autonomy: "propose" } });
    const f = refused(ctx);
    const agents = diagnosing([capability({ jams: [`job:${f.id}`] })]);
    await unjamLine(ctx, tienda(ctx), collectJams(ctx, tienda(ctx), at(3)), agents.runner, at(3));
    expect(agents.calls[0]!.prompt).toContain("tienda, zero (owner/zero)");
    const [proposal] = onZero(ctx);
    expect(proposal).toMatchObject({ status: "pending", origin: "unjam", forJobs: [f.id], change: "Agregá a zero la capacidad de exportar a PDF" });
    expect(proposal!.why).toContain(f.id);
    expect(proposal!.why).toContain("línea tienda");
    expect(ctx.store.listProposals({ line: "tienda" })).toHaveLength(0);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]).toMatchObject({ action: "capability", line: "zero", proposal: proposal!.id });
    expect(proposalsPage(proposalsView(ctx), "n")).toContain(`Agrega la capacidad que les faltó a ${f.id}`);
  });

  it("follows the target line's autonomy", async () => {
    const { ctx } = factory({ lines: lines(), nightShift: { autonomy: "build" } });
    const f = refused(ctx);
    await unjamLine(ctx, tienda(ctx), collectJams(ctx, tienda(ctx), at(3)), diagnosing([capability({ jams: [`job:${f.id}`] })]).runner, at(3));
    const [proposal] = onZero(ctx);
    expect(proposal).toMatchObject({ status: "approved", decidedBy: "night-shift" });
    expect(ctx.store.getJob(proposal!.jobId!)).toMatchObject({ line: "zero", status: "queued", source: { kind: "night-shift", origin: "unjam" } });
  });

  it("becomes none for an unknown line or a job that did not stop at spec", async () => {
    const { ctx } = factory({ lines: lines(), nightShift: { autonomy: "propose" } });
    const f = refused(ctx);
    const built = failedJob(ctx, "verify falló");
    await unjamLine(ctx, tienda(ctx), collectJams(ctx, tienda(ctx), at(3)), diagnosing([capability({ line: "otra", jams: [`job:${f.id}`] }), capability({ title: "Otra capacidad", jams: [`job:${built.id}`] })]).runner, at(3));
    expect(ctx.store.listProposals()).toHaveLength(0);
    const causes = readDiagnosis(ctx.store, "tienda")!.causes;
    expect(causes.map((c) => c.action)).toEqual(["none", "none"]);
    expect(causes[0]!.line).toBeUndefined();
    expect(causes[0]!.todo).toContain("Pedile a zero");
  });

  it("is not repeated while an earlier one refused at spec holds its title", async () => {
    const { ctx } = factory({ lines: lines(), nightShift: { autonomy: "build" } });
    const earlier = ctx.store.createProposal({ line: "zero", title: "Agregar exportar a PDF", why: "x", change: "y", estimatedUsd: 0, paths: [], origin: "unjam" });
    const job = ctx.store.createJob({ line: "zero", kind: "request", request: "exportar a PDF", budgetUsd: 1 });
    ctx.store.updateJob(job.id, { status: "failed", reason: `${SPEC_REFUSAL}: This is already done`, finishedAt: at(3, 0, 27).toISOString() });
    ctx.store.updateProposal(earlier.id, { status: "approved", decidedBy: "night-shift", jobId: job.id });
    const f = refused(ctx);
    await unjamLine(ctx, tienda(ctx), collectJams(ctx, tienda(ctx), at(3)), diagnosing([capability({ jams: [`job:${f.id}`] })]).runner, at(3));
    expect(onZero(ctx)).toHaveLength(1);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]).toMatchObject({ proposal: earlier.id, job: job.id });
  });

  it("does not repeat a pending proposal, and records it", async () => {
    const { ctx } = factory({ lines: lines(), nightShift: { autonomy: "propose" } });
    const f = refused(ctx);
    const jams = collectJams(ctx, tienda(ctx), at(3));
    await unjamLine(ctx, tienda(ctx), jams, diagnosing([capability({ jams: [`job:${f.id}`] })]).runner, at(3));
    await unjamLine(ctx, tienda(ctx), jams, diagnosing([capability({ title: "agregar exportar a  pdf", jams: [`job:${f.id}`] })]).runner, at(4));
    expect(onZero(ctx)).toHaveLength(1);
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.proposal).toBe(onZero(ctx)[0]!.id);
  });

  describe("resending", () => {
    /** An approved capability proposal on `target` for job `original`, whose job finished at 2:00. */
    function approved(ctx: Ctx, target: string, original: string, delivery: { mode: "merge" | "pull-request"; commit?: string }) {
      const proposal = ctx.store.createProposal({ line: target, title: "Agregar exportar a PDF", why: "x", change: "y", estimatedUsd: 0, paths: [], origin: "unjam", forJobs: [original] });
      const job = ctx.store.createJob({ line: target, kind: "request", request: "y", budgetUsd: 1 });
      ctx.store.updateJob(job.id, { status: "delivered", finishedAt: at(2).toISOString(), delivery: { branch: `zero/${job.id}`, ...delivery, ...(delivery.mode === "pull-request" && { url: "https://github.com/owner/zero/pull/3", autoMerge: true }) } });
      ctx.store.updateProposal(proposal.id, { status: "approved", jobId: job.id, decidedBy: "owner" });
      return job;
    }
    const queuedOn = (ctx: Ctx, line: string) => ctx.store.listJobs({ line, status: ["queued"] });
    const record = (over: Record<string, unknown>) => JSON.stringify({ checkedAt: at(3).toISOString(), behind: 0, staleBuild: false, repository: "owner/zero", ...over });

    it("sends the original request again once, after a merge on another repository", async () => {
      const { ctx } = factory({ lines: [...lines(), { name: "plus", repo: gitRepo() }] });
      const f = refused(ctx);
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: 5 }));
      approved(ctx, "plus", f.id, { mode: "merge", commit: "abc123" });
      expect(await resendAfterCapability(ctx, at(3))).toBe(1);
      const [again] = queuedOn(ctx, "tienda");
      expect(again!.request).toBe("arreglar el carrito");
      expect(ctx.store.getKv(unjamResentKey(f.id))).toBe(again!.id);
      const posts = await ctx.townhall.recall({ line: "tienda", kinds: ["lesson"] });
      expect(posts.some((p) => p.topic.startsWith("capacidad agregada") && p.body.includes(again!.id))).toBe(true);
      expect(await resendAfterCapability(ctx, at(4))).toBe(0);
      expect(queuedOn(ctx, "tienda")).toHaveLength(1);
    });

    it("waits for the installed copy when the capability went into zero's own repository", async () => {
      const { ctx } = factory({ lines: lines() });
      const f = refused(ctx);
      approved(ctx, "zero", f.id, { mode: "merge", commit: "abc123" });
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: 1 }));
      await resendAfterCapability(ctx, at(3));
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ checkedAt: at(1).toISOString() }));
      await resendAfterCapability(ctx, at(3));
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ staleBuild: true }));
      await resendAfterCapability(ctx, at(3));
      // In the stable channel unreleased work is not a delay, but the copy does not have it yet.
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: undefined, channel: "estable", unreleased: 1 }));
      await resendAfterCapability(ctx, at(3));
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({ behind: undefined, channel: "estable" }));
      await resendAfterCapability(ctx, at(3));
      expect(queuedOn(ctx, "tienda")).toHaveLength(0);
      ctx.store.setKv(INSTALL_FRESHNESS_KEY, record({}));
      expect(await resendAfterCapability(ctx, at(4))).toBe(1);
      expect(queuedOn(ctx, "tienda")).toHaveLength(1);
    });

    it("waits for the pull request to merge", async () => {
      const { ctx } = factory({ lines: [...lines(), { name: "plus", repo: gitRepo() }] });
      const f = refused(ctx);
      const job = approved(ctx, "plus", f.id, { mode: "pull-request" });
      ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked", why: "fallaron los checks" }));
      expect(await resendAfterCapability(ctx, at(3))).toBe(0);
      ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "merged" }));
      expect(await resendAfterCapability(ctx, at(3))).toBe(1);
    });

    it("leaves a job that is no longer failed", async () => {
      const { ctx } = factory({ lines: [...lines(), { name: "plus", repo: gitRepo() }] });
      const f = refused(ctx);
      approved(ctx, "plus", f.id, { mode: "merge", commit: "abc123" });
      ctx.store.updateJob(f.id, { status: "stopped" });
      expect(await resendAfterCapability(ctx, at(3))).toBe(0);
    });
  });
});

describe("collecting jams behind a long history", () => {
  it("sees a failure created after more than 10,000 older jobs", () => {
    const { ctx } = factory();
    ctx.store.transaction(() => {
      for (let i = 0; i < 10_001; i++) {
        const job = ctx.store.createJob({ line: "tienda", kind: "request", request: `viejo ${i}`, budgetUsd: 1 });
        ctx.store.updateJob(job.id, { status: "stopped", finishedAt: at(1).toISOString() });
      }
    });
    const failed = failedJob(ctx);
    expect(collectJams(ctx, ctx.config.lines[0]!, at(3)).find((j) => j.kind === "failed-job")).toMatchObject({ job: failed.id });
  });
});

describe("unjam during the day", () => {
  const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const stuck = (ctx: Ctx, now: Date, hours = 3) => blockedPr(ctx, 1, { blockedSince: hoursAgo(now, hours) });
  const runningJob = (ctx: Ctx) => {
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "otro", budgetUsd: 1 });
    return ctx.store.updateJob(job.id, { status: "running" });
  };

  it("runs with jobs running, outside the night shift's hours, when a pull request is blocked for hours", async () => {
    const { ctx } = factory({ concurrency: 2, nightShift: { hours: "22:00-06:00" } }, at(14));
    stuck(ctx, at(14));
    runningJob(ctx);
    const agents = diagnosing([]);
    expect(await urgentUnjamPass(ctx, agents.runner, at(14), { running: 1 })).toBe(1);
    expect(agents.calls.map((c) => c.station)).toEqual(["unjam"]);
    expect(agents.calls[0]!.maxBudgetUsd).toBeGreaterThan(0);
  });

  it("does not run while an owner job is queued, without a free slot, nor for a pull request blocked a short while", async () => {
    const agents = diagnosing([]);
    const queued = factory({ concurrency: 2 }, at(14));
    stuck(queued.ctx, at(14));
    queued.ctx.store.createJob({ line: "tienda", kind: "request", request: "pedido", budgetUsd: 1 });
    await urgentUnjamPass(queued.ctx, agents.runner, at(14), { running: 0 });
    const full = factory({ concurrency: 1 }, at(14));
    stuck(full.ctx, at(14));
    await urgentUnjamPass(full.ctx, agents.runner, at(14), { running: 1 });
    const recent = factory({ concurrency: 2 }, at(14));
    stuck(recent.ctx, at(14), 1);
    await urgentUnjamPass(recent.ctx, agents.runner, at(14), { running: 0 });
    const off = factory({ unjam: { urgentAfterHours: 0 } }, at(14));
    stuck(off.ctx, at(14));
    await urgentUnjamPass(off.ctx, agents.runner, at(14), { running: 0 });
    const andon = factory({}, at(14));
    stuck(andon.ctx, at(14));
    andon.ctx.store.setKv(ANDON_KEY, "on");
    await urgentUnjamPass(andon.ctx, agents.runner, at(14), { running: 0 });
    expect(agents.calls).toHaveLength(0);
  });

  it("runs once per urgentAfterHours for a line", async () => {
    const { ctx } = factory({}, at(14));
    stuck(ctx, at(14));
    const agents = diagnosing([]);
    await urgentUnjamPass(ctx, agents.runner, at(14), { running: 0 });
    await urgentUnjamPass(ctx, agents.runner, at(15), { running: 0 });
    expect(agents.count.unjam).toBe(1);
    expect(ctx.store.getKv(unjamUrgentKey("tienda"))).toBe(at(14).toISOString());
    await urgentUnjamPass(ctx, agents.runner, at(16), { running: 0 });
    expect(agents.count.unjam).toBe(2);
  });

  it("runs in the daemon's background, outside the idle run", async () => {
    const now = new Date();
    const { ctx } = factory({}, now);
    stuck(ctx, now);
    const agents = diagnosing([]);
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, unjam: false, urgentUnjam: true, agentRunner: () => agents.runner });
    expect(agents.calls.map(agentName)).toEqual(["unjam"]);
  });
});

describe("blockedSince", () => {
  it("is set when blocked, kept while blocked and gone otherwise", () => {
    const blocked = stampBlocked({ status: "waiting" }, { status: "blocked", why: "x" }, "t1");
    expect(blocked.blockedSince).toBe("t1");
    expect(stampBlocked(blocked, { ...blocked, why: "y" }, "t2").blockedSince).toBe("t1");
    expect(stampBlocked(blocked, { status: "waiting", blockedSince: "t1" }, "t3").blockedSince).toBeUndefined();
  });

  it("keeps the first blocked time over the passes of a watched pull request", async () => {
    const clock = { ms: at(10).getTime() };
    const repo = gitRepo();
    gitIn(repo, "remote", "add", "origin", "https://github.com/acme/tienda.git");
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo, integrate: "pull-request", autoMerge: true }] }, () => new Date(clock.ms));
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
    ctx.store.updateJob(job.id, { status: "delivered", finishedAt: new Date(clock.ms).toISOString(), delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/acme/tienda/pull/1", autoMerge: true } });
    let checks: Check[] = [{ name: "ci", done: false, ok: false, started: at(10).toISOString() }];
    const api: MergeApi = {
      pullRequest: async () => ({ open: true, merged: false, mergeable: true, headSha: "a", base: "main" }),
      checks: async () => checks,
      merge: async () => "m",
      deleteBranch: async () => {},
      comment: async () => {},
    };
    const state = () => JSON.parse(ctx.store.getKv(mergeKey(job.id))!) as MergeState;
    await pollMerges(ctx, () => api);
    expect(state().status).toBe("waiting");
    expect(state().blockedSince).toBeUndefined();
    checks = [{ name: "ci", done: true, ok: false, started: at(10).toISOString(), at: at(10).toISOString() }];
    clock.ms += 10 * 60_000;
    const first = new Date(clock.ms).toISOString();
    await pollMerges(ctx, () => api);
    expect(state()).toMatchObject({ status: "blocked", blockedSince: first });
    for (const minutes of [10, 120]) {
      clock.ms += minutes * 60_000;
      await pollMerges(ctx, () => api);
      expect(state()).toMatchObject({ status: "blocked", blockedSince: first });
    }
    checks = [{ name: "ci", done: true, ok: true }];
    clock.ms += 300 * 60_000;
    await pollMerges(ctx, () => api);
    expect(state().status).toBe("merged");
    expect(state().blockedSince).toBeUndefined();
  });
});

describe("a train cause", () => {
  function trainFactory(autonomy: string) {
    const repo = gitRepo();
    gitIn(repo, "remote", "add", "origin", "https://github.com/acme/tienda.git");
    return factory({ lines: [{ name: "tienda", repo, integrate: "pull-request", autoMerge: true, nightShift: { autonomy } }] });
  }
  const trainCause = (jams: string[]) => cause({ title: "Pull requests que se pisan", kind: "code", action: "train", jams, todo: null });

  it("starts the line's train with the cause's pull requests on a build line", async () => {
    const { ctx } = trainFactory("build");
    const a = blockedPr(ctx, 1);
    const b = blockedPr(ctx, 2);
    const line = ctx.config.lines[0]!;
    const causes = await unjamLine(ctx, line, collectJams(ctx, line, at(3)), diagnosing([trainCause([`pr:${a.id}`, `pr:${b.id}`])]).runner, at(3));
    expect(causes![0]!.action).toBe("train");
    expect(readTrain(ctx, "tienda")!.entries.map((e) => e.job)).toEqual([a.id, b.id]);
  });

  it("leaves the command as the todo on a propose line", async () => {
    const { ctx } = trainFactory("propose");
    const a = blockedPr(ctx, 1);
    const b = blockedPr(ctx, 2);
    const line = ctx.config.lines[0]!;
    const causes = await unjamLine(ctx, line, collectJams(ctx, line, at(3)), diagnosing([trainCause([`pr:${a.id}`, `pr:${b.id}`])]).runner, at(3));
    expect(readTrain(ctx, "tienda")).toBeUndefined();
    expect(causes![0]!.todo).toContain("zero tren tienda 1 2");
    expect(readDiagnosis(ctx.store, "tienda")!.causes[0]!.todo).toContain("zero tren tienda");
  });
});
