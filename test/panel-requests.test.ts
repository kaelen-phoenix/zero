import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { requestsView, requestWork } from "../src/app.js";
import { askOwner } from "../src/line/finish.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, tempDir, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel() {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: tempDir() }, { name: "blog", repo: tempDir() }] });
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = { cookie }) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  return { ctx, get, post };
}

/** The list part of the page (below the filter form), where job rows live. */
const list = (html: string) => html.slice(html.indexOf('<section class="requests">'));
const rowOf = (html: string, id: string) => {
  const start = html.indexOf(`id="request-${id}"`);
  if (start < 0) return "";
  const end = html.indexOf('id="request-', start + 1);
  return html.slice(start, end < 0 ? undefined : end);
};

describe("typed requests", () => {
  it("composes title, type and description into the request", () => {
    const ctx = testFactory({ lines: [{ name: "tienda", repo: tempDir() }] });
    const { job } = requestWork(ctx, { type: "fix", title: " Botón roto ", description: " El botón de pagar no responde ", line: "tienda" });
    expect(ctx.store.listJobs()).toHaveLength(1);
    expect(job).toMatchObject({ line: "tienda", status: "queued", request: "Botón roto\n\nTipo de pedido: arreglo\n\nEl botón de pagar no responde" });
    expect(requestWork(ctx, { type: "docs", title: "README" }).job.request).toBe("README\n\nTipo de pedido: documentación");
  });

  it("refuses an unknown type or an empty title and creates nothing", () => {
    const ctx = testFactory({ lines: [{ name: "tienda", repo: tempDir() }] });
    expect(() => requestWork(ctx, { type: "x", title: "algo" })).toThrow(/Tipo de pedido desconocido/);
    expect(() => requestWork(ctx, { type: "feature", title: " " })).toThrow(/título/);
    expect(ctx.store.listJobs()).toHaveLength(0);
  });

  it("keeps plain requests as they were", () => {
    const ctx = testFactory({ lines: [{ name: "tienda", repo: tempDir() }] });
    expect(requestWork(ctx, { text: "agregá un descuento" }).job.request).toBe("agregá un descuento");
  });
});

describe("requests view", () => {
  it("tells each job's age relative to now", () => {
    const ctx = testFactory({ lines: [{ name: "tienda", repo: tempDir() }] });
    const { job } = requestWork(ctx, { text: "x" });
    const at = new Date(job.createdAt).getTime();
    const age = (ms: number) => requestsView(ctx, {}, new Date(at + ms)).rows[0]!.age;
    expect(age(3 * 3_600_000)).toBe("hace 3 h");
    expect(age(5 * 60_000)).toBe("hace 5 min");
    expect(age(3 * 86_400_000)).toBe("hace 3 días");
  });

  it("reads every job, not only the store's first 1000", () => {
    const ctx = testFactory({ lines: [{ name: "tienda", repo: tempDir() }] });
    for (let i = 0; i < 1001; i++) ctx.store.createJob({ line: "tienda", kind: "request", request: `pedido ${i}`, budgetUsd: 1 });
    const view = requestsView(ctx);
    expect(view.rows).toHaveLength(200);
    expect(view.rows[0]!.job.request).toBe("pedido 1000");
  });
});

