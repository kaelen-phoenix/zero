import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentInstructions, createAgentRunner } from "../src/agent.js";
import { requestWork, type FactoryContext } from "../src/app.js";
import type { EngineResult } from "../src/engines/index.js";
import { VERIFY_COMMAND_SPAN } from "../src/line/pace.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const alsoPasses = `node -e "process.exitCode = 0"`;
const fails = `node -e "process.exit(1)"`;
const DO_NOT = "do not run it whole";
const cut = { ok: false, text: "timed out after 45 min", timedOut: true };
const write = (req: { cwd: string }) => writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });
const deps = (ctx: FactoryContext, runner: RunnerDeps["runAgent"]): RunnerDeps => ({ ...ctx, runAgent: runner });

function factory(opts: { verify?: string[]; timeoutMinutes?: number; maxAttempts?: number } = {}) {
  return testFactory({
    level: "L2",
    isolation: "worktree",
    ...(opts.timeoutMinutes && { stations: { build: { timeoutMinutes: opts.timeoutMinutes } } }),
    lines: [{ name: "demo", repo: gitRepo(), verify: opts.verify ?? [passes], ...(opts.maxAttempts && { maxAttempts: opts.maxAttempts }) }],
  });
}

/** A passing run of a verify command an hour ago, in another job of the line. */
function ran(ctx: FactoryContext, command: string, minutes: number) {
  const { job } = requestWork(ctx, { text: "un trabajo anterior" });
  const start = Date.now() - 3_600_000;
  const id = `span-${job.id}`;
  ctx.store.insertSpan({ id, jobId: job.id, name: VERIFY_COMMAND_SPAN, start: new Date(start).toISOString(), attrs: {} });
  ctx.store.endSpan(id, new Date(start + minutes * 60_000).toISOString(), "ok", { "process.command_line": command, "zero.run_ms": minutes * 60_000 });
}

/** The build prompt of a job on the factory, and the job. */
async function built(ctx: FactoryContext) {
  const agents = fakeAgents({ build: write });
  const { job } = requestWork(ctx, { text: "health" });
  const done = await runJob(job.id, deps(ctx, agents.runner));
  return { done, prompt: agents.calls.find((c) => c.station === "build")!.prompt };
}

describe("the verify commands in build's prompt", () => {
  it("are as before without history", async () => {
    const { prompt } = await built(factory({ verify: [passes, alsoPasses] }));
    expect(prompt).toContain(`Implement the specification. Verification commands that must pass: ${passes}, ${alsoPasses}.`);
    expect(prompt).not.toContain(DO_NOT);
  });

  it("are none configured on a line without them", async () => {
    const { prompt } = await built(factory({ verify: [] }));
    expect(prompt).toContain("Verification commands that must pass: none configured.");
  });

  it("carry the known duration, only on the command that has one", async () => {
    const ctx = factory({ verify: [passes, alsoPasses] });
    ran(ctx, passes, 3);
    ran(ctx, passes, 2);
    const { prompt } = await built(ctx);
    expect(prompt).toContain(`Verification commands that must pass: ${passes} (takes up to 3 min), ${alsoPasses}.`);
    expect(prompt).not.toContain(DO_NOT);
  });

  it("round the duration up to the minute", async () => {
    const ctx = factory();
    ran(ctx, passes, 2.1);
    expect((await built(ctx)).prompt).toContain(`${passes} (takes up to 3 min)`);
  });

  it("say not to run whole a command over a third of build's time, and verify still runs it", async () => {
    const ctx = factory({ verify: [passes, alsoPasses], timeoutMinutes: 45 });
    ran(ctx, passes, 20);
    ran(ctx, alsoPasses, 3);
    const { done, prompt } = await built(ctx);
    expect(prompt).toContain(`${passes} (takes up to 20 min: do not run it whole, run only the tests of the files you touch; zero runs it whole in verify), ${alsoPasses} (takes up to 3 min).`);
    expect(done.status).toBe("delivered");
    const commands = ctx.store.spansForJob(done.id).filter((s) => s.name === VERIFY_COMMAND_SPAN);
    expect(commands.map((s) => [s.attrs["process.command_line"], s.status])).toEqual([[passes, "ok"], [alsoPasses, "ok"]]);
  });

  it("fail the attempt in verify even when build was told not to run the command whole", async () => {
    const ctx = factory({ verify: [fails], timeoutMinutes: 45, maxAttempts: 1 });
    ran(ctx, fails, 20);
    const { done, prompt } = await built(ctx);
    expect(prompt).toContain(DO_NOT);
    expect(done.status).toBe("failed");
    expect(ctx.store.spansForJob(done.id).filter((s) => s.name === VERIFY_COMMAND_SPAN).map((s) => s.status)).toEqual(["error"]);
  });

  it.each([
    { timeoutMinutes: 45, minutes: 15 },
    { timeoutMinutes: 120, minutes: 20 },
  ])("do not warn with $minutes of $timeoutMinutes minutes", async ({ timeoutMinutes, minutes }) => {
    const ctx = factory({ timeoutMinutes });
    ran(ctx, passes, minutes);
    const { prompt } = await built(ctx);
    expect(prompt).toContain(`${passes} (takes up to ${minutes} min)`);
    expect(prompt).not.toContain(DO_NOT);
  });

  it("have their exception in build's instructions", async () => {
    const text = await agentInstructions("build");
    expect(text).toMatch(/verification commands[^\n]*except the ones the prompt says not to run whole[^\n]*only the tests of the files you touch[^\n]*zero runs every command whole in verify/);
    expect(text).toContain("Never delete, skip or weaken existing tests");
  });
});

