import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approveProposal, briefing, listProposals, rejectProposal, requestWork, type FactoryContext } from "../src/app.js";
import type { Autonomy } from "../src/config.js";
import { ownerFirst, runDaemon } from "../src/daemon.js";
import { decideNightShift, stricter, touchesManifest } from "../src/line/policy.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { scoutLine, scoutPass } from "../src/line/scout.js";
import type { Job, Proposal } from "../src/state/store.js";
import { cleanup, fakeAgents, gitIn, gitRepo, simulatedBox, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);
const idea = (title: string, over: Record<string, unknown> = {}) => ({ title, why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, paths: ["src/x.ts"], needsNewCredentials: false, ...over });
const scouting = (proposals: unknown[]) => fakeAgents({ scout: () => ({ output: { proposals } }) });

function factory(over: Record<string, unknown> = {}, start = at(3)) {
  let clock = start;
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo(), verify: [passes] }], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}

const nightJobs = (ctx: FactoryContext) => ctx.store.listJobs().filter((j) => j.source?.kind === "night-shift");

/** What scout does on a `build`/`auto` line: a proposal approved by the night shift, with its job. */
function autonomousJob(ctx: FactoryContext, autonomy: "build" | "auto", over: Partial<Pick<Proposal, "researchNote" | "thirdParty">> = {}, line = "demo"): { proposal: Proposal; job: Job } {
  const proposal = ctx.store.createProposal({ ...idea("Agregar /health"), line, ...over });
  const { job } = requestWork(ctx, { text: "Agregar /health", line, source: { kind: "night-shift", proposal: proposal.id, autonomy } });
  ctx.store.updateProposal(proposal.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
  return { proposal: ctx.store.getProposal(proposal.id)!, job };
}

describe("autonomy policy", () => {
  it("takes the stricter autonomy and recognizes manifests", () => {
    expect(stricter("auto", "propose")).toBe("propose");
    expect(stricter("build", "auto")).toBe("build");
    expect(decideNightShift("build")).toBe("ask");
    expect(decideNightShift("auto")).toBe("continue");
    for (const p of ["package.json", "web/package-lock.json", "requirements-dev.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", ".mcp.json", "./yarn.lock"]) expect(touchesManifest([p])).toBe(true);
    expect(touchesManifest(["src/package.ts", "docs/requirements.md", "skills/mine/SKILL.md"])).toBe(false);
  });
});

describe("proposals by autonomy", () => {
  it("propose: stays pending, no job", async () => {
    const { ctx } = factory();
    await scoutPass(ctx, scouting([idea("Cubrir egress")]).runner, at(3));
    const [p] = ctx.store.listProposals();
    expect(p).toMatchObject({ status: "pending" });
    expect(p!.jobId).toBeUndefined();
    expect(nightJobs(ctx)).toHaveLength(0);
  });

  it("build: approved by the night shift into a queued job", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "build" } });
    await scoutPass(ctx, scouting([idea("Cubrir egress")]).runner, at(3));
    const [p] = ctx.store.listProposals();
    expect(p).toMatchObject({ status: "approved", decidedBy: "night-shift", jobId: expect.any(String) });
    expect(ctx.store.getJob(p!.jobId!)).toMatchObject({ status: "queued", line: "tienda", source: { kind: "night-shift", proposal: p!.id, autonomy: "build" } });
    expect(ctx.store.getJob(p!.jobId!)!.request).toContain("Cubrir egress");
  });

  it("the line's autonomy overrides the global one", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" }, lines: [{ name: "tienda", repo: gitRepo(), nightShift: { autonomy: "auto" } }] });
    await scoutPass(ctx, scouting([idea("Cubrir egress")]).runner, at(3));
    expect(nightJobs(ctx)).toEqual([expect.objectContaining({ source: expect.objectContaining({ autonomy: "auto" }) })]);
  });

  it("owner approvals are marked as the owner's", () => {
    const { ctx } = factory();
    const p = ctx.store.createProposal({ ...idea("Algo"), line: "tienda" });
    const { job } = approveProposal(ctx, p.id);
    expect(ctx.store.getProposal(p.id)).toMatchObject({ status: "approved", decidedBy: "owner" });
    expect(job.source).toEqual({ kind: "night-shift", proposal: p.id });
  });
});

