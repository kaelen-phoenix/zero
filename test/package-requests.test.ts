import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, briefing, factoryStatus, monthlyReport, productionLine, requestWork, type FactoryContext } from "../src/app.js";
import { ownerFirst, runDaemon } from "../src/daemon.js";
import { formatJob, formatStatus } from "../src/format.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { packagesPass, type JobRequestResult } from "../src/line/packages.js";
import { runJob } from "../src/line/runner.js";
import { factoryConfig } from "../src/packages.js";
import { jobPage, linePage, overviewPage } from "../src/panel/html.js";
import { monthlyMarkdown } from "../src/report.js";
import type { Job } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const passes = `node -e "process.exit(0)"`;
const NOW = new Date("2026-11-04T12:00:00Z");
const SOURCE = { kind: "package", package: "hello", station: "nota" } as const;
const ORIGIN = "pedido por paquete hello/nota";
const SECRET = "valor-del-secreto-123";
const GITHUB_TOKEN = `ghp_${"a".repeat(36)}`;

/** A package whose station `nota` runs `body` in its pass and leaves in a file what `results` holds at the end. */
function stationPackage(body: string, requests?: unknown, secrets: string[] = []) {
  const dir = tempDir("zero-pkg-");
  const out = join(tempDir("zero-out-"), "out.json");
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", secrets, ...(requests === undefined ? {} : { requests }) }] }),
    "nota.mjs": `import { writeFileSync } from "node:fs";
export async function pass(ctx) {
  const results = [];
  ${body}
  writeFileSync(${JSON.stringify(out)}, JSON.stringify(results));
}
`,
  });
  return { dir, results: () => JSON.parse(readFileSync(out, "utf8")) as JobRequestResult[] };
}

