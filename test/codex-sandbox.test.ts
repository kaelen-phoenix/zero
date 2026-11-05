import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { factoryStatus } from "../src/app.js";
import { createBoxExecutor } from "../src/box/executor.js";
import type { GateHost } from "../src/box/network.js";
import { saveBoxStatus, type BoxStatus } from "../src/box/status.js";
import { parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { codexEngine, codexInvocation } from "../src/engines/cli.js";
import { resolveEngine, type Access, type EngineRequest } from "../src/engines/index.js";
import { formatStatus } from "../src/format.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { cleanup, gitRepo, simulatedBox, tempDir, testFactory } from "./helpers.js";

const fake = vi.hoisted(() => ({ runs: [] as string[][], box: [] as { spec: { copy: string; mount: string }; input: string }[] }));

// `codex` is a node process that records nothing itself: its arguments are what the tests read.
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (bin: string, args: string[], options: object) => {
      if (bin !== "codex") return real.spawn(bin, args, options);
      if (args[0] === "login") return real.spawn(process.execPath, ["-e", "process.exitCode = 1"], options);
      fake.runs.push(args);
      return real.spawn(process.execPath, ["-e", `require("node:fs").writeFileSync(process.argv[process.argv.indexOf("--output-last-message") + 1], '{"proposals":[]}')`, "--", ...args], options);
    },
  };
});

vi.mock("../src/box/run.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/box/run.js")>()),
  runInBox: async (spec: { copy: string; mount: string }, opts: { input: string }) => {
    fake.box.push({ spec, input: opts.input });
    return { code: 0, stdout: 'ZERO-RESULT {"ok":true,"text":"{}"}\n', stderr: "", timedOut: false, cancelled: false };
  },
}));

const req = (access: Access, cwd = process.cwd()): EngineRequest => ({ instructions: "i", prompt: "p", cwd, access, timeoutMs: 30_000 });
const OFF = parseFactory("lines: []\ncodex: { sandbox: off }\n");
const pairAt = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

const READY: BoxStatus = { ready: true, runtime: "docker", image: "zero-box:test", problems: [], checkedAt: "2026-11-05T00:00:00Z" };
const NOT_READY: BoxStatus = { ready: false, image: "zero-box:test", problems: ["sin runtime"], checkedAt: "2026-11-05T00:00:00Z" };

beforeEach(() => {
  fake.runs = [];
  fake.box = [];
  vi.stubEnv("CODEX_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe("the option", () => {
  it("is on by default", () => {
    expect(parseFactory("lines: []\n").codex.sandbox).toBe("on");
  });

  it("can be off", () => {
    expect(OFF.codex.sandbox).toBe("off");
  });

  it("refuses other values and other keys", () => {
    expect(() => parseFactory("lines: []\ncodex: { sandbox: false }\n")).toThrow();
    expect(() => parseFactory("lines: []\ncodex: { sandbox: off, otra: 1 }\n")).toThrow();
  });

  it("is offered by no chat tool", async () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo() }] });
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.name).not.toMatch(/sandbox/i);
      expect(JSON.stringify(t.inputSchema)).not.toMatch(/sandbox/i);
    }
  });
});

describe("how codex is started", () => {
  it("with the option on: the flags of today", () => {
    for (const [access, mode] of [["read", "read-only"], ["web", "read-only"], ["write", "workspace-write"]] as const) {
      const { args } = codexInvocation(req(access), { lastMessage: "/t/last" });
      expect(pairAt(args, "--sandbox")).toBe(mode);
      expect(args.join(" ")).not.toMatch(/danger-full-access|approval_policy/);
    }
  });

  it("with the option off, outside the box: no sandbox and no approvals on every access", async () => {
    const engine = resolveEngine("codex", OFF);
    expect(engine.unsandboxed).toBe(true);
    for (const access of ["read", "web", "write"] as const) {
      expect((await engine.run(req(access))).ok).toBe(true);
      const args = fake.runs.at(-1)!;
      expect(pairAt(args, "--sandbox")).toBe("danger-full-access");
      expect(pairAt(args, "-c")).toBe('approval_policy="never"');
      expect(args.join(" ")).not.toMatch(/read-only|workspace-write/);
    }
  });

  it("a custom engine named codex stays as it is, without the check", () => {
    const config = parseFactory(`lines: []\ncodex: { sandbox: off }\nengines:\n  codex: { command: [mi-codex] }\n`);
    const engine = resolveEngine("codex", config);
    expect(engine.unsandboxed).toBeUndefined();
    expect(engine.nativeSchema).toBe(false);
  });

  it("the option on resolves the plain engine", () => {
    expect(resolveEngine("codex", parseFactory("lines: []\n"))).toBe(codexEngine);
  });
});