describe("daily cap", () => {
  const twoLines = (cap: number) =>
    factory({ nightShift: { autonomy: "build", maxAutoJobsPerDay: cap }, lines: [{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }] });

  it("counts across lines; past it, proposals wait for the owner", async () => {
    const { ctx } = twoLines(1);
    for (const l of ctx.config.lines) await scoutLine(ctx, l, scouting([idea("Una idea")]).runner, at(3));
    expect(ctx.store.listProposals().map((p) => p.status)).toEqual(["approved", "pending"]);
    expect(nightJobs(ctx)).toHaveLength(1);
  });

  it("a cap of 0 opens none", async () => {
    const { ctx } = twoLines(0);
    for (const l of ctx.config.lines) await scoutLine(ctx, l, scouting([idea("Una idea")]).runner, at(3));
    expect(ctx.store.listProposals().map((p) => p.status)).toEqual(["pending", "pending"]);
    expect(nightJobs(ctx)).toHaveLength(0);
  });

  it("starts again the next day", async () => {
    const { ctx, set } = factory({ nightShift: { autonomy: "build", maxAutoJobsPerDay: 1 } });
    await scoutPass(ctx, scouting([idea("Primera"), idea("Segunda")]).runner, at(3));
    expect(nightJobs(ctx)).toHaveLength(1);
    for (const j of nightJobs(ctx)) ctx.store.finishJob(j.id, "delivered");
    set(at(3, 0, 30));
    await scoutPass(ctx, scouting([idea("Tercera")]).runner, at(3, 0, 30));
    expect(nightJobs(ctx)).toHaveLength(2);
    expect(ctx.store.listProposals().find((p) => p.title === "Tercera")).toMatchObject({ status: "approved" });
  });
});

describe("research-born proposals", () => {
  function withNote(autonomy: Autonomy, research?: Record<string, unknown>) {
    const f = factory({ nightShift: { autonomy }, ...(research && { research }) });
    const note = f.ctx.store.createResearchNote({ line: "tienda", topic: "Skill de tests", findings: "x", sources: ["https://example.com"], serves: "build", maturity: "estable" });
    return { ...f, note };
  }

  it("keeps the note only when it is one of the line's notes", async () => {
    const { ctx, note } = withNote("propose");
    await scoutPass(ctx, scouting([idea("Con nota", { researchNote: note.id }), idea("Nota ajena", { researchNote: "deadbeef" })]).runner, at(3));
    const [known, unknown] = ctx.store.listProposals();
    expect(known!.researchNote).toBe(note.id);
    expect(unknown!.researchNote).toBeUndefined();
  });

  it("third party waits for the owner on an auto line with the default research autonomy", async () => {
    const { ctx, note } = withNote("auto");
    await scoutPass(ctx, scouting([idea("Agregar un MCP", { researchNote: note.id, thirdParty: true })]).runner, at(3));
    expect(ctx.store.listProposals()[0]).toMatchObject({ status: "pending", thirdParty: true });
    expect(nightJobs(ctx)).toHaveLength(0);
  });

  it("a manifest among the paths counts as third party, whatever scout says", async () => {
    const { ctx, note } = withNote("auto", { autonomy: "propose" });
    await scoutPass(ctx, scouting([idea("Nueva librería", { researchNote: note.id, thirdParty: false, paths: ["package.json", "src/x.ts"] })]).runner, at(3));
    expect(ctx.store.listProposals()[0]).toMatchObject({ status: "pending" });
    expect(nightJobs(ctx)).toHaveLength(0);
  });

  it("an own skill follows the line's autonomy", async () => {
    const { ctx, note } = withNote("auto");
    await scoutPass(ctx, scouting([idea("Escribir una skill propia", { researchNote: note.id, thirdParty: false, paths: ["skills/tests/SKILL.md"] })]).runner, at(3));
    expect(nightJobs(ctx)).toEqual([expect.objectContaining({ source: expect.objectContaining({ autonomy: "auto" }) })]);
  });

  it("research.autonomy auto lets third party go on an auto line; off never does", async () => {
    const open = withNote("auto", { autonomy: "auto" });
    await scoutPass(open.ctx, scouting([idea("Agregar un MCP", { researchNote: open.note.id, thirdParty: true })]).runner, at(3));
    expect(nightJobs(open.ctx)).toHaveLength(1);
    const off = factory({ nightShift: { autonomy: "auto" }, research: "off" });
    const note = off.ctx.store.createResearchNote({ line: "tienda", topic: "t", findings: "x", sources: ["https://example.com"], serves: "s", maturity: "m" });
    await scoutPass(off.ctx, scouting([idea("Agregar un MCP", { researchNote: note.id, thirdParty: true })]).runner, at(3));
    expect(nightJobs(off.ctx)).toHaveLength(0);
  });
});

