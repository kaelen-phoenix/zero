import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { productionLine, requestWork, type FactoryContext } from "../src/app.js";
import { askOwner } from "../src/line/finish.js";
import { log } from "../src/log.js";
import { linePage, lineView } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer, type PanelOptions } from "../src/panel/server.js";
import { newId, type JobPatch } from "../src/state/store.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const factory = () => testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo(), maxAttempts: 3 }] });

async function panel(ctx: FactoryContext, opts: Partial<PanelOptions> = {}) {
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets), ...opts });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  return (path: string, headers: Record<string, string> = { cookie }, signal?: AbortSignal) => fetch(base + path, { headers, redirect: "manual", signal });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads a `/line/events` response as it arrives: data events (lines joined like EventSource does) and comments. */
function events(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const data: string[] = [];
  const comments: string[] = [];
  let buffer = "";
  let done = false;
  const pump = (async () => {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        buffer += decoder.decode(r.value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) > -1) {
          const lines = buffer.slice(0, end).split("\n");
          buffer = buffer.slice(end + 2);
          comments.push(...lines.filter((l) => l.startsWith(":")));
          const payload = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
          if (payload.length) data.push(payload.join("\n"));
        }
      }
    } catch {
      // aborted by the test
    }
    done = true;
  })();
  /** Waits until `ok` holds and returns how long it took; fails after `ms`. */
  const until = async (ok: () => boolean, ms = 2000) => {
    const start = Date.now();
    while (!ok()) {
      if (Date.now() - start > ms) throw new Error("timed out waiting for the stream");
      await wait(10);
    }
    return Date.now() - start;
  };
  return { data, comments, until, pump, isDone: () => done };
}

const T0 = Date.parse("2026-01-01T10:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

/** Writes a finished (or open) span for a job, as the runner's tracer would. */
function span(ctx: FactoryContext, jobId: string, name: string, o: { parent?: string; from?: number; to?: number; status?: "ok" | "error"; attrs?: Record<string, unknown> } = {}) {
  const id = newId() + newId();
  ctx.store.insertSpan({
    id,
    jobId,
    parentId: o.parent ?? `job-${jobId}`,
    name,
    start: at(o.from ?? 0),
    end: o.status ? at(o.to ?? (o.from ?? 0) + 1) : undefined,
    status: o.status,
    attrs: o.attrs ?? {},
  });
  return id;
}

function job(ctx: FactoryContext, text: string, patch: JobPatch = {}) {
  const { job } = requestWork(ctx, { text });
  return ctx.store.updateJob(job.id, patch);
}

describe("a line's own agents on the production line", () => {
  it("place a job in an agent that writes at build, and in a reviewer at security", () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", agents: [{ name: "site", type: "build" }], lines: [{ name: "tienda", repo: gitRepo(), agents: [{ name: "docs", type: "build" }, { name: "a11y" }] }] });
    const rowAt = (station: string) => {
      const { id } = job(ctx, station, { status: "running", station });
      return productionLine(ctx).rows.find((r) => r.id === id)!;
    };
    expect(rowAt("docs")).toMatchObject({ at: "build" });
    expect(rowAt("site")).toMatchObject({ at: "build" });
    const reviewer = rowAt("a11y");
    expect(reviewer).toMatchObject({ at: "security" });
    expect(reviewer.stations.find((s) => s.name === "security")!.state).toBe("active");
  });
});

