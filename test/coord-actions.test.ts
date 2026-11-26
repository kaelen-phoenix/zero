import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { answerAnywhere, confirmRemoteAction, decideProposal, factoryStatus, factoryView, jobText, LAUNCH_KEY, pendingRemoteActions, proposalsElsewhere, requestAnywhere, requestLines, requestsView, requestWork, type FactoryContext, type RequestSent } from "../src/app.js";
import { linesPass } from "../src/coord/lines.js";
import { outbox, type OutboxEntry } from "../src/coord/outbox.js";
import { coordPass, PROBE_KEY } from "../src/coord/pass.js";
import { claimJob, decisionRef, lineRef, memoryCoord, queueRef, readDecisionRecord, readQueueRecord, releaseJob, type DecisionTarget } from "../src/coord/protocol.js";
import { formatStatus } from "../src/format.js";
import { HALT_KEY } from "../src/github-quota.js";
import { askOwner } from "../src/line/finish.js";
import { machineIdentity } from "../src/machine.js";
import { createZeroMcpServer, type ZeroMcpOptions } from "../src/mcp/server.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const REPOSITORY = "me/zero-coord";
/** Real time: the panel and the chat open the factory with their own clock. */
const NOW = new Date();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
type Coord = ReturnType<typeof memoryCoord>;

/** A factory of the distributed test, with its probe passed and the line only A has unless told otherwise. */
function factory(machine: string, over: Record<string, unknown> = {}): FactoryContext {
  const ctx = testFactory({ level: "L2", isolation: "worktree", distributed: { repository: REPOSITORY, machine }, lines: [{ name: "demo", repo: gitRepo() }], ...over });
  ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: NOW.toISOString(), ok: true }));
  return ctx;
}

const pass = (ctx: FactoryContext, coord: Coord, now = NOW) => coordPass(ctx, coord, undefined, now);
const me = (ctx: FactoryContext) => machineIdentity(ctx.store, ctx.config);
const text = (ctx: FactoryContext) => formatStatus(factoryStatus(ctx), NOW);
const decisions = (coord: Coord) => [...coord.refs.keys()].filter((n) => n.startsWith("decisions/"));
const created = (coord: Coord, prefix: string) => coord.calls.filter((c) => c.startsWith(`create ${prefix}`)).length;
const put = (coord: Coord, name: string, data: unknown) => coord.refs.set(name, { name, sha: "a".repeat(40), data: typeof data === "string" ? data : JSON.stringify(data) });
const states = (ctx: FactoryContext) => outbox(ctx.store).map((e: OutboxEntry) => e.state);
const onlyOnA = () => factory("pc-a", { lines: [{ name: "tienda", repo: gitRepo() }] });

/** A's job waiting for an answer, and the other machines that know of it. */
async function waitingOnA(others: string[] = ["pc-b"], question: Parameters<typeof askOwner>[2] = { kind: "spec-ready", text: "¿Apruebo la especificación?" }) {
  const coord = memoryCoord();
  const a = onlyOnA();
  const { job } = requestWork(a, { text: "Agregar un buscador" });
  await claimJob(coord, job.id, me(a), NOW);
  const { askedAt } = askOwner(a, a.store.getJob(job.id)!, question).question!;
  await pass(a, coord);
  const rest = others.map((name) => factory(name));
  for (const ctx of rest) await pass(ctx, coord);
  return { coord, a, b: rest[0]!, c: rest[1]!, id: job.id, askedAt, ref: decisionRef({ job: job.id, askedAt }) };
}

async function proposedOnA() {
  const coord = memoryCoord();
  const a = onlyOnA();
  const b = factory("pc-b");
  const proposal = a.store.createProposal({ line: "tienda", title: "Cubrir <b>egress</b>", why: "falla", change: "tests", estimatedUsd: 0.5, paths: [] });
  await pass(a, coord);
  await pass(b, coord);
  return { coord, a, b, id: proposal.id, ref: decisionRef({ proposal: proposal.id }) };
}

async function chat(ctx: FactoryContext, opts: ZeroMcpOptions = {}) {
  const server = createZeroMcpServer(ctx.home, { autoStart: false, start: async () => false, ...opts });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  return async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]!.text;
}
const REMOTE: ZeroMcpOptions = { remote: { scope: ["zero:read", "zero:act"], client: "c" } };

