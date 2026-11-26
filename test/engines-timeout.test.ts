import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentRunner } from "../src/agent.js";
import { claudeEngine } from "../src/engines/claude.js";
import type { EngineRequest } from "../src/engines/index.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, tempDir, testFactory } from "./helpers.js";

afterEach(cleanup);

/** A query that never answers: it waits for its abort controller and then throws, or ends quietly. */
const sdk = vi.hoisted(() => ({ quiet: false }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: Options }) =>
    (async function* () {
      const abort = options.abortController!;
      await new Promise<void>((resolve) => (abort.signal.aborted ? resolve() : abort.signal.addEventListener("abort", () => resolve(), { once: true })));
      if (!sdk.quiet) throw new Error("Claude Code process aborted by user");
      yield* [];
    })(),
}));

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({ instructions: "You are the coder.", prompt: "Fix bug", cwd: process.cwd(), access: "read", timeoutMs: 30_000, ...over });

describe("the Claude engine at its time limit", () => {
  it("marks a call its timer cut short as timed out", async () => {
    sdk.quiet = false;
    const result = await claudeEngine.run(req({ timeoutMs: 50 }));
    expect(result).toMatchObject({ ok: false, timedOut: true });
    expect(result.text).toMatch(/timed out after/);
  });

  it("marks it too when the SDK ends its loop without throwing", async () => {
    sdk.quiet = true;
    expect(await claudeEngine.run(req({ timeoutMs: 50 }))).toMatchObject({ ok: false, timedOut: true });
    sdk.quiet = false;
  });

  it("does not mark a cancelled call", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await claudeEngine.run(req({ signal: controller.signal }));
    expect(result).toEqual({ ok: false, text: "cancelled" });
    expect(result.timedOut).toBeUndefined();
  });
});

describe("the agent runner and a timeout", () => {
  it("passes the engine's timedOut on to the run and its span", async () => {
    const ctx = testFactory({ engine: "claude", lines: [] });
    const run = await createAgentRunner(ctx.config, { execute: async () => ({ ok: false, text: "timed out after 45 min", timedOut: true }) })({ station: "build", prompt: "p", cwd: tempDir(), trace: { tracer: ctx.tracer, jobId: "j1" } });
    expect(run).toMatchObject({ ok: false, timedOut: true });
    expect(ctx.store.spansForJob("j1").find((s) => s.name === AGENT_SPAN)!.attrs).toMatchObject({ "zero.timed_out": true });

    const other = await createAgentRunner(ctx.config, { execute: async () => ({ ok: false, text: "boom" }) })({ station: "build", prompt: "p", cwd: tempDir() });
    expect(other.timedOut).toBeUndefined();
  });
});
