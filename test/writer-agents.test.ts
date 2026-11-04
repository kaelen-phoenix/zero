import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentName, createAgentRunner, type AgentStation, type CustomAgentRun, type EngineExecute } from "../src/agent.js";
import { addAgent, agentList, answer, requestWork, type FactoryContext } from "../src/app.js";
import { loadFactory, parseFactory } from "../src/config.js";
import type { EngineRequest, QuotaReport } from "../src/engines/index.js";
import { formatAgents } from "../src/format.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { changeName } from "../src/line/spec.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanReview, cleanup, fakeAgents, gitIn, gitRepo, run, simulatedBox, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const DOCS = "# docs\nKeep the documentation current.\n";
const I18N = "# i18n\nTranslate every new text.\n";
const OWN_FILES = { ".zero/agents/docs.md": DOCS, ".zero/agents/i18n.md": I18N, ".zero/agents/a11y.md": "# a11y\n" };
const docs = { name: "docs", type: "build" };
const i18n = { name: "i18n", type: "build" };

function factory(opts: { agents?: unknown[]; global?: unknown[]; files?: Record<string, string>; level?: string; isolation?: string; verify?: string[]; fallback?: string[]; maxAttempts?: number } = {}) {
  const repo = gitRepo({ "README.md": "# demo\n", ...OWN_FILES, ...opts.files });
  const ctx = testFactory({
    level: opts.level ?? "L2",
    isolation: opts.isolation ?? "worktree",
    ...(opts.global && { agents: opts.global }),
    ...(opts.fallback && { fallback: opts.fallback }),
    lines: [{ name: "web", repo, verify: opts.verify ?? [passes], maxAttempts: opts.maxAttempts ?? 3, agents: opts.agents ?? [docs] }],
  });
  return { repo, ctx };
}

const writeHealth = (req: { cwd: string }) => void writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });
const writeDoc = (req: { cwd: string }) => void writeTree(req.cwd, { "docs/x.md": "# x\n" });
const deps = (ctx: FactoryContext, runner: RunnerDeps["runAgent"], extra: Partial<RunnerDeps> = {}): RunnerDeps => ({ ...ctx, runAgent: runner, ...extra });
const names = (calls: Parameters<typeof agentName>[0][]) => calls.map(agentName);
const buildPrompts = (calls: { station: AgentStation; custom?: CustomAgentRun; prompt: string }[]) => calls.filter((c) => agentName(c) === "build").map((c) => c.prompt);
const inMain = (repo: string) => gitIn(repo, "ls-tree", "-r", "--name-only", "main");
const usedUp = (): QuotaReport => ({ billing: "subscription", limited: true, windows: [{ name: "five_hour", label: "5 horas", utilization: 1, status: "exhausted", resetsAt: new Date(Date.now() + 3_600_000).toISOString() }] });
const agentsOf = (yaml: string) => parseFactory(`agents: ${yaml}`).agents;

describe("agent types in the factory file", () => {
  it("keep a reviewer without a type", () => {
    expect(agentsOf("[{ name: a11y }]")[0]).toMatchObject({ type: "review", access: "read", after: "review", blocking: true, files: [] });
    expect(agentsOf("[{ name: a11y, access: read, after: review, blocking: false }]")[0]).toMatchObject({ type: "review", blocking: false });
  });

  it("derive access and place for an agent that writes", () => {
    expect(agentsOf("[{ name: docs, type: build }]")[0]).toMatchObject({ type: "build", access: "write", after: "build", blocking: true, files: [] });
    expect(agentsOf("[{ name: docs, type: build, access: write, files: ['site/**'] }]")[0]).toMatchObject({ files: ["site/**"] });
  });

  it("refuse an unknown type, in Spanish", () => {
    expect(() => agentsOf("[{ name: docs, type: deploy }]")).toThrow(/tiene que ser review o build/);
  });

  it("never let an agent that writes run after verify", () => {
    expect(() => agentsOf("[{ name: docs, type: build, after: review }]")).toThrow(/corre entre build y verify/);
    expect(() => agentsOf("[{ name: docs, type: build, after: verify }]")).toThrow(/corre entre build y verify/);
    expect(() => agentsOf("[{ name: docs, type: build, after: build }]")).toThrow(/corre entre build y verify/);
  });

  it("refuse contradictions", () => {
    expect(() => agentsOf("[{ name: docs, type: build, access: read }]")).toThrow(/access solo puede ser write/);
    expect(() => agentsOf("[{ name: docs, type: build, blocking: false }]")).toThrow(/blocking: false/);
    expect(() => agentsOf("[{ name: docs, access: write }]")).toThrow(/solo puede ser de lectura/);
    expect(() => agentsOf("[{ name: docs, after: build }]")).toThrow(/después de review/);
    expect(() => agentsOf("[{ name: a11y, files: ['x'] }]")).toThrow(/files solo vale con type: build/);
    expect(() => agentsOf("[{ name: docs, type: build, files: [''] }]")).toThrow(/no pueden estar vacíos/);
    expect(() => agentsOf("[{ name: Docs }]")).toThrow(/minúsculas/);
  });
});