async function panel(ctx: FactoryContext) {
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  return {
    get: async (path: string) => (await fetch(base + path, { headers: { cookie } })).text(),
    post: (path: string, body: Record<string, string>) => fetch(base + path, { method: "POST", headers: { cookie, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), redirect: "manual" }),
  };
}

/** The CLI on that machine, with a daemon said to be on its way so that none is started. */
function cli(ctx: FactoryContext, ...args: string[]) {
  ctx.store.setKv(LAUNCH_KEY, new Date(Date.now() + 600_000).toISOString());
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
  return { out: r.stdout + r.stderr, status: r.status };
}

describe("answering a job of another machine", () => {
  it("approves from B: A puts the job back in the queue with that approval, once", async () => {
    const { coord, a, b, id, ref, askedAt } = await waitingOnA();
    const r = await answerAnywhere(b, id, "approve", "dale");
    expect(r).toMatchObject({ sent: expect.stringContaining(`aprobar el trabajo ${id} en la máquina pc-a`) });
    expect(decisions(coord)).toEqual([]);
    expect(a.store.getJob(id)?.status).toBe("waiting");
    await pass(b, coord);
    expect(readDecisionRecord(coord.refs.get(ref)!)).toEqual({ target: { job: id, askedAt }, to: me(a).id, machine: me(b).id, name: "pc-b", at: expect.any(String), decision: "approve", note: "dale" });
    expect(text(b)).toContain(`- aprobar el trabajo ${id} en la máquina pc-a: publicado`);
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "queued", approvals: { spec: true } });
    expect(decisions(coord)).toEqual([]);

    // Asked again, the same decision answers nothing.
    askOwner({ ...a, now: () => later(1) }, a.store.getJob(id)!, { kind: "before-integrate", text: "¿Integro?" });
    await pass(a, coord);
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "waiting", approvals: { spec: true } });
    expect(a.store.getJob(id)!.approvals.integrate).toBeUndefined();
    expect(states(b)).toEqual(["attended"]);
    expect(created(coord, "decisions/")).toBe(1);
    expect(b.store.getJob(id)).toBeUndefined();
  });

  it("rejects from B with its reason, without this machine's paths or secrets", async () => {
    const { coord, a, b, id, ref } = await waitingOnA();
    const token = `ghp_${"a1B2".repeat(9)}`;
    await answerAnywhere(b, id, "reject", `No: mirá ${join(b.home.root, "x")} y ${token}`);
    await pass(b, coord);
    const { data } = coord.refs.get(ref)!;
    for (const hidden of [b.home.root, JSON.stringify(b.home.root).slice(1, -1), token]) expect(data).not.toContain(hidden);
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "stopped", reason: expect.stringContaining("No: mirá") });
  });

  it("answers a job this machine has imported in its queue where it waits", async () => {
    const coord = memoryCoord();
    const a = factory("pc-a");
    const b = factory("pc-b");
    const { job } = requestWork(a, { text: "Un cambio" });
    await pass(a, coord);
    await pass(b, coord);
    await claimJob(coord, job.id, me(a), NOW);
    askOwner(a, a.store.getJob(job.id)!, { kind: "spec-ready", text: "¿Sí?" });
    await pass(a, coord);
    await pass(b, coord);
    expect(b.store.getJob(job.id)?.status).toBe("queued");
    expect(await answerAnywhere(b, job.id, "approve")).toHaveProperty("sent");
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getJob(job.id)).toMatchObject({ status: "queued", approvals: { spec: true } });
    expect(b.store.getJob(job.id)).toMatchObject({ status: "queued", approvals: {} });
  });

  it("keeps the first decision published, and tells the other machine it was already answered", async () => {
    const { coord, a, b, c, id } = await waitingOnA(["pc-b", "pc-c"]);
    await answerAnywhere(b, id, "approve");
    await answerAnywhere(c, id, "reject");
    await pass(b, coord);
    await pass(c, coord);
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "queued", approvals: { spec: true } });
    expect(states(c)).toEqual(["late"]);
    expect(text(c)).toContain(`- rechazar el trabajo ${id} en la máquina pc-a: sin efecto: ya se había respondido`);
    expect(jobText(c, id)).toContain("ya se había respondido");
    // It is told for a day.
    await pass(c, coord, later(25 * 60));
    expect(states(c)).toEqual([]);
    expect(text(c)).not.toContain("ya se había respondido");
  });

  it("tells the same when the job's machine had already applied the first one", async () => {
    const { coord, a, b, c, id } = await waitingOnA(["pc-b", "pc-c"]);
    await answerAnywhere(b, id, "approve");
    await answerAnywhere(c, id, "reject");
    await pass(b, coord);
    await pass(a, coord);
    await pass(c, coord);
    expect(states(c)).toEqual(["late"]);
    expect(decisions(coord)).toEqual([]);
    expect(a.store.getJob(id)?.status).toBe("queued");
  });

  it("lets exactly one of two machines that publish at once win", async () => {
    const { coord, a, b, c, id } = await waitingOnA(["pc-b", "pc-c"]);
    await answerAnywhere(b, id, "approve");
    await answerAnywhere(c, id, "reject");
    await Promise.all([pass(b, coord), pass(c, coord)]);
    expect([...states(b), ...states(c)].sort()).toEqual(["late", "published"]);
    await pass(a, coord);
    expect(a.store.getJob(id)?.status).toBe(states(b)[0] === "published" ? "queued" : "stopped");
  });

  it("takes one decision per question from each machine", async () => {
    const { coord, b, id } = await waitingOnA();
    await answerAnywhere(b, id, "approve");
    await expect(answerAnywhere(b, id, "reject")).rejects.toThrow(`Eso ya lo decidiste desde esta máquina: aprobar el trabajo ${id}`);
    await pass(b, coord);
    await expect(answerAnywhere(b, id, "reject")).rejects.toThrow("Eso ya lo decidiste");
    expect(jobText(b, id)).toContain(`Desde esta máquina: aprobar el trabajo ${id} en la máquina pc-a: publicado`);
  });

  it("goes on from a pass that was cut after publishing", async () => {
    const { coord, a, b, id, ref } = await waitingOnA();
    await answerAnywhere(b, id, "approve");
    const before = b.store.kvWithPrefix("coord:outbox:")[0]!;
    await pass(b, coord);
    b.store.setKv(...before);
    await pass(b, coord);
    expect(states(b)).toEqual(["published"]);
    expect(coord.refs.has(ref)).toBe(true);
    await pass(a, coord);
    expect(a.store.getJob(id)?.status).toBe("queued");
  });

  it("gives no effect to a decision on an earlier question, a job that does not wait or another machine's", async () => {
    const { coord, a, b, id, askedAt } = await waitingOnA();
    const decision = (target: DecisionTarget, over: Record<string, unknown> = {}) => put(coord, decisionRef(target), { target, to: me(a).id, machine: me(b).id, name: "pc-b", at: NOW.toISOString(), decision: "approve", ...over });
    const { job: queued } = requestWork(a, { text: "En cola" });
    decision({ job: id, askedAt: new Date(Date.parse(askedAt) - 60_000).toISOString() });
    decision({ job: queued.id, askedAt });
    decision({ job: "00000000", askedAt });
    decision({ proposal: "00000000" });
    decision({ job: id, askedAt }, { to: "otra-maquina" });
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "waiting", approvals: {} });
    expect(a.store.getJob(queued.id)).toMatchObject({ status: "queued", approvals: {} });
    // What was for A is attended; what is for another machine stays.
    expect(decisions(coord)).toEqual([decisionRef({ job: id, askedAt })]);
  });

  it("drops an answer to a question that is over before publishing it", async () => {
    const { coord, a, b, id } = await waitingOnA();
    await answerAnywhere(b, id, "approve");
    askOwner({ ...a, now: () => later(1) }, a.store.getJob(id)!, { kind: "spec-ready", text: "¿Y ahora?" });
    await pass(a, coord);
    await pass(b, coord);
    expect(states(b)).toEqual(["late"]);
    expect(decisions(coord)).toEqual([]);
    // The new question takes its own answer.
    await answerAnywhere(b, id, "approve");
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getJob(id)?.status).toBe("queued");
  });

  it("gives no effect to records that do not read, and clears the one in the way", async () => {
    const { coord, a, b, id, ref, askedAt } = await waitingOnA();
    const good = { target: { job: id, askedAt }, to: me(a).id, machine: me(b).id, name: "pc-b", at: NOW.toISOString(), decision: "approve" };
    for (const bad of [
      "{no es json",
      { ...good, decision: "quizás" },
      { ...good, at: "ayer" },
      { ...good, name: "con\nrenglón" },
      { ...good, note: "\u001b[2J" },
      { ...good, note: "x".repeat(4001) },
      { ...good, to: "../x" },
      { ...good, target: { job: id, askedAt, proposal: "abc" } },
      { ...good, target: { job: id, askedAt: later(5).toISOString() } },
    ]) {
      put(coord, ref, bad);
      expect(readDecisionRecord(coord.refs.get(ref)!)).toBeUndefined();
      await pass(a, coord);
      expect(a.store.getJob(id)?.status).toBe("waiting");
      expect(decisions(coord)).toEqual([]);
    }
    put(coord, "decisions/otra-cosa", good);
    put(coord, ref, "{");
    await answerAnywhere(b, id, "approve");
    await pass(b, coord);
    expect(states(b)).toEqual(["pending"]);
    await pass(a, coord);
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getJob(id)?.status).toBe("queued");
    expect(decisions(coord)).toEqual(["decisions/otra-cosa"]);
    expect(readDecisionRecord({ name: ref, sha: "", data: JSON.stringify({ ...good, extra: 1, config: { level: "L3" } }) })).toEqual(good);
  });

  it("does not apply it to a copy of a job another machine took over", async () => {
    const { coord, a, b, id } = await waitingOnA();
    await answerAnywhere(b, id, "approve");
    await pass(b, coord);
    await claimJob(coord, id, { id: "maquina-d", name: "pc-d" }, later(60));
    await pass(a, coord, later(60));
    expect(a.store.getJob(id)?.status).toBe("waiting");
    expect(decisions(coord)).toEqual([]);
  });

  it("says it is delivered when the machine is back, and delivers it then", async () => {
    const { coord, a, b, id } = await waitingOnA();
    await pass(b, coord, later(30));
    const r = await answerAnywhere(b, id, "approve");
    expect(r).toMatchObject({ sent: expect.stringContaining("La máquina pc-a está apagada o caída: se entrega cuando vuelva") });
    await pass(b, coord, later(30));
    await pass(a, coord, later(90));
    expect(a.store.getJob(id)?.status).toBe("queued");
  });

  it("refuses a job that does not wait or that nobody knows", async () => {
    const { coord, a, b, id } = await waitingOnA();
    const { job } = requestWork(a, { text: "En cola" });
    await pass(a, coord);
    await pass(b, coord);
    await expect(answerAnywhere(b, job.id, "approve")).rejects.toThrow("no está esperando una respuesta");
    await expect(answerAnywhere(b, "00000000", "approve")).rejects.toThrow("No existe el trabajo 00000000.");
    expect(outbox(b.store)).toEqual([]);
    // On its own machine it is answered at once, as always.
    expect(await answerAnywhere(a, id, "approve")).toMatchObject({ job: { status: "queued" } });
    expect(outbox(a.store)).toEqual([]);
  });

  it("waits for GitHub's pause to end, and is published once", async () => {
    const { coord, a, b, id } = await waitingOnA();
    b.store.setKv(HALT_KEY, JSON.stringify({ until: later(10).toISOString(), why: "límite" }));
    await answerAnywhere(b, id, "approve");
    await pass(b, coord, later(1));
    expect(created(coord, "decisions/")).toBe(0);
    expect(states(b)).toEqual(["pending"]);
    await pass(b, coord, later(11));
    await pass(b, coord, later(12));
    expect(created(coord, "decisions/")).toBe(1);
    await pass(a, coord, later(12));
    expect(a.store.getJob(id)?.status).toBe("queued");
  });

  it("changes no configuration, egress rule nor autonomy level", async () => {
    const { coord, a, b, id } = await waitingOnA(["pc-b"], { kind: "egress-suspicious", text: "¿Dejo salir?", data: { seq: 3 } });
    const before = readFileSync(a.home.config, "utf8");
    const config = JSON.stringify(a.config);
    await answerAnywhere(b, id, "approve");
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "queued", approvals: { egressSeq: 3 } });
    expect(readFileSync(a.home.config, "utf8")).toBe(before);
    expect(JSON.stringify(a.config)).toBe(config);
  });

  it("is taken from zero approve, zero_answer and the panel", async () => {
    for (const via of ["cli", "cli-reject", "chat", "panel", "panel-list"] as const) {
      const { coord, a, b, id } = await waitingOnA();
      if (via === "cli" || via === "cli-reject") expect(cli(b, "approve", id, ...(via === "cli" ? [] : ["--reject", "--note", "no va"]))).toMatchObject({ status: 0, out: expect.stringContaining(`el trabajo ${id} en la máquina pc-a`) });
      else if (via === "chat") expect(await (await chat(b))("zero_answer", { job: id, decision: "approve" })).toContain(`aprobar el trabajo ${id} en la máquina pc-a`);
      else {
        const p = await panel(b);
        const path = via === "panel" ? `/job/${id}` : "/requests";
        expect(await p.get(path)).toContain(`action="/job/${id}/answer"`);
        const r = await p.post(via === "panel" ? `/job/${id}/answer` : `/requests/${id}/answer`, { decision: "approve" });
        expect(decodeURIComponent(r.headers.get("location")!)).toContain(`aprobar el trabajo ${id} en la máquina pc-a`);
        expect(await p.get(path)).not.toContain(`action="/job/${id}/answer"`);
        expect(await p.get("/")).toContain(`aprobar el trabajo ${id} en la máquina pc-a`);
      }
      await pass(b, coord);
      await pass(a, coord);
      expect(a.store.getJob(id)).toMatchObject(via === "cli-reject" ? { status: "stopped", reason: expect.stringContaining("no va") } : { status: "queued", approvals: { spec: true } });
    }
  }, 60_000);
});