describe("integrating night-shift jobs", () => {
  function line(opts: { level?: string; onTimeout?: string } = {}) {
    const repo = gitRepo();
    let clock = Date.parse("2026-10-26T10:00:00Z");
    const ctx = testFactory(
      {
        level: opts.level ?? "L3",
        isolation: opts.level === "L2" ? "worktree" : "container",
        approvals: { timeoutHours: 1, onTimeout: opts.onTimeout ?? "reject" },
        lines: [{ name: "demo", repo, verify: [passes] }],
      },
      () => new Date(clock),
    );
    return { repo, ctx, later: (ms: number) => (clock += ms) };
  }
  const health = fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/health.ts": "ok" }) });
  const deps = (ctx: FactoryContext, agents = health): RunnerDeps => ({ ...ctx, runAgent: agents.runner, box: simulatedBox(agents.runner).box });
  const head = (repo: string) => gitIn(repo, "rev-parse", "main").trim();

  it("build parks before integrating at L3, with a timeout that rejects", async () => {
    const { repo, ctx } = line({ onTimeout: "approve" });
    const before = head(repo);
    const { job } = autonomousJob(ctx, "build");
    const waiting = await runJob(job.id, deps(ctx));
    expect(waiting).toMatchObject({ status: "waiting", question: { kind: "before-integrate", onTimeout: "reject" } });
    expect(head(repo)).toBe(before);
    expect(existsSync(join(repo, "src/health.ts"))).toBe(false);
  });

  it("a timeout never integrates, even when approvals.onTimeout is approve", async () => {
    const { repo, ctx, later } = line({ level: "L2", onTimeout: "approve" });
    const before = head(repo);
    const { job } = autonomousJob(ctx, "build");
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/health.ts": "ok" }) });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner });
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "waiting", question: { kind: "before-integrate", onTimeout: "reject" } });
    later(2 * 3_600_000);
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("stopped");
    expect(head(repo)).toBe(before);
  });

  it("approving the proposal integrates it with the line's delivery", async () => {
    const { repo, ctx } = line();
    const { proposal, job } = autonomousJob(ctx, "build");
    await runJob(job.id, deps(ctx));
    expect(listProposals(ctx).map((p) => p.id)).toEqual([proposal.id]);
    expect(approveProposal(ctx, proposal.id).job.status).toBe("queued");
    const done = await runJob(job.id, deps(ctx));
    expect(done).toMatchObject({ status: "delivered", delivery: { mode: "merge" } });
    expect(readFileSync(join(repo, "src/health.ts"), "utf8")).toBe("ok");
  });

  it("rejecting the proposal stops the job, keeps its branch and teaches the townhall", async () => {
    const { repo, ctx } = line();
    const { proposal, job } = autonomousJob(ctx, "build");
    await runJob(job.id, deps(ctx));
    await rejectProposal(ctx, proposal.id, "no lo quiero");
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "stopped" });
    expect(ctx.store.getProposal(proposal.id)).toMatchObject({ status: "rejected", note: "no lo quiero", jobId: job.id });
    expect(gitIn(repo, "branch", "--list", `zero/${job.id}`)).toContain(job.id);
    const posts = await ctx.townhall.recall({ line: "demo" });
    expect(posts).toContainEqual(expect.objectContaining({ kind: "lesson", body: expect.stringContaining("no lo quiero") }));
  });

  it("refuses to approve again while the night shift is still building", () => {
    const { ctx } = line();
    const { proposal } = autonomousJob(ctx, "build");
    expect(() => approveProposal(ctx, proposal.id)).toThrow(/se está construyendo/);
  });

  it("auto integrates at L3 without asking", async () => {
    const { repo, ctx } = line();
    const { job } = autonomousJob(ctx, "auto");
    const done = await runJob(job.id, deps(ctx));
    expect(done).toMatchObject({ status: "delivered", delivery: { mode: "merge" } });
    expect(readFileSync(join(repo, "src/health.ts"), "utf8")).toBe("ok");
    expect(ctx.store.spansForJob(job.id).some((s) => s.name === "zero.approval")).toBe(false);
  });

  it("auto still asks for protected paths at L2", async () => {
    const { ctx } = line({ level: "L2" });
    const { job } = autonomousJob(ctx, "auto");
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { ".github/workflows/ci.yml": "on: push\n", "src/health.ts": "ok" }) });
    const waiting = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(waiting.question).toMatchObject({ kind: "protected-path" });
  });

  it("an auto research-born job that touches a manifest parks before integrating", async () => {
    const { repo, ctx } = line();
    const before = head(repo);
    const note = ctx.store.createResearchNote({ line: "demo", topic: "t", findings: "x", sources: ["https://example.com"], serves: "s", maturity: "m" });
    const { job } = autonomousJob(ctx, "auto", { researchNote: note.id, thirdParty: false });
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { "package.json": "{}\n", "src/health.ts": "ok" }) });
    const waiting = await runJob(job.id, deps(ctx, agents));
    expect(waiting).toMatchObject({ status: "waiting", question: { kind: "before-integrate", onTimeout: "reject" } });
    expect(head(repo)).toBe(before);
  });
});