/** A factory with lines `web` and `blog`, unless the definition says otherwise. */
async function factory(dir: string, over: Record<string, unknown> = {}): Promise<FactoryContext> {
  const ctx = testFactory({
    isolation: "worktree",
    level: "L2",
    lines: [
      { name: "web", repo: gitRepo(), verify: [passes], integrate: "merge" },
      { name: "blog", repo: gitRepo(), verify: [passes], integrate: "merge" },
    ],
    packages: [{ path: dir, allowCode: true }],
    ...over,
  });
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const pass = (ctx: FactoryContext, now = NOW) => packagesPass(ctx, fakeAgents({}).runner, now);
const jobs = (ctx: FactoryContext) => ctx.store.listJobs({});
const ask = (line = "web", text = "arreglar algo") => `results.push(ctx.requestJob(${JSON.stringify({ line, text })}));`;

describe("declaring requests in the manifest", () => {
  it("loads a valid declaration under interface 1", async () => {
    const { dir } = stationPackage("", { perLinePerDay: 2 });
    const ctx = await factory(dir);
    expect(ctx.config.loadedPackages!.problems).toEqual([]);
    expect(ctx.config.loadedPackages!.stations[0]!.requests?.perLinePerDay).toBe(2);
  });

  it.each([[{ perLinePerDay: 0 }], [{ perLinePerDay: 1.5 }], [{ otra: 1 }]])("leaves the package out for %j, naming requests", async (requests) => {
    const { dir } = stationPackage("", requests);
    const ctx = await factory(dir);
    expect(ctx.config.loadedPackages!.stations).toEqual([]);
    expect(ctx.config.loadedPackages!.problems[0]!.reason).toContain("requests");
  });
});

describe("ctx.requestJob", () => {
  it("refuses a station without requests", async () => {
    const { dir, results } = stationPackage(ask());
    const ctx = await factory(dir);
    await pass(ctx);
    expect(results()[0]).toEqual({ reason: expect.any(String) });
    expect(jobs(ctx)).toEqual([]);
  });

  it("opens a queued request job with its source", async () => {
    const { dir, results } = stationPackage(ask(), { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    const { id } = results()[0] as { id: string };
    expect(ctx.store.getJob(id)).toMatchObject({ status: "queued", line: "web", kind: "request", request: "arreglar algo", source: SOURCE });
    expect(ctx.store.spansForJob(id).find((s) => s.name === "zero.job")!.attrs["zero.package"]).toBe("hello/nota");
  });

  it("refuses a line the factory does not have, even with a single line", async () => {
    const { dir, results } = stationPackage(ask("otra"), { perLinePerDay: 1 });
    const ctx = await factory(dir, { lines: [{ name: "web", repo: gitRepo(), verify: [passes] }] });
    await pass(ctx);
    expect(results()[0]).toEqual({ reason: expect.any(String) });
    expect(jobs(ctx)).toEqual([]);
  });

  it("counts per line, and the second request of the day on a line is refused", async () => {
    const { dir, results } = stationPackage(`${ask()}${ask()}${ask("blog")}`, { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    const [first, second, other] = results();
    expect(first).toHaveProperty("id");
    expect(second).toEqual({ reason: expect.any(String) });
    expect(other).toHaveProperty("id");
    expect(jobs(ctx).map((j) => j.line).sort()).toEqual(["blog", "web"]);
  });

  it("counts again on the next local day", async () => {
    const { dir, results } = stationPackage(`${ask()}${ask()}`, { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    const [first] = results();
    ctx.store.finishJob((first as { id: string }).id, "stopped", {});
    await pass(ctx, new Date(NOW.getTime() + 25 * 3_600_000));
    const [next, again] = results();
    expect(next).toHaveProperty("id");
    expect(again).toHaveProperty("reason");
  });

  it("spends no quota on a refused request", async () => {
    const { dir, results } = stationPackage(`${ask("web", "  ")}${ask()}`, { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    const [empty, valid] = results();
    expect(empty).toHaveProperty("reason");
    expect(valid).toHaveProperty("id");
  });

  it("keeps the quota out of reach of ctx.state", async () => {
    const reset = ["requests:web", "web", "count", ":requests:web"].map((name) => `ctx.state.set(${JSON.stringify(name)}, { day: "x", count: 0 });`).join("");
    const { dir, results } = stationPackage(`${ask()}${reset}${ask()}`, { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    expect(results()[1]).toHaveProperty("reason");
    expect(jobs(ctx)).toHaveLength(1);
  });

  it("refuses with the andon pulled during the pass", async () => {
    const { dir, results } = stationPackage(`globalThis.zeroTestHook();${ask()}`, { perLinePerDay: 1 });
    const ctx = await factory(dir);
    vi.stubGlobal("zeroTestHook", () => ctx.store.setKv(ANDON_KEY, "on"));
    await pass(ctx);
    expect(results()[0]).toHaveProperty("reason");
    expect(jobs(ctx)).toEqual([]);
  });

  it("refuses once the budget is reached", async () => {
    const { dir, results } = stationPackage(`globalThis.zeroTestHook();${ask()}`, { perLinePerDay: 1 });
    const ctx = await factory(dir, { limits: { usdPerDay: 1 } });
    vi.stubGlobal("zeroTestHook", () => ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": 5 }));
    await pass(ctx, new Date());
    expect(results()[0]).toHaveProperty("reason");
    expect(jobs(ctx)).toEqual([]);
  });

  it("refuses a ctx kept after its pass ended", async () => {
    const { dir } = stationPackage("globalThis.zeroTestSaved = ctx;", { perLinePerDay: 1 });
    const ctx = await factory(dir);
    vi.stubGlobal("zeroTestSaved", undefined);
    await pass(ctx);
    const saved = (globalThis as unknown as { zeroTestSaved: { requestJob(req: unknown): JobRequestResult } }).zeroTestSaved;
    expect(saved.requestJob({ line: "web", text: "tarde" })).toHaveProperty("reason");
    expect(jobs(ctx)).toEqual([]);
  });

  it("never throws, whatever it is given", async () => {
    const body = `results.push(ctx.requestJob());
results.push(ctx.requestJob(null));
results.push(ctx.requestJob({ line: 1, text: {} }));
results.push(ctx.requestJob({ line: "web", text: " " }));
results.push(ctx.requestJob({ get line() { throw { toString() { throw new Error("x"); } }; }, text: "t" }));`;
    const { dir, results } = stationPackage(body, { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    expect(results()).toHaveLength(5);
    for (const r of results()) expect(r).toEqual({ reason: expect.any(String) });
    expect(jobs(ctx)).toEqual([]);
  });

  it("gives a reason without the secret when opening the job fails, and the quota stays", async () => {
    const { dir, results } = stationPackage(`${ask()}${ask()}`, { perLinePerDay: 1 }, ["HELLO_TOKEN"]);
    const ctx = await factory(dir);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: SECRET });
    vi.spyOn(ctx.store, "createJob").mockImplementationOnce(() => {
      throw new Error(`falló con ${SECRET}`);
    });
    await pass(ctx);
    const [failed, next] = results();
    expect(failed).toEqual({ reason: expect.any(String) });
    expect((failed as { reason: string }).reason).not.toContain(SECRET);
    expect(next).toHaveProperty("id");
  });

  it("stores the text without secrets, tokens or local paths", async () => {
    const { dir } = stationPackage(ask("web", `Falla con ${SECRET}, ${GITHUB_TOKEN} y /home/ana/proyecto/app.ts ahora`), { perLinePerDay: 1 }, ["HELLO_TOKEN"]);
    const ctx = await factory(dir);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: SECRET });
    await pass(ctx);
    const { request } = jobs(ctx)[0]!;
    expect(request).toContain("Falla con");
    for (const piece of [SECRET, GITHUB_TOKEN, "/home/ana"]) expect(request).not.toContain(piece);
  });

  it("cuts a long text to 4000 characters", async () => {
    const { dir } = stationPackage(ask("web", "palabra ".repeat(1250)), { perLinePerDay: 1 });
    const ctx = await factory(dir);
    await pass(ctx);
    expect(jobs(ctx)[0]!.request.length).toBeLessThanOrEqual(4000);
  });
});

describe("a package's job on the line", () => {
  const building = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${req.prompt.match(/# Job (\w+)/)![1]}.ts`]: "ok\n" }) });

  async function packageJob(level: string) {
    const ctx = await factory(stationPackage("").dir, { level });
    return { ctx, job: requestWork(ctx, { text: "arreglar algo", line: "web", source: SOURCE }).job };
  }

  it("reaches agents as a third party's data", async () => {
    const { ctx, job } = await packageJob("L2");
    const agents = building();
    await runJob(job.id, { ...ctx, runAgent: agents.runner });
    const prompt = agents.calls.find((c) => c.station === "spec")!.prompt;
    expect(prompt).toContain("hello/nota");
    expect(prompt).toContain("data from a third party");
    expect(prompt).toContain("arreglar algo");
    expect(prompt).not.toContain("The owner sent");
  });

  it("leaves the prompt of other jobs as it was", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "arreglar algo", line: "web" });
    const agents = building();
    await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(agents.calls.find((c) => c.station === "spec")!.prompt).toContain("The owner sent a request in plain language");
  });

  it("is delivered on L2 like any request, with no question", async () => {
    const { ctx, job } = await packageJob("L2");
    const done = await runJob(job.id, { ...ctx, runAgent: building().runner });
    expect(done.status).toBe("delivered");
    expect(done.delivery?.mode).toBe("merge");
    expect(done.question).toBeUndefined();
  });

  it("waits with its specification on L1 like any request", async () => {
    const { ctx, job } = await packageJob("L1");
    const done = await runJob(job.id, { ...ctx, runAgent: building().runner });
    expect(done).toMatchObject({ status: "waiting", question: { kind: "spec-ready" } });
  });
});

describe("priority in the daemon", () => {
  const started = (ctx: FactoryContext, id: string) => Date.parse(ctx.store.spansForJob(id).find((s) => s.name === "zero.station.spec")!.start);
  const building = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${req.prompt.match(/# Job (\w+)/)![1]}.ts`]: "ok\n" }) });

  it("orders them after other jobs, keeping their order", () => {
    const fromPackage = { id: "p", source: SOURCE } as Job;
    const night = { id: "n", source: { kind: "night-shift", proposal: "x", autonomy: "auto" } } as Job;
    const plain = { id: "o" } as Job;
    expect(ownerFirst([fromPackage, night, plain]).map((j) => j.id)).toEqual(["o", "p", "n"]);
  });

  it("starts the package's job only once the other one finished", async () => {
    const ctx = await factory(stationPackage("").dir, { concurrency: 3 });
    const { job: fromPackage } = requestWork(ctx, { text: "del paquete", line: "web", source: SOURCE });
    const { job: plain } = requestWork(ctx, { text: "sin fuente", line: "blog" });
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, agentRunner: () => building().runner });
    const done = ctx.store.getJob(plain.id)!;
    expect(done.status).toBe("delivered");
    expect(ctx.store.getJob(fromPackage.id)!.status).toBe("delivered");
    expect(started(ctx, fromPackage.id)).toBeGreaterThanOrEqual(Date.parse(done.finishedAt!));
  });

  it("runs two of them one at a time", async () => {
    const ctx = await factory(stationPackage("").dir, { concurrency: 3 });
    const { job: a } = requestWork(ctx, { text: "uno", line: "web", source: SOURCE });
    const { job: b } = requestWork(ctx, { text: "dos", line: "blog", source: SOURCE });
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, agentRunner: () => building().runner });
    const [first, second] = [ctx.store.getJob(a.id)!, ctx.store.getJob(b.id)!].sort((x, y) => started(ctx, x.id) - started(ctx, y.id));
    expect(first!.status).toBe("delivered");
    expect(second!.status).toBe("delivered");
    expect(started(ctx, second!.id)).toBeGreaterThanOrEqual(Date.parse(first!.finishedAt!));
  });
});

describe("where the origin shows", () => {
  it("shows in the status and the job's text, and only for package jobs", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "arreglar algo", line: "web", source: SOURCE });
    expect(formatStatus(factoryStatus(ctx))).toContain(ORIGIN);
    expect(formatJob(job)).toContain(ORIGIN);
    const { job: plain } = requestWork(ctx, { text: "otro", line: "blog" });
    expect(formatJob(plain)).not.toContain("pedido por paquete");
  });

  it("shows among the status's finished jobs", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "arreglar algo", line: "web", source: SOURCE });
    ctx.store.finishJob(job.id, "stopped", {});
    expect(formatStatus(factoryStatus(ctx))).toContain(ORIGIN);
  });

  it("shows on the panel's overview, job page and line view", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "arreglar algo", line: "web", source: SOURCE });
    expect(overviewPage(factoryStatus(ctx), ["web"], "nonce")).toContain(ORIGIN);
    expect(jobPage(job, "", "nonce")).toContain(ORIGIN);
    expect(linePage(productionLine(ctx), "nonce")).toContain(ORIGIN);
  });

  it("stays off the panel for other jobs", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "arreglar algo", line: "web" });
    expect(overviewPage(factoryStatus(ctx), ["web"], "nonce")).not.toContain("pedido por paquete");
    expect(jobPage(job, "", "nonce")).not.toContain("pedido por paquete");
    expect(linePage(productionLine(ctx), "nonce")).not.toContain("pedido por paquete");
  });

  it("has its own section in the briefing, for delivered and open jobs", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job: delivered } = requestWork(ctx, { text: "entregado", line: "web", source: SOURCE });
    ctx.store.finishJob(delivered.id, "delivered", { delivery: { mode: "merge", branch: `zero/${delivered.id}`, commit: "abc" } });
    const { job: open } = requestWork(ctx, { text: "abierto", line: "blog", source: SOURCE });
    const body = (await briefing(ctx)).body;
    expect(body).toContain("## Pedidos de paquetes");
    expect(body).toContain(delivered.id);
    expect(body).toContain(open.id);
    const [entry] = body.split("\n").filter((l) => l.includes(open.id));
    expect(entry).toContain(`${ORIGIN}: en cola`);
    const [done] = body.split("\n").filter((l) => l.includes(delivered.id) && l.includes(ORIGIN));
    expect(done).toContain("entregado");
  });

  it("leaves old finished jobs out of the briefing, and the section out when there are none", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "viejo", line: "web", source: SOURCE });
    ctx.store.finishJob(job.id, "delivered", {});
    requestWork(ctx, { text: "sin fuente", line: "web" });
    ctx.now = () => new Date(Date.now() + 5 * 86_400_000);
    expect((await briefing(ctx)).body).not.toContain("Pedidos de paquetes");
  });

  it("names it as the origin in the monthly report", async () => {
    const ctx = await factory(stationPackage("").dir);
    const { job } = requestWork(ctx, { text: "arreglar algo", line: "web", source: SOURCE });
    ctx.store.finishJob(job.id, "delivered", { delivery: { mode: "merge", branch: `zero/${job.id}`, commit: "abc" } });
    const month = ctx.store.getJob(job.id)!.finishedAt!.slice(0, 7);
    expect(monthlyMarkdown(monthlyReport(ctx, { month, line: "web" }))).toContain("Origen: Pedido por paquete hello/nota");
  });
});
