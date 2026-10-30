import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { proposalsView, requestWork, type FactoryContext } from "../src/app.js";
import { askOwner, finalizeJob } from "../src/line/finish.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel() {
  const ctx = testFactory({
    level: "L2",
    isolation: "worktree",
    nightShift: { autonomy: "propose" },
    lines: [
      { name: "tienda", repo: gitRepo(), nightShift: { autonomy: "build" } },
      { name: "blog", repo: gitRepo() },
    ],
  });
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string) => fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const post = (path: string, form: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  return { ctx, get, post };
}

const idea = (line: string, title: string) => ({ line, title, why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, paths: ["src/x.ts"] });

/** A proposal the night shift took on its own, with its job. */
function autonomous(ctx: FactoryContext, title: string) {
  const p = ctx.store.createProposal(idea("tienda", title));
  const { job } = requestWork(ctx, { text: title, line: "tienda", source: { kind: "night-shift", proposal: p.id, autonomy: "build" } });
  ctx.store.updateProposal(p.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
  return { proposal: p, job };
}

describe("panel proposals tab", () => {
  it("groups each line's proposals by stage, with the issue, rejection reason, research note and autonomy", async () => {
    const p = await panel();
    const pending = p.ctx.store.createProposal({ ...idea("tienda", "Cubrir egress"), researchNote: "n1", thirdParty: true });
    p.ctx.store.setProposalIssue(pending.id, { number: 7, url: "https://github.com/o/r/issues/7" });
    const built = autonomous(p.ctx, "Agregar /health");
    askOwner(p.ctx, built.job, { kind: "before-integrate", text: "¿Lo integro?" }, { onTimeout: "reject" });
    const done = autonomous(p.ctx, "Logs ordenados");
    await finalizeJob(p.ctx, p.ctx.store.getJob(done.job.id)!, "delivered", { delivery: { mode: "branch", branch: "zero/x" } });
    const rejected = p.ctx.store.createProposal(idea("blog", "Cambiar tema"));
    p.ctx.store.updateProposal(rejected.id, { status: "rejected", note: "no me gusta", decidedBy: "owner" });

    const view = proposalsView(p.ctx);
    expect(view.lines.map((l) => [l.line, l.autonomy])).toEqual([["tienda", "build"], ["blog", "propose"]]);
    const stage = (id: string) => view.lines.flatMap((l) => l.proposals).find((x) => x.id === id);
    expect(stage(pending.id)).toMatchObject({ stage: "pending", awaitsIntegration: false });
    expect(stage(built.proposal.id)).toMatchObject({ stage: "building", awaitsIntegration: true });
    expect(stage(done.proposal.id)).toMatchObject({ stage: "delivered" });
    expect(stage(rejected.id)).toMatchObject({ stage: "rejected", note: "no me gusta" });

    const r = await p.get("/proposals");
    expect(r.status).toBe(200);
    const html = await r.text();
    for (const text of ["Pendientes", "Construyéndose", "Entregadas", "Rechazadas", "no me gusta", "nota de investigación n1", "build: se construye sola", "propose: cada propuesta espera", "Aprobar e integrar"]) expect(html).toContain(text);
    expect(html).toContain("https://github.com/o/r/issues/7");
    expect(html).toContain(`/proposals/${pending.id}/approve`);
    expect(html).toContain(`/proposals/${built.proposal.id}/reject`);
    expect(html).not.toContain(`/proposals/${done.proposal.id}/approve`);
    expect(html).not.toContain(`/proposals/${rejected.id}/approve`);
    expect(await (await p.get("/")).text()).toContain(`href="/proposals"`);
  });

  it("asks for confirmation before approving, then opens the job", async () => {
    const p = await panel();
    const proposal = p.ctx.store.createProposal(idea("blog", "Cubrir egress"));
    const ask = await p.post(`/proposals/${proposal.id}/approve`);
    expect(ask.status).toBe(200);
    const html = await ask.text();
    expect(html).toContain("¿Aprobar «Cubrir egress»?");
    expect(html).toContain(`name="confirm" value="1"`);
    expect(p.ctx.store.getProposal(proposal.id)!.status).toBe("pending");
    expect(p.ctx.store.listJobs()).toHaveLength(0);

    const ok = await p.post(`/proposals/${proposal.id}/approve`, { confirm: "1" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toMatch(/^\/proposals\?msg=/);
    const stored = p.ctx.store.getProposal(proposal.id)!;
    expect(stored).toMatchObject({ status: "approved", decidedBy: "owner" });
    expect(p.ctx.store.getJob(stored.jobId!)!.source).toMatchObject({ kind: "night-shift", proposal: proposal.id });
  });

  it("approving a built proposal lets its job integrate", async () => {
    const p = await panel();
    const { proposal, job } = autonomous(p.ctx, "Agregar /health");
    askOwner(p.ctx, job, { kind: "before-integrate", text: "¿Lo integro?" }, { onTimeout: "reject" });
    expect(await (await p.post(`/proposals/${proposal.id}/approve`)).text()).toContain("ya está construido");
    expect(p.ctx.store.getJob(job.id)!.status).toBe("waiting");
    await p.post(`/proposals/${proposal.id}/approve`, { confirm: "1" });
    expect(p.ctx.store.getJob(job.id)!.status).toBe("queued");
  });

  it("rejects with the owner's reason and stops a built job", async () => {
    const p = await panel();
    const { proposal, job } = autonomous(p.ctx, "Agregar /health");
    askOwner(p.ctx, job, { kind: "before-integrate", text: "¿Lo integro?" }, { onTimeout: "reject" });
    const r = await p.post(`/proposals/${proposal.id}/reject`, { note: "ya no hace falta" });
    expect(r.status).toBe(303);
    expect(p.ctx.store.getProposal(proposal.id)).toMatchObject({ status: "rejected", note: "ya no hace falta" });
    expect(p.ctx.store.getJob(job.id)!.status).toBe("stopped");
  });

  it("sends errors back to the tab", async () => {
    const p = await panel();
    const proposal = p.ctx.store.createProposal(idea("blog", "Cubrir egress"));
    await p.post(`/proposals/${proposal.id}/reject`);
    const again = await p.post(`/proposals/${proposal.id}/approve`, { confirm: "1" });
    expect(again.status).toBe(303);
    expect(decodeURIComponent(again.headers.get("location")!)).toContain("ya fue rechazada");
  });
});