describe("delicate answers from the remote chat", () => {
  const protectedPath = { kind: "protected-path" as const, text: "Toca archivos protegidos", data: { paths: ["package.json"] } };

  it("holds the approval of protected paths of another machine's job until it is confirmed", async () => {
    const { coord, a, b, id } = await waitingOnA(["pc-b"], protectedPath);
    const held = await (await chat(b, REMOTE))("zero_answer", { job: id, decision: "approve" });
    expect(held).toContain("No lo hice todavía");
    expect(pendingRemoteActions(b)).toMatchObject([{ tool: "zero_answer", args: { job: id } }]);
    await pass(b, coord);
    expect(decisions(coord)).toEqual([]);
    expect(outbox(b.store)).toEqual([]);
    const r = await confirmRemoteAction(b, pendingRemoteActions(b)[0]!.id);
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining("en la máquina pc-a") });
    await pass(b, coord);
    expect(decisions(coord)).toHaveLength(1);
    await pass(a, coord);
    expect(a.store.getJob(id)).toMatchObject({ status: "queued", approvals: { protectedPaths: ["package.json"] } });
  });

  it("answers nothing when the question changed before the confirmation", async () => {
    const { coord, a, b, id } = await waitingOnA(["pc-b"], protectedPath);
    await (await chat(b, REMOTE))("zero_answer", { job: id, decision: "approve" });
    askOwner({ ...a, now: () => later(1) }, a.store.getJob(id)!, { ...protectedPath, data: { paths: ["otro"] } });
    await pass(a, coord);
    await pass(b, coord);
    await expect(confirmRemoteAction(b, pendingRemoteActions(b)[0]!.id)).rejects.toThrow("ya no es la misma");
    expect(outbox(b.store)).toEqual([]);
  });

  it("lets a rejection and the other questions through, as with a local job", async () => {
    const first = await waitingOnA(["pc-b"], protectedPath);
    expect(await (await chat(first.b, REMOTE))("zero_answer", { job: first.id, decision: "reject" })).toContain("rechazar el trabajo");
    const second = await waitingOnA();
    expect(await (await chat(second.b, REMOTE))("zero_answer", { job: second.id, decision: "approve" })).toContain("aprobar el trabajo");
  });

  it("holds the decision on another machine's proposal", async () => {
    const { coord, a, b, id } = await proposedOnA();
    expect(await (await chat(b, REMOTE))("zero_proposal_decide", { id, decision: "approve" })).toContain("No lo hice todavía");
    await pass(b, coord);
    expect(decisions(coord)).toEqual([]);
    await confirmRemoteAction(b, pendingRemoteActions(b)[0]!.id);
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getProposal(id)?.status).toBe("approved");
  });
});

