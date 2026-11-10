import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { engineCredentials } from "../src/box/credentials.js";
import { parseFactory, type CustomEngine } from "../src/config.js";
import { acpEngine } from "../src/engines/acp.js";
import { customInvocation } from "../src/engines/cli.js";
import { resolveEngine, type EngineRequest } from "../src/engines/index.js";
import { factoryHome } from "../src/home.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

interface FakeParts {
  /** Body of the `initialize` handler (`m` is the request). */
  init?: string;
  /** Body of the `session/new` handler. */
  session?: string;
  /** Body of the `session/prompt` handler. */
  prompt: string;
}

/** A fake ACP agent: it records every request it gets, and its own pid, in FAKE_LOG. */
const agentScript = ({ init, session, prompt }: FakeParts) => `
const fs = require("node:fs");
const record = (m) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(m) + "\\n");
record({ pid: process.pid });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
const waiting = new Map();
let n = 0;
const ask = (method, params) => new Promise((resolve) => { const id = "agent-" + n++; waiting.set(id, resolve); send({ id, method, params }); });
const update = (u) => send({ method: "session/update", params: { sessionId: "s1", update: u } });
const chunk = (text) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const done = (m, stopReason = "end_turn") => send({ id: m.id, result: { stopReason } });
const handlers = {
  initialize: async (m) => { ${init ?? `send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });`} },
  "session/new": async (m) => { ${session ?? `send({ id: m.id, result: { sessionId: "s1" } });`} },
  "session/prompt": async (m) => { ${prompt} },
};
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (m.method) { record(m); handlers[m.method]?.(m); } else waiting.get(m.id)?.(m);
  }
});
`;

const def = (script: string): CustomEngine => ({ command: [process.execPath, "-e", script], readArgs: [], writeArgs: [], modelArgs: [], secrets: [], hosts: ["api.example.com"], protocol: "acp" });

const run = async (parts: FakeParts, over: Partial<EngineRequest> = {}) => {
  const log = join(tempDir(), "log.jsonl");
  const result = await acpEngine("gem", def(agentScript(parts))).run({
    instructions: "You are the coder.",
    prompt: "Fix bug",
    cwd: process.cwd(),
    access: "read",
    timeoutMs: 30_000,
    env: { FAKE_LOG: log },
    ...over,
  });
  const entries = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, any>);
  return { result, requests: entries.filter((e) => e.method), pid: entries.find((e) => e.pid)!.pid as number };
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A prompt handler that asks permission for a tool call of this kind and answers with what zero chose. */
const asking = (kind: string, options = `[{ optionId: "a", name: "Allow", kind: "allow_once" }, { optionId: "r", name: "Reject", kind: "reject_once" }]`) => `
  const r = await ask("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "t1", kind: "${kind}" }, options: ${options} });
  chunk(r.result.outcome.optionId ?? JSON.stringify(r.result));
  done(m);
`;

describe("ACP engines in the factory file", () => {
  it("accepts protocol acp and guards the engine", () => {
    const config = parseFactory("engines:\n  gem:\n    command: [gemini, --experimental-acp]\n    protocol: acp\n    hosts: [generativelanguage.googleapis.com]\n");
    const engine = resolveEngine("gem", config);
    expect(engine.unsandboxed).toBe(true);
    expect(engine.nativeSchema).toBe(false);
    expect(engine.hosts).toEqual(["generativelanguage.googleapis.com"]);
  });

  it("refuses {prompt} in an ACP entry, naming the engine", () => {
    expect(() => parseFactory("engines:\n  agent1:\n    command: [agent, '{prompt}']\n    protocol: acp\n")).toThrow(/agent1/);
    expect(() => parseFactory("engines:\n  agent1:\n    command: [agent]\n    readArgs: ['{prompt}']\n    protocol: acp\n")).toThrow(/agent1/);
  });

  it("leaves CLI entries as they were", () => {
    const config = parseFactory("engines:\n  local:\n    command: [my-agent, '{prompt}']\n");
    expect(resolveEngine("local", config).unsandboxed).toBeUndefined();
    const inv = customInvocation(config.engines.local!, { instructions: "i", prompt: "p", cwd: ".", access: "read", timeoutMs: 1 });
    expect(inv.args).toEqual(["i\n\n---\n\np"]);
    expect(inv.stdin).toBeUndefined();
  });

  it("keeps the entry's secrets in the box", () => {
    const config = parseFactory("engines:\n  gem:\n    command: [gemini, --experimental-acp]\n    protocol: acp\n    secrets: [GEMINI_API_KEY]\n");
    const secrets = new SecretStore(factoryHome(tempDir()), memoryKeyring(), { GEMINI_API_KEY: "k" });
    expect(engineCredentials("gem", config, secrets)).toEqual({ names: ["GEMINI_API_KEY"] });
  });
});