describe("agents that write, on the line", () => {
  it("run between build and verify in order, with reviewers after security", async () => {
    const { ctx, repo } = factory({ global: [docs], agents: [{ name: "a11y" }, i18n] });
    writeTree(dirname(ctx.home.config), { ".zero/agents/docs.md": DOCS });
    const agents = fakeAgents({ build: writeHealth, docs: writeDoc });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(names(agents.calls)).toEqual(["spec", "build", "docs", "i18n", "review", "security", "a11y"]);
    expect(inMain(repo)).toContain("docs/x.md");
    const prompt = agents.calls.find((c) => agentName(c) === "docs")!.prompt;
    expect(prompt).toContain("Health check");
    expect(prompt).toContain("git diff main...HEAD");
    expect(prompt).toContain("Never commit");
  });

  it("run before verify, which sees what they wrote", async () => {
    const { ctx } = factory({ verify: [`node -e "process.exit(require('fs').existsSync('docs/x.md') ? 0 : 1)"`] });
    const agents = fakeAgents({ build: writeHealth, docs: writeDoc });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
  });

  it("do not run when build changed nothing", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: (req, n) => (n === 1 ? undefined : writeHealth(req)) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 2 });
    expect(names(agents.calls)).toEqual(["spec", "build", "build", "docs", "review", "security"]);
  });

  it("leave their work in a commit of their own, seen by the next one", async () => {
    const { ctx, repo } = factory({ agents: [docs, i18n] });
    let seen: { status: string; file: boolean } | undefined;
    const agents = fakeAgents({
      build: writeHealth,
      docs: writeDoc,
      i18n: (req) => void (seen = { status: run("git", ["status", "--porcelain"], req.cwd), file: existsSync(join(req.cwd, "docs/x.md")) }),
    });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(seen).toEqual({ status: "", file: true });
    const log = gitIn(repo, "log", "--format=%B", "main");
    expect(log).toContain(`zero(${job.id}): intento 1, agente docs`);
    expect(log).toContain("zerointheloop.com");
    // One that changed nothing leaves no commit.
    expect(log).not.toContain("agente i18n");
  });

  it("may end well without changes", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count.docs).toBe(1);
  });

  it("fail the attempt when they undo the whole change", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: writeHealth, docs: (req, n) => (n === 1 ? rmSync(join(req.cwd, "src/health.ts")) : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 2 });
    expect(buildPrompts(agents.calls)[1]).toContain("No se hizo ningún cambio");
    expect(agents.count.review).toBe(1);
  });
});

