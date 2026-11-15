import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import type { FactoryContext } from "../src/app.js";
import { stationOnDemandKey, stationOnDemandRequestKey, stationUploadKey } from "../src/line/packages.js";
import { createZeroMcpServer, type ZeroMcpOptions } from "../src/mcp/server.js";
import { factoryConfig, packageDataDir } from "../src/packages.js";
import { cleanup, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";
import { makeZip } from "./zip.js";

const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  cleanup();
});

const zip = makeZip([{ name: "src/a.txt", data: "hola" }]);

/** A factory with package `hello`, whose station `nota` runs on demand and accepts uploads unless told otherwise. */
async function factory(uploads: boolean = true): Promise<FactoryContext> {
  const dir = tempDir("zero-pkg-");
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", onDemand: true, ...(uploads && { uploads: {} }) }] }),
    "nota.mjs": "export async function pass() {}\n",
  });
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [{ name: "web", repo: gitRepo() }], packages: [{ path: dir, allowCode: true }] });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

async function connect(ctx: FactoryContext, opts: ZeroMcpOptions = {}): Promise<Client> {
  const server = createZeroMcpServer(ctx.home, { autoStart: false, stationWaitMs: 0, ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  clients.push(client);
  return client;
}

async function upload(client: Client, args: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name: "zero_package_upload", arguments: { station: "hello/nota", ...args } })) as { content: { text: string }[] };
  return r.content[0]!.text;
}

const uploadsDir = (ctx: FactoryContext) => join(packageDataDir(ctx.home, "hello"), "uploads", "nota");
const files = (ctx: FactoryContext) => (existsSync(uploadsDir(ctx)) ? readdirSync(uploadsDir(ctx)) : []);

function zipFile(): string {
  const path = join(tempDir("zero-src-"), "sitio.zip");
  writeFileSync(path, zip);
  return path;
}

describe("zero_package_upload on this machine", () => {
  it("passes a local file and the request to the station", async () => {
    const ctx = await factory();
    const text = await upload(await connect(ctx), { path: zipFile(), request: "construilo" });
    const stored = files(ctx);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/sitio\.zip$/);
    expect(readFileSync(join(uploadsDir(ctx), stored[0]!)).equals(zip)).toBe(true);
    expect(ctx.store.getKv(stationUploadKey("hello", "nota"))).toBeDefined();
    expect(ctx.store.getKv(stationOnDemandRequestKey("hello", "nota"))).toBe("construilo");
    expect(text).toContain("Archivo sitio.zip");
    expect(text).toContain("guardado para hello/nota");
  });

  it("passes back the station's refusal", async () => {
    const ctx = await factory(false);
    expect(await upload(await connect(ctx), { path: zipFile() })).toContain("no acepta archivos");
    expect(files(ctx)).toEqual([]);
  });

  it("passes base64 content with its name", async () => {
    const ctx = await factory();
    await upload(await connect(ctx), { content: zip.toString("base64"), name: "sitio.zip" });
    const stored = files(ctx);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/sitio\.zip$/);
    expect(readFileSync(join(uploadsDir(ctx), stored[0]!)).equals(zip)).toBe(true);
    expect(ctx.store.getKv(stationUploadKey("hello", "nota"))).toBeDefined();
  });

  it("refuses bad input in Spanish, writing nothing", async () => {
    const ctx = await factory();
    const client = await connect(ctx);
    const folder = tempDir("zero-dir-");
    mkdirSync(join(folder, "sub"));
    const cases: [Record<string, unknown>, string][] = [
      [{ path: zipFile(), content: zip.toString("base64"), name: "a.zip" }, "no los dos"],
      [{}, "Falta el archivo"],
      [{ content: zip.toString("base64") }, "hace falta name"],
      [{ content: "no es base64!!", name: "a.zip" }, "base64"],
      [{ path: "sitio.zip" }, "ruta absoluta"],
      [{ path: join(folder, "sub") }, "no es un archivo"],
    ];
    for (const [args, reason] of cases) expect(await upload(client, args)).toContain(reason);
    expect(ctx.store.getKv(stationOnDemandKey("hello", "nota"))).toBeUndefined();
    expect(files(ctx)).toEqual([]);
  });
});

describe("zero_package_upload over the remote chat", () => {
  const remote = { scope: ["zero:read", "zero:act"] as ("zero:read" | "zero:act")[], client: "c" };

  it("refuses a local path, naming content", async () => {
    const ctx = await factory();
    const text = await upload(await connect(ctx, { remote }), { path: zipFile() });
    expect(text).toContain("content");
    expect(files(ctx)).toEqual([]);
    expect(ctx.store.getKv(stationOnDemandKey("hello", "nota"))).toBeUndefined();
  });

  it("accepts base64 content", async () => {
    const ctx = await factory();
    await upload(await connect(ctx, { remote }), { content: zip.toString("base64"), name: "a.zip" });
    expect(files(ctx)).toHaveLength(1);
    expect(ctx.store.getKv(stationUploadKey("hello", "nota"))).toBeDefined();
  });

  it("is not listed for a read-only token", async () => {
    const ctx = await factory();
    const { tools } = await (await connect(ctx, { remote: { scope: ["zero:read"], client: "c" } })).listTools();
    expect(tools.map((t) => t.name)).not.toContain("zero_package_upload");
  });
});