/** The station states and texts of one job's row. */
function stations(html: string, id: string): Record<string, { state: string; text: string }> {
  const row = rowOf(html, id);
  return Object.fromEntries(
    [...row.matchAll(/data-station="(\w+)" data-state="(\w+)".*?<span class="tx">([^<]+)<\/span>/gs)].map((m) => [m[1], { state: m[2], text: m[3] }]),
  );
}
const rowOf = (html: string, id: string) => {
  const start = html.indexOf(`id="job-${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
};
/** The lane holding a job's card: the last lane opened before it. */
const laneOf = (html: string, id: string) => {
  const start = html.indexOf(`id="job-${id}"`);
  expect(start).toBeGreaterThan(-1);
  return [...html.slice(0, start).matchAll(/data-lane="(\w+)"/g)].at(-1)![1];
};
const states = (html: string, id: string) => Object.fromEntries(Object.entries(stations(html, id)).map(([k, v]) => [k, v.text]));

describe("production line view", () => {
  it("shows the stage a staged job is on, and nothing about stages for others", () => {
    const ctx = factory();
    const stages = [{ title: "Base <datos>", tasks: ["a"] }, { title: "Vista", tasks: ["b"] }, { title: "Docs", tasks: ["c"] }];
    const staged = job(ctx, "pedido grande", { status: "running", station: "build", attempt: 1, spec: { stages }, stagesDone: 0 });
    const plain = job(ctx, "pedido chico", { status: "running", station: "build", attempt: 1 });
    const html = lineView(productionLine(ctx));
    expect(rowOf(html, staged.id)).toContain("etapa 1 de 3");
    expect(rowOf(html, staged.id)).toContain("Base &lt;datos&gt;");
    expect(rowOf(html, plain.id)).not.toContain("etapa");
  });

  it("shows a job running in build, with the stations it passed and the ones ahead", () => {
    const ctx = factory();
    const j = job(ctx, "agregá descuentos", { status: "running", station: "build", attempt: 1, title: "Descuentos" });
    span(ctx, j.id, "zero.setup", { status: "ok" });
    span(ctx, j.id, "zero.station.spec", { from: 1, status: "ok" });
    const attempt = span(ctx, j.id, "zero.attempt", { from: 3, attrs: { "zero.attempt": 1 } });
    span(ctx, j.id, "zero.station.build", { from: 3, parent: attempt });
    const html = lineView(productionLine(ctx));
    expect(states(html, j.id)).toEqual({ setup: "lista", spec: "lista", build: "activa", verify: "pendiente", review: "pendiente", security: "pendiente", integrate: "pendiente" });
    expect(stations(html, j.id).build!.state).toBe("active");
    expect(rowOf(html, j.id)).toContain("Descuentos");
    expect(rowOf(html, j.id)).toContain("tienda");
    expect(rowOf(html, j.id)).not.toContain("intento");
    expect(html.match(/data-station="(\w+)"/g)!.map((s) => s.slice(14, -1))).toEqual(["setup", "spec", "build", "verify", "review", "security", "integrate"]);
    for (const label of ["preparación", "especificación", "construcción", "verificación", "revisión", "seguridad", "integración"]) expect(html).toContain(label);
    expect(html).toMatch(/<svg viewBox/);
  });

  it("shows the error where verify failed and the job as failed", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "verify", attempt: 1 });
    span(ctx, j.id, "zero.station.spec", { status: "ok" });
    const attempt = span(ctx, j.id, "zero.attempt", { from: 2, to: 9, status: "error", attrs: { "zero.attempt": 1, "error.message": "tests rojos" } });
    span(ctx, j.id, "zero.station.build", { from: 2, parent: attempt, status: "ok" });
    span(ctx, j.id, "zero.station.verify", { from: 5, parent: attempt, status: "error", attrs: { "error.message": "tests rojos" } });
    ctx.store.finishJob(j.id, "failed", { reason: "Se agotaron los 3 intentos. Último problema:\ntests rojos" });
    const html = lineView(productionLine(ctx));
    const s = stations(html, j.id);
    expect(s.verify).toEqual({ state: "error", text: "error" });
    expect(s.build!.text).toBe("lista");
    expect(s.setup!.text).toBe("pendiente");
    const row = rowOf(html, j.id);
    expect(row).toMatch(/class="why">tests rojos</);
    expect(row).toContain("fallido");
    expect(row).toContain("Se agotaron los 3 intentos");
    expect(laneOf(html, j.id)).toBe("out");
    expect(row).toContain(`class="chip" data-status="failed"`);
    expect(html).toContain(`class="card job final" id="job-${j.id}"`);
  });

  it("marks the station where the last attempt stopped when verify reported instead of throwing", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 3 });
    const attempt = span(ctx, j.id, "zero.attempt", { status: "error", attrs: { "zero.attempt": 3, "error.message": "falló verify" } });
    span(ctx, j.id, "zero.station.build", { parent: attempt, status: "ok" });
    span(ctx, j.id, "zero.station.verify", { from: 1, parent: attempt, status: "ok" });
    ctx.store.finishJob(j.id, "failed", { reason: "Se agotaron los 3 intentos" });
    const s = stations(lineView(productionLine(ctx)), j.id);
    expect(s.verify!.state).toBe("error");
    expect(s.build!.state).toBe("done");
  });

  it("shows a retry: attempt 2 of 3, the error that caused it, and the card back in build", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 2, feedback: "detalle largo" });
    span(ctx, j.id, "zero.station.spec", { status: "ok" });
    const first = span(ctx, j.id, "zero.attempt", { from: 2, to: 8, status: "error", attrs: { "zero.attempt": 1, "error.message": "falló verify" } });
    span(ctx, j.id, "zero.station.build", { from: 2, parent: first, status: "ok" });
    span(ctx, j.id, "zero.station.verify", { from: 5, parent: first, status: "ok" });
    const second = span(ctx, j.id, "zero.attempt", { from: 9, attrs: { "zero.attempt": 2 } });
    span(ctx, j.id, "zero.station.build", { from: 9, parent: second });
    const html = lineView(productionLine(ctx));
    const row = rowOf(html, j.id);
    expect(row).toContain("intento 2 de 3");
    expect(row).toContain("falló verify");
    expect(html).toContain(`class="card job back" id="job-${j.id}"`);
    expect(laneOf(html, j.id)).toBe("build");
    expect(states(html, j.id)).toMatchObject({ spec: "lista", build: "activa", verify: "pendiente" });
  });

  it("shows a job waiting for the owner at the station that asked", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "integrate", attempt: 1 });
    span(ctx, j.id, "zero.station.spec", { status: "ok" });
    const attempt = span(ctx, j.id, "zero.attempt", { from: 2, status: "ok", attrs: { "zero.attempt": 1 } });
    for (const st of ["build", "verify", "review", "security"]) span(ctx, j.id, `zero.station.${st}`, { from: 2, parent: attempt, status: "ok" });
    askOwner(ctx, ctx.store.getJob(j.id)!, { kind: "before-integrate", text: "¿Lo integro?" });
    const html = lineView(productionLine(ctx));
    expect(stations(html, j.id).integrate).toEqual({ state: "waiting", text: "te espera" });
    expect(states(html, j.id)).toMatchObject({ spec: "lista", build: "lista", verify: "lista", review: "lista", security: "lista", setup: "pendiente" });
  });

  it("parks a spec-ready job at spec and never shows a skipped setup as active or failed", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "spec" });
    span(ctx, j.id, "zero.station.spec", { status: "ok" });
    askOwner(ctx, ctx.store.getJob(j.id)!, { kind: "spec-ready", text: "¿Sigo?" });
    const s = stations(lineView(productionLine(ctx)), j.id);
    expect(s.spec!.state).toBe("waiting");
    expect(s.setup!.state).toBe("pending");
  });

  it("takes the card off the line when delivered, with the pull request", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "integrate", attempt: 1 });
    span(ctx, j.id, "zero.station.spec", { status: "ok" });
    span(ctx, j.id, "zero.station.integrate", { from: 3, status: "ok" });
    ctx.store.finishJob(j.id, "delivered", { delivery: { mode: "pull-request", branch: "zero/x", url: "https://github.com/o/r/pull/7" } });
    const html = lineView(productionLine(ctx));
    const row = rowOf(html, j.id);
    expect(row).toContain("entregado");
    expect(row).toContain('href="https://github.com/o/r/pull/7"');
    expect(row).toContain("sin fundir todavía");
    expect(laneOf(html, j.id)).toBe("out");
    expect(row).toContain(`class="chip" data-status="delivered"`);
    expect(states(html, j.id)).toMatchObject({ spec: "lista", integrate: "lista", build: "pendiente" });
    expect(html).not.toMatch(/data-state="active"/);
  });

  it("puts work in progress above finished work and escapes every value", () => {
    const ctx = factory();
    const done = job(ctx, "y", { title: "<script>x</script>" });
    ctx.store.finishJob(done.id, "stopped", { reason: "Lo detuviste." });
    const running = job(ctx, "z", { status: "running", station: "build", attempt: 1 });
    const html = lineView(productionLine(ctx));
    expect(html.indexOf(`job-${running.id}`)).toBeLessThan(html.indexOf(`job-${done.id}`));
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(rowOf(html, done.id)).toContain("detenido");
  });

  it("explains each station like `zero trace`: time, cost and engine", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const spec = span(ctx, j.id, "zero.station.spec", { from: 0, to: 2, status: "ok" });
    span(ctx, j.id, "gen_ai.invoke_agent", { parent: spec, status: "ok", attrs: { "gen_ai.agent.name": "spec", "zero.engine": "claude", "zero.cost.usd": 0.25 } });
    const html = lineView(productionLine(ctx));
    const detail = /data-station="spec".*?<\/details>/s.exec(rowOf(html, j.id))![0];
    expect(detail).toContain("<details>");
    expect(detail).toContain("2.0 s");
    expect(detail).toContain("$0.250");
    expect(detail).toContain("claude");
  });

  it("counts like factoryStatus and says when the factory is free", () => {
    const ctx = factory();
    const empty = lineView(productionLine(ctx));
    expect(empty).toContain("La fábrica está libre");
    expect(empty).not.toMatch(/data-state="active"/);

    job(ctx, "a", { status: "running", station: "build", attempt: 1 });
    askOwner(ctx, job(ctx, "b", { status: "running", station: "spec" }), { kind: "spec-ready", text: "?" });
    ctx.store.finishJob(job(ctx, "c").id, "delivered", { delivery: { mode: "branch", branch: "zero/c" } });
    const html = lineView(productionLine(ctx));
    expect(productionLine(ctx).counts).toEqual({ active: 1, waiting: 1, failed: 0, delivered: 1 });
    for (const [n, label] of [[1, "activos"], [1, "esperando"], [0, "con error"], [1, "entregados hoy"]]) expect(html).toContain(`<b>${n}</b><span class="muted">${label}</span>`);
    expect(html).not.toContain("La fábrica está libre");
  });
});

describe("production line page", () => {
  it("needs the panel's session, for the page and for its fragment", async () => {
    const ctx = factory();
    job(ctx, "agregá descuentos", { title: "Descuentos" });
    const get = await panel(ctx);
    for (const path of ["/line", "/line?fragment=1"]) {
      const r = await get(path, {});
      expect(r.status).toBe(401);
      const html = await r.text();
      expect(html).toContain("Panel de tu fábrica");
      expect(html).not.toContain("tienda");
      expect(html).not.toContain("Descuentos");
    }
  });

  it("is in the menu and runs only its nonce'd script under the same policy as the rest", async () => {
    const ctx = factory();
    job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const get = await panel(ctx);
    const r = await get("/line");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Línea de producción");
    expect(await (await get("/")).text()).toContain('href="/line"');
    const csp = r.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toBe(` nonce="${nonce}"`);
      expect(body).not.toMatch(/\beval\(|new Function/);
      expect(body).toContain('fetch("/line?fragment=1"');
      expect(body).toMatch(/setInterval\([\s\S]*, 5000\)/);
    }
    expect([...html.matchAll(/<[a-z][^>]*>/gi)].some((t) => /\son[a-z]+\s*=/i.test(t[0]))).toBe(false);
    const home = (await get("/")).headers.get("content-security-policy")!;
    expect(csp.replace(/'nonce-[^']+'/, "")).toBe(home.replace(/'nonce-[^']+'/, ""));
  });

  it("serves the rows as a fragment for the refresh", async () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const r = await (await panel(ctx))("/line?fragment=1");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).not.toContain("<html");
    expect(stations(html, j.id).build!.state).toBe("active");
  });

  it("animates only with CSS, only what is active or waiting, and not at all with reduced motion", async () => {
    const html = await (await (await panel(factory()))("/line")).text();
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(css).toMatch(/@keyframes \w+/);
    const infinite = [...css.matchAll(/([^{}]+)\{[^{}]*\binfinite\b[^{}]*\}/g)].map((m) => m[1]!.trim());
    expect(infinite.length).toBeGreaterThan(0);
    for (const selector of infinite) expect(selector).toMatch(/active|waiting/);
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([^}]*\})/.exec(css)![1]!;
    expect(reduced).toMatch(/animation: none/);
    expect(reduced).toMatch(/transition: none/);
    expect(css).toMatch(/@media \(max-width: \d+px\) \{[^@]*(overflow-x:\s*auto|flex-direction:\s*column)/);
  });
});

describe("production line stream", () => {
  async function open(ctx: FactoryContext, opts: Partial<PanelOptions> = {}) {
    const get = await panel(ctx, { watchMs: 20, ...opts });
    const abort = new AbortController();
    const res = await get("/line/events", undefined, abort.signal);
    return { res, abort, stream: events(res), get };
  }

  it("needs the panel's session and sends no job data without it", async () => {
    const ctx = factory();
    const j = job(ctx, "agregá descuentos", { title: "Descuentos" });
    const r = await (await panel(ctx))("/line/events", {});
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).not.toContain("text/event-stream");
    const html = await r.text();
    expect(html).toContain("Panel de tu fábrica");
    expect(html).not.toContain(j.id);
    expect(html).not.toContain("Descuentos");
  });

  it("opens with a session as an uncached event stream under the panel's policy", async () => {
    const ctx = factory();
    const { res, abort, get } = await open(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const home = (await get("/")).headers.get("content-security-policy")!;
    expect(res.headers.get("content-security-policy")!.replace(/'nonce-[^']+'/, "")).toBe(home.replace(/'nonce-[^']+'/, ""));
    abort.abort();
  });

  it("sends the current line right away, the same fragment as /line?fragment=1", async () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const attempt = span(ctx, j.id, "zero.attempt", { attrs: { "zero.attempt": 1 } });
    span(ctx, j.id, "zero.station.build", { parent: attempt });
    const { abort, stream, get } = await open(ctx);
    await stream.until(() => stream.data.length > 0);
    expect(stream.data[0]).toBe(lineView(productionLine(ctx)));
    expect(stream.data[0]).toBe(await (await get("/line?fragment=1")).text());
    expect(stations(stream.data[0]!, j.id).build!.state).toBe("active");
    abort.abort();
  });

  it("pushes the new fragment within 2 s when a job moves to the next station", async () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const attempt = span(ctx, j.id, "zero.attempt", { attrs: { "zero.attempt": 1 } });
    const build = span(ctx, j.id, "zero.station.build", { parent: attempt });
    const { abort, stream } = await open(ctx, { watchMs: 1000 });
    await stream.until(() => stream.data.length > 0);
    ctx.store.updateJob(j.id, { station: "verify" });
    ctx.store.endSpan(build, at(2), "ok", {});
    const took = await stream.until(() => stream.data.length > 1, 2000);
    expect(took).toBeLessThan(2000);
    expect(states(stream.data.at(-1)!, j.id)).toMatchObject({ build: "lista", verify: "activa" });
    abort.abort();
  });

  it("pushes a new job's row", async () => {
    const ctx = factory();
    const { abort, stream } = await open(ctx);
    await stream.until(() => stream.data.length > 0);
    const { job: j } = requestWork(ctx, { text: "nuevo" });
    await stream.until(() => stream.data.some((d) => d.includes(`id="job-${j.id}"`)));
    abort.abort();
  });

  it("sends no data while nothing changes, only comments to keep the connection alive", async () => {
    const ctx = factory();
    job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const { abort, stream } = await open(ctx, { heartbeatMs: 50 });
    await stream.until(() => stream.data.length > 0);
    await wait(300);
    expect(stream.data).toHaveLength(1);
    expect(stream.comments.length).toBeGreaterThan(0);
    abort.abort();
  });

  it("ends the stream when the panel key changes", async () => {
    const ctx = factory();
    let key = "a".repeat(32);
    let t = T0;
    const server = createPanelServer(ctx, { key: () => key, now: () => t, watchMs: 20 });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/line/events`, { headers: { cookie: `zero_panel=${sessionFor(key)}` } });
    expect(res.status).toBe(200);
    const stream = events(res);
    await stream.until(() => stream.data.length > 0);
    key = "b".repeat(32);
    t += 11_000;
    const j = job(ctx, "secreto", { title: "Secreto" });
    await stream.until(() => stream.isDone());
    expect(stream.data).toHaveLength(1);
    expect(stream.data.join("")).not.toContain(j.id);
  });

  it("does not hold up the daemon's shutdown with streams open", async () => {
    const ctx = factory();
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets), watchMs: 20 });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
    const streams = (await Promise.all([0, 1].map(() => fetch(`${base}/line/events`, { headers: { cookie } })))).map(events);
    await Promise.all(streams.map((s) => s.until(() => s.data.length > 0)));
    const start = Date.now();
    await new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("stops writing to a client that left, without errors or warnings", async () => {
    const ctx = factory();
    const warn = vi.spyOn(log, "warn");
    try {
      const j = job(ctx, "x", { status: "running", station: "build", attempt: 1 });
      const { abort, stream } = await open(ctx);
      await stream.until(() => stream.data.length > 0);
      abort.abort();
      await stream.pump;
      await wait(50);
      ctx.store.updateJob(j.id, { station: "verify" });
      job(ctx, "otro");
      await wait(150);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("is what the page listens to, with the polling fallback and only nonce'd scripts", async () => {
    const r = await (await panel(factory()))("/line");
    const html = await r.text();
    const nonce = /'nonce-([^']+)'/.exec(r.headers.get("content-security-policy")!)![1];
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs] of scripts) expect(attrs).toBe(` nonce="${nonce}"`);
    const body = scripts.map((m) => m[2]).join("\n");
    expect(body).toContain('new EventSource("/line/events")');
    expect(body).toContain('fetch("/line?fragment=1"');
    expect(body).toMatch(/setInterval\([\s\S]*readyState === EventSource\.OPEN[\s\S]*, 5000\)/);
    expect(body).toContain('addEventListener("visibilitychange"');
    expect(body).not.toMatch(/\beval\(|new Function/);
    expect([...html.matchAll(/<[a-z][^>]*>/gi)].some((t) => /\son[a-z]+\s*=/i.test(t[0]))).toBe(false);
  });
});