describe("what agents that write touch", () => {
  it.each([".github/workflows/ci.yml", ".zero/agents/security.md"])("stops at L3 on the protected path %s", async (path) => {
    const { ctx } = factory({ level: "L3", isolation: "container" });
    const agents = fakeAgents({ build: writeHealth, docs: (req) => void writeTree(req.cwd, { [path]: "x\n" }) });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner, { box: simulatedBox(agents.runner).box }));
    expect(done.status).toBe("failed");
    expect(buildPrompts(agents.calls)[1]).toContain("rutas protegidas");
    expect(agents.count.review).toBeUndefined();
  });

  it("asks the owner at L2 about a protected path, and resumes at verify", async () => {
    const { ctx, repo } = factory();
    const agents = fakeAgents({ build: writeHealth, docs: (req) => void writeTree(req.cwd, { ".github/workflows/ci.yml": "x\n" }) });
    const { job } = requestWork(ctx, { text: "health" });
    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting.question).toMatchObject({ kind: "protected-path", data: { paths: [".github/workflows/ci.yml"] } });
    await answer(ctx, job.id, "approve");
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count.docs).toBe(1);
    expect(inMain(repo)).toContain(".github/workflows/ci.yml");
  });

  it("is seen by review, and the next attempt runs build and the agent again", async () => {
    const { ctx } = factory();
    const finding = { severity: "critical" as const, file: "docs/x.md", line: 1, problem: "wrong doc", fix: "fix it", confidence: 9 };
    const agents = fakeAgents({ build: writeHealth, docs: writeDoc, review: (_req, n) => (n === 1 ? { output: cleanReview({ findings: [finding] }) } : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 2 });
    expect(names(agents.calls)).toEqual(["spec", "build", "docs", "review", "build", "docs", "review", "security"]);
    expect(buildPrompts(agents.calls)[1]).toContain("docs/x.md:1: wrong doc");
    expect(agents.calls.filter((c) => agentName(c) === "docs")[1]!.prompt).toContain("docs/x.md:1: wrong doc");
  });

  it("fails the attempt when verify fails on it, with the feedback for build", async () => {
    const { ctx } = factory({ verify: [`node -e "process.exit(require('fs').readFileSync('docs/x.md','utf8').includes('bien') ? 0 : 1)"`] });
    const agents = fakeAgents({ build: writeHealth, docs: (req, n) => void writeTree(req.cwd, { "docs/x.md": n === 1 ? "mal\n" : "bien\n" }) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 2 });
    expect(buildPrompts(agents.calls)[1]).toContain("docs/x.md");
  });
});

describe("the guarantees of agents that write", () => {
  it("run with write access and their own limits, and reviewers stay read-only", async () => {
    const { ctx } = factory({ agents: [{ ...docs, maxTurns: 7, timeoutMinutes: 3 }, { name: "a11y" }] });
    const seen: EngineRequest[] = [];
    const execute: EngineExecute = async (_e, req) => (seen.push(req), { ok: true, text: "ok" });
    const runner = createAgentRunner(ctx.config, { execute });
    const custom = (name: string, access: "read" | "write", maxTurns: number, timeoutMinutes: number) => ({ name, instructions: DOCS, access, maxTurns, timeoutMinutes, skills: [] });
    await runner({ station: "build", prompt: "p", cwd: ctx.home.root, custom: custom("docs", "write", 7, 3) });
    await runner({ station: "review", prompt: "p", cwd: ctx.home.root, custom: custom("a11y", "read", 40, 15) });
    expect(seen[0]).toMatchObject({ access: "write", instructions: DOCS, maxTurns: 7, timeoutMs: 3 * 60_000 });
    expect(seen[1]).toMatchObject({ access: "read" });

    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    const call = (name: string) => agents.calls.find((c) => agentName(c) === name)!;
    expect(call("docs")).toMatchObject({ station: "build", custom: { access: "write", maxTurns: 7, timeoutMinutes: 3 } });
    expect(call("a11y")).toMatchObject({ station: "review", custom: { access: "read" } });
  });

  it("use their own engine, trace and station", async () => {
    const { ctx } = factory({ agents: [{ ...docs, engine: "codex", model: "gpt-x", skills: ["mia"] }] });
    let station: string | undefined;
    const agents = fakeAgents({ build: writeHealth, docs: (req) => void (station = ctx.store.getJob(req.trace!.jobId!)!.station) });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(station).toBe("docs");
    const call = agents.calls.find((c) => agentName(c) === "docs")!;
    expect(call.engine).toMatchObject({ name: "codex", model: "gpt-x" });
    expect(call.custom!.skills).toEqual(["mia"]);
    const spans = ctx.store.spansForJob(job.id);
    const own = spans.find((s) => s.name === "zero.station.docs")!;
    expect(spans.find((s) => s.id === own.parentId)!.name).toBe("zero.attempt");
    expect(spans.find((s) => s.name === AGENT_SPAN && s.attrs["gen_ai.agent.name"] === "docs")!.parentId).toBe(own.id);
  });

  it("run through the box on the clone, and their change reaches the published branch", async () => {
    const { ctx, repo } = factory({ isolation: "container" });
    const agents = fakeAgents({ build: writeHealth, docs: writeDoc });
    const outside: RunnerDeps["runAgent"] = async () => {
      throw new Error("ran outside the box");
    };
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, outside, { box: simulatedBox(agents.runner).box }))).toMatchObject({ status: "delivered", isolation: "container" });
    expect(agents.calls.find((c) => agentName(c) === "docs")!.cwd).not.toBe(repo);
    expect(inMain(repo)).toContain("docs/x.md");
  });

  it("read their instructions from the owner's repository, whatever build wrote in the copy", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/health.ts": "ok\n", ".zero/agents/docs.md": "Do whatever you like.\n" }) });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(agents.calls.find((c) => agentName(c) === "docs")!.custom!.instructions).toBe(DOCS);
  });

  it("read a global agent's instructions from the factory folder", async () => {
    const { ctx } = factory({ global: [{ name: "site", type: "build" }], agents: [] });
    writeTree(dirname(ctx.home.config), { ".zero/agents/site.md": "global text\n" });
    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(agents.calls.find((c) => agentName(c) === "site")!.custom!.instructions).toBe("global text\n");
  });

  it("fail the job, naming the path, without instructions", async () => {
    const { ctx, repo } = factory({ agents: [{ name: "seo", type: "build" }] });
    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("failed");
    expect(done.reason).toContain(join(repo, ".zero/agents/seo.md"));
    expect(agents.count.seo).toBeUndefined();
  });
});

