import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { antigravityEngine, fullPrompt, runProcess } from "../src/engines/cli.js";
import type { EngineRequest } from "../src/engines/index.js";

// spawn runs without a shell, so a fake `.cmd` on PATH would not start on Windows:
// agy is redirected to a real node process instead.
const fake = vi.hoisted(() => ({ script: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (bin: string, args: string[], options: object) =>
      bin === "agy"
        ? real.spawn(process.execPath, ["-e", fake.script, "--", ...args], options)
        : real.spawn(bin, args, options),
  };
});

const HUGE = 5_000_000;

/** A request whose fullPrompt measures exactly `length` characters. */
const sized = (length: number): EngineRequest => {
  const base: EngineRequest = { instructions: "You are the coder.", prompt: "", cwd: process.cwd(), access: "read", timeoutMs: 30_000 };
  return { ...base, prompt: "x".repeat(length - fullPrompt(base).length) };
};

const uncaught: Error[] = [];
const record = (err: Error) => uncaught.push(err);

beforeEach(() => {
  uncaught.length = 0;
  process.on("uncaughtException", record);
});

afterEach(async () => {
  // A broken pipe reports after the process closes, so give it time to surface.
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.off("uncaughtException", record);
  expect(uncaught).toEqual([]);
});

describe("a long antigravity prompt", () => {
  it("reaches the process whole, with the short instruction in -p", async () => {
    fake.script = `
      let received = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => (received += d));
      process.stdin.on("end", () => {
        const p = process.argv[process.argv.indexOf("-p") + 1];
        process.stdout.write(JSON.stringify({ chars: received.length, p }));
      });
    `;
    const result = await antigravityEngine.run(sized(40_000));
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ chars: 40_000, p: "Follow the instructions received on stdin." });
  });
});

describe("a process that does not read stdin", () => {
  it("still answers when it exits with 0", async () => {
    fake.script = `process.stdout.write('{"response":"hola"}')`;
    expect(await antigravityEngine.run(sized(HUGE))).toEqual({ ok: true, text: "hola" });
  });

  it("still reports its exit code", async () => {
    fake.script = `process.stderr.write("roto"); process.exitCode = 3;`;
    expect(await antigravityEngine.run(sized(HUGE))).toEqual({ ok: false, text: "antigravity exited with 3: roto" });
  });
});

describe("a binary that does not exist", () => {
  it("rejects with the start error", async () => {
    await expect(runProcess({ bin: "zero-no-such-binary", args: [], stdin: "x".repeat(HUGE) }, process.cwd(), 30_000)).rejects.toThrow("cannot start");
  });
});
