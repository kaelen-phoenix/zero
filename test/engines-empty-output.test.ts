import { beforeEach, describe, expect, it, vi } from "vitest";
import { antigravityEngine, codexEngine, customEngine } from "../src/engines/cli.js";
import type { EngineRequest } from "../src/engines/index.js";

// spawn runs without a shell, so a fake `.cmd` on PATH would not start on Windows:
// the built-in engines' binaries are redirected to a real node process instead.
const fake = vi.hoisted(() => ({ script: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    // By their name alone: where those programs are installed, zero starts them by their full path.
    spawn: (bin: string, args: string[], options: object) =>
      /(^|[\\/])(agy|codex)(\.(com|exe))?$/i.test(bin)
        ? real.spawn(process.execPath, ["-e", fake.script, "--", ...args], options)
        : real.spawn(bin, args, options),
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

const custom = (name: string, script: string) =>
  customEngine(name, { command: [process.execPath, "-e", script], readArgs: [], writeArgs: [], modelArgs: [], secrets: [], hosts: [] });

/** A fake codex body that can reach the path given after --output-last-message as `last`. */
const codexScript = (body: string) => `
  const fs = require("node:fs");
  const last = process.argv[process.argv.indexOf("--output-last-message") + 1];
  ${body}
`;

beforeEach(() => {
  fake.script = "";
});

describe("engines that answer on stdout", () => {
  it("antigravity without output is a failure", async () => {
    expect(await antigravityEngine.run(req())).toEqual({ ok: false, text: "antigravity devolvió salida vacía" });
  });

  it("a custom engine without output is a failure", async () => {
    expect(await custom("mudo", "").run(req())).toEqual({ ok: false, text: "mudo devolvió salida vacía" });
  });

  it("only whitespace on stdout counts as empty", async () => {
    const result = await custom("mudo", 'process.stdout.write("  \\n\\t\\n")').run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("mudo devolvió salida vacía")).toBe(true);
  });

  it("an empty JSON envelope counts as empty", async () => {
    const result = await custom("mudo", `process.stdout.write('{"result":" "}')`).run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("mudo devolvió salida vacía")).toBe(true);
    fake.script = `process.stdout.write('{"result":" "}')`;
    const agy = await antigravityEngine.run(req());
    expect(agy.ok).toBe(false);
    expect(agy.text.startsWith("antigravity devolvió salida vacía")).toBe(true);
  });

  it("a normal answer does not change", async () => {
    expect(await custom("mudo", `process.stdout.write('{"response":"hola"}')`).run(req())).toEqual({ ok: true, text: "hola" });
    fake.script = `process.stdout.write('{"response":"hola"}')`;
    expect(await antigravityEngine.run(req())).toEqual({ ok: true, text: "hola" });
  });

  it("an envelope without text keys is still the raw JSON", async () => {
    expect(await custom("mudo", `process.stdout.write('{"foo":1}')`).run(req())).toEqual({ ok: true, text: '{"foo":1}' });
  });
});

describe("the end of stderr in the error", () => {
  it("is added after the message", async () => {
    expect(await custom("mudo", 'process.stderr.write("sin TTY\\n")').run(req())).toEqual({ ok: false, text: "mudo devolvió salida vacía: sin TTY" });
  });

  it("keeps only the last 2000 characters", async () => {
    const result = await custom("mudo", 'process.stderr.write("a".repeat(1000) + "b".repeat(2000))').run(req());
    expect(result.ok).toBe(false);
    expect(result.text).toBe(`mudo devolvió salida vacía: ${"b".repeat(2000)}`);
    expect(result.text).not.toContain("a".repeat(2));
  });

  it("is left out when it has only whitespace", async () => {
    expect(await custom("mudo", 'process.stderr.write("  \\n\\n")').run(req())).toEqual({ ok: false, text: "mudo devolvió salida vacía" });
  });
});

describe("codex", () => {
  it("fails with an empty last message", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "");');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía" });
  });

  it("fails with a last message of only whitespace", async () => {
    fake.script = codexScript('fs.writeFileSync(last, " \\n");');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía" });
  });

  it("adds stderr to the error", async () => {
    fake.script = codexScript('fs.writeFileSync(last, ""); process.stderr.write("sin sesión");');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía: sin sesión" });
  });

  it("fails with an empty last message even if stdout has text", async () => {
    fake.script = codexScript('fs.writeFileSync(last, ""); process.stdout.write("progreso");');
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("codex devolvió salida vacía")).toBe(true);
    expect(result.text).not.toContain("progreso");
  });

  it("answers from the file with an empty stdout", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "listo\\n");');
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo" });
  });

  it("fails without a file and without stdout", async () => {
    fake.script = codexScript("");
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía" });
  });

  it("falls back to stdout without a file", async () => {
    fake.script = codexScript('process.stdout.write("hola");');
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "hola" });
  });

  it("keeps the message of a failed exit whatever the file says", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "listo"); process.stderr.write("roto"); process.exitCode = 3;');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex exited with 3: roto" });
  });
});

describe("other failures keep their message", () => {
  it("a non-zero exit without output", async () => {
    const result = await custom("mudo", "process.exitCode = 3").run(req());
    expect(result).toEqual({ ok: false, text: "mudo exited with 3: " });
  });

  it("a cancelled run", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("andon"), 200);
    const result = await custom("sleeper", "setTimeout(() => {}, 60000)").run(req({ timeoutMs: 60_000, signal: controller.signal }));
    expect(result).toEqual({ ok: false, text: "sleeper cancelled" });
  });

  it("a run out of time", async () => {
    const result = await custom("sleeper", "setTimeout(() => {}, 60000)").run(req({ timeoutMs: 300 }));
    expect(result).toEqual({ ok: false, text: `sleeper timed out after ${300 / 60_000} min` });
  });
});