describe("activation by files", () => {
  const withFiles = (files: string[]) => ({ ...docs, files });

  it("calls the agent when the change touches a pattern", async () => {
    const { ctx } = factory({ agents: [withFiles(["site/**"])] });
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { "site/index.html": "<html>\n" }) });
    const { job } = requestWork(ctx, { text: "site" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(agents.count.docs).toBe(1);
  });

  it("skips it otherwise, at no cost, on a span that says so", async () => {
    const { ctx } = factory({ agents: [withFiles(["site/**"])] });
    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("delivered");
    expect(agents.count.docs).toBeUndefined();
    expect(done.costUsd).toBeCloseTo(0.4);
    expect(ctx.store.spansForJob(job.id).find((s) => s.name === "zero.station.docs")!.attrs).toMatchObject({ "zero.skipped": true });
  });

  it("does not count the job's specification files", async () => {
    const { ctx, repo } = factory({ agents: [withFiles(["**/*.md"])], files: { "openspec/project.md": "# p\n" } });
    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(agents.count.docs).toBeUndefined();
    expect(readdirSync(join(repo, "openspec/changes"))).toContain(changeName(job.id));
  });

  it("includes what an earlier agent wrote", async () => {
    const { ctx } = factory({ agents: [docs, { ...i18n, files: ["docs/**"] }] });
    const agents = fakeAgents({ build: writeHealth, docs: writeDoc });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(agents.count.i18n).toBe(1);
  });
});

