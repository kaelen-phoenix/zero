import { describe, expect, it } from "vitest";
import { extractJson } from "../src/agent.js";
import { FactorySchema } from "../src/config.js";
import { antigravityEngine, antigravityInvocation, codexAnswer, codexEvents, codexInvocation, codexLoginBilling, codexWindows, customEngine, customInvocation, finalText, fullPrompt } from "../src/engines/cli.js";
import { resolveEngine, type EngineRequest } from "../src/engines/index.js";

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({
  instructions: "You are the coder.",
  prompt: "Fix bug",
  cwd: "/repo",
  access: "write",
  timeoutMs: 1000,
  ...over,
});

describe("codex", () => {
  it("maps access to the sandbox and passes the prompt on stdin", () => {
    const inv = codexInvocation(req({ access: "read", model: "gpt-5-codex" }), { lastMessage: "/t/last", schema: "/t/s.json" });
    expect(inv.bin).toBe("codex");
    expect(inv.args).toEqual(expect.arrayContaining(["exec", "read-only", "--output-schema", "/t/s.json", "--model", "gpt-5-codex"]));
    expect(inv.args.at(-1)).toBe("-");
    expect(inv.stdin).toContain("You are the coder.");
    expect(codexInvocation(req(), { lastMessage: "/t/last" }).args).toContain("workspace-write");
  });

  it("asks for events, with the prompt still last", () => {
    for (const r of [req(), req({ access: "read", model: "m" })]) {
      const { args } = codexInvocation(r, { lastMessage: "/t/last", schema: "/t/s.json" });
      expect(args).toContain("--json");
      expect(args.at(-1)).toBe("-");
    }
  });
});