describe("inside the box", () => {
  const gate: GateHost = { open: async () => ({ network: "n", proxy: "http://p", close: () => {} }), ingest: () => {} };

  it("the request does not carry the option, so the box resolves today's flags, and no snapshot is taken", async () => {
    const ctx = testFactory({ engine: "codex", codex: { sandbox: "off" }, lines: [] });
    ctx.secrets.set("OPENAI_API_KEY", "k");
    const box = createBoxExecutor(ctx.config, READY, ctx.secrets, gate);
    // A folder that does not exist would fail any snapshot.
    const cwd = join(tempDir(), "no-existe");
    const engine = resolveEngine("codex", ctx.config);
    const r = await box.execute(engine, req("read", cwd), undefined, "scout");
    expect(r.ok).toBe(true);
    const run = await box.agentRunner(ctx.config)({ station: "review", prompt: "p", cwd });
    expect(run.ok).toBe(true);
    expect(fake.runs).toEqual([]);
    expect(fake.box.map((b) => b.spec.mount)).toEqual(["ro", "ro"]);
    const payload = JSON.parse(fake.box[0]!.input);
    expect(JSON.stringify(payload)).not.toMatch(/sandbox/i);
    const inside = resolveEngine(payload.engine, { engines: payload.engines });
    expect(inside).toBe(codexEngine);
    expect(pairAt(codexInvocation(req("read"), { lastMessage: "l" }).args, "--sandbox")).toBe("read-only");
  });
});

describe("background passes", () => {
  const LOCAL_MARK = "pasó-por-la-máquina";

  async function scoutRun(over: Record<string, unknown>, status: BoxStatus = READY) {
    const repo = gitRepo();
    const ctx = testFactory({ level: "L2", isolation: "container", engine: "codex", codex: { sandbox: "off" }, lines: [{ name: "demo", repo }], ...over });
    ctx.secrets.set("OPENAI_API_KEY", "k");
    const execute = vi.fn(async (_engine: unknown, _req: EngineRequest) => ({ ok: true, text: '{"proposals":[]}' }));
    const { box } = simulatedBox(async () => { throw new Error("no job here"); });
    await runDaemon(ctx, { once: true, pollMs: 10, scout: true, research: false, packages: false, packageUpdates: false, inspectBox: () => status, boxExecutor: () => ({ ...box, execute }) });
    return { execute };
  }

  it("codex goes through the box when it is ready, and no local process starts", async () => {
    const { execute } = await scoutRun({});
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![1].access).toBe("read");
    expect(fake.runs).toEqual([]);
  });

  it("another engine of the same pass stays on the machine", async () => {
    const dir = tempDir();
    const mark = join(dir, "mark").replace(/\\/g, "/");
    const script = `require("node:fs").writeFileSync(${JSON.stringify(mark)}, ${JSON.stringify(LOCAL_MARK)}); console.log('{"proposals":[]}')`;
    const { execute } = await scoutRun({ engines: { otro: { command: [process.execPath, "-e", script] } }, stations: { scout: { engine: "otro" } } });
    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(mark)).toBe(true);
  });

  it("with the option on, codex stays on the machine", async () => {
    const { execute } = await scoutRun({ codex: { sandbox: "on" } });
    expect(execute).not.toHaveBeenCalled();
    expect(pairAt(fake.runs[0]!, "--sandbox")).toBe("read-only");
  });

  it("with the box not ready: on the machine, with no sandbox and with the check", async () => {
    const { execute } = await scoutRun({}, NOT_READY);
    expect(execute).not.toHaveBeenCalled();
    expect(pairAt(fake.runs[0]!, "--sandbox")).toBe("danger-full-access");
  });

  it("with isolation worktree: on the machine, with no sandbox", async () => {
    const { execute } = await scoutRun({ isolation: "worktree" });
    expect(execute).not.toHaveBeenCalled();
    expect(pairAt(fake.runs[0]!, "--sandbox")).toBe("danger-full-access");
  });
});

describe("zero status", () => {
  const status = (over: Record<string, unknown>, box: BoxStatus = NOT_READY) => {
    const ctx = testFactory({ codex: { sandbox: "off" }, lines: [], ...over });
    ctx.secrets.set("OPENAI_API_KEY", "k");
    ctx.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "t");
    saveBoxStatus(ctx.store, box);
    return formatStatus(factoryStatus(ctx));
  };

  it("warns when codex runs without its sandbox", () => {
    const warning = status({ isolation: "worktree" }).split("\n").find((l) => l.startsWith("AVISO:"));
    expect(warning).toContain("sin su sandbox");
    expect(warning).toContain("codex.sandbox: off");
    expect(warning).toContain("carpeta de trabajo y su repositorio");
    expect(status({ isolation: "container" })).toContain("sin su sandbox");
  });

  it("says codex runs in the box when it is ready", () => {
    const text = status({ isolation: "container" }, READY);
    expect(text).not.toContain("sin su sandbox");
    expect(text).toContain("Codex corre dentro de la caja");
  });

  it("says nothing by default or with a custom engine named codex", () => {
    expect(status({ codex: { sandbox: "on" }, isolation: "worktree" })).not.toContain("codex.sandbox");
    expect(status({ engines: { codex: { command: ["mi-codex"] } }, isolation: "worktree" })).not.toContain("codex.sandbox");
  });
});