describe("panel requests section", () => {
  it("needs a session", async () => {
    const p = await panel();
    requestWork(p.ctx, { text: "x", line: "tienda" });
    const r = await p.get("/requests", {});
    expect(r.status).toBe(401);
    const html = await r.text();
    expect(html).toContain("Panel de tu fábrica");
    expect(html).not.toContain("tienda");
    expect((await p.post("/requests", { type: "fix", title: "x" }, {})).status).toBe(401);
    expect(p.ctx.store.listJobs()).toHaveLength(1);
  });

  it("is in the menu and shows the typed form", async () => {
    const p = await panel();
    const r = await p.get("/requests");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Pedidos");
    expect(await (await p.get("/")).text()).toContain('href="/requests"');
    expect(html).toContain('<form method="post" action="/requests">');
    expect(html).toContain('<option value="tienda">tienda</option>');
    expect(html).toContain('<option value="blog">blog</option>');
    const types = { feature: "función nueva", fix: "arreglo", security: "seguridad", design: "diseño", docs: "documentación", other: "otro" };
    for (const [value, label] of Object.entries(types)) expect(html).toContain(`<option value="${value}">${label}</option>`);
    expect(html.match(/<select id="q-type" name="type">(.*?)<\/select>/)![1]!.match(/<option/g)).toHaveLength(6);
    expect(html).toMatch(/<input[^>]*name="title"[^>]*required/);
    expect(html).toContain('<textarea id="q-desc" name="description">');
  });

  it("creates a typed job from the form", async () => {
    const p = await panel();
    const r = await p.post("/requests", { line: "tienda", type: "security", title: "Revisar login", description: "x" });
    expect(r.status).toBe(303);
    const [job] = p.ctx.store.listJobs();
    expect(r.headers.get("location")).toMatch(new RegExp(`^/job/${job!.id}\\?msg=`));
    expect(job!.line).toBe("tienda");
    expect(job!.request).toContain("Tipo de pedido: seguridad");
  });

  it("returns validation errors to the section and refuses other origins", async () => {
    const p = await panel();
    const r = await p.post("/requests", { line: "tienda", type: "fix", title: "" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^\/requests\?msg=/);
    const evil = await p.post("/requests", { line: "tienda", type: "fix", title: "x" }, { cookie: `zero_panel=${sessionFor(panelKey(p.ctx.secrets))}`, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("lists jobs newest first, escaped, with line, status and age", async () => {
    const p = await panel();
    const first = requestWork(p.ctx, { text: "<script>x</script>", line: "tienda" }).job;
    const second = requestWork(p.ctx, { text: "segundo", line: "blog" }).job;
    const html = list(await (await p.get("/requests")).text());
    expect(html.indexOf(second.id)).toBeGreaterThan(-1);
    expect(html.indexOf(second.id)).toBeLessThan(html.indexOf(first.id));
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x</script>");
    for (const [job, line] of [[first, "tienda"], [second, "blog"]] as const) {
      const row = rowOf(html, job.id);
      expect(row).toContain(line);
      expect(row).toContain("en cola");
      expect(row).toMatch(/· hace /);
      expect(row).toContain(`href="/job/${job.id}"`);
    }
  });

  it("filters by line and status, keeping the selection", async () => {
    const p = await panel();
    const shop = requestWork(p.ctx, { text: "a", line: "tienda" }).job;
    const blog = requestWork(p.ctx, { text: "b", line: "blog" }).job;
    p.ctx.store.updateJob(blog.id, { status: "delivered" });
    const byLine = await (await p.get("/requests?line=blog")).text();
    expect(list(byLine)).toContain(blog.id);
    expect(list(byLine)).not.toContain(shop.id);
    expect(byLine).toContain('<option value="blog" selected>');
    const done = await (await p.get("/requests?estado=terminados")).text();
    expect(list(done)).toContain(blog.id);
    expect(list(done)).not.toContain(shop.id);
    expect(done).toContain('<option value="terminados" selected>');
    const unknown = await p.get("/requests?estado=zzz");
    expect(unknown.status).toBe(200);
    const all = list(await unknown.text());
    expect(all).toContain(blog.id);
    expect(all).toContain(shop.id);
  });

  it("answers a pending question from the list", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x", line: "tienda" });
    askOwner(p.ctx, job, { kind: "before-integrate", text: "¿Lo integro?" });
    const row = rowOf(list(await (await p.get("/requests")).text()), job.id);
    expect(row).toContain("¿Lo integro?");
    expect(row).toContain(`action="/requests/${job.id}/answer"`);
    const r = await p.post(`/requests/${job.id}/answer`, { decision: "approve" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^\/requests/);
    expect(p.ctx.store.getJob(job.id)).toMatchObject({ status: "queued", approvals: { integrate: true } });
    const again = await p.post(`/requests/${job.id}/answer`, { decision: "approve" });
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toMatch(/^\/requests\?msg=/);
  });

  it("stops a job only after confirmation", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x", line: "tienda" });
    expect(rowOf(list(await (await p.get("/requests")).text()), job.id)).toContain(`action="/requests/${job.id}/stop"`);
    const ask = await p.post(`/requests/${job.id}/stop`, {});
    expect(ask.status).toBe(200);
    const html = await ask.text();
    expect(html).toContain('<input type="hidden" name="confirm" value="1">');
    expect(html).toContain('href="/requests"');
    expect(p.ctx.store.getJob(job.id)!.status).toBe("queued");
    const r = await p.post(`/requests/${job.id}/stop`, { confirm: "1" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^\/requests/);
    expect(p.ctx.store.getJob(job.id)!.status).toBe("stopped");
  });

  it("offers no actions on finished jobs", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x", line: "tienda" });
    p.ctx.store.updateJob(job.id, { status: "delivered" });
    const html = await (await p.get("/requests")).text();
    expect(html).toContain(`href="/job/${job.id}"`);
    expect(html).not.toContain(`/requests/${job.id}/stop`);
    expect(html).not.toContain(`/requests/${job.id}/answer`);
  });
});
