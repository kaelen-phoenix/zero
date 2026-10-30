import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, proposalsView, rejectProposal, requestWork, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { detectReverts } from "../src/line/reverts.js";
import { scoutLine, scoutPass } from "../src/line/scout.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import type { Proposal } from "../src/state/store.js";
import { cleanup, fakeAgents, gitIn, gitRepo, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);
const idea = (title: string, over: Record<string, unknown> = {}) => ({ title, why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, paths: ["src/x.ts"], needsNewCredentials: false, ...over });
const scouting = (proposals: unknown[]) => fakeAgents({ scout: () => ({ output: { proposals } }) });

function factory(over: Record<string, unknown> = {}, start = at(3)) {
  let clock = start;
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}

/** What the night shift delivers under `auto`: a branch merged with --no-ff into main, recorded as the job's delivery. */
function autonomousMerge(ctx: FactoryContext, title: string, approvals: Record<string, boolean> = {}): { proposal: Proposal; commit: string } {
  const line = ctx.config.lines[0]!;
  const branch = `zero/${title.replace(/\W+/g, "-").toLowerCase()}`;
  gitIn(line.repo, "checkout", "-q", "-b", branch);
  writeTree(line.repo, { [`src/${branch.slice(5)}.ts`]: "ok\n" });
  gitIn(line.repo, "add", "-A");
  gitIn(line.repo, "commit", "-q", "-m", title);
  gitIn(line.repo, "checkout", "-q", "main");
  gitIn(line.repo, "merge", "--no-ff", "-q", "-m", `zero: ${title}`, branch);
  const commit = gitIn(line.repo, "rev-parse", "main");
  const proposal = ctx.store.createProposal({ ...idea(title), line: line.name });
  const { job } = requestWork(ctx, { text: title, line: line.name, source: { kind: "night-shift", proposal: proposal.id, autonomy: "auto" } });
  ctx.store.updateProposal(proposal.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
  ctx.store.finishJob(job.id, "delivered", { approvals, delivery: { mode: "merge", branch, commit } });
  return { proposal, commit };
}

const revert = (ctx: FactoryContext, commit: string) => gitIn(ctx.config.lines[0]!.repo, "revert", "-m", "1", "--no-edit", commit);
const lessons = async (ctx: FactoryContext) => (await ctx.townhall.recall({ line: "tienda" })).filter((p) => p.topic === "propuesta revertida");

describe("revert detection", () => {
  it("marks an autonomous merge the owner reverted, once, with a townhall lesson", async () => {
    const { ctx } = factory();
    const { proposal, commit } = autonomousMerge(ctx, "Agregar health");
    revert(ctx, commit);
    expect(await detectReverts(ctx)).toBe(1);
    expect(ctx.store.getProposal(proposal.id)).toMatchObject({ status: "reverted", decidedAt: expect.any(String) });
    expect(await detectReverts(ctx)).toBe(0);
    const posts = await lessons(ctx);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: "lesson" });
    expect(posts[0]!.body).toContain("Agregar health");
  });

  it("leaves a merge nobody reverted approved", async () => {
    const { ctx } = factory();
    const { proposal } = autonomousMerge(ctx, "Agregar health");
    autonomousMerge(ctx, "Otra cosa");
    expect(await detectReverts(ctx)).toBe(0);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("approved");
  });

  it("ignores an integration the owner approved", async () => {
    const { ctx } = factory();
    const { proposal, commit } = autonomousMerge(ctx, "Agregar health", { integrate: true });
    revert(ctx, commit);
    await detectReverts(ctx);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("approved");
    expect(await lessons(ctx)).toHaveLength(0);
  });

  it("still marks it when the townhall fails, and survives a missing branch", async () => {
    const { ctx } = factory();
    const { proposal, commit } = autonomousMerge(ctx, "Agregar health");
    revert(ctx, commit);
    const broken = { ...ctx, townhall: { publish: async () => { throw new Error("disco lleno"); }, recall: async () => [] } };
    await expect(detectReverts(broken)).resolves.toBe(1);
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("reverted");

    const other = factory();
    autonomousMerge(other.ctx, "Algo");
    other.ctx.config.lines[0]!.baseBranch = "no-existe";
    await expect(detectReverts(other.ctx)).resolves.toBe(0);
  });

  it("runs in the daemon", async () => {
    const { ctx } = factory();
    const { proposal, commit } = autonomousMerge(ctx, "Agregar health");
    revert(ctx, commit);
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner });
    expect(ctx.store.getProposal(proposal.id)!.status).toBe("reverted");
  });
});

