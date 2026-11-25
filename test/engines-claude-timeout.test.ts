import { beforeEach, describe, expect, it, vi } from "vitest";
import { claudeEngine } from "../src/engines/claude.js";
import type { EngineRequest } from "../src/engines/index.js";

/** What the fake SDK does with the call's abort signal. */
const fake = vi.hoisted(() => ({ run: async function* (_abort: AbortSignal): AsyncGenerator<unknown> {} }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: { abortController: AbortController } }) => fake.run(options.abortController.signal),
}));

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({ instructions: "You are the coder.", prompt: "Fix bug", cwd: process.cwd(), access: "write", timeoutMs: 30_000, ...over });
const aborted = (signal: AbortSignal) => new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
const errorResult = { type: "result", subtype: "error_during_execution", session_id: "s1", total_cost_usd: 0.42, errors: ["Request was aborted"] };

describe("a Claude call cut by its time limit", () => {
  beforeEach(() => {
    fake.run = async function* (abort) {
      await aborted(abort);
      throw new Error("Claude Code process aborted by user");
    };
  });

  it("is marked timedOut", async () => {
    expect(await claudeEngine.run(req({ timeoutMs: 60 }))).toEqual({ ok: false, text: `timed out after ${60 / 60_000} min`, timedOut: true });
  });

  it("is marked when the SDK ends without a result instead of throwing", async () => {
    fake.run = async function* (abort) {
      await aborted(abort);
    };
    expect(await claudeEngine.run(req({ timeoutMs: 60 }))).toMatchObject({ ok: false, text: expect.stringContaining("timed out after"), timedOut: true });
  });

  it("is marked when the SDK ends with an error message, keeping its cost", async () => {
    fake.run = async function* (abort) {
      await aborted(abort);
      yield errorResult;
    };
    expect(await claudeEngine.run(req({ timeoutMs: 60 }))).toMatchObject({ ok: false, text: expect.stringContaining("timed out after"), costUsd: 0.42, timedOut: true });
  });

  it("is not marked when it was cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("andon"), 30);
    expect(await claudeEngine.run(req({ signal: controller.signal }))).toEqual({ ok: false, text: "cancelled" });
  });

  it("is not marked when it was cancelled and the SDK ends quietly", async () => {
    fake.run = async function* (abort) {
      await aborted(abort);
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort("andon"), 30);
    expect(await claudeEngine.run(req({ signal: controller.signal }))).toEqual({ ok: false, text: "cancelled" });
  });

  it("is not marked on any other error", async () => {
    fake.run = async function* () {
      throw new Error("socket hang up");
    };
    expect(await claudeEngine.run(req())).toEqual({ ok: false, text: "socket hang up" });
    fake.run = async function* () {
      yield errorResult;
    };
    const failed = await claudeEngine.run(req());
    expect(failed).toMatchObject({ ok: false, text: "error_during_execution" });
    expect(failed).not.toHaveProperty("timedOut");
  });
});