describe("deciding a proposal of another machine", () => {
  it("approves from B: A creates exactly one job out of it", async () => {
    const { coord, a, b, id } = await proposedOnA();
    expect(proposalsElsewhere(b)).toMatchObject([{ id, machine: { name: "pc-a", alive: true } }]);
    expect(await decideProposal(b, id, "approve")).toMatchObject({ sent: expect.stringContaining(`aprobar la propuesta ${id} en la máquina pc-a`) });
    for (let i = 0; i < 2; i++) {
      await pass(b, coord);
      await pass(a, coord);
    }
    expect(a.store.listJobs()).toMatchObject([{ source: { kind: "night-shift", proposal: id }, status: "queued" }]);
    expect(a.store.getProposal(id)).toMatchObject({ status: "approved", decidedBy: "owner" });
    expect(b.store.listJobs()).toEqual([]);
    expect(decisions(coord)).toEqual([]);
    await pass(b, coord);
    expect(proposalsElsewhere(b)).toEqual([]);
    expect(states(b)).toEqual(["attended"]);
  });

  it("rejects from B with its reason", async () => {
    const { coord, a, b, id } = await proposedOnA();
    await decideProposal(b, id, "reject", "no conviene");
    await pass(b, coord);
    await pass(a, coord);
    expect(a.store.getProposal(id)).toMatchObject({ status: "rejected", note: "no conviene" });
    expect(a.store.listJobs()).toEqual([]);
  });

  it("creates no other job when A had already decided it", async () => {
    const { coord, a, b, id } = await proposedOnA();
    await decideProposal(b, id, "approve");
    await pass(b, coord);
    await decideProposal(a, id, "approve");
    await pass(a, coord);
    expect(a.store.listJobs()).toHaveLength(1);
    expect(decisions(coord)).toEqual([]);
    // Nor one the night shift took on its own meanwhile.
    const taken = a.store.createProposal({ line: "tienda", title: "Otra", why: "x", change: "y", estimatedUsd: 1, paths: [] });
    const { job } = requestWork(a, { text: "Otra", source: { kind: "night-shift", proposal: taken.id, autonomy: "build" } });
    a.store.updateProposal(taken.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
    askOwner(a, a.store.getJob(job.id)!, { kind: "before-integrate", text: "¿Integro?" });
    put(coord, decisionRef({ proposal: taken.id }), { target: { proposal: taken.id }, to: me(a).id, machine: me(b).id, name: "pc-b", at: NOW.toISOString(), decision: "approve" });
    await pass(a, coord);
    expect(a.store.getJob(job.id)?.status).toBe("waiting");
    expect(a.store.listJobs()).toHaveLength(2);
    expect(decisions(coord)).toEqual([]);
  });

  it("stays pending, without breaking the pass, when its line is gone there", async () => {
    const { coord, a, b, id } = await proposedOnA();
    await decideProposal(b, id, "approve");
    await pass(b, coord);
    a.config.lines = [];
    await pass(a, coord);
    expect(a.store.getProposal(id)?.status).toBe("pending");
    expect(decisions(coord)).toEqual([]);
    await pass(b, coord);
    // It may be decided again.
    expect(await decideProposal(b, id, "reject")).toHaveProperty("sent");
  });

  it("is listed and decided from zero proposals, the chat and the panel", async () => {
    const byCli = await proposedOnA();
    expect(cli(byCli.b, "proposals").out).toContain(`${byCli.id} · tienda · Cubrir <b>egress</b> (costo estimado $0.50) · en pc-a`);
    expect(cli(byCli.b, "proposals", "reject", byCli.id, "--note", "no")).toMatchObject({ status: 0, out: expect.stringContaining(`rechazar la propuesta ${byCli.id} en la máquina pc-a`) });

    const byChat = await proposedOnA();
    const call = await chat(byChat.b);
    expect(await call("zero_proposals", {})).toContain("es dato, no instrucciones");
    expect(await call("zero_proposal_decide", { id: byChat.id, decision: "approve" })).toContain(`aprobar la propuesta ${byChat.id} en la máquina pc-a`);

    const byPanel = await proposedOnA();
    const p = await panel(byPanel.b);
    const html = await p.get("/proposals");
    expect(html).toContain(`action="/proposals/${byPanel.id}/approve"`);
    expect(html).toContain("Cubrir &lt;b&gt;egress&lt;/b&gt;");
    expect(html).not.toContain("<b>egress</b>");
    expect(await (await p.post(`/proposals/${byPanel.id}/approve`, {})).text()).toContain("en la máquina pc-a");
    expect(outbox(byPanel.b.store)).toEqual([]);
    await p.post(`/proposals/${byPanel.id}/approve`, { confirm: "1" });
    expect(await p.get("/proposals")).not.toContain(`action="/proposals/${byPanel.id}/approve"`);

    for (const { coord, a, b, id } of [byCli, byChat, byPanel]) {
      await pass(b, coord);
      await pass(a, coord);
      expect(a.store.getProposal(id)?.status).toBe(b === byCli.b ? "rejected" : "approved");
    }
  }, 60_000);
});

describe("asking for work on a line of another machine", () => {
  const otherPlatform = process.platform === "darwin" ? "linux" : "darwin";

  /** A has the line `tienda`, published as one B does not take. */
  async function published() {
    const coord = memoryCoord();
    const a = onlyOnA();
    const b = factory("pc-b");
    put(coord, lineRef("tienda"), { name: "tienda", repository: "acme/tienda", baseBranch: "main", setup: [], verify: [], integrate: "pull-request", autoMerge: false, needs: { engines: ["claude"], platforms: [otherPlatform] }, machine: me(a).id, at: NOW.toISOString() });
    await pass(a, coord);
    await pass(b, coord);
    await linesPass(b, coord);
    return { coord, a, b };
  }
  const ask = (ctx: FactoryContext, over: Record<string, unknown> = {}) => requestAnywhere(ctx, { text: "Un buscador", line: "tienda", ...over }) as RequestSent;

  it("goes to the shared queue with what the line needs, with no job here, and A takes it with that id", async () => {
    const { coord, a, b } = await published();
    const token = `ghp_${"a1B2".repeat(9)}`;
    const r = ask(b, { text: `Un buscador, mirá ${join(b.home.root, "x")} y ${token}`, priority: "alta" });
    expect(r.sent).toContain(`trabajo ${r.id} en la línea "tienda"`);
    expect(b.store.getJob(r.id)).toBeUndefined();
    // B tells of it from the start, before any other machine does.
    expect(factoryView(b, b.store.listJobs())).toMatchObject([{ id: r.id, line: "tienda", status: "queued", priority: "alta", machine: { name: "pc-b" } }]);
    expect(jobText(b, r.id)).toContain("todavía sin publicar");
    await pass(b, coord);
    const record = readQueueRecord(coord.refs.get(queueRef(r.id))!)!;
    expect(record).toMatchObject({ id: r.id, line: "tienda", kind: "request", priority: "alta", needs: { box: false, engines: ["claude"] } });
    for (const hidden of [b.home.root, token]) expect(record.request).not.toContain(hidden);
    expect(text(b)).toContain(`- ${r.id} · tienda`);
    await pass(a, coord);
    expect(a.store.getJob(r.id)).toMatchObject({ status: "queued", line: "tienda", priority: "alta" });
    await pass(b, coord);
    expect(b.store.listJobs()).toEqual([]);
    expect(factoryView(b, [])).toMatchObject([{ id: r.id, status: "queued", machine: { name: "pc-a" } }]);
    expect(outbox(b.store)).toEqual([]);

    // And to its end, once.
    await claimJob(coord, r.id, me(a), NOW);
    a.store.finishJob(r.id, "delivered");
    await releaseJob(coord, r.id, me(a), "delivered", NOW);
    await pass(a, coord);
    await pass(b, coord);
    expect(factoryView(b, [])).toMatchObject([{ id: r.id, status: "delivered", machine: { name: "pc-a" } }]);
    expect(b.store.listJobs()).toEqual([]);
    expect(created(coord, queueRef(r.id))).toBe(1);
  });

  it("keeps showing a published request no machine told of, and forgets it in the end", async () => {
    const { coord, b } = await published();
    const r = ask(b);
    await pass(b, coord);
    await pass(b, coord, later(60));
    expect(jobText(b, r.id)).toContain("falta que una máquina lo tome");
    expect(requestsView(b, { line: "tienda" }).away).toMatchObject([{ job: { id: r.id } }]);
    await pass(b, coord, later(8 * 24 * 60));
    expect(outbox(b.store)).toEqual([]);
  });

  it("refuses a line that is neither here nor published, naming the known ones", async () => {
    const { b } = await published();
    expect(requestLines(b)).toEqual(["demo", "tienda"]);
    expect(() => ask(b, { line: "fantasma" })).toThrow('No existe la línea "fantasma". Líneas: demo, tienda.');
    expect(outbox(b.store)).toEqual([]);
  });

  it("refuses what it would refuse on a line of its own", async () => {
    const { b } = await published();
    expect(() => ask(b, { text: " " })).toThrow("El pedido está vacío.");
    expect(() => ask(b, { priority: "ya" })).toThrow("No conozco la prioridad");
    expect(() => ask(b, { text: "x".repeat(100_001) })).toThrow("100000 caracteres");
    expect(outbox(b.store)).toEqual([]);
  });

  it("leaves this machine's lines as always, and everything as always without distributed", async () => {
    const { coord, b } = await published();
    expect(requestAnywhere(b, { text: "Acá", line: "demo" })).toMatchObject({ job: { line: "demo", status: "queued" } });
    expect(requestAnywhere(b, { text: "Acá" })).toMatchObject({ job: { line: "demo" } });
    expect(outbox(b.store)).toEqual([]);
    await pass(b, coord);
    const r = ask(b);
    b.config.distributed = undefined;
    expect(() => ask(b)).toThrow('No existe la línea "tienda". Líneas: demo.');
    expect(requestLines(b)).toEqual(["demo"]);
    expect(factoryStatus(b).sent).toBeUndefined();
    expect(text(b)).not.toContain(r.id);
    expect(text(b)).not.toContain("Para otras máquinas");
  });

  it("is kept during GitHub's pause and published once after it", async () => {
    const { coord, a, b } = await published();
    b.store.setKv(HALT_KEY, JSON.stringify({ until: later(10).toISOString(), why: "límite" }));
    const r = ask(b);
    await pass(b, coord, later(1));
    expect(coord.refs.has(queueRef(r.id))).toBe(false);
    await pass(b, coord, later(11));
    await pass(b, coord, later(12));
    expect(created(coord, queueRef(r.id))).toBe(1);
    await pass(a, coord, later(12));
    expect(a.store.getJob(r.id)?.status).toBe("queued");
  });

  it("is taken from zero request, zero_request and the panel", async () => {
    const { coord, a, b } = await published();
    expect(cli(b, "request", "Desde", "la", "terminal", "--line", "tienda")).toMatchObject({ status: 0, out: expect.stringContaining('en la línea "tienda", que no está en esta máquina') });
    expect(await (await chat(b))("zero_request", { text: "Desde el chat", line: "tienda" })).toContain('en la línea "tienda"');
    const p = await panel(b);
    expect(await p.get("/")).toContain("<option>tienda</option>");
    expect(await p.get("/requests")).toContain(`<option value="tienda">`);
    const free = await p.post("/request", { text: "Desde el resumen", line: "tienda" });
    const to = free.headers.get("location")!;
    expect(to).toMatch(/^\/job\/[0-9a-f]{8}\?/);
    expect(await p.get(to.split("?")[0]!)).toContain("todavía sin publicar");
    await p.post("/requests", { type: "fix", title: "Desde pedidos", line: "tienda" });
    expect(b.store.listJobs()).toEqual([]);
    await pass(b, coord);
    await pass(a, coord);
    const names = a.store.listJobs().map((j) => j.request.split("\n")[0]);
    expect(names.sort()).toEqual(["Desde el chat", "Desde el resumen", "Desde la terminal", "Desde pedidos"]);
  }, 60_000);
});
