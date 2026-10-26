import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, requestWork, stop } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { installClaude, manualInstructions, serverCommand } from "../src/install.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { cleanup, gitRepo, tempDir, testFactory } from "./helpers.js";

afterEach(cleanup);

async function connect(ctx: ReturnType<typeof testFactory>) {
  const server = createZeroMcpServer(ctx.home, { autoStart: false });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: r.isError ?? false };
  };
  return { client, call };
}

describe("chat interface (MCP)", () => {
  it("offers the factory's tools", async () => {
    const { client } = await connect(testFactory({ lines: [{ name: "demo", repo: gitRepo() }] }));
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["zero_answer", "zero_briefing", "zero_lines", "zero_request", "zero_resume", "zero_status", "zero_stop", "zero_trace"]);
  });

  it("queues a request and answers at once", async () => {
    const ctx = testFactory({ level: "L2", lines: [{ name: "demo", repo: gitRepo() }] });
    const { call } = await connect(ctx);
    const r = await call("zero_request", { text: "agregá un login con Google" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Pedido anotado: trabajo [0-9a-f]{8} en la línea "demo"/);
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(1);
    expect((await call("zero_status")).text).toContain("En cola:");
  });

  it("explains errors instead of failing", async () => {
    const ctx = testFactory({ lines: [{ name: "a", repo: gitRepo() }, { name: "b", repo: gitRepo() }] });
    const { call } = await connect(ctx);
    const ambiguous = await call("zero_request", { text: "algo" });
    expect(ambiguous).toMatchObject({ isError: true, text: expect.stringContaining("Hay varias líneas") });
    const job = requestWork(ctx, { text: "x", line: "a" }).job;
    expect(await call("zero_answer", { job: job.id, decision: "approve" })).toMatchObject({ isError: true, text: expect.stringContaining("no está esperando") });
  });

  it("stops a job and the whole factory", async () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo() }] });
    const { call } = await connect(ctx);
    const job = requestWork(ctx, { text: "x" }).job;
    expect((await call("zero_stop", { job: job.id })).text).toContain("Estado: detenido");
    expect((await call("zero_stop")).text).toContain("Fábrica detenida");
    expect(factoryStatus(ctx).andon).toBe(true);
  });

  it("reports the same numbers as the CLI", async () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo() }] });
    const { call } = await connect(ctx);
    requestWork(ctx, { text: "x" });
    expect((await call("zero_status")).text).toBe(formatStatus(factoryStatus(ctx)));
  });
});

describe("factory operations", () => {
  it("asks the daemon to stop a running job instead of killing it here", async () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo() }] });
    const job = requestWork(ctx, { text: "x" }).job;
    ctx.store.updateJob(job.id, { status: "running" });
    const r = await stop(ctx, job.id);
    expect(r.job).toMatchObject({ status: "running", stopRequested: true });
  });

  it("rejects empty requests", () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo() }] });
    expect(() => requestWork(ctx, { text: "  " })).toThrow(/vacío/);
  });
});

describe("zero install", () => {
  const cmd = { command: "node", args: ["/zero/dist/cli.js", "mcp"], env: {} };

  it("registers zero in Claude Code once", () => {
    const calls: string[][] = [];
    const exec = (_bin: string, args: string[]) => (calls.push(args), { status: args[1] === "get" ? 1 : 0, output: "" });
    expect(installClaude(cmd, exec).status).toBe("installed");
    expect(calls[1]).toEqual(["mcp", "add", "--scope", "user", "zero", "--", "node", "/zero/dist/cli.js", "mcp"]);
    expect(installClaude(cmd, () => ({ status: 0, output: "" })).status).toBe("already");
  });

  it("prints configuration for clients it cannot verify", () => {
    const [codex, opencode] = manualInstructions({ ...cmd, env: { ZERO_HOME: "/f" } });
    expect(codex!.detail).toContain('[mcp_servers.zero]\ncommand = "node"\nargs = ["/zero/dist/cli.js", "mcp"]\nenv = { ZERO_HOME = "/f" }');
    expect(JSON.parse(opencode!.detail.slice(opencode!.detail.indexOf("{")))).toEqual({
      mcp: { zero: { type: "local", command: ["node", "/zero/dist/cli.js", "mcp"], enabled: true, environment: { ZERO_HOME: "/f" } } },
    });
  });

  it("pins ZERO_HOME only when it is not the default", () => {
    const ctx = testFactory({});
    expect(serverCommand(ctx.home, "/cli.js").env).toEqual({ ZERO_HOME: ctx.home.root });
  });
});

describe("zero secret (CLI)", () => {
  const cli = (args: string[], home: string) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: home }, input: "" });

  it("refuses a value passed as an argument", () => {
    const r = cli(["secret", "set", "OPENAI_API_KEY", "sk-should-not-be-here"], tempDir());
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/No pases el valor como argumento/);
  });

  it("lists names only", () => {
    const home = tempDir();
    writeFileSync(join(home, "secrets.json"), JSON.stringify(["CLAUDE_CODE_OAUTH_TOKEN"]));
    const r = cli(["secret", "list"], home);
    expect(r.stdout.trim()).toBe("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