describe("scheduling", () => {
  it("orders owner jobs before the night shift's own", () => {
    const night = { id: "n", source: { kind: "night-shift", proposal: "p", autonomy: "auto" } } as Job;
    const approved = { id: "a", source: { kind: "night-shift", proposal: "q" } } as Job;
    const owner = { id: "o" } as Job;
    expect(ownerFirst([night, approved, owner]).map((j) => j.id)).toEqual(["a", "o", "n"]);
  });

  it("starts the owner's job first and the night shift's only when nothing else is left", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }, { name: "blog", repo: gitRepo(), verify: [passes] }] });
    const { job: night } = autonomousJob(ctx, "auto", {}, "demo");
    const { job: owner } = requestWork(ctx, { text: "pedido del dueño", line: "blog" });
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${Math.random().toString(36).slice(2)}.ts`]: "ok" }) });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner });
    const ownerDone = ctx.store.getJob(owner.id)!;
    expect(ownerDone.status).toBe("delivered");
    expect(ctx.store.getJob(night.id)!.status).toBe("delivered");
    const nightStart = ctx.store.spansForJob(night.id).find((s) => s.name === "zero.station.spec")!.start;
    expect(Date.parse(nightStart)).toBeGreaterThanOrEqual(Date.parse(ownerDone.finishedAt!));
  });

  it("starts the night shift's job when it is alone", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] });
    const { job } = autonomousJob(ctx, "auto");
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/a.ts": "ok" }) }).runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });
});

describe("README", () => {
  it("documents the night shift and fallback", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const s of ["maxAutoJobsPerDay", "autonomy", "zero proposals", "fallback", "nightShift", "research:"]) expect(readme).toContain(s);
    expect(readme).not.toContain("Turno nocturno (en camino)");
  });

  it("documents deciding proposals from GitHub and research issues", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain("zero:propuesta");
    expect(readme).toMatch(/le pone la etiqueta de trabajo[^\n]*aprobada[^\n]*cierra el issue sin esa etiqueta[^\n]*rechazada/);
    expect(readme).toContain("zero:investigacion");
  });
});

describe("briefing", () => {
  it("separates what was proposed, built on its own and integrated on its own", async () => {
    const { ctx } = factory({ lines: [{ name: "demo", repo: gitRepo() }] });
    const pending = ctx.store.createProposal({ ...idea("Pendiente"), line: "demo" });
    const built = autonomousJob(ctx, "build");
    ctx.store.updateJob(built.job.id, {
      status: "waiting",
      title: "Construida",
      question: { kind: "before-integrate", text: "?", askedAt: at(3).toISOString(), expiresAt: at(9).toISOString(), onTimeout: "reject" },
    });
    const auto = autonomousJob(ctx, "auto");
    ctx.store.updateJob(auto.job.id, { title: "Integrada" });
    ctx.store.finishJob(auto.job.id, "delivered", { delivery: { mode: "merge", branch: `zero/${auto.job.id}`, commit: "abc" } });
    const body = (await briefing(ctx)).body;
    const section = body.slice(body.indexOf("## Turno nocturno"), body.indexOf("Período:"));
    const proposed = section.indexOf("### Propuesto");
    const builtAt = section.indexOf("### Construido solo");
    const integrated = section.indexOf("### Integrado solo");
    expect(proposed).toBeGreaterThan(-1);
    expect(builtAt).toBeGreaterThan(proposed);
    expect(integrated).toBeGreaterThan(builtAt);
    expect(section.slice(proposed, builtAt)).toContain(pending.id);
    expect(section.slice(builtAt, integrated)).toContain(built.job.id);
    expect(section.slice(integrated)).toContain(auto.job.id);
  });
});
