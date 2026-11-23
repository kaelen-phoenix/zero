import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { panelLinks, requestWork, setRemotePanel, type MergeApiFactory } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import type { MergeApi } from "../src/line/automerge.js";
import { askOwner, finalizeJob } from "../src/line/finish.js";
import { jobPage, markdown } from "../src/panel/html.js";
import { panelKey, rotatePanelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { log } from "../src/log.js";
import type { Job } from "../src/state/store.js";
import { downloadCloudflared, downloadPlan, readTunnelState, REMOTE_URL_KEY, TUNNEL_STATE_KEY, tunnelKeeper } from "../src/panel/tunnel.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel(over: Record<string, unknown> = {}, merges?: MergeApiFactory) {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over });
  let clock = 0;
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets), now: () => clock, ...(merges && { merges }) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = { cookie }) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  return { ctx, base, cookie, get, post, tick: (ms: number) => (clock += ms) };
}

describe("panel access", () => {
  it("shows only the sign-in page without a session", async () => {
    const p = await panel();
    for (const path of ["/", "/egress", "/briefing", "/job/deadbeef"]) {
      const r = await p.get(path, {});
      expect(r.status).toBe(401);
      const html = await r.text();
      expect(html).toContain("Panel de tu fábrica");
      expect(html).not.toContain("tienda");
    }
    expect((await p.post("/request", { text: "algo" }, {})).status).toBe(401);
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("trades the key for an HttpOnly, SameSite=Strict session cookie", async () => {
    const p = await panel();
    expect((await p.post("/login", { k: "wrong" }, {})).status).toBe(401);
    const ok = await p.post("/login", { k: panelKey(p.ctx.secrets) }, {});
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain(p.cookie);
    expect(cookie).toMatch(/HttpOnly; SameSite=Strict/);
    expect(cookie).not.toContain("Secure");
    const viaTunnel = await p.post("/login", { k: panelKey(p.ctx.secrets) }, { "x-forwarded-proto": "https" });
    expect(viaTunnel.headers.get("set-cookie")).toContain("Secure");
  });

  it("keeps the key out of the link the server ever sees", () => {
    const ctx = testFactory({ lines: [] });
    const links = panelLinks(ctx);
    expect(links.local).toMatch(/^http:\/\/127\.0\.0\.1:4848\/#k=[A-Za-z0-9_-]{43}$/);
    expect(links.remote).toBeUndefined();
    ctx.store.setKv(REMOTE_URL_KEY, "https://ab-cd.trycloudflare.com");
    expect(panelLinks(ctx).remote).toMatch(/^https:\/\/ab-cd\.trycloudflare\.com\/#k=/);
  });

  it("stops accepting old sessions once the key rotates", async () => {
    const p = await panel();
    expect((await p.get("/")).status).toBe(200);
    rotatePanelKey(p.ctx.secrets);
    p.tick(11_000);
    expect((await p.get("/")).status).toBe(401);
  });

  it("refuses actions coming from another site", async () => {
    const p = await panel();
    expect((await p.post("/request", { text: "algo" }, { cookie: p.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await p.post("/request", { text: "algo" }, { cookie: p.cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("takes an action whose Origin matches the Host", async () => {
    const p = await panel();
    const r = await p.post("/request", { text: "algo" }, { cookie: p.cookie, origin: p.base });
    expect(r.status).toBe(303);
    expect(p.ctx.store.listJobs()).toHaveLength(1);
  });

  it("takes an action with Origin null when Sec-Fetch-Site says same-origin", async () => {
    const p = await panel();
    const r = await p.post("/request", { text: "algo" }, { cookie: p.cookie, origin: "null", "sec-fetch-site": "same-origin" });
    expect(r.status).toBe(303);
    expect(p.ctx.store.listJobs()).toHaveLength(1);
  });

  it.each<[string, Record<string, string>]>([
    ["Origin null without Sec-Fetch-Site", { origin: "null" }],
    ["Origin null with Sec-Fetch-Site none", { origin: "null", "sec-fetch-site": "none" }],
    ["another site's Origin", { origin: "https://evil.example" }],
    ["another site's Origin with Sec-Fetch-Site same-origin", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site cross-site with Origin null", { origin: "null", "sec-fetch-site": "cross-site" }],
  ])("refuses an action with %s", async (_name, headers) => {
    const p = await panel();
    const r = await p.post("/request", { text: "algo" }, { cookie: p.cookie, ...headers });
    expect(r.status).toBe(403);
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("sends a strict content security policy", async () => {
    const r = await (await panel()).get("/");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'.*script-src 'nonce-[^']+'.*frame-ancestors 'none'/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    const html = await r.text();
    expect(html).toContain(`<meta name="referrer" content="same-origin">`);
    expect(html).not.toContain("no-referrer");
  });
});

describe("panel pages and actions", () => {
  it("shows the factory and takes a request", async () => {
    const p = await panel();
    const home = await (await p.get("/")).text();
    expect(home).toContain("nivel L2");
    expect(home).toContain("Pedir un trabajo");

    const r = await p.post("/request", { text: "agregá un descuento" });
    expect(r.status).toBe(303);
    const [job] = p.ctx.store.listJobs();
    expect(job).toMatchObject({ request: "agregá un descuento", line: "tienda", status: "queued" });
    expect(r.headers.get("location")).toMatch(new RegExp(`^/job/${job!.id}\\?msg=`));
    expect(await (await p.get(`/job/${job!.id}`)).text()).toContain("agregá un descuento");
  });

  it("answers a waiting job like `zero approve`", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x" });
    askOwner(p.ctx, job, { kind: "before-integrate", text: "¿Lo integro?" });
    expect(await (await p.get("/")).text()).toContain("¿Lo integro?");
    const r = await p.post(`/job/${job.id}/answer`, { decision: "approve" });
    expect(r.status).toBe(303);
    expect(p.ctx.store.getJob(job.id)).toMatchObject({ status: "queued", approvals: { integrate: true } });
  });

  it("returns owner errors to the page instead of failing", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x" });
    const r = await p.post(`/job/${job.id}/answer`, { decision: "approve" });
    expect(r.status).toBe(303);
    expect(decodeURIComponent(r.headers.get("location")!)).toMatch(new RegExp(`^/job/${job.id}\\?msg=.*no está esperando`));
    const bad = await p.post("/egress/rule", { site: "http://x/y", action: "block" });
    expect(decodeURIComponent(bad.headers.get("location")!)).toMatch(/^\/egress\?msg=.*no es un sitio válido/);
  });

  it("discards a job with its reason, and goes back to it", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x" });
    await finalizeJob(p.ctx, job, "failed", { reason: "no" });
    const html = await (await p.get(`/job/${job.id}`)).text();
    expect(html).toContain(`action="/job/${job.id}/discard"`);
    expect(html).toContain("Descartar");
    expect((await p.post(`/job/${job.id}/discard`, {}, {})).status).toBe(401);
    expect(p.ctx.store.getJob(job.id)!.status).toBe("failed");

    const r = await p.post(`/job/${job.id}/discard`, { motivo: "quedó viejo" });
    expect(r.status).toBe(303);
    const to = new URL(r.headers.get("location")!, "http://x");
    expect(to.pathname).toBe(`/job/${job.id}`);
    expect(to.searchParams.get("msg")).toContain("quedó detenido");
    expect(p.ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", reason: "Lo descartaste vos: quedó viejo" });
    expect(await (await p.get(`/job/${job.id}`)).text()).not.toContain("/discard");
    const again = await p.post(`/job/${job.id}/discard`, {});
    expect(new URL(again.headers.get("location")!, "http://x").searchParams.get("msg")).toContain("ya está detenido");
  });

  it("closes the pull request of a discarded job through the panel's GitHub access", async () => {
    const did: string[] = [];
    const api: MergeApi = {
      pullRequest: async () => ({ open: true, merged: false, mergeable: true, headSha: "abc", base: "main" }),
      checks: async () => [],
      merge: async () => undefined,
      deleteBranch: async (b) => void did.push(`delete ${b}`),
      comment: async (n) => void did.push(`comment #${n}`),
      close: async (n) => void did.push(`close #${n}`),
    };
    const p = await panel({}, () => api);
    const { job } = requestWork(p.ctx, { text: "x" });
    await finalizeJob(p.ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/kaelen/demo/pull/7" } });
    await p.post(`/job/${job.id}/discard`, {});
    expect(did).toEqual(["comment #7", "close #7", `delete zero/${job.id}`]);
    expect(p.ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", reason: "Lo descartaste vos." });
    expect(p.ctx.store.spansForJob(job.id).find((s) => s.name === "zero.discard")!.attrs["zero.discard.via"]).toBe("panel");
  });

  it("offers to discard only a job that can be discarded", async () => {
    const p = await panel();
    const { job } = requestWork(p.ctx, { text: "x" });
    const offered = (over: Partial<Job>, merge?: "merged" | "closed" | "blocked") => jobPage({ ...job, ...over }, "", "n", undefined, false, merge).includes("/discard");
    const delivery = { mode: "pull-request" as const, branch: "zero/x", url: "https://github.com/kaelen/demo/pull/7" };
    for (const status of ["failed", "queued", "waiting"] as const) expect(offered({ status }), status).toBe(true);
    for (const status of ["running", "stopped", "delivered"] as const) expect(offered({ status }), status).toBe(false);
    expect(offered({ status: "delivered", delivery })).toBe(true);
    expect(offered({ status: "delivered", delivery }, "blocked")).toBe(true);
    expect(offered({ status: "delivered", delivery }, "merged")).toBe(false);
    expect(offered({ status: "delivered", delivery }, "closed")).toBe(false);
  });

  it("pulls the andon cord and edits the egress rules", async () => {
    const p = await panel();
    await p.post("/andon", { state: "on" });
    expect(await (await p.get("/")).text()).toContain("DETENIDA");
    await p.post("/andon", { state: "off" });
    expect(await (await p.get("/")).text()).not.toContain("DETENIDA");

    await p.post("/egress/rule", { site: "pastebin.com", action: "block" });
    await p.post("/egress/mode", { mode: "allowlist" });
    expect(parseFactory(readFileSync(p.ctx.home.config, "utf8")).egress).toEqual({ mode: "allowlist", allow: [], block: ["pastebin.com"] });
    const egress = await (await p.get("/egress")).text();
    expect(egress).toContain("Bloqueados: pastebin.com");
    expect(egress).toContain("fuera de la caja");
  });

  it("renders the briefing's markdown, escaping what it contains", () => {
    const html = markdown("## Producción\n| A | B |\n|---|---|\n| 1 | <b>2</b> |\n- **Bloqueado**: `x`");
    expect(html).toContain("<h3>Producción</h3>");
    expect(html).toContain("<td>&lt;b&gt;2&lt;/b&gt;</td>");
    expect(html).toContain("<li><b>Bloqueado</b>: <code>x</code></li>");
  });
});

/** A child process that prints what cloudflared prints and exits when killed. */
function fakeCloudflared() {
  const spawned: string[][] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const procs: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; killed?: boolean })[] = [];
  const spawn = (_bin: string, args: string[], env?: NodeJS.ProcessEnv) => {
    spawned.push(args);
    envs.push(env);
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
    proc.kill = () => (proc.emit("exit", 0), true);
    procs.push(proc);
    return proc as unknown as ChildProcess;
  };
  return { spawn, spawned, envs, procs };
}

describe("remote panel", () => {
  it("opens the tunnel when the owner turns it on, keeps its address, and closes it when off", async () => {
    const ctx = testFactory({ lines: [] });
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(ctx.home.bin, { recursive: true });
    writeFileSync(`${ctx.home.bin}/${process.platform === "win32" ? "cloudflared.exe" : "cloudflared"}`, "");
    const cf = fakeCloudflared();
    let clock = 0;
    const keeper = tunnelKeeper({ home: ctx.home, store: ctx.store, port: 4848, spawn: cf.spawn, now: () => clock });

    keeper.tick();
    expect(cf.spawned).toHaveLength(0);
    setRemotePanel(ctx, true);
    keeper.tick();
    expect(cf.spawned[0]).toEqual(["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4848"]);
    cf.procs[0]!.stderr.write("INF |  https://quiet-river-1234.trycloudflare.com  |\n");
    await new Promise((r) => setImmediate(r));
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBe("https://quiet-river-1234.trycloudflare.com");

    // It dies: the address goes away, and it reopens after a wait.
    cf.procs[0]!.emit("exit", 1);
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBeUndefined();
    keeper.tick();
    expect(cf.spawned).toHaveLength(1);
    clock += 16_000;
    keeper.tick();
    expect(cf.spawned).toHaveLength(2);

    setRemotePanel(ctx, false);
    keeper.tick();
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBeUndefined();
  });

  const withCloudflared = async () => {
    const ctx = testFactory({ lines: [] });
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(ctx.home.bin, { recursive: true });
    writeFileSync(`${ctx.home.bin}/${process.platform === "win32" ? "cloudflared.exe" : "cloudflared"}`, "");
    return ctx;
  };
  const flush = () => new Promise((r) => setImmediate(r));

  it("runs a named tunnel with the token only in its environment and publishes the fixed address once it registered", async () => {
    const ctx = await withCloudflared();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const cf = fakeCloudflared();
    let clock = Date.parse("2026-11-15T10:00:00.000Z");
    const keeper = tunnelKeeper({ home: ctx.home, store: ctx.store, port: 4848, hostname: "zero.example.com", token: () => "tok123", spawn: cf.spawn, now: () => clock });
    setRemotePanel(ctx, true);
    keeper.tick();
    expect(cf.spawned[0]).toEqual(["tunnel", "--no-autoupdate", "run"]);
    expect(cf.envs[0]?.TUNNEL_TOKEN).toBe("tok123");
    expect(cf.spawned[0]!.some((a) => a.includes("tok123"))).toBe(false);

    // Started, but nothing registered yet: no address.
    cf.procs[0]!.stderr.write("INF Starting tunnel tunnelID=abc\n");
    await flush();
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBeUndefined();
    expect(readTunnelState(ctx.store)).toMatchObject({ mode: "named", failures: 0 });
    expect(readTunnelState(ctx.store)?.connectedSince).toBeUndefined();

    cf.procs[0]!.stderr.write("INF Registered tunnel connection connIndex=0 location=eze01 protocol=quic\n");
    await flush();
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBe("https://zero.example.com");
    expect(readTunnelState(ctx.store)).toEqual({ mode: "named", failures: 0, connectedSince: "2026-11-15T10:00:00.000Z" });

    // It dies: the address goes, the failure counts, and it reopens only after the wait.
    cf.procs[0]!.emit("exit", 1);
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBeUndefined();
    expect(readTunnelState(ctx.store)).toMatchObject({ mode: "named", failures: 1, lastExitAt: "2026-11-15T10:00:00.000Z" });
    keeper.tick();
    expect(cf.spawned).toHaveLength(1);
    clock += 16_000;
    keeper.tick();
    expect(cf.spawned[1]).toEqual(["tunnel", "--no-autoupdate", "run"]);
    cf.procs[1]!.stdout.write("Registered tunnel connection connIndex=0\n");
    await flush();
    expect(readTunnelState(ctx.store)).toMatchObject({ failures: 0, connectedSince: "2026-11-15T10:00:16.000Z" });
    cf.procs[1]!.emit("exit", 0);

    // The token never reaches kv or the keeper's log lines.
    for (const [, value] of ctx.store.kvWithPrefix("")) expect(value).not.toContain("tok123");
    for (const call of [...warn.mock.calls, ...info.mock.calls]) expect(JSON.stringify(call)).not.toContain("tok123");

    setRemotePanel(ctx, false);
    keeper.tick();
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBeUndefined();
    expect(ctx.store.getKv(TUNNEL_STATE_KEY)).toBeUndefined();
    warn.mockRestore();
    info.mockRestore();
  });

  it("keeps the quick tunnel without the token, warning once and recording the problem", async () => {
    const ctx = await withCloudflared();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const cf = fakeCloudflared();
    let clock = 0;
    const keeper = tunnelKeeper({ home: ctx.home, store: ctx.store, port: 4848, hostname: "zero.example.com", token: () => undefined, spawn: cf.spawn, now: () => clock });
    setRemotePanel(ctx, true);
    keeper.tick();
    expect(cf.spawned[0]).toEqual(["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4848"]);
    expect(cf.envs[0]?.TUNNEL_TOKEN).toBeUndefined();
    expect(readTunnelState(ctx.store)).toMatchObject({ mode: "quick", problem: expect.stringContaining("CLOUDFLARE_TUNNEL_TOKEN") });
    cf.procs[0]!.stderr.write("INF |  https://quiet-river-1234.trycloudflare.com  |\n");
    await flush();
    expect(ctx.store.getKv(REMOTE_URL_KEY)).toBe("https://quiet-river-1234.trycloudflare.com");
    cf.procs[0]!.emit("exit", 1);
    clock += 16_000;
    keeper.tick();
    expect(cf.spawned).toHaveLength(2);
    const tokenWarnings = warn.mock.calls.filter(([msg]) => String(msg).includes("zero secret set CLOUDFLARE_TUNNEL_TOKEN"));
    expect(tokenWarnings).toHaveLength(1);
    keeper.stop();
    warn.mockRestore();
  });

  it("downloads cloudflared only from the official releases and drops it if the signature is not Cloudflare's", async () => {
    const ctx = testFactory({ lines: [] });
    const urls: string[] = [];
    const fetchFake = (async (url: string) => (urls.push(url), new Response("binary"))) as unknown as typeof fetch;
    await expect(downloadCloudflared(ctx.home, { fetch: fetchFake, platform: "win32", arch: "x64", verify: () => ({ ok: false, detail: "NotSigned" }) })).rejects.toThrow(/firma/);
    expect(urls).toEqual(["https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"]);
    expect(existsSync(`${ctx.home.bin}/cloudflared.exe`)).toBe(false);
    const ok = await downloadCloudflared(ctx.home, { fetch: fetchFake, platform: "win32", arch: "x64", verify: () => ({ ok: true, detail: "Valid" }) });
    expect(ok.sha256).toHaveLength(64);
    expect(downloadPlan("darwin", "arm64")).toEqual({ manual: expect.stringContaining("brew install cloudflared") });
    expect(downloadPlan("linux", "arm64")).toEqual({ url: expect.stringMatching(/cloudflared-linux-arm64$/) });
  });
});
