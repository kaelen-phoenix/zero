import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { answer, approveProposal, briefing, egressReport, factoryGuide, factoryStatus, getJob, productionLine, proposalsView, rejectProposal, requestWork, resume, setEgressMode, setEgressRule, stop, trace, type FactoryContext } from "../app.js";
import { onSubscription } from "../budget.js";
import { log } from "../log.js";
import { aboutPage, agentsPage, briefingPage, confirmProposalPage, egressPage, esc, jobPage, linePage, lineView, loginPage, overviewPage, page, proposalsPage } from "./html.js";
import { sessionFor } from "./key.js";

const COOKIE = "zero_panel";
const MAX_BODY = 64 * 1024;
/** How long a key read from the keychain is trusted before reading it again (so a rotation applies). */
const KEY_TTL_MS = 10_000;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k!, decodeURIComponent(v!)]),
  );
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error("pedido demasiado grande");
  }
  return new URLSearchParams(body);
}

/** Came through https (the tunnel), so the cookie can be marked Secure. */
const viaHttps = (req: IncomingMessage) => req.headers["x-forwarded-proto"] === "https" || String(req.headers["cf-visitor"] ?? "").includes("https");

/** An action must come from the panel's own pages: same-site cookie, and Origin (when sent) matching Host. */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** The page an action returns to (the panel sends no Referer). */
function returnTo(path: string): string {
  const job = /^\/job\/([0-9a-f]{8})\//.exec(path)?.[1];
  if (job) return `/job/${job}`;
  if (path.startsWith("/proposals")) return "/proposals";
  return path.startsWith("/egress") ? "/egress" : "/";
}

export interface PanelOptions {
  /** Reads the current key; the server caches it briefly. */
  key: () => string;
  now?: () => number;
  /** How often open line streams check the store for changes. */
  watchMs?: number;
  /** Longest silence on a line stream before a comment keeps proxies and tunnels from cutting it. */
  heartbeatMs?: number;
}

/** One open `/line/events` stream: the session it was opened with and the last fragment it got. */
interface LineStream {
  res: ServerResponse;
  session: string;
  last: string;
  wrote: number;
}

/** A Server-Sent Event with one `data:` line per line of the payload. */
const sse = (data: string) => `${data.split(/\r\n|\r|\n/).map((l) => `data: ${l}`).join("\n")}\n\n`;

/**
 * The control panel, served by the daemon on 127.0.0.1. Every page and action
 * needs a session; every action goes through the same operations as the CLI.
 */
