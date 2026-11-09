import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, requestWork, setPriority, type FactoryContext } from "../src/app.js";
import { ownerFirst, runDaemon } from "../src/daemon.js";
import { formatJob, formatRequest, formatStatus } from "../src/format.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { effectivePriority, isPriority, PRIORITY_AGING_MS } from "../src/priority.js";
import type { Job } from "../src/state/store.js";
import { cleanup, fakeAgents, gitRepo, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const NOW = new Date("2026-11-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const PACKAGE = { kind: "package", package: "hello", station: "nota" } as const;
const NIGHT = { kind: "night-shift", proposal: "p", autonomy: "auto" } as const;

/** One line unless a test needs two jobs running side by side: every repository costs real git calls. */
function factory(over: Record<string, unknown> = {}, names = ["web"]): FactoryContext {
  return testFactory({
    isolation: "worktree",
    level: "L2",
    lines: names.map((name) => ({ name, repo: gitRepo(), verify: [passes], integrate: "merge" })),
    ...over,
  });
}
const twoLines = (over: Record<string, unknown>) => factory(over, ["web", "blog"]);

const backdate = (ctx: FactoryContext, id: string, at: string) => ctx.store.db.prepare("UPDATE jobs SET created_at = ? WHERE id = ?").run(at, id);

describe("priority levels", () => {
  it("knows the four levels", () => {
    expect(["baja", "media", "alta", "urgente"].every(isPriority)).toBe(true);
    expect(isPriority("altísima")).toBe(false);
  });

  it("defaults owner requests to media and package or autonomous night-shift jobs to baja", () => {
    const ctx = factory();
    expect(requestWork(ctx, { text: "algo", line: "web" }).job.priority).toBe("media");
    expect(requestWork(ctx, { text: "del paquete", line: "web", source: PACKAGE }).job.priority).toBe("baja");
    expect(requestWork(ctx, { text: "nocturno", line: "web", source: NIGHT }).job.priority).toBe("baja");
    expect(requestWork(ctx, { text: "aprobado", line: "web", source: { kind: "night-shift", proposal: "q" } }).job.priority).toBe("media");
  });

  it("reads legacy rows with the source-based default", () => {
    const ctx = factory();
    const { job: night } = requestWork(ctx, { text: "nocturno", line: "web", source: NIGHT });
    const { job: plain } = requestWork(ctx, { text: "algo", line: "web" });
    ctx.store.db.prepare("UPDATE jobs SET priority = NULL").run();
    expect(ctx.store.getJob(night.id)!.priority).toBe("baja");
    expect(ctx.store.getJob(plain.id)!.priority).toBe("media");
  });

  it("lets only the owner ask for urgent, and refuses unknown levels", () => {
    const ctx = factory();
    expect(() => requestWork(ctx, { text: "parche", line: "web", source: PACKAGE, priority: "urgente" })).toThrow(/urgente/);
    expect(() => requestWork(ctx, { text: "parche", line: "web", priority: "altísima" })).toThrow(/baja, media, alta, urgente/);
    expect(ctx.store.listJobs()).toHaveLength(0);
    expect(requestWork(ctx, { text: "parche", line: "web", priority: "urgente" }).job.priority).toBe("urgente");
  });

  it("names the priority in the confirmation when it is not media", () => {
    const ctx = factory();
    expect(formatRequest(requestWork(ctx, { text: "a", line: "web", priority: "alta" }))).toContain("prioridad alta");
    expect(formatRequest(requestWork(ctx, { text: "b", line: "web" }))).not.toContain("prioridad");
  });
});

describe("aging", () => {
  const job = (priority: Job["priority"], hours: number) => ({ priority, createdAt: hoursAgo(hours) }) as Job;

  it("raises one level per full day, capped at alta", () => {
    expect(PRIORITY_AGING_MS).toBe(24 * 3600_000);
    expect(effectivePriority(job("baja", 23), NOW)).toBe("baja");
    expect(effectivePriority(job("baja", 25), NOW)).toBe("media");
    expect(effectivePriority(job("baja", 240), NOW)).toBe("alta");
    expect(effectivePriority(job("alta", 240), NOW)).toBe("alta");
    expect(effectivePriority(job("urgente", 240), NOW)).toBe("urgente");
  });

  it("does not age without createdAt nor change the stored priority", () => {
    expect(effectivePriority({ priority: "baja" } as Job, NOW)).toBe("baja");
    const j = job("baja", 50);
    effectivePriority(j, NOW);
    expect(j.priority).toBe("baja");
  });
});

describe("queue order", () => {
  it("puts a newer alta ahead of an older media", () => {
    const media = { id: "m", priority: "media", createdAt: "2026-11-09T10:00:00Z" } as Job;
    const alta = { id: "a", priority: "alta", createdAt: "2026-11-09T11:00:00Z" } as Job;
    expect(ownerFirst([media, alta], new Date("2026-11-09T11:05:00Z")).map((j) => j.id)).toEqual(["a", "m"]);
  });

  it("keeps age order within a level and input order on ties", () => {
    const late = { id: "l", priority: "media", createdAt: "2026-11-09T10:30:00Z" } as Job;
    const early = { id: "e", priority: "media", createdAt: "2026-11-09T10:00:00Z" } as Job;
    expect(ownerFirst([late, early], NOW).map((j) => j.id)).toEqual(["e", "l"]);
    const night = { id: "n", source: NIGHT } as Job;
    const approved = { id: "a", source: { kind: "night-shift", proposal: "q" } } as Job;
    const owner = { id: "o" } as Job;
    expect(ownerFirst([night, approved, owner]).map((j) => j.id)).toEqual(["a", "o", "n"]);
  });

  it("puts an aged baja ahead of a newer media", () => {
    const aged = { id: "b", priority: "baja", createdAt: hoursAgo(25) } as Job;
    const media = { id: "m", priority: "media", createdAt: hoursAgo(1) } as Job;
    expect(ownerFirst([media, aged], NOW).map((j) => j.id)).toEqual(["b", "m"]);
  });
});

describe("changing the priority", () => {
  it("changes a queued job and leaves it queued", () => {
    const ctx = factory();
    const { job } = requestWork(ctx, { text: "algo", line: "web" });
    expect(setPriority(ctx, job.id, "alta")).toMatchObject({ priority: "alta", status: "queued" });
    expect(ctx.store.getJob(job.id)!.priority).toBe("alta");
  });

  it("refuses finished and unknown jobs and unknown levels", () => {
    const ctx = factory();
    const { job } = requestWork(ctx, { text: "algo", line: "web" });
    expect(() => setPriority(ctx, job.id, "altísima")).toThrow(/baja, media, alta, urgente/);
    expect(() => setPriority(ctx, "nope", "alta")).toThrow(/No existe/);
    ctx.store.finishJob(job.id, "delivered");
    expect(() => setPriority(ctx, job.id, "alta")).toThrow(/terminó/);
    expect(ctx.store.getJob(job.id)!.priority).toBe("media");
  });
});

describe("where the priority shows", () => {
  it("marks non-media jobs in the status", () => {
    const ctx = factory();
    const { job: alta } = requestWork(ctx, { text: "importante", line: "web", priority: "alta" });
    const { job: media } = requestWork(ctx, { text: "normal", line: "web" });
    const lines = formatStatus(factoryStatus(ctx)).split("\n");
    expect(lines.find((l) => l.startsWith(`- ${alta.id}`))).toContain("prioridad alta");
    expect(lines.find((l) => l.startsWith(`- ${media.id}`))).not.toContain("prioridad");
  });

  it("says when the wait raised it", () => {
    const ctx = factory();
    const { job } = requestWork(ctx, { text: "bajo", line: "web", source: PACKAGE });
    const status = factoryStatus(ctx);
    const text = formatStatus({ ...status, queued: [{ ...job, createdAt: hoursAgo(25) }] }, NOW);
    expect(text).toContain("prioridad media (subió por la espera)");
  });

  it("shows it in the job's detail", () => {
    const ctx = factory();
    expect(formatJob(requestWork(ctx, { text: "parche", line: "web", priority: "urgente" }).job)).toContain("Prioridad: urgente");
  });

  it("takes it from the chat", async () => {
    const ctx = factory();
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const r = (await client.callTool({ name: "zero_request", arguments: { text: "importante", line: "web", priority: "alta" } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain("prioridad alta");
    expect(ctx.store.listJobs()[0]!.priority).toBe("alta");
  });

  it("is documented in both READMEs and the usage text", () => {
    for (const file of ["README.md", "README.es.md", "src/cli.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("--prioridad");
      expect(text, file).toContain("zero priority");
    }
  });
});

describe("priority in the daemon", () => {
  const started = (ctx: FactoryContext, id: string) => Date.parse(ctx.store.spansForJob(id).find((s) => s.name === "zero.station.spec")!.start);
  const building = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${req.prompt.match(/# Job (\w+)/)![1]}.ts`]: "ok\n" }) });
  const run = (ctx: FactoryContext) => runDaemon(ctx, { once: true, pollMs: 10, panel: false, agentRunner: () => building().runner });

  // The baja job starting once it is alone also covers "low runs when alone".
  it("starts a baja job only after the media one finished, then runs it alone", async () => {
    const ctx = twoLines({ concurrency: 2 });
    const { job: low } = requestWork(ctx, { text: "bajo", line: "web", priority: "baja" });
    const { job: medium } = requestWork(ctx, { text: "normal", line: "blog" });
    await run(ctx);
    const done = ctx.store.getJob(medium.id)!;
    expect(done.status).toBe("delivered");
    expect(ctx.store.getJob(low.id)!.status).toBe("delivered");
    expect(started(ctx, low.id)).toBeGreaterThanOrEqual(Date.parse(done.finishedAt!));
  });

  it("starts an aged baja job next to a media one", async () => {
    const ctx = twoLines({ concurrency: 2 });
    const { job: low } = requestWork(ctx, { text: "bajo", line: "web", priority: "baja" });
    backdate(ctx, low.id, new Date(Date.now() - 25 * 3600_000).toISOString());
    const { job: medium } = requestWork(ctx, { text: "normal", line: "blog" });
    await run(ctx);
    expect(ctx.store.getJob(low.id)!.status).toBe("delivered");
    expect(started(ctx, low.id)).toBeLessThan(Date.parse(ctx.store.getJob(medium.id)!.finishedAt!));
  });

  it("runs one urgent job at a time", async () => {
    const ctx = twoLines({ concurrency: 2 });
    const { job: first } = requestWork(ctx, { text: "parche uno", line: "web", priority: "urgente" });
    const { job: second } = requestWork(ctx, { text: "parche dos", line: "blog", priority: "urgente" });
    await run(ctx);
    const done = ctx.store.getJob(first.id)!;
    expect(done.status).toBe("delivered");
    expect(ctx.store.getJob(second.id)!.status).toBe("delivered");
    expect(started(ctx, second.id)).toBeGreaterThanOrEqual(Date.parse(done.finishedAt!));
  });
});