describe("ACP session", () => {
  it("initializes, opens a session in the cwd and sends the full prompt", async () => {
    const { result, requests } = await run({ prompt: `chunk("lis"); chunk("to"); done(m);` });
    expect(result).toMatchObject({ ok: true, text: "listo" });
    expect(requests.map((r) => r.method)).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(requests[0]!.params).toEqual({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    expect(requests[1]!.params).toEqual({ cwd: process.cwd(), mcpServers: [] });
    expect(requests[2]!.params).toEqual({ sessionId: "s1", prompt: [{ type: "text", text: "You are the coder.\n\n---\n\nFix bug" }] });
  });

  it("ends the agent after its answer", async () => {
    const { result, pid } = await run({ prompt: `setInterval(() => {}, 1000); chunk("ok"); done(m);` });
    expect(result.ok).toBe(true);
    expect(alive(pid)).toBe(false);
  });

  it("passes the access and model arguments, never the prompt", async () => {
    const log = join(tempDir(), "log.jsonl");
    const script = `require("node:fs").writeFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(1)) + "\\n"); ${agentScript({ prompt: `chunk("ok"); done(m);` })}`;
    const engine = acpEngine("gem", { ...def(script), command: [process.execPath, "-e", script, "--"], readArgs: ["--read"], writeArgs: ["--write"], modelArgs: ["--model", "{model}"] });
    const r = await engine.run({ instructions: "i", prompt: "secret prompt", cwd: process.cwd(), access: "write", model: "m1", timeoutMs: 30_000, env: { FAKE_LOG: log } });
    expect(r.ok).toBe(true);
    expect(readFileSync(log, "utf8").split("\n")[0]).toBe(JSON.stringify(["--write", "--model", "m1"]));
  });

  it("reports the model and the USD cost", async () => {
    const { result } = await run({
      session: `send({ id: m.id, result: { sessionId: "s1", models: { currentModelId: "gemini-2.5-pro", availableModels: [] } } });`,
      prompt: `chunk("ok"); update({ sessionUpdate: "usage_update", used: 10, size: 100, cost: { amount: 0.01, currency: "USD" } }); update({ sessionUpdate: "usage_update", cost: { amount: 0.04, currency: "USD" } }); update({ sessionUpdate: "usage_update", cost: { amount: 9, currency: "EUR" } }); done(m);`,
    });
    expect(result.model).toBe("gemini-2.5-pro");
    expect(result.costUsd).toBe(0.04);
    expect(result.quota).toBeUndefined();
  });

  it("reports nothing when the agent says nothing", async () => {
    const { result } = await run({ prompt: `chunk("ok"); done(m);` });
    expect(result.model).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });
});

describe("ACP permissions", () => {
  it("refuses an edit on read access", async () => {
    expect((await run({ prompt: asking("edit") })).result.text).toBe("r");
  });

  it("allows an edit on write access", async () => {
    expect((await run({ prompt: asking("edit") }, { access: "write" })).result.text).toBe("a");
  });

  it("allows reading on read and web access", async () => {
    expect((await run({ prompt: asking("read") })).result.text).toBe("a");
    expect((await run({ prompt: asking("search") }, { access: "web" })).result.text).toBe("a");
  });

  it("prefers allow_always and reject_always when there is no once option", async () => {
    const always = `[{ optionId: "aa", name: "Always", kind: "allow_always" }, { optionId: "ra", name: "Never", kind: "reject_always" }]`;
    expect((await run({ prompt: asking("execute", always) })).result.text).toBe("ra");
    expect((await run({ prompt: asking("execute", always) }, { access: "write" })).result.text).toBe("aa");
  });

  it("cancels when a refused tool call offers no reject option", async () => {
    const { result } = await run({ prompt: asking("execute", `[{ optionId: "a", name: "Allow", kind: "allow_once" }]`) });
    expect(JSON.parse(result.text)).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("answers other client methods with -32601", async () => {
    const { result } = await run({ prompt: `const r = await ask("fs/write_text_file", { sessionId: "s1", path: "x", content: "y" }); chunk(String(r.error.code)); done(m);` });
    expect(result.text).toBe("-32601");
  });
});

describe("ACP failures", () => {
  it("fails on an empty answer, with the end of stderr", async () => {
    const { result } = await run({ prompt: `process.stderr.write("sin sesión"); setTimeout(() => done(m), 50);` });
    expect(result).toMatchObject({ ok: false, text: "gem devolvió salida vacía: sin sesión" });
  });

  it("fails on a JSON-RPC error", async () => {
    const { result } = await run({ session: `send({ id: m.id, error: { code: -32000, message: "auth required" } });`, prompt: "" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("auth required");
  });

  it("fails on a stop reason other than end_turn", async () => {
    const { result } = await run({ prompt: `chunk("no"); done(m, "refusal");` });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("refusal");
  });

  it("fails when the agent exits before answering", async () => {
    const { result } = await run({ session: `process.stderr.write("adiós"); process.exit(3);`, prompt: "" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("gem exited with 3");
    expect(result.text).toContain("adiós");
  });

  it("kills the agent on timeout", async () => {
    const { result, pid } = await run({ prompt: `setInterval(() => {}, 1000);` }, { timeoutMs: 1500 });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/gem timed out after/);
    expect(alive(pid)).toBe(false);
  });

  it("kills the agent when the request is cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 800);
    const { result, pid } = await run({ prompt: `setInterval(() => {}, 1000);` }, { signal: controller.signal });
    expect(result).toEqual({ ok: false, text: "gem cancelled" });
    expect(alive(pid)).toBe(false);
  });
});