export function createPanelServer(ctx: FactoryContext, opts: PanelOptions): Server {
  const now = opts.now ?? Date.now;
  let cached: { key: string; at: number } | undefined;
  const currentKey = () => {
    if (!cached || now() - cached.at > KEY_TTL_MS) cached = { key: opts.key(), at: now() };
    return cached.key;
  };

  const headers = (nonce: string) => ({
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
  const send = (res: ServerResponse, status: number, html: string, nonce: string, extra: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers(nonce), ...extra });
    res.end(html);
  };

  // Line streams share one watcher that reads the store, so changes made by other processes (the CLI) count too.
  const watchMs = opts.watchMs ?? 1000;
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const streams = new Set<LineStream>();
  let watcher: NodeJS.Timeout | undefined;
  const write = (s: LineStream, chunk: string) => {
    if (s.res.destroyed || s.res.writableEnded) return void streams.delete(s);
    s.res.write(chunk);
    s.wrote = now();
  };
  const drop = (s: LineStream) => {
    streams.delete(s);
    if (!s.res.writableEnded && !s.res.destroyed) s.res.end();
    if (!streams.size && watcher) {
      clearInterval(watcher);
      watcher = undefined;
    }
  };
  const tick = () => {
    try {
      const session = sessionFor(currentKey());
      for (const s of [...streams]) if (s.res.destroyed || s.res.writableEnded || !same(s.session, session)) drop(s);
      if (!streams.size) return;
      const html = lineView(productionLine(ctx));
      for (const s of streams) {
        if (html !== s.last) {
          s.last = html;
          write(s, sse(html));
        } else if (now() - s.wrote >= heartbeatMs) write(s, ": ping\n\n");
      }
    } catch (err) {
      log.warn("panel line stream", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  const openStream = (req: IncomingMessage, res: ServerResponse, session: string) => {
    res.writeHead(200, { ...headers(randomBytes(16).toString("base64")), "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
    const html = lineView(productionLine(ctx));
    const s: LineStream = { res, session, last: html, wrote: now() };
    streams.add(s);
    req.on("close", () => drop(s));
    res.on("close", () => drop(s));
    res.on("error", () => drop(s));
    res.write(sse(html));
    if (!watcher) {
      watcher = setInterval(tick, watchMs);
      watcher.unref();
    }
  };
  const back = (res: ServerResponse, to: string, msg?: string) => {
    res.writeHead(303, { Location: msg ? `${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}` : to, "Cache-Control": "no-store" });
    res.end();
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const nonce = randomBytes(16).toString("base64");
    const url = new URL(req.url ?? "/", "http://panel");
    const path = url.pathname;
    const flash = url.searchParams.get("msg")?.slice(0, 500) || undefined;
    const key = currentKey();
    const authed = same(cookies(req)[COOKIE] ?? "", sessionFor(key));

    if (req.method === "POST" && path === "/login") {
      const given = (await readForm(req)).get("k") ?? "";
      if (!same(given, key)) {
        await new Promise((r) => setTimeout(r, 500));
        return send(res, 401, loginPage(nonce, true), nonce);
      }
      const cookie = `${COOKIE}=${sessionFor(key)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86_400}${viaHttps(req) ? "; Secure" : ""}`;
      res.writeHead(303, { Location: "/", "Set-Cookie": cookie, "Cache-Control": "no-store" });
      return void res.end();
    }
    if (!authed) return send(res, 401, loginPage(nonce), nonce);

    if (req.method === "GET") {
      if (path === "/line/events") return openStream(req, res, sessionFor(key));
      if (path === "/") return send(res, 200, overviewPage(factoryStatus(ctx), ctx.config.lines.map((l) => l.name), nonce, flash), nonce);
      if (path === "/line") {
        // The fragment is what the page's script fetches to update its rows in place.
        if (url.searchParams.get("fragment") === "1") return send(res, 200, lineView(productionLine(ctx)), nonce);
        return send(res, 200, linePage(productionLine(ctx), nonce), nonce);
      }
      const job = /^\/job\/([0-9a-f]{8})$/.exec(path)?.[1];
      if (job) return send(res, 200, jobPage(getJob(ctx, job), trace(ctx, job), nonce, flash, onSubscription(ctx.store, ctx.config.engine)), nonce);
      if (path === "/egress") {
        const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 1) || 1, 1), 90);
        return send(res, 200, egressPage(egressReport(ctx, { days }), ctx.config.egress, nonce, flash), nonce);
      }
      if (path === "/proposals") return send(res, 200, proposalsPage(proposalsView(ctx), nonce, flash), nonce);
      if (path === "/briefing") {
        const b = await briefing(ctx, Math.min(Math.max(Number(url.searchParams.get("days") ?? 1) || 1, 1), 90));
        return send(res, 200, briefingPage(b.title, b.body, nonce), nonce);
      }
      // Read-only pages: they have no POST route, so a POST to them falls through to the 404 below.
      if (path === "/about") return send(res, 200, aboutPage(await factoryGuide(ctx), nonce), nonce);
      if (path === "/agents") return send(res, 200, agentsPage(await factoryGuide(ctx), nonce), nonce);
      return send(res, 404, page("No existe", `<div class="card">Esa página no existe. <a href="/">Volver</a></div>`, { nonce }), nonce);
    }

    if (req.method !== "POST") return send(res, 405, page("No permitido", "", { nonce }), nonce);
    if (!sameOrigin(req)) return send(res, 403, page("No permitido", `<div class="card">Pedido de otro sitio rechazado.</div>`, { nonce }), nonce);
    const form = await readForm(req);

    if (path === "/logout") {
      res.writeHead(303, { Location: "/", "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      return void res.end();
    }
    if (path === "/request") {
      const r = requestWork(ctx, { text: form.get("text") ?? "", line: form.get("line") || undefined });
      return back(res, `/job/${r.job.id}`, `Pedido anotado. ${r.next}`);
    }
    if (path === "/andon") {
      if (form.get("state") === "off") resume(ctx);
      else await stop(ctx);
      return back(res, "/", form.get("state") === "off" ? "Fábrica reanudada." : "Fábrica detenida: nada nuevo empieza hasta que la reanudes.");
    }
    const jobAction = /^\/job\/([0-9a-f]{8})\/(answer|stop)$/.exec(path);
    if (jobAction) {
      const [, id, action] = jobAction as unknown as [string, string, string];
      if (action === "stop") {
        await stop(ctx, id);
        return back(res, `/job/${id}`, "Deteniendo el trabajo.");
      }
      const decision = form.get("decision") === "approve" ? "approve" : "reject";
      await answer(ctx, id, decision, form.get("note") || undefined);
      return back(res, `/job/${id}`, decision === "approve" ? "Aprobado: el trabajo sigue." : "Rechazado: el trabajo se detuvo.");
    }
    const proposalAction = /^\/proposals\/([0-9a-f]{8})\/(approve|reject)$/.exec(path);
    if (proposalAction) {
      const [, id, action] = proposalAction as unknown as [string, string, string];
      if (action === "reject") {
        await rejectProposal(ctx, id, form.get("note") || undefined);
        return back(res, "/proposals", "Propuesta rechazada.");
      }
      // Approving opens a job or integrates one, so the first press only asks for confirmation.
      if (form.get("confirm") !== "1") {
        const proposal = proposalsView(ctx).lines.flatMap((l) => l.proposals).find((p) => p.id === id);
        if (!proposal) throw new Error(`No existe la propuesta ${id}.`);
        return send(res, 200, confirmProposalPage(proposal, nonce), nonce);
      }
      const r = approveProposal(ctx, id);
      return back(res, "/proposals", `Propuesta aprobada: trabajo ${r.job.id}. ${r.next}`);
    }
    if (path === "/egress/rule") {
      const action = form.get("action");
      if (action !== "allow" && action !== "block" && action !== "remove") throw new Error("Acción desconocida.");
      return back(res, "/egress", await setEgressRule(ctx, form.get("site") ?? "", action));
    }
    if (path === "/egress/mode") return back(res, "/egress", await setEgressMode(ctx, form.get("mode") ?? ""));
    return send(res, 404, page("No existe", "", { nonce }), nonce);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (res.headersSent) return void res.end();
      // Owner-facing errors (a bad site, a job that is not waiting) go back to the page the action belongs to.
      if (req.method === "POST") return back(res, returnTo(req.url ?? "/"), message);
      log.warn("panel error", { path: req.url, error: message });
      const nonce = randomBytes(16).toString("base64");
      send(res, 500, page("Error", `<div class="card bad">${esc(message)}</div><p><a href="/">Volver</a></p>`, { nonce }), nonce);
    });
  });
  server.on("close", () => [...streams].forEach(drop));
  return server;
}