describe("scout remembers rejected and reverted", () => {
  const section = (prompt: string) => prompt.slice(prompt.indexOf("## Rejected or reverted proposals"), prompt.indexOf("## Research notes"));

  it("lists both, marking the reverted one", async () => {
    const { ctx, set } = factory();
    const { commit } = autonomousMerge(ctx, "Cambiar logs");
    const rejected = ctx.store.createProposal({ ...idea("Cambiar tema"), line: "tienda" });
    await rejectProposal(ctx, rejected.id, "no me gusta");
    revert(ctx, commit);
    set(at(3, 5));
    await detectReverts(ctx);
    const agents = scouting([idea("Cambiar  LOGS"), idea("Algo nuevo")]);
    await scoutLine(ctx, ctx.config.lines[0]!, agents.runner, at(4));
    const s = section(agents.calls[0]!.prompt);
    expect(s).toContain("- Cambiar logs — reverted by the owner on the base branch");
    expect(s).toContain("- Cambiar tema — rejected, owner's reason: no me gusta");
    expect(s.indexOf("Cambiar logs")).toBeLessThan(s.indexOf("Cambiar tema"));
    expect(ctx.store.listProposals({ status: ["pending"] }).map((p) => p.title)).toEqual(["Algo nuevo"]);
  });

  it("lists only the 20 most recently decided", async () => {
    const { ctx, set } = factory();
    for (let i = 1; i <= 25; i++) {
      const p = ctx.store.createProposal({ ...idea(`Idea ${i}`), line: "tienda" });
      set(at(3, i));
      if (i % 2) ctx.store.updateProposal(p.id, { status: "rejected", note: `motivo ${i}`, decidedBy: "owner" });
      else {
        ctx.store.updateProposal(p.id, { status: "approved", decidedBy: "night-shift" });
        ctx.store.updateProposal(p.id, { status: "reverted", from: "approved" });
      }
    }
    const agents = scouting([]);
    await scoutLine(ctx, ctx.config.lines[0]!, agents.runner, at(4));
    const s = section(agents.calls[0]!.prompt);
    expect(s.match(/^- Idea \d+ — /gm)).toHaveLength(20);
    for (let i = 6; i <= 25; i++) expect(s).toContain(`- Idea ${i} — `);
    for (let i = 1; i <= 5; i++) expect(s).not.toContain(`- Idea ${i} — `);
  });
});

describe("promotion of pending proposals", () => {
  const raise = (ctx: FactoryContext, autonomy: "build" | "auto") => (ctx.config.lines[0]!.nightShift = { autonomy });

  it("takes on a pending proposal once the line moves to build", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const p = ctx.store.createProposal({ ...idea("Cubrir egress"), line: "tienda" });
    ctx.store.setKv("scout:tienda", at(3).toISOString());
    raise(ctx, "build");
    await scoutPass(ctx, scouting([]).runner, at(3));
    const stored = ctx.store.getProposal(p.id)!;
    expect(stored).toMatchObject({ status: "approved", decidedBy: "night-shift", jobId: expect.any(String) });
    expect(ctx.store.getJob(stored.jobId!)).toMatchObject({ status: "queued", source: { kind: "night-shift", proposal: p.id, autonomy: "build" } });
  });

  it("respects maxAutoJobsPerDay, oldest first", async () => {
    const { ctx, set } = factory({ nightShift: { autonomy: "propose", maxAutoJobsPerDay: 1 } });
    const older = ctx.store.createProposal({ ...idea("Primera"), line: "tienda" });
    set(at(3, 1));
    const newer = ctx.store.createProposal({ ...idea("Segunda"), line: "tienda" });
    raise(ctx, "auto");
    await scoutPass(ctx, scouting([]).runner, at(3, 2));
    expect(ctx.store.getProposal(older.id)!.status).toBe("approved");
    expect(ctx.store.getProposal(newer.id)!.status).toBe("pending");
  });

  it("leaves propose lines alone", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const p = ctx.store.createProposal({ ...idea("Cubrir egress"), line: "tienda" });
    await scoutPass(ctx, scouting([]).runner, at(3));
    expect(ctx.store.getProposal(p.id)!.status).toBe("pending");
  });

  it("promotes nothing with the night shift off, outside its hours or with the andon on", async () => {
    const cases = [
      { nightShift: "off" },
      { nightShift: { autonomy: "propose", hours: "01:00-05:00" }, now: at(12) },
      { nightShift: { autonomy: "propose" }, andon: true },
    ] as const;
    for (const c of cases) {
      const { ctx } = factory({ nightShift: c.nightShift });
      const p = ctx.store.createProposal({ ...idea("Cubrir egress"), line: "tienda" });
      raise(ctx, "auto");
      if ("andon" in c) ctx.store.setKv(ANDON_KEY, "on");
      await scoutPass(ctx, scouting([]).runner, "now" in c ? c.now : at(3));
      expect(ctx.store.getProposal(p.id)!.status).toBe("pending");
      expect(ctx.store.listJobs()).toHaveLength(0);
    }
  });

  it("never promotes third-party proposals", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" }, research: { autonomy: "auto" } });
    const flagged = ctx.store.createProposal({ ...idea("Agregar librería"), line: "tienda", thirdParty: true });
    const manifest = ctx.store.createProposal({ ...idea("Subir versión"), line: "tienda", paths: ["package.json"] });
    raise(ctx, "auto");
    await scoutPass(ctx, scouting([]).runner, at(3));
    expect(ctx.store.getProposal(flagged.id)!.status).toBe("pending");
    expect(ctx.store.getProposal(manifest.id)!.status).toBe("pending");
    expect(ctx.store.listJobs()).toHaveLength(0);
  });
});