describe("agents that write that fail", () => {
  it("fail the attempt, discarding what they wrote, and skip the next ones", async () => {
    const { ctx, repo } = factory({ agents: [docs, i18n] });
    const agents = fakeAgents({ build: writeHealth, docs: (req, n) => (n === 1 ? (writeTree(req.cwd, { "basura.txt": "x\n" }), { ok: false, text: "se rompió" }) : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 2 });
    expect(names(agents.calls)).toEqual(["spec", "build", "docs", "build", "docs", "i18n", "review", "security"]);
    expect(buildPrompts(agents.calls)[1]).toContain("El agente docs terminó de forma anormal (se rompió)");
    expect(inMain(repo)).not.toContain("basura.txt");
  });

  it("use up the attempts", async () => {
    const { ctx } = factory({ maxAttempts: 2 });
    const agents = fakeAgents({ build: writeHealth, docs: () => ({ ok: false, text: "roto" }) });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("failed");
    expect(done.reason).toContain("Se agotaron los 2 intentos");
    expect(agents.count.docs).toBe(2);
    expect(agents.count.review).toBeUndefined();
  });
});

describe("plan and budget on agents that write", () => {
  it("go back to the queue without a replacement, and resume at the agent", async () => {
    const { ctx, repo } = factory({ agents: [i18n, docs] });
    const agents = fakeAgents({ build: writeHealth, docs: (req, n) => (n === 1 ? (writeTree(req.cwd, { "basura.txt": "x\n" }), { ok: false, text: "rate limited", quota: usedUp() }) : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "queued", attempt: 1, station: "docs" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count).toMatchObject({ build: 1, i18n: 1, docs: 2 });
    expect(inMain(repo)).not.toContain("basura.txt");
  });

  it("go on with a replacement of their chain in the same attempt", async () => {
    const { ctx, repo } = factory({ fallback: ["codex"] });
    const agents = fakeAgents({ build: writeHealth, docs: (req, n) => (n === 1 ? (writeTree(req.cwd, { "basura.txt": "x\n" }), { ok: false, text: "rate limited", quota: usedUp() }) : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.calls.filter((c) => agentName(c) === "docs").map((c) => c.engine!.name)).toEqual(["claude", "codex"]);
    expect(agents.count.build).toBe(1);
    expect(inMain(repo)).not.toContain("basura.txt");
  });

  it("ask the owner when the job's budget cuts them short, and resume at the agent", async () => {
    const { ctx, repo } = factory();
    const agents = fakeAgents({ build: writeHealth, docs: (req, n) => (n === 1 ? (writeTree(req.cwd, { "basura.txt": "x\n" }), { ok: false, text: "Reached maximum budget", budgetLimited: true }) : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting).toMatchObject({ status: "waiting", attempt: 1, station: "docs", question: { kind: "budget-exceeded" } });
    await answer(ctx, job.id, "approve");
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count).toMatchObject({ build: 1, docs: 2 });
    expect(inMain(repo)).not.toContain("basura.txt");
  });

  it("resume at the agent after a shutdown", async () => {
    const { ctx } = factory();
    const stopped = new AbortController();
    const agents = fakeAgents({ build: writeHealth, docs: (_req, n) => (n === 1 ? stopped.abort("shutdown") : undefined) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner), stopped.signal)).toMatchObject({ status: "queued", attempt: 1, station: "docs" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count).toMatchObject({ build: 1, docs: 2 });
  });
});

describe("zero agent with types", () => {
  it("adds an agent that writes", async () => {
    const { ctx, repo } = factory({ agents: [] });
    const message = await addAgent(ctx, { name: "tech", line: "web", type: "build", files: ["**/*.md"] });
    expect(message).toContain("tipo build");
    expect((await loadFactory(ctx.home.config)).lines[0]!.agents).toMatchObject([{ name: "tech", type: "build", access: "write", files: ["**/*.md"] }]);
    const template = readFileSync(join(repo, ".zero/agents/tech.md"), "utf8");
    expect(template).toContain('"tech" agent');
    expect(template).not.toMatch(/read-only|solo lectura/i);
  });

  it("adds a reviewer without a type, as before", async () => {
    const { ctx, repo } = factory({ agents: [] });
    const message = await addAgent(ctx, { name: "seo", line: "web" });
    expect(message).toContain("bloqueante");
    expect((await loadFactory(ctx.home.config)).lines[0]!.agents).toMatchObject([{ name: "seo", type: "review", access: "read" }]);
    expect(readFileSync(ctx.home.config, "utf8")).not.toContain("type:");
    expect(readFileSync(join(repo, ".zero/agents/seo.md"), "utf8")).toContain("read-only");
  });

  it("refuses bad combinations without touching anything", async () => {
    const { ctx, repo } = factory({ agents: [] });
    const before = readFileSync(ctx.home.config, "utf8");
    await expect(addAgent(ctx, { name: "x1", line: "web", type: "deploy" })).rejects.toThrow(/no existe/);
    await expect(addAgent(ctx, { name: "x1", line: "web", type: "build", blocking: false })).rejects.toThrow(/informativo/);
    await expect(addAgent(ctx, { name: "x1", line: "web", type: "review", files: ["a"] })).rejects.toThrow(/--archivos/);
    await expect(addAgent(ctx, { name: "x1", line: "web", files: ["a"] })).rejects.toThrow(/--archivos/);
    await expect(addAgent(ctx, { name: "x1", line: "web", type: "build", files: [" "] })).rejects.toThrow(/vacíos/);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
    expect(existsSync(join(repo, ".zero/agents/x1.md"))).toBe(false);
  });

  it("lists the type, the patterns and the real order", () => {
    const { ctx } = factory({ agents: [{ name: "a11y" }, { ...docs, files: ["**/*.md"] }] });
    const lists = agentList(ctx, "web");
    expect(lists[0]!.agents.map((a) => [a.name, a.type, a.files])).toEqual([["docs", "build", ["**/*.md"]], ["a11y", "review", []]]);
    const text = formatAgents(lists);
    expect(text).toContain("spec → build → docs → verify → review → security → a11y → integrate");
    expect(text).toContain("- docs (escribe, solo si el cambio toca **/*.md, de la línea)");
    expect(text).toContain("- a11y (revisor bloqueante, de la línea)");
  });
});