/** The panel's stylesheet, as every page carries it. */
const css = (html = linePage(productionLine(factory()), "n")) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
/** The rules of a stylesheet as [selector, declarations], with each @media block's rules kept apart. */
const rules = (sheet: string) => [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const);
const mediaBlock = (sheet: string, query: RegExp) => {
  const out: string[] = [];
  for (const m of sheet.matchAll(/@media ([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) if (query.test(m[1]!)) out.push(m[2]!);
  return out.join("\n");
};

describe("production line board", () => {
  it("has eight lanes in order, each card in exactly one lane", () => {
    const ctx = factory();
    const queued = job(ctx, "a");
    const building = job(ctx, "b", { status: "running", station: "build", attempt: 1 });
    const waiting = job(ctx, "c", { status: "running", station: "integrate", attempt: 1 });
    askOwner(ctx, ctx.store.getJob(waiting.id)!, { kind: "before-integrate", text: "¿Lo integro?" });
    const delivered = job(ctx, "d");
    ctx.store.finishJob(delivered.id, "delivered", { delivery: { mode: "branch", branch: "zero/d" } });
    const failed = job(ctx, "e");
    ctx.store.finishJob(failed.id, "failed", { reason: "no" });
    const html = lineView(productionLine(ctx));
    expect(html).toContain(`<div class="board" data-part="board">`);
    expect([...html.matchAll(/<section class="lane" data-lane="(\w+)"/g)].map((m) => m[1])).toEqual(["setup", "spec", "build", "verify", "review", "security", "integrate", "out"]);
    for (const [j, lane] of [[queued, "setup"], [building, "build"], [waiting, "integrate"], [delivered, "out"], [failed, "out"]] as const) {
      expect(html.split(`id="job-${j.id}"`)).toHaveLength(2);
      expect(laneOf(html, j.id)).toBe(lane);
    }
    for (const [lane, n] of [["setup", 1], ["spec", 0], ["build", 1], ["integrate", 1], ["out", 2]] as const) expect(html).toContain(`data-lane="${lane}" data-count="${n}"`);
    expect(html).toMatch(/data-lane="build"[^>]*><header class="lane-head"[^>]*><span class="ic"><svg[^>]*>[\s\S]*?<\/svg><\/span><span class="ln">Construcción<\/span><span class="n">1<\/span>/);
    expect(html).toContain(`<span class="ln">Salida</span>`);
    expect(rowOf(html, waiting.id)).toContain(`class="chip" data-status="waiting"`);
    expect(stations(html, waiting.id).integrate!.state).toBe("waiting");
    expect(rowOf(html, building.id)).toMatch(new RegExp(`^id="job-${building.id}" data-status="running" data-sig="[0-9a-f]{16}"`));
    expect(html).toContain(`<article class="card job" id="job-${building.id}"`);
  });

  it("keeps an empty board, with every lane at zero, when the factory is free", () => {
    const html = lineView(productionLine(factory()));
    expect(html).toContain("La fábrica está libre");
    expect(html.match(/data-count="0"/g)).toHaveLength(8);
    expect(html).not.toContain("<article");
  });

  it("moves the card to its new lane from one fragment to the next", () => {
    const ctx = factory();
    const j = job(ctx, "x", { status: "running", station: "build", attempt: 1 });
    const first = lineView(productionLine(ctx));
    ctx.store.updateJob(j.id, { station: "verify" });
    const second = lineView(productionLine(ctx));
    expect(laneOf(first, j.id)).toBe("build");
    expect(laneOf(second, j.id)).toBe("verify");
    expect(second).toContain(`data-lane="build" data-count="0"`);
    expect(second).toContain(`data-lane="verify" data-count="1"`);
  });

  it("fits the screen's width: eight shrinking columns, lanes scrolling on their own, stacked on a phone", () => {
    const sheet = css();
    const all = rules(sheet);
    const board = all.filter(([sel]) => /(^|[\s,])\.board\b/.test(sel));
    expect(board.some(([, d]) => /grid-template-columns:\s*repeat\(\s*8\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/.test(d))).toBe(true);
    for (const [sel, d] of all.filter(([sel]) => /\.(board|lane)\b/.test(sel))) {
      expect(d, sel).not.toMatch(/overflow-x:\s*auto/);
      expect(d, sel).not.toMatch(/min-width:\s*[1-9]/);
    }
    expect(all.some(([sel, d]) => sel === ".lane" && /overflow-y:\s*auto/.test(d))).toBe(true);
    const phone = mediaBlock(sheet, /max-width: \d+px/);
    expect(phone).toMatch(/\.board \{[^}]*grid-template-columns:\s*1fr/);
    expect(phone).toMatch(/\.lane\[data-count="0"\] \{[^}]*display:\s*none/);
  });

  it("uses one status token for a job status and its station state", () => {
    const all = rules(css());
    const token = (selector: string) => all.filter(([sel]) => sel.split(",").map((s) => s.trim()).includes(selector)).map(([, d]) => /var\((--st-[\w-]+)\)/.exec(d)?.[1]);
    expect(token(`[data-status="failed"]`)).toEqual(token(`[data-state="error"]`));
    expect(token(`[data-status="failed"]`)[0]).toBe("--st-bad");
    expect(token(`[data-status="delivered"]`)).toEqual(token(`[data-state="done"]`));
    expect(token(`[data-status="delivered"]`)[0]).toBe("--st-ok");
    for (const status of ["queued", "running", "waiting", "stopped"]) expect(token(`[data-status="${status}"]`)[0]).toMatch(/^--st-/);
  });

  it("moves cards between lanes in its script, keeping open details", () => {
    const html = linePage(productionLine(factory()), "n");
    const body = /<script nonce="n">([\s\S]*?)<\/script>/.exec(html)![1]!;
    for (const piece of ["data-lane", "dataset.sig", "dataset.count", ".open", 'fetch("/line?fragment=1"', "EventSource"]) expect(body).toContain(piece);
    expect(body).toMatch(/setInterval\([\s\S]*, 5000\)/);
  });
});
