import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { codexEngine, codexSignedOut, customEngine, unsandboxedCodexEngine } from "../src/engines/cli.js";
import type { EngineRequest } from "../src/engines/index.js";

// spawn runs without a shell, so `codex` is redirected to a real node process (see engines-empty-output.test.ts).
const fake = vi.hoisted(() => ({ script: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (bin: string, args: string[], options: object) => {
      if (!/(^|[\\/])codex(\.(com|exe))?$/i.test(bin)) return real.spawn(bin, args, options);
      // `codex login status` only exits: the session's billing does not matter here.
      const script = args[0] === "login" ? "process.exitCode = 1" : fake.script;
      return real.spawn(process.execPath, ["-e", script, "--", ...args], options);
    },
  };
});

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({
  instructions: "You are the coder.",
  prompt: "Fix bug",
  cwd: process.cwd(),
  access: "read",
  timeoutMs: 30_000,
  ...over,
});

/** A fake codex body that can reach the path given after --output-last-message as `last`. */
const codexScript = (body: string) => `
  const fs = require("node:fs");
  const last = process.argv[process.argv.indexOf("--output-last-message") + 1];
  ${body}
`;

/** A fake codex that writes `text` to stderr and exits with `code`. */
const failingWith = (text: string, code = 1) => codexScript(`process.stderr.write(${JSON.stringify(text)}); process.exitCode = ${code};`);

beforeEach(() => {
  fake.script = "";
  vi.stubEnv("CODEX_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("codex recognises an expired or missing session", () => {
  it.each([
    "Error: Not logged in",
    "unexpected status 401 Unauthorized",
    "Your access token expired",
    "token has expired",
    "Failed to refresh token: refresh token was revoked",
  ])("%s", async (text) => {
    fake.script = failingWith(text);
    const result = await codexEngine.run(req());
    expect(result).toMatchObject({ ok: false, signedOut: true, text: `codex exited with 1: ${text}` });
  });

  it("with the text only in an error event", async () => {
    fake.script = codexScript(`process.stdout.write(${JSON.stringify(JSON.stringify({ type: "error", message: "401 Unauthorized" }))}); process.exitCode = 1;`);
    expect(await codexEngine.run(req())).toMatchObject({ ok: false, signedOut: true, text: "codex exited with 1: 401 Unauthorized" });
  });

  it("without its own sandbox too", async () => {
    fake.script = failingWith("Error: Not logged in");
    expect(await unsandboxedCodexEngine.run(req())).toMatchObject({ ok: false, signedOut: true });
  });
});

describe("only a failed exit can be a sign-out", () => {
  it("an ordinary failure", async () => {
    fake.script = failingWith("error: something else broke");
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(false);
    expect(result.signedOut).toBeUndefined();
  });

  it("a successful answer mentioning the words", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "listo"); process.stderr.write("not logged in");');
    const result = await codexEngine.run(req());
    expect(result).toMatchObject({ ok: true, text: "listo" });
    expect(result.signedOut).toBeUndefined();
  });

  it("a timeout", async () => {
    fake.script = codexScript('process.stderr.write("not logged in"); setTimeout(() => {}, 60000);');
    const result = await codexEngine.run(req({ timeoutMs: 500 }));
    expect(result).toMatchObject({ ok: false, timedOut: true });
    expect(result.signedOut).toBeUndefined();
  });

  it("a cancelled call", async () => {
    fake.script = codexScript('process.stderr.write("not logged in"); setTimeout(() => {}, 60000);');
    const controller = new AbortController();
    setTimeout(() => controller.abort("andon"), 300);
    expect(await codexEngine.run(req({ timeoutMs: 60_000, signal: controller.signal }))).toEqual({ ok: false, text: "codex cancelled" });
  });
});

describe("detection is per engine", () => {
  it("a custom engine without a detector is never marked", async () => {
    const engine = customEngine("propio", { command: [process.execPath, "-e", 'process.stderr.write("not logged in"); process.exitCode = 1;'], readArgs: [], writeArgs: [], modelArgs: [], secrets: [], hosts: [] });
    const result = await engine.run(req());
    expect(result).toEqual({ ok: false, text: "propio exited with 1: not logged in" });
  });
});

describe("codexSignedOut", () => {
  it("reads stderr", () => {
    expect(codexSignedOut("", "NOT LOGGED IN")).toBe(true);
    expect(codexSignedOut("", "token expired")).toBe(true);
    expect(codexSignedOut("", "refresh token")).toBe(true);
    expect(codexSignedOut("", "401 Unauthorized")).toBe(true);
  });

  it("reads the last error or failed turn", () => {
    expect(codexSignedOut(JSON.stringify({ type: "turn.failed", error: { message: "Token has expired" } }), "")).toBe(true);
    expect(codexSignedOut(JSON.stringify({ type: "error", message: "sin permiso" }), "")).toBe(false);
  });

  it("does not take other texts", () => {
    expect(codexSignedOut("", "error: something else broke")).toBe(false);
    expect(codexSignedOut("", "status 401")).toBe(false);
    expect(codexSignedOut("not logged in", "")).toBe(false);
  });
});
