import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answer, requestWork, trace, type FactoryContext } from "../src/app.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { statSync } from "node:fs";
import { cleanReview, cleanup, fakeAgents, gitIn, gitRepo, simulatedBox, testFactory, validSpec, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const checkHealth = `node -e "process.exit(require('fs').readFileSync('src/health.ts','utf8').includes('ok') ? 0 : 1)"`;

function factory(opts: { level?: string; verify?: string[]; usdPerJob?: number; files?: Record<string, string>; isolation?: string } = {}) {
  const repo = gitRepo(opts.files);
  const ctx = testFactory({
    level: opts.level ?? "L2",
    isolation: opts.isolation ?? "worktree",
    limits: { usdPerJob: opts.usdPerJob ?? 3 },
    lines: [{ name: "demo", repo, verify: opts.verify ?? [passes] }],
  });
  return { repo, ctx };
}

const writeHealth = (content = "export const status = 'ok';\n") => (req: { cwd: string }) => writeTree(req.cwd, { "src/health.ts": content });
const deps = (ctx: FactoryContext, runner: RunnerDeps["runAgent"], extra: Partial<RunnerDeps> = {}): RunnerDeps => ({ ...ctx, runAgent: runner, ...extra });

describe("production line", () => {
  it("delivers a request end to end and merges it into the base branch", async () => {
    const { repo, ctx } = factory();
    const agents = fakeAgents({ build: writeHealth() });
    const { job } = requestWork(ctx, { text: "agregá un endpoint de salud" });

    const done = await runJob(job.id, deps(ctx, agents.runner));

    expect(done).toMatchObject({ status: "delivered", checkpoint: "delivered", attempt: 1, title: "Health endpoint" });
    expect(done.delivery).toMatchObject({ mode: "merge", branch: `zero/${job.id}` });
    expect(readFileSync(join(repo, "src/health.ts"), "utf8")).toContain("ok");
    expect(existsSync(done.worktree!)).toBe(false);
    expect(gitIn(repo, "branch", "--list", `zero/${job.id}`)).toContain(job.id);
    expect(agents.count).toEqual({ spec: 1, build: 1, review: 1, security: 1 });
    expect(done.costUsd).toBeCloseTo(0.4);

    const t = trace(ctx, job.id);
    for (const span of ["zero.job", "zero.station.spec", "zero.attempt", "zero.station.build", "zero.station.verify", "zero.verify.command", "zero.station.review", "zero.station.integrate"]) {
      expect(t).toContain(span);
    }
    const posts = await ctx.townhall.recall();
    expect(posts.find((p) => p.kind === "run")).toMatchObject({ line: "demo", job: job.id, data: { status: "delivered" } });
  });

  it("signs the spec, attempt and merge commits with the trailer, and none of them with the signature off", async () => {
    const trailer = "Built-by: zero in the loop <https://zerointheloop.com>";
    const deliver = async (signature?: string) => {
      const repo = gitRepo({ "README.md": "# demo\n", "openspec/config.yaml": "schema: spec-driven\n" });
      const ctx = testFactory({ level: "L2", isolation: "worktree", ...(signature && { signature }), lines: [{ name: "demo", repo, verify: [passes] }] });
      const { job } = requestWork(ctx, { text: "agregá un endpoint de salud" });
      expect((await runJob(job.id, deps(ctx, fakeAgents({ build: writeHealth() }).runner))).status).toBe("delivered");
      return { repo, job };
    };

    const { repo, job } = await deliver();
    const branch = `zero/${job.id}`;
    expect(gitIn(repo, "log", "--format=%s", "main").split("\n").slice(0, 3)).toEqual([`zero: Health endpoint (${job.id})`, `zero(${job.id}): intento 1`, `zero(${job.id}): especificación`]);
    for (const rev of ["main", branch, `${branch}~1`]) {
      const message = gitIn(repo, "log", "-1", "--format=%B", rev).trim();
      expect(message.endsWith(`\n\n${trailer}`)).toBe(true);
      expect(spawnSync("git", ["interpret-trailers", "--parse"], { cwd: repo, input: message, encoding: "utf8" }).stdout.trim()).toBe(trailer);
    }

    const off = await deliver("off");
    expect(gitIn(off.repo, "log", "--format=%B", "main")).not.toContain("Built-by:");
  });

  it("asks the owner to approve the spec at L1 and continues after approval", async () => {
    const { ctx } = factory({ level: "L1" });
    const agents = fakeAgents({ build: writeHealth() });
    const { job } = requestWork(ctx, { text: "agregá un endpoint de salud" });

    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting.status).toBe("waiting");
    expect(waiting.question).toMatchObject({ kind: "spec-ready", onTimeout: "reject" });
    expect(waiting.question!.text).toContain("Qué va a funcionar");
    expect(agents.count).toEqual({ spec: 1 });

    expect((await answer(ctx, job.id, "approve")).status).toBe("queued");
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("delivered");
    expect(agents.count.spec).toBe(1);
  });

  it("stops a job the owner rejects", async () => {
    const { ctx } = factory({ level: "L1" });
    const { job } = requestWork(ctx, { text: "algo" });
    await runJob(job.id, deps(ctx, fakeAgents({}).runner));
    const stopped = await answer(ctx, job.id, "reject", "no era esto");
    expect(stopped).toMatchObject({ status: "stopped", reason: "Rechazado por el dueño: no era esto" });
  });

  it("retries the build with the verification output as feedback", async () => {
    const { ctx } = factory({ verify: [checkHealth] });
    const agents = fakeAgents({ build: (req, n) => writeHealth(n === 1 ? "bad\n" : "export const s = 'ok';\n")(req) });
    const { job } = requestWork(ctx, { text: "health" });

    const done = await runJob(job.id, deps(ctx, agents.runner));

    expect(done).toMatchObject({ status: "delivered", attempt: 2 });
    const second = agents.calls.filter((c) => c.station === "build")[1]!;
    expect(second.prompt).toContain("Feedback from the previous attempt");
    expect(second.prompt).toContain("terminó con código 1");
  });

  it("fails after the maximum number of attempts", async () => {
    const { ctx } = factory({ verify: [`node -e "process.exit(1)"`] });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, deps(ctx, fakeAgents({ build: writeHealth() }).runner));
    expect(done).toMatchObject({ status: "failed", attempt: 3 });
    expect(done.reason).toMatch(/Se agotaron los 3 intentos/);
    expect((await ctx.townhall.recall({ kinds: ["blocker"] }))[0]).toMatchObject({ line: "demo", job: job.id });
  });

  it("sends verified review findings back to the build and ignores invented ones", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({
      build: writeHealth(),
      review: (_req, n) =>
        n === 1
          ? { output: cleanReview({ findings: [{ severity: "critical", file: "src/health.ts", line: 1, problem: "no test", fix: "add one", confidence: 9 }] }) }
          : { output: cleanReview({ findings: [{ severity: "critical", file: "src/ghost.ts", line: 9, problem: "invented", fix: "-", confidence: 10 }] }) },
    });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done).toMatchObject({ status: "delivered", attempt: 2 });
    const retry = agents.calls.filter((c) => c.station === "build")[1]!.prompt;
    expect(retry).toContain("src/health.ts:1: no test");
    expect(retry).toContain("confianza 9");
  });

  it("does not send back a verified finding below the confidence threshold, and counts it on the span", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({
      build: writeHealth(),
      review: () => ({
        output: cleanReview({
          findings: [
            { severity: "critical", file: "src/health.ts", line: 1, problem: "maybe", fix: "f", confidence: 5 },
          ],
        }),
      }),
    });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count.build).toBe(1);
    const span = ctx.store.spansForJob(job.id).find((s) => s.name === "zero.station.review")!;
    expect(span.attrs).toMatchObject({ "zero.findings.low_confidence": 1, "zero.findings": 1 });
  });

  it("records low-confidence findings next to verified findings and invalid citations", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({
      build: writeHealth(),
      review: () => ({
        output: cleanReview({
          findings: [
            { severity: "high", file: "src/health.ts", line: 1, problem: "guess", fix: "f", confidence: 3 },
            { severity: "high", file: "src/health.ts", line: 1, problem: "hunch", fix: "f", confidence: 6 },
            { severity: "critical", file: "src/ghost.ts", line: 9, problem: "invented", fix: "-", confidence: 10 },
          ],
        }),
      }),
    });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 1 });
    const span = ctx.store.spansForJob(job.id).find((s) => s.name === "zero.station.review")!;
    expect(span.attrs).toMatchObject({ "zero.findings.low_confidence": 2, "zero.findings": 2, "zero.citations.invalid": 1 });
  });

  it("runs a separate security check after the review, and sends its verified findings back to the build", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({
      build: writeHealth(),
      security: (req, n) =>
        n === 1
          ? (writeTree(req.cwd, { "sneaky.txt": "x" }), { output: cleanReview({ findings: [{ severity: "critical", file: "src/health.ts", line: 1, problem: "token in code", fix: "read it from the keychain", confidence: 9 }] }) })
          : undefined,
    });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done).toMatchObject({ status: "delivered", attempt: 2 });
    expect(agents.calls.map((c) => c.station)).toEqual(["spec", "build", "review", "security", "build", "review", "security"]);
    expect(agents.calls.find((c) => c.station === "security")!.prompt).toContain("security problems");
    const retry = agents.calls.filter((c) => c.station === "build")[1]!.prompt;
    expect(retry).toContain("La revisión de seguridad encontró problemas");
    expect(retry).toContain("src/health.ts:1: token in code");
    expect(gitIn(ctx.config.lines[0]!.repo, "ls-tree", "-r", "--name-only", "main")).not.toContain("sneaky.txt");
  });

  it("discards anything the read-only spec station writes", async () => {
    const { repo, ctx } = factory();
    const agents = fakeAgents({ spec: (req) => void writeTree(req.cwd, { "sneaky.txt": "x" }), build: writeHealth() });
    const { job } = requestWork(ctx, { text: "health" });
    expect((await runJob(job.id, deps(ctx, agents.runner))).status).toBe("delivered");
    expect(existsSync(join(repo, "sneaky.txt"))).toBe(false);
  });

  it("fails a request the spec station declares infeasible, without building", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ spec: () => ({ output: validSpec({ feasible: false, reason: "requiere credenciales de producción", requirements: [] }) }) });
    const { job } = requestWork(ctx, { text: "desplegá en producción" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done).toMatchObject({ status: "failed", reason: expect.stringContaining("credenciales de producción") });
    expect(agents.count.build).toBeUndefined();
  });

  it("writes the spec into the repository's OpenSpec changes", async () => {
    const { repo, ctx } = factory({ files: { "openspec/config.yaml": "schema: spec-driven\n" } });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, fakeAgents({ build: writeHealth() }).runner));
    expect(existsSync(join(repo, "openspec", "changes", `zero-${job.id}`, "specs", "health-check", "spec.md"))).toBe(true);
    expect(existsSync(join(ctx.home.jobs, job.id, "openspec", "proposal.md"))).toBe(true);
  });

  it("asks before touching protected paths at L2 and resumes at verify after approval", async () => {
    const { repo, ctx } = factory();
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { ".github/workflows/ci.yml": "on: push\n", "src/health.ts": "ok" }) });
    const { job } = requestWork(ctx, { text: "health + ci" });

    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting.question).toMatchObject({ kind: "protected-path", data: { paths: [".github/workflows/ci.yml"] } });

    await answer(ctx, job.id, "approve");
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("delivered");
    expect(agents.count.build).toBe(1);
    expect(existsSync(join(repo, ".github/workflows/ci.yml"))).toBe(true);
  });

  it("refuses protected paths as a hard limit at L3", async () => {
    const { ctx } = factory({ level: "L3", isolation: "container" });
    const agents = fakeAgents({
      build: (req, n) => void writeTree(req.cwd, n === 1 ? { ".env": "SECRET=1" } : { "src/health.ts": "ok" }),
    });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner, { box: simulatedBox(agents.runner).box }));
    // The first attempt touched .env and was rejected; the second never reverted it, so it is still protected.
    expect(done.status).toBe("failed");
    expect(agents.calls.filter((c) => c.station === "build")[1]!.prompt).toContain("rutas protegidas (.env)");
  });

  it("stops at the job budget at L3 and asks for more at L2", async () => {
    const strict = factory({ level: "L3", isolation: "container", usdPerJob: 0.15, verify: [`node -e "process.exit(1)"`] });
    const j1 = requestWork(strict.ctx, { text: "x" }).job;
    const strictAgents = fakeAgents({ build: writeHealth() });
    const failed = await runJob(j1.id, deps(strict.ctx, strictAgents.runner, { box: simulatedBox(strictAgents.runner).box }));
    expect(failed).toMatchObject({ status: "failed", reason: expect.stringMatching(/presupuesto/) });

    const lenient = factory({ level: "L2", usdPerJob: 0.15, verify: [`node -e "process.exit(1)"`] });
    const j2 = requestWork(lenient.ctx, { text: "x" }).job;
    const waiting = await runJob(j2.id, deps(lenient.ctx, fakeAgents({ build: writeHealth() }).runner));
    expect(waiting.question).toMatchObject({ kind: "budget-exceeded", data: { extraUsd: 0.15 } });
    expect((await answer(lenient.ctx, j2.id, "approve")).approvals.extraBudgetUsd).toBe(0.15);
  });

  it("goes back to the queue on andon and resumes without redoing the spec", async () => {
    const { ctx } = factory();
    const controller = new AbortController();
    const agents = fakeAgents({
      build: (req, n) => {
        if (n === 1) {
          controller.abort("andon");
          return { ok: false, text: "cancelled" };
        }
        writeHealth()(req);
      },
    });
    const { job } = requestWork(ctx, { text: "health" });
    const paused = await runJob(job.id, deps(ctx, agents.runner), controller.signal);
    expect(paused).toMatchObject({ status: "queued", checkpoint: "spec", station: "build" });

    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("delivered");
    expect(agents.count).toMatchObject({ spec: 1, build: 2 });
  });

  it("ends a job stopped by the owner", async () => {
    const { ctx } = factory();
    const controller = new AbortController();
    const agents = fakeAgents({ build: () => (controller.abort("stop"), { ok: false, text: "cancelled" }) });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, deps(ctx, agents.runner), controller.signal)).toMatchObject({ status: "stopped", reason: "Detenido por el dueño." });
  });

  it("parks the job when the owner's copy has unsaved changes, and retries after approval", async () => {
    const { repo, ctx } = factory();
    const agents = fakeAgents({ build: writeHealth() });
    const { job } = requestWork(ctx, { text: "health" });
    writeFileSync(join(repo, "README.md"), "editing\n");

    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting.question).toMatchObject({ kind: "integration-blocked" });
    expect(waiting.question!.text).toMatch(/cambios sin guardar/);

    gitIn(repo, "commit", "-q", "-am", "owner saved");
    await answer(ctx, job.id, "approve");
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done.status).toBe("delivered");
    expect(agents.count).toEqual({ spec: 1, build: 1, review: 1, security: 1 });
  });

  it("keeps what setup creates out of the change, and never discards it", async () => {
    const repo = gitRepo();
    const makeDeps = `node -e "require('fs').mkdirSync('node_modules/dep',{recursive:true});require('fs').writeFileSync('node_modules/dep/index.js','1')"`;
    const depsPresent = `node -e "process.exit(require('fs').existsSync('node_modules/dep/index.js') ? 0 : 1)"`;
    const ctx = testFactory({ level: "L2", lines: [{ name: "demo", repo, setup: [makeDeps], verify: [depsPresent] }] });
    const agents = fakeAgents({
      build: writeHealth(),
      // The first review writes a file, which forces a discard before the second attempt's verify.
      review: (req, n) => (n === 1 ? (writeTree(req.cwd, { "junk.txt": "x" }), { output: cleanReview({ findings: [{ severity: "high", file: "src/health.ts", line: 1, problem: "p", fix: "f", confidence: 8 }] }) }) : undefined),
    });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done).toMatchObject({ status: "delivered", attempt: 2 });
    expect(gitIn(repo, "ls-tree", "-r", "--name-only", "main")).not.toContain("node_modules");
    expect(existsSync(join(repo, "junk.txt"))).toBe(false);
  });

  it("runs setup, agents and verification through the box, on an independent clone", async () => {
    const repo = gitRepo();
    const ctx = testFactory({ level: "L3", isolation: "container", lines: [{ name: "demo", repo, setup: [passes], verify: [passes] }] });
    const agents = fakeAgents({ build: writeHealth() });
    const sim = simulatedBox(agents.runner);
    const { job } = requestWork(ctx, { text: "health" });
    let copyIsClone = false;
    const done = await runJob(job.id, deps(ctx, fakeAgents({}).runner, {
      box: { ...sim.box, shell: async (c, o) => ((copyIsClone ||= statSync(join(o.cwd, ".git")).isDirectory()), sim.box.shell(c, o)) },
    }));
    expect(done).toMatchObject({ status: "delivered", isolation: "container" });
    expect(sim.calls.map((c) => [c.command, c.mount])).toEqual([[passes, "rw"], [passes, "rw"]]);
    expect(copyIsClone).toBe(true);
    expect(agents.count).toEqual({ spec: 1, build: 1, review: 1, security: 1 });
    expect(readFileSync(join(repo, "src/health.ts"), "utf8")).toContain("ok");
    expect(trace(ctx, job.id)).toContain("zero.station.integrate");
  });

  it("works on this machine when the box is configured but not ready", async () => {
    const ctx = testFactory({ level: "L3", isolation: "container", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] });
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, deps(ctx, fakeAgents({ build: writeHealth() }).runner));
    expect(done).toMatchObject({ status: "delivered", isolation: "worktree" });
  });

  it("does not move a job out of the box when the box disappears", async () => {
    const ctx = testFactory({ isolation: "container", lines: [{ name: "demo", repo: gitRepo() }] });
    const { job } = requestWork(ctx, { text: "health" });
    ctx.store.updateJob(job.id, { isolation: "container" });
    const done = await runJob(job.id, deps(ctx, fakeAgents({}).runner));
    expect(done).toMatchObject({ status: "failed", reason: expect.stringMatching(/caja de aislamiento/) });
  });

  it("shares what one job learned with the next job of the same line only", async () => {
    const { ctx } = factory();
    const learned = validSpec({ learnings: [{ kind: "finding", topic: "tests", body: "los tests usan vitest", source: "package.json" }], followUps: ["agregar CI"] });
    const agents = fakeAgents({ spec: (_r, n) => (n === 1 ? { output: learned } : undefined), build: writeHealth() });
    await runJob(requestWork(ctx, { text: "primero" }).job.id, deps(ctx, agents.runner));
    await runJob(requestWork(ctx, { text: "segundo" }).job.id, deps(ctx, agents.runner));

    const secondSpec = agents.calls.filter((c) => c.station === "spec")[1]!;
    expect(secondSpec.prompt).toContain("[finding] tests: los tests usan vitest (package.json)");
    expect((await ctx.townhall.recall({ kinds: ["proposal"] }))[0]).toMatchObject({ line: "demo", body: "agregar CI" });
  });
});