describe("a build cut by its time limit", () => {
  it("is told so in the next attempt, which goes on from what is in the copy", async () => {
    const ctx = factory({ timeoutMinutes: 45 });
    let kept = false;
    const agents = fakeAgents({
      build: (req, n) => {
        if (n === 1) {
          write(req);
          return cut;
        }
        kept = existsSync(join(req.cwd, "src/health.ts"));
      },
    });
    const { job } = requestWork(ctx, { text: "health" });

    expect(await runJob(job.id, deps(ctx, agents.runner))).toMatchObject({ status: "delivered", attempt: 2 });

    const second = agents.calls.filter((c) => c.station === "build")[1]!.prompt;
    expect(second).toContain("límite de 45 minutos");
    expect(second).toContain("sin commitear");
    expect(second).toContain("continuá desde ahí");
    expect(second).not.toContain("terminó de forma anormal");
    expect(second).not.toContain("Hacé cambios más chicos y enfocados");
    expect(kept).toBe(true);
  });

  it("is told apart from any other failure", async () => {
    const ctx = factory({ timeoutMinutes: 45 });
    const agents = fakeAgents({ build: (req, n) => (n === 1 ? { ok: false, text: "socket hang up" } : write(req)) });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    const second = agents.calls.filter((c) => c.station === "build")[1]!.prompt;
    expect(second).toContain("terminó de forma anormal (socket hang up). Hacé cambios más chicos y enfocados.");
    expect(second).not.toContain("45 minutos");
  });

  it("counts as an attempt", async () => {
    const ctx = factory({ maxAttempts: 2 });
    const agents = fakeAgents({ build: () => cut });
    const { job } = requestWork(ctx, { text: "health" });
    const failed = await runJob(job.id, deps(ctx, agents.runner));
    expect(failed).toMatchObject({ status: "failed", reason: expect.stringContaining("Se agotaron los 2 intentos") });
    expect(failed.reason).toContain("límite de 45 minutos");
    expect(agents.count.build).toBe(2);
  });
});

describe("the agent runner", () => {
  const runWith = (result: EngineResult) => createAgentRunner(testFactory({ engine: "claude", lines: [] }).config, { execute: async () => result })({ station: "build", prompt: "p", cwd: tempDir() });

  it("passes the time mark on, only when the engine set it", async () => {
    expect(await runWith(cut)).toMatchObject({ ok: false, timedOut: true });
    expect(await runWith({ ok: false, text: "socket hang up" })).not.toHaveProperty("timedOut");
  });
});
