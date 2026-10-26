import { describe, expect, it } from "vitest";
import { extractJson } from "../src/agent.js";
import { ConfigSchema } from "../src/config.js";
import { antigravityInvocation, codexInvocation, customInvocation, finalText } from "../src/engines/cli.js";
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
});

describe("antigravity", () => {
  it("only skips permissions for write access", () => {
    expect(antigravityInvocation(req()).args).toContain("--dangerously-skip-permissions");
    expect(antigravityInvocation(req({ access: "read" })).args).not.toContain("--dangerously-skip-permissions");
  });
});

describe("custom engine", () => {
  const def = { command: ["gemini", "-p", "{prompt}"], readArgs: [], writeArgs: ["--yolo"], modelArgs: ["-m", "{model}"] };

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

  it("overrides built-ins when declared in config", () => {
    const config = ConfigSchema.parse({ engines: { codex: { command: ["my-codex"] } } });
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