async function panel() {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }] });
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const post = (path: string, form: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  return { ctx, get, post };
}

const note = (ctx: FactoryContext, over: Record<string, unknown> = {}) =>
  ctx.store.createResearchNote({ line: "tienda", topic: "Caché de dependencias", findings: "Bajaría el tiempo de CI", sources: ["https://a.example/one", "https://b.example/two"], serves: "verify", maturity: "estable", ...over });

describe("panel research tab", () => {
  it("lists each line's notes with their sources and issue, linked from the nav", async () => {
    const p = await panel();
    const n = note(p.ctx);
    p.ctx.store.setResearchNoteIssue(n.id, { number: 9, url: "https://github.com/o/r/issues/9" });
    const r = await p.get("/research");
    expect(r.status).toBe(200);
    const html = await r.text();
    for (const text of ["Caché de dependencias", "https://a.example/one", "https://b.example/two", "https://github.com/o/r/issues/9", "Bajaría el tiempo de CI", "verify", "estable", "<h2>blog</h2>", `/research/${n.id}/request`]) expect(html).toContain(text);
    expect(html).toContain(`href="/research"`);
    expect(await (await p.get("/")).text()).toContain(`href="/research">Investigación</a>`);
  });

  it("escapes the notes", async () => {
    const p = await panel();
    note(p.ctx, { findings: "mirá <script>alert(1)</script>" });
    const html = await (await p.get("/research")).text();
    expect(html).toContain("&lt;script&gt;alert(1)");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("needs a session", async () => {
    const p = await panel();
    const r = await p.get("/research", {});
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain("Investigación</h1>");
  });

  it("asks for confirmation, then opens the job", async () => {
    const p = await panel();
    const n = note(p.ctx);
    const ask = await p.post(`/research/${n.id}/request`);
    expect(ask.status).toBe(200);
    expect(await ask.text()).toContain(`name="confirm" value="1"`);
    expect(p.ctx.store.listJobs()).toHaveLength(0);

    const ok = await p.post(`/research/${n.id}/request`, { confirm: "1" });
    expect(ok.status).toBe(303);
    const jobs = p.ctx.store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ line: "tienda", source: { kind: "research", note: n.id } });
    expect(ok.headers.get("location")).toMatch(/^\/research\?msg=/);
    expect(decodeURIComponent(ok.headers.get("location")!)).toContain(jobs[0]!.id);
  });

  it("reports an unknown note", async () => {
    const p = await panel();
    const r = await p.post("/research/ffffffff/request", { confirm: "1" });
    expect(r.status).toBe(303);
    expect(decodeURIComponent(r.headers.get("location")!)).toContain("No existe la nota de investigación ffffffff");
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("shows reverted proposals in their own group", async () => {
    const p = await panel();
    const proposal = p.ctx.store.createProposal({ ...idea("Cambiar logs"), line: "tienda" });
    p.ctx.store.updateProposal(proposal.id, { status: "approved", decidedBy: "night-shift" });
    p.ctx.store.updateProposal(proposal.id, { status: "reverted", from: "approved" });
    expect(proposalsView(p.ctx).lines.flatMap((l) => l.proposals).find((x) => x.id === proposal.id)!.stage).toBe("reverted");
    const html = await (await p.get("/proposals")).text();
    expect(html).toContain("Revertidas");
    expect(html).toContain("Cambiar logs");
  });
});

describe("README", () => {
  it("documents part 2c", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain("revertida");
    expect(readme).toMatch(/pestaña[^\n]*Investigación/);
    expect(readme).toMatch(/promue[^\n]*maxAutoJobsPerDay|maxAutoJobsPerDay[^\n]*promue/);
  });
});
