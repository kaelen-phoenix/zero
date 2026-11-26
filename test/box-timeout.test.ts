import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestWork } from "../src/app.js";
import { createBoxExecutor } from "../src/box/executor.js";
import type { GateHost } from "../src/box/network.js";
import type { BoxStatus } from "../src/box/status.js";
import { resolveEngine, type EngineRequest } from "../src/engines/index.js";
import { runJob } from "../src/line/runner.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

type Fake = (spec: { copy: string }) => { code: number; stdout: string; stderr: string; timedOut: boolean; cancelled: boolean };
const fake = vi.hoisted(() => ({ next: [] as Fake[], prompts: [] as string[] }));

vi.mock("../src/box/run.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/box/run.js")>()),
  runInBox: async (spec: { copy: string }, opts: { input: string }) => {
    fake.prompts.push(JSON.parse(opts.input).request.prompt);
    return fake.next.shift()!(spec);
  },
}));

const READY: BoxStatus = { ready: true, runtime: "docker", image: "zero-box:test", problems: [], checkedAt: "2026-11-05T00:00:00Z" };
const gate: GateHost = { open: async () => ({ network: "n", proxy: "http://p", close: () => {} }), ingest: () => {} };
const cut: Fake = () => ({ code: 137, stdout: "", stderr: "", timedOut: true, cancelled: false });
const done: Fake = () => ({ code: 0, stdout: 'ZERO-RESULT {"ok":true,"text":"done"}\n', stderr: "", timedOut: false, cancelled: false });
const req = (): EngineRequest => ({ instructions: "i", prompt: "p", cwd: tempDir(), access: "write", timeoutMs: 2_700_000 });

beforeEach(() => {
  fake.next = [];
  fake.prompts = [];
});

afterEach(cleanup);

function boxFor(ctx: ReturnType<typeof testFactory>) {
  ctx.secrets.set("OPENAI_API_KEY", "k");
  return createBoxExecutor(ctx.config, READY, ctx.secrets, gate);
}

describe("a box run cut by its time limit", () => {
  it("is marked as a time-limit cut, with the same text", async () => {
    const ctx = testFactory({ engine: "codex", lines: [] });
    fake.next = [cut];
    const r = await boxFor(ctx).execute(resolveEngine("codex", ctx.config), req(), undefined, "build");
    expect(r).toEqual({ ok: false, text: "la caja superó el tiempo límite (45 min)", timedOut: true });
  });

  it("keeps the mark through the box's agent runner", async () => {
    const ctx = testFactory({ engine: "codex", lines: [] });
    fake.next = [cut];
    const run = await boxFor(ctx).agentRunner(ctx.config)({ station: "build", prompt: "p", cwd: tempDir() });
    expect(run).toMatchObject({ ok: false, timedOut: true });
  });

  it("is the only end that carries the mark", async () => {
    const ctx = testFactory({ engine: "codex", lines: [] });
    const box = boxFor(ctx);
    const engine = resolveEngine("codex", ctx.config);
    fake.next = [
      () => ({ code: 137, stdout: "", stderr: "", timedOut: false, cancelled: true }),
      () => ({ code: 1, stdout: "", stderr: "boom", timedOut: false, cancelled: false }),
    ];
    const cancelled = await box.execute(engine, req(), undefined, "build");
    expect(cancelled).toEqual({ ok: false, text: "cancelled" });
    const failed = await box.execute(engine, req(), undefined, "build");
    expect(failed.ok).toBe(false);
    expect(failed.text).toContain("la caja terminó con código 1");
    expect(failed).not.toHaveProperty("timedOut");
  });

  it("does not carry the mark when the egress gate fails", async () => {
    const ctx = testFactory({ engine: "codex", lines: [] });
    ctx.secrets.set("OPENAI_API_KEY", "k");
    const broken: GateHost = { open: async () => { throw new Error("sin red"); }, ingest: () => {} };
    const r = await createBoxExecutor(ctx.config, READY, ctx.secrets, broken).execute(resolveEngine("codex", ctx.config), req(), undefined, "build");
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("timedOut");
  });

  it("tells the next build it reached the time limit, not that it ended abnormally", async () => {
    const ctx = testFactory({
      level: "L2",
      isolation: "worktree",
      engine: "codex",
      stations: { build: { timeoutMinutes: 45 } },
      lines: [{ name: "demo", repo: gitRepo(), verify: [`node -e "process.exit(0)"`] }],
    });
    const boxed = boxFor(ctx).agentRunner(ctx.config);
    const agents = fakeAgents({});
    fake.next = [
      (spec) => {
        writeTree(spec.copy, { "src/health.ts": "export const status = 'ok';\n" });
        return cut(spec);
      },
      done,
    ];
    const { job } = requestWork(ctx, { text: "health" });
    const finished = await runJob(job.id, { ...ctx, runAgent: (r) => (r.station === "build" ? boxed(r) : agents.runner(r)) });

    expect(finished).toMatchObject({ status: "delivered", attempt: 2 });
    expect(fake.prompts).toHaveLength(2);
    const second = fake.prompts[1]!;
    expect(second).toContain("límite de 45 minutos");
    expect(second).toContain("sin commitear");
    expect(second).toContain("continuá desde ahí");
    expect(second).not.toContain("terminó de forma anormal");
    expect(second).not.toContain("Hacé cambios más chicos y enfocados");
  });
});