describe("codex events", () => {
  it("skip what is not a JSON object, with any line ending", () => {
    expect(codexEvents('{"type":"a"}\r\nnada\n[1]\n42\n{roto\n\n  {"type":"b"}\n')).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("plain text is the answer when there are no events", () => {
    expect(codexAnswer("hola")).toBe("hola");
    expect(codexAnswer('{"type":"turn.started"}')).toBe("");
  });

  it("the session's words decide its billing", () => {
    expect(codexLoginBilling("Logged in using ChatGPT")).toBe("subscription");
    expect(codexLoginBilling("Logged in using an API key - sk-***")).toBe("api");
    expect(codexLoginBilling("Not logged in")).toBeUndefined();
    expect(codexLoginBilling("algo distinto")).toBeUndefined();
  });

  it("a very deep event does not break the reading", () => {
    let event = '{"rate_limits":{"primary":{"used_percent":10}}}';
    for (let i = 0; i < 50_000; i++) event = `{"a":${event}}`;
    expect(codexWindows(event)).toEqual([]);
    expect(codexWindows('{"a":{"rate_limits":{"primary":{"used_percent":10}}}}')).toMatchObject([{ name: "primary", label: "primary" }]);
  });
});

describe("antigravity", () => {
  it("only skips permissions for write access", () => {
    expect(antigravityInvocation(req()).args).toContain("--dangerously-skip-permissions");
    expect(antigravityInvocation(req({ access: "read" })).args).not.toContain("--dangerously-skip-permissions");
  });

  const STDIN_INSTRUCTION = "Follow the instructions received on stdin.";

  /** A request whose fullPrompt measures exactly `length` characters. */
  const sized = (length: number, over: Partial<EngineRequest> = {}) => {
    const base = fullPrompt(req({ prompt: "" })).length;
    return req({ prompt: "x".repeat(length - base), ...over });
  };

  it("sends a prompt one character over the threshold on stdin", () => {
    const r = sized(30_001);
    expect(fullPrompt(r)).toHaveLength(30_001);
    const inv = antigravityInvocation(r);
    expect(inv.stdin).toBe(fullPrompt(r));
    expect(inv.args[inv.args.indexOf("-p") + 1]).toBe(STDIN_INSTRUCTION);
    expect(inv.args.some((a) => a.includes("xxx") || a.includes("You are the coder."))).toBe(false);
  });

  it("keeps a prompt of exactly the threshold in -p", () => {
    const r = sized(30_000);
    expect(fullPrompt(r)).toHaveLength(30_000);
    const inv = antigravityInvocation(r);
    expect(inv.args[inv.args.indexOf("-p") + 1]).toBe(fullPrompt(r));
    expect(inv.stdin).toBeUndefined();
  });

  it("does not change a short prompt", () => {
    const r = req({ model: "m" });
    const inv = antigravityInvocation(r);
    expect(inv.args).toEqual(["-p", fullPrompt(r), "--output-format", "json", "--dangerously-skip-permissions", "--model", "m"]);
    expect(inv.stdin).toBeUndefined();
  });

  it("keeps the other flags with a long prompt", () => {
    expect(antigravityInvocation(sized(30_001, { model: "m" })).args).toEqual(["-p", STDIN_INSTRUCTION, "--output-format", "json", "--dangerously-skip-permissions", "--model", "m"]);
    expect(antigravityInvocation(sized(30_001, { access: "read" })).args).toEqual(["-p", STDIN_INSTRUCTION, "--output-format", "json"]);
  });

  it("has no native schema", () => {
    expect(antigravityEngine.nativeSchema).toBe(false);
  });
});

describe("custom engine", () => {
  const def = { command: ["gemini", "-p", "{prompt}"], readArgs: [], writeArgs: ["--yolo"], modelArgs: ["-m", "{model}"], secrets: [], hosts: [] };

  it("substitutes placeholders and appends access/model args", () => {
    const inv = customInvocation(def, req({ model: "gemini-3-pro" }));
    expect(inv.bin).toBe("gemini");
    expect(inv.args).toEqual(["-p", "You are the coder.\n\n---\n\nFix bug", "--yolo", "-m", "gemini-3-pro"]);
    expect(inv.stdin).toBeUndefined();
  });

  it("uses stdin when the command has no {prompt}", () => {
    const inv = customInvocation({ ...def, command: ["aider", "--message-file", "/dev/stdin"] }, req({ access: "read" }));
    expect(inv.stdin).toContain("Fix bug");
    expect(inv.args).toEqual(["--message-file", "/dev/stdin"]);
  });

  it("keeps a long prompt in its {prompt} argument", () => {
    const long = req({ prompt: "x".repeat(30_001) });
    const inv = customInvocation(def, long);
    expect(inv.args).toContain(fullPrompt(long));
    expect(inv.stdin).toBeUndefined();
  });

  it("overrides built-ins when declared in config", () => {
    const config = FactorySchema.parse({ engines: { codex: { command: ["my-codex"] } } });
    expect(resolveEngine("codex", config).nativeSchema).toBe(false);
    expect(() => resolveEngine("nope", config)).toThrow(/Known engines: claude, codex, antigravity/);
  });
});

describe("output parsing", () => {
  it("unwraps JSON envelopes from CLIs", () => {
    expect(finalText('{"response":"hola"}')).toBe("hola");
    expect(finalText("plain answer\n")).toBe("plain answer");
  });

  it("extracts the last JSON object from free text", () => {
    expect(extractJson('Plan:\n```json\n{"approved": true}\n```')).toEqual({ approved: true });
    expect(extractJson('I think {not json}. Final: {"a": {"b": 1}}')).toEqual({ a: { b: 1 } });
    expect(extractJson("no json here")).toBeUndefined();
  });
});

describe("cancellation", () => {
  it("kills a CLI engine when the andon cord is pulled", async () => {
    const engine = customEngine("sleeper", { command: [process.execPath, "-e", "setTimeout(() => {}, 60000)"], readArgs: [], writeArgs: [], modelArgs: [], secrets: [], hosts: [] });
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort("andon"), 200);
    const result = await engine.run({ ...req({ cwd: process.cwd() }), timeoutMs: 60_000, signal: controller.signal });
    expect(result).toEqual({ ok: false, text: "sleeper cancelled" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
