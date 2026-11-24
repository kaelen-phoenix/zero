import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { confirmRemoteAction, createProject, describeRemoteAction, holdRemoteAction, pendingRemoteActions, type ProjectInput } from "../src/app.js";
import { formatPendingActions } from "../src/format.js";
import { createZeroMcpServer, type ZeroMcpOptions } from "../src/mcp/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  cleanup();
});

const factory = () => testFactory({ isolation: "worktree", lines: [{ name: "demo", repo: gitRepo() }] });
type Ctx = ReturnType<typeof factory>;

async function chat(ctx: Ctx, remote?: ZeroMcpOptions["remote"]) {
  const server = createZeroMcpServer(ctx.home, { autoStart: false, ...(remote && { remote }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(a);
  clients.push(client);
  const create = async (args: Record<string, unknown>) => ((await client.callTool({ name: "zero_repo_create", arguments: args })) as { content: { text: string }[] }).content[0]!.text;
  return { client, create };
}

/** A fake project creator that records what it was asked to create. */
function creator(result: { ok: boolean; job?: string } = { ok: true, job: "abcd1234" }) {
  const calls: ProjectInput[] = [];
  const project = async (_ctx: unknown, input: ProjectInput) => {
    calls.push(input);
    return { created: result.ok, text: result.ok ? "Creé el repositorio." : "No creé nada.", ...result };
  };
  return { calls, project };
}

describe("zero_repo_create from the chat", () => {
  it("holds the creation over stdio and creates nothing", async () => {
    const ctx = factory();
    const before = readFileSync(ctx.home.config, "utf8");
    const { create } = await chat(ctx);
    const reply = await create({ name: "demo-x", pedido: "Demo para la empresa X" });
    const pending = pendingRemoteActions(ctx);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ tool: "zero_repo_create", args: { name: "demo-x", pedido: "Demo para la empresa X" } });
    expect(ctx.store.getKv(`mcp-pending:${pending[0]!.id}`)).toBeTruthy();
    expect(reply).toContain(pending[0]!.id);
    expect(reply).toContain(`zero mcp confirmar ${pending[0]!.id}`);
    expect(reply).toContain("No lo hice todavía");
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
    expect(existsSync(ctx.home.projects)).toBe(false);
    expect(ctx.store.listJobs()).toEqual([]);
    expect(formatPendingActions(pending)).toContain("pedido por un chat de esta máquina");
  });

  it("holds it over the remote server too, and hides it from a read-only token", async () => {
    const ctx = factory();
    const { create } = await chat(ctx, { scope: ["zero:read", "zero:act"], client: "c1" });
    const reply = await create({ name: "demo-x", publico: true });
    expect(pendingRemoteActions(ctx)).toMatchObject([{ tool: "zero_repo_create", client: "c1", args: { name: "demo-x", publico: true } }]);
    expect(reply).toContain("repositorio público demo-x");
    const readOnly = await chat(ctx, { scope: ["zero:read"], client: "c1" });
    expect((await readOnly.client.listTools()).tools.map((t) => t.name)).not.toContain("zero_repo_create");
  });

  it("refuses a name that is not valid without holding anything", async () => {
    const ctx = factory();
    const { create } = await chat(ctx);
    expect(await create({ name: "mi demo!" })).toContain("no es un nombre de repositorio válido");
    expect(pendingRemoteActions(ctx)).toEqual([]);
  });
});

describe("confirming a held creation", () => {
  it("runs the creator once with what was held", async () => {
    const ctx = factory();
    const { create } = await chat(ctx);
    await create({ name: "acme/demo-x", publico: true, pedido: "Demo con turnos online" });
    const [held] = pendingRemoteActions(ctx);
    const f = creator();
    const done = await confirmRemoteAction(ctx, held!.id, { project: f.project });
    expect(done).toEqual({ ok: true, text: "Creé el repositorio.", job: "abcd1234" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ name: "acme/demo-x", publico: true, pedido: "Demo con turnos online" });
    expect(await f.calls[0]!.confirm!("¿Creo?")).toBe(true);

    const twice = await confirmRemoteAction(ctx, held!.id, { project: f.project });
    expect(twice.ok).toBe(false);
    expect(twice.text).toContain("No hay ninguna acción pendiente");
    expect(f.calls).toHaveLength(1);
  });

  it("does not run an expired one", async () => {
    const ctx = factory();
    const held = holdRemoteAction(ctx, { tool: "zero_repo_create", args: { name: "demo-x" } });
    const f = creator();
    const r = await confirmRemoteAction(ctx, held.id, { project: f.project, now: new Date(Date.parse(held.expiresAt) + 1) });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("venció");
    expect(f.calls).toEqual([]);
  });

  it("passes on a creation that failed", async () => {
    const ctx = factory();
    const held = holdRemoteAction(ctx, { tool: "zero_repo_create", args: { name: "demo-x" } });
    expect(await confirmRemoteAction(ctx, held.id, { project: creator({ ok: false }).project })).toEqual({ ok: false, text: "No creé nada." });
  });

  it("reaches createProject approved and private by default", async () => {
    const ctx = factory();
    const held = holdRemoteAction(ctx, { tool: "zero_repo_create", args: { name: "demo-x" } });
    const created: unknown[] = [];
    const r = await confirmRemoteAction(ctx, held.id, {
      project: (c, input) =>
        createProject(c, {
          ...input,
          token: () => "ghp_fake",
          create: async (req) => {
            created.push(req);
            throw Object.assign(new Error("Forbidden"), { status: 403 });
          },
        }),
    });
    expect(created).toEqual([{ name: "demo-x", private: true }]);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("no tiene permiso para crear repositorios");
  });
});

describe("describing a held creation", () => {
  it("names the repository, its visibility and the first job", () => {
    expect(describeRemoteAction({ tool: "zero_repo_create", args: { name: "demo-x" } })).toContain("crear el repositorio privado demo-x en GitHub");
    expect(describeRemoteAction({ tool: "zero_repo_create", args: { name: "demo-x", publico: true } })).toContain("crear el repositorio público demo-x en GitHub");
    const text = describeRemoteAction({ tool: "zero_repo_create", args: { name: "demo-x", pedido: "Demo\npara \u001b[2JX" } });
    expect(text).toContain('con el primer trabajo "Demo para [2JX"');
  });
});
