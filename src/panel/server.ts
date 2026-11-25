import { randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { addFromCatalog, agentCatalog, catalogAddPlan, controlRoomView, rejectCatalogEntry, answerAnywhere, confirmRemoteAction, createProject, decideProposal, projectPlan, remoteChatView, revokeRemoteChatClient, briefing, egressReport, factoryGuide, factoryStatus, factoryView, getJob, jobElsewhere, monitorView, monthlyReport, packageList, packageTabFile, packageTabs, packageTabView, parsePeriod, productionLine, proposalsView, requestAnywhere, requestFromResearchNote, requestInvestigation, requestLines, requestStationRun, requestsView, requestUnjam, uploadToStation, researchOnDemand, researchView, resume, saveReport, setEgressMode, setEgressRule, stop, trace, mergePullRequest, type FactoryContext, type MergeApiFactory, type ProjectCreator, type ProjectInput, type RequestResult, type RequestSent } from "../app.js";
import { onSubscription } from "../budget.js";
import { formatDiscard, formatMerge, formatProposalDecision } from "../format.js";
import { mergeKey, type MergeState } from "../line/automerge.js";
import { discardJob } from "../line/discard.js";
import { log } from "../log.js";
import { createRemoteMcp, isRemoteMcpPath } from "../mcp/http.js";
import { downloadName, MAX_DOWNLOAD_BYTES } from "../package-tabs.js";
import { reportFileName, reportHtml, reportMarkdown } from "../report.js";
import { controlRoomFragment, controlRoomPage } from "./control-room.js";
import { aboutPage, agentsPage, briefingPage, confirmCatalogPage, confirmMergePage, confirmProjectPage, confirmProposalPage, confirmResearchPage, confirmRevokePage, confirmStopPage, egressPage, esc, factoryJobPage, jobPage, linePage, lineView, loginPage, monitorPage, safeBack, overviewPage, packagesPage, packageTabPage, page, projectPage, projectResultPage, proposalsPage, remoteChatPage, reportPage, requestsPage, researchPage, tabLinks, TABS_MARK, type ProjectForm, type StationUploads } from "./html.js";
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

/** Room for the multipart boundaries, headers and the other fields around an uploaded file. */
const UPLOAD_OVERHEAD = 1024 * 1024;

/** What each loaded station takes as uploads, by `<package>/<station>`. */
function stationUploads(ctx: FactoryContext): StationUploads {
  const out: StationUploads = {};
  for (const s of ctx.config.loadedPackages?.stations ?? []) if (s.uploads) out[`${s.package}/${s.name}`] = s.uploads;
  return out;
}

/** How much of a refused upload is read and dropped, so the browser gets the answer, before the connection is cut. */
const DRAIN_BYTES = 256 * 1024 * 1024;

/**
 * A request body that fails as soon as it goes over `max` bytes, so nothing larger is ever held. Past it the rest is
 * read and dropped (up to `DRAIN_BYTES`), and `drained` resolves once the request ended or was cut.
 */
function limitedBody(req: IncomingMessage, max: number): { body: ReadableStream<Uint8Array>; over: () => boolean; drained: Promise<void> } {
  let size = 0;
  let over = false;
  const drained = new Promise<void>((done) => {
    req.once("end", done);
    req.once("close", done);
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (over) {
          if (size > max + DRAIN_BYTES) req.destroy();
          return;
        }
        if (size > max) {
          over = true;
          controller.error(new Error("el archivo es demasiado grande"));
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
      });
      req.once("end", () => {
        if (!over) controller.close();
      });
      req.once("error", (err) => {
        if (!over) controller.error(err);
      });
    },
  });
  return { body, over: () => over, drained };
}

/** Came through https (the tunnel), so the cookie can be marked Secure. */
const viaHttps = (req: IncomingMessage) => req.headers["x-forwarded-proto"] === "https" || String(req.headers["cf-visitor"] ?? "").includes("https");

/**
 * An action must come from the panel's own pages: same-site cookie, and Origin (when sent) matching Host.
 * Browsers may send `Origin: null` on a page's own form posts, so null counts only when Sec-Fetch-Site vouches for it.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === "null") return site === "same-origin";
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** The page an action returns to (from its path, never from the Referer). */
function returnTo(path: string): string {
  const job = /^\/job\/([0-9a-f]{8})\//.exec(path)?.[1];
  if (job) return `/job/${job}`;
  if (path.startsWith("/proposals")) return "/proposals";
  if (path.startsWith("/requests")) return "/requests";
  if (path.startsWith("/research")) return "/research";
  if (path.startsWith("/projects")) return "/projects";
  if (path.startsWith("/packages")) return "/packages";
  if (path.startsWith("/remote-chat")) return "/remote-chat";
  if (path.startsWith("/agents")) return "/agents";
  if (path.startsWith("/control-room")) return "/control-room";
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
  /** GitHub adapters for merging on request; the daemon passes its metered real ones. */
  merges?: MergeApiFactory;
  /** Creates a project once its confirmation came back; tests inject a fake. */
  project?: ProjectCreator;
}

/** What a live page's stream sends: its fragment, and what of it counts as a change (all of it by default). */
interface StreamFeed {
  render: () => string;
  changed?: (html: string) => string;
}

/** One open live stream (`/line/events`, `/control-room/events`): the session it was opened with, its feed and the last fragment it got. */
interface LiveStream {
  res: ServerResponse;
  session: string;
  feed: StreamFeed;
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

  // formTargets: other origins a page's forms may end up at, as the remote chat's approval redirects to the chat.
  const headers = (nonce: string, formTargets: string[] = []) => ({
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action ${["'self'", ...formTargets].join(" ")}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
  const send = (res: ServerResponse, status: number, html: string, nonce: string, extra: Record<string, string | string[]> = {}, formTargets?: string[]) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers(nonce, formTargets), ...extra });
    // The tab being shown is marked in the menu by its address, which only the request knows.
    const shown = (res.req.url ?? "").split(/[?#]/)[0];
    res.end(html.includes(TABS_MARK) ? html.replace(TABS_MARK, () => tabLinks(packageTabs(ctx), shown)) : html);
  };

  /** Hands out a file a package tab lists, as an attachment; false (nothing sent) for anything else. */
  const sendTabFile = (res: ServerResponse, pkg: string, tab: string, encoded: string, nonce: string): boolean => {
    let file: string;
    try {
      file = encoded.split("/").map(decodeURIComponent).join("/");
    } catch {
      return false;
    }
    const real = packageTabFile(ctx, pkg, tab, file);
    if (!real) return false;
    let fd: number;
    try {
      fd = openSync(real, "r");
    } catch {
      return false;
    }
    let size: number;
    try {
      // Judged again on what was opened, in case the file changed after the check.
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_DOWNLOAD_BYTES) throw new Error("not a file to hand out");
      size = stat.size;
    } catch {
      closeSync(fd);
      return false;
    }
    res.writeHead(200, {
      ...headers(nonce),
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${downloadName(file)}"`,
      "Content-Length": String(size),
    });
    createReadStream("", { fd, start: 0, end: Math.max(size - 1, 0) })
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  };

  // Live streams share one watcher that reads the store, so changes made by other processes (the CLI) count too.
  const watchMs = opts.watchMs ?? 1000;
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const streams = new Set<LiveStream>();
  let watcher: NodeJS.Timeout | undefined;
  const lineFeed: StreamFeed = { render: () => lineView(productionLine(ctx)) };
  // The room's clock moves every second on its own in the page; only the rest of the fragment is a change.
  const controlFeed: StreamFeed = {
    render: () => controlRoomFragment(controlRoomView(ctx, ctx.now?.())),
    changed: (html) => html.replace(/<span class="clock"[^>]*>[^<]*<\/span>/, ""),
  };
  const write = (s: LiveStream, chunk: string) => {
    if (s.res.destroyed || s.res.writableEnded) return void streams.delete(s);
    s.res.write(chunk);
    s.wrote = now();
  };
  const drop = (s: LiveStream) => {
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
      // Each feed is rendered once per tick, however many of its streams are open.
      const rendered = new Map<StreamFeed, string>();
      for (const s of streams) {
        let html = rendered.get(s.feed);
        if (html === undefined) rendered.set(s.feed, (html = s.feed.render()));
        const changed = s.feed.changed ?? ((h: string) => h);
        if (changed(html) !== changed(s.last)) {
          s.last = html;
          write(s, sse(html));
        } else if (now() - s.wrote >= heartbeatMs) write(s, ": ping\n\n");
      }
    } catch (err) {
      log.warn("panel live stream", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  const openStream = (req: IncomingMessage, res: ServerResponse, session: string, feed: StreamFeed) => {
    res.writeHead(200, { ...headers(randomBytes(16).toString("base64")), "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
    const html = feed.render();
    const s: LiveStream = { res, session, feed, last: html, wrote: now() };
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
  const remoteMcp = createRemoteMcp(ctx, { merges: opts.merges });
  const back = (res: ServerResponse, to: string, msg?: string) => {
    res.writeHead(303, { Location: msg ? `${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}` : to, "Cache-Control": "no-store" });
    res.end();
  };

  /** A request that was taken, on this machine or to be published. */
  const requested = (res: ServerResponse, r: RequestResult | RequestSent) => ("sent" in r ? back(res, `/job/${r.id}`, r.sent) : back(res, `/job/${r.job.id}`, `Pedido anotado. ${r.next}`));

  /** A file for a package station, read only up to that station's limit and stored through `uploadToStation`. */
  async function upload(req: IncomingMessage, res: ServerResponse, url: URL, nonce: string) {
    const uploads = stationUploads(ctx);
    const asked = url.searchParams.get("station") ?? "";
    const limits = Object.hasOwn(uploads, asked) ? [uploads[asked]!] : Object.values(uploads);
    const max = limits.length ? Math.max(...limits.map((u) => u.maxMb)) * 1024 * 1024 + UPLOAD_OVERHEAD : 0;
    // Too large by its own word: nothing of it is kept, only read and dropped so the browser gets the answer.
    const declared = Number(req.headers["content-length"] ?? 0);
    const reading = limitedBody(req, declared > max ? 0 : max);
    if (!limits.length || declared > max) {
      await reading.drained;
      if (!limits.length) return back(res, "/packages", "Ninguna estación acepta archivos.");
    }
    const tooLarge = async () => {
      await reading.drained;
      res.writeHead(413, { ...headers(nonce), "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Archivo demasiado grande", `<div class="card bad">El archivo pasa del máximo de la estación. <a href="/packages">Volver</a></div>`, { nonce }));
    };
    if (declared > max) return tooLarge();
    let form: FormData;
    try {
      form = await new Request("http://panel/packages/upload", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body: reading.body, duplex: "half" } as RequestInit).formData();
    } catch {
      if (reading.over()) return tooLarge();
      await reading.drained;
      return back(res, "/packages", "No se pudo leer el archivo subido.");
    }
    const file = form.get("file");
    const station = asked || String(form.get("station") ?? "");
    if (typeof file === "string" || !file?.name) return back(res, "/packages", "Elegí un archivo para subir.");
    const pedido = form.get("pedido");
    const r = await uploadToStation(ctx, station, { name: file.name, content: new Uint8Array(await file.arrayBuffer()), ...(typeof pedido === "string" && pedido && { request: pedido }) });
    return back(res, "/packages", r.ok ? r.text : r.reason);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const nonce = randomBytes(16).toString("base64");
    const url = new URL(req.url ?? "/", "http://panel");
    const path = url.pathname;
    const flash = url.searchParams.get("msg")?.slice(0, 500) || undefined;
    const key = currentKey();
    const authed = same(cookies(req)[COOKIE] ?? "", sessionFor(key));

    // The remote chat's routes answer machines with their own tokens; only its approval page looks at the session.
    if (isRemoteMcpPath(path)) return remoteMcp(req, res, url, { authed, sameOrigin: sameOrigin(req), nonce, page: (status, html, targets) => send(res, status, html, nonce, {}, targets) });

    if (req.method === "POST" && path === "/login") {
      const form = await readForm(req);
      const given = form.get("k") ?? "";
      const to = safeBack(form.get("back"));
      if (!same(given, key)) {
        await new Promise((r) => setTimeout(r, 500));
        return send(res, 401, loginPage(nonce, true, to), nonce);
      }
      const cookie = `${COOKIE}=${sessionFor(key)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86_400}${viaHttps(req) ? "; Secure" : ""}`;
      res.writeHead(303, { Location: to ?? "/", "Set-Cookie": cookie, "Cache-Control": "no-store" });
      return void res.end();
    }
    if (!authed) return send(res, 401, loginPage(nonce), nonce);

    if (req.method === "GET") {
      if (path === "/line/events") return openStream(req, res, sessionFor(key), lineFeed);
      if (path === "/control-room/events") return openStream(req, res, sessionFor(key), controlFeed);
      if (path === "/") return send(res, 200, overviewPage(factoryStatus(ctx), requestLines(ctx), nonce, flash), nonce);
      if (path === "/line") {
        // The fragment is what the page's script fetches to update its rows in place.
        if (url.searchParams.get("fragment") === "1") return send(res, 200, lineView(productionLine(ctx)), nonce);
        return send(res, 200, linePage(productionLine(ctx), nonce), nonce);
      }
      if (path === "/requests") {
        const view = requestsView(ctx, { line: url.searchParams.get("line") || undefined, estado: url.searchParams.get("estado") || undefined }, ctx.now?.());
        return send(res, 200, requestsPage(view, nonce, flash), nonce);
      }
      const job = /^\/job\/([0-9a-f]{8})$/.exec(path)?.[1];
      if (job) {
        const away = jobElsewhere(ctx, job);
        if (away) return send(res, 200, factoryJobPage(away, nonce, flash), nonce);
        const own = getJob(ctx, job);
        const merge = JSON.parse(ctx.store.getKv(mergeKey(job)) ?? "{}") as Partial<MergeState>;
        const machine = factoryView(ctx, [own])?.find((j) => j.id === job)?.machine;
        return send(res, 200, jobPage(own, trace(ctx, job), nonce, flash, onSubscription(ctx.store, ctx.config.engine), merge.status, machine), nonce);
      }
      if (path === "/projects") return send(res, 200, projectPage(nonce, { flash }), nonce);
      if (path === "/egress") {
        const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 1) || 1, 1), 90);
        return send(res, 200, egressPage(egressReport(ctx, { days }), ctx.config.egress, nonce, flash), nonce);
      }
      if (path === "/proposals") return send(res, 200, proposalsPage(proposalsView(ctx), nonce, flash), nonce);
      if (path === "/remote-chat") return send(res, 200, remoteChatPage(remoteChatView(ctx, ctx.now?.()), nonce, flash), nonce);
      if (path === "/research") return send(res, 200, researchPage(researchView(ctx, ctx.now?.()), researchOnDemand(ctx), nonce, flash), nonce);
      if (path === "/control-room") {
        // Read-only: the fragment is what the page refreshes its modules with.
        const view = controlRoomView(ctx, ctx.now?.());
        if (url.searchParams.get("fragment") === "1") return send(res, 200, controlRoomFragment(view), nonce);
        return send(res, 200, controlRoomPage(view, nonce), nonce);
      }
      if (path === "/monitor") return send(res, 200, monitorPage(monitorView(ctx, parsePeriod(url.searchParams.get("periodo")), ctx.now?.()), nonce), nonce);
      if (path === "/report") {
        const line = url.searchParams.get("line") || undefined;
        const month = url.searchParams.get("mes") || undefined;
        const names = ctx.config.lines.map((l) => l.name);
        try {
          return send(res, 200, reportPage({ report: monthlyReport(ctx, { line, month }), names, line }, nonce), nonce);
        } catch (err) {
          return send(res, 400, reportPage({ error: err instanceof Error ? err.message : String(err), names, line, month }, nonce), nonce);
        }
      }
      if (path === "/report/export") {
        const line = url.searchParams.get("line") || undefined;
        const format = url.searchParams.get("format");
        try {
          if (!line) throw new Error("Indicá la línea del informe que querés descargar.");
          if (format !== "md" && format !== "html") throw new Error("El formato de descarga es md o html.");
          const report = monthlyReport(ctx, { line, month: url.searchParams.get("mes") || undefined }).lines[0]!;
          saveReport(ctx, report, format);
          res.writeHead(200, { ...headers(nonce), "Content-Type": `text/${format === "md" ? "markdown" : "html"}; charset=utf-8`, "Content-Disposition": `attachment; filename="${reportFileName(report, format)}"` });
          return void res.end(format === "md" ? reportMarkdown(report) : reportHtml(report));
        } catch (err) {
          return send(res, 400, page("Informe mensual", `<div class="card bad">${esc(err instanceof Error ? err.message : String(err))}</div><p><a href="/report">Volver</a></p>`, { nonce }), nonce);
        }
      }
      if (path === "/briefing") {
        const b = await briefing(ctx, Math.min(Math.max(Number(url.searchParams.get("days") ?? 1) || 1, 1), 90));
        return send(res, 200, briefingPage(b.title, b.body, nonce), nonce);
      }
      // Read-only pages: they have no POST route, so a POST to them falls through to the 404 below.
      if (path === "/about") return send(res, 200, aboutPage(await factoryGuide(ctx), nonce), nonce);
      if (path === "/agents") return send(res, 200, agentsPage(await factoryGuide(ctx), nonce, agentCatalog(ctx), flash), nonce);
      if (path === "/packages") {
        const onDemand = (ctx.config.loadedPackages?.stations ?? []).filter((s) => s.onDemand).map((s) => `${s.package}/${s.name}`);
        return send(res, 200, packagesPage(packageList(ctx), onDemand, nonce, flash, stationUploads(ctx)), nonce);
      }
      const tab = /^\/packages\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/.exec(path);
      if (tab) {
        const view = packageTabView(ctx, tab[1]!, tab[2]!, url.searchParams.get("categoria") || undefined);
        if (view) return send(res, 200, packageTabPage(view, nonce), nonce);
      }
      const tabDownload = /^\/packages\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/files\/(.+)$/.exec(path);
      if (tabDownload && sendTabFile(res, tabDownload[1]!, tabDownload[2]!, tabDownload[3]!, nonce)) return;
      return send(res, 404, page("No existe", `<div class="card">Esa página no existe. <a href="/">Volver</a></div>`, { nonce }), nonce);
    }

    if (req.method !== "POST") return send(res, 405, page("No permitido", "", { nonce }), nonce);
    if (!sameOrigin(req)) return send(res, 403, page("No permitido", `<div class="card">Pedido de otro sitio rechazado.</div>`, { nonce }), nonce);
    // Before readForm: a file is far larger than a form, so this route has its own limit, the station's.
    if (path === "/packages/upload") return upload(req, res, url, nonce);
    const form = await readForm(req);

    if (path === "/logout") {
      res.writeHead(303, { Location: "/", "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      return void res.end();
    }
    if (path === "/request") {
      return requested(res, requestAnywhere(ctx, { text: form.get("text") ?? "", line: form.get("line") || undefined }));
    }
    if (path === "/requests") {
      return requested(res, requestAnywhere(ctx, { type: form.get("type") ?? "", title: form.get("title") ?? "", description: form.get("description") ?? "", line: form.get("line") || undefined }));
    }
    if (path === "/projects") {
      const fields: ProjectForm = { name: form.get("name") ?? "", publico: form.get("publico") === "1", pedido: form.get("pedido") ?? "", verify: form.get("verify") ?? "" };
      const pedido = fields.pedido.trim();
      const verify = fields.verify.split("\n").map((c) => c.trim()).filter(Boolean);
      const input: ProjectInput = { name: fields.name.trim(), ...(fields.publico && { publico: true }), ...(pedido && { pedido }), ...(verify.length && { verify }) };
      // Creating a repository is visible from outside and hard to undo, so the first press only checks and shows the plan.
      if (form.get("confirm") !== "1") {
        const planned = projectPlan(ctx, input);
        return send(res, 200, "error" in planned ? projectPage(nonce, { form: fields, error: planned.error }) : confirmProjectPage(planned.plan, fields, nonce), nonce);
      }
      const r = await (opts.project ?? createProject)(ctx, { ...input, confirm: async () => true });
      return send(res, 200, projectResultPage(r, nonce), nonce);
    }
    const requestAction = /^\/requests\/([0-9a-f]{8})\/(answer|stop)$/.exec(path);
    if (requestAction) {
      const [, id, action] = requestAction as unknown as [string, string, string];
      if (action === "stop") {
        // Stopping cannot be undone, so the first press only asks for confirmation.
        if (form.get("confirm") !== "1") return send(res, 200, confirmStopPage(getJob(ctx, id), nonce), nonce);
        await stop(ctx, id);
        return back(res, "/requests", `Frenando el trabajo ${id}.`);
      }
      const decision = form.get("decision") === "approve" ? "approve" : "reject";
      const r = await answerAnywhere(ctx, id, decision, form.get("note") || undefined);
      return back(res, "/requests", "sent" in r ? r.sent : decision === "approve" ? `Aprobado: el trabajo ${id} sigue.` : `Rechazado: el trabajo ${id} se detuvo.`);
    }
    if (path === "/andon") {
      if (form.get("state") === "off") resume(ctx);
      else await stop(ctx);
      return back(res, "/", form.get("state") === "off" ? "Fábrica reanudada." : "Fábrica detenida: nada nuevo empieza hasta que la reanudes.");
    }
    if (path === "/unjam") {
      const r = requestUnjam(ctx, form.get("line") || undefined, ctx.now?.());
      return back(res, "/", r.ok ? r.text : r.reason);
    }
    if (path === "/research") {
      // A form sends each line break as two characters; the limit of the topic counts one, as its field does.
      const topic = (form.get("topic") ?? "").replace(/\r\n/g, "\n");
      const r = requestInvestigation(ctx, topic, form.get("line") || undefined, ctx.now?.());
      return back(res, "/research", r.ok ? r.text : r.reason);
    }
    const jobAction = /^\/job\/([0-9a-f]{8})\/(answer|stop|merge|discard)$/.exec(path);
    if (jobAction) {
      const [, id, action] = jobAction as unknown as [string, string, string];
      if (action === "merge") {
        // Merging cannot be undone, so the first press only asks for confirmation.
        if (form.get("confirm") !== "1") return send(res, 200, confirmMergePage(getJob(ctx, id), nonce), nonce);
        const r = await mergePullRequest(ctx, id, { via: "panel", ...(opts.merges && { api: opts.merges }) });
        return back(res, `/job/${id}`, formatMerge(r));
      }
      if (action === "discard") {
        const r = await discardJob(ctx, id, { reason: form.get("motivo") || undefined, via: "panel", ...(opts.merges && { api: opts.merges }) });
        return back(res, `/job/${id}`, formatDiscard(r));
      }
      if (action === "stop") {
        await stop(ctx, id);
        return back(res, `/job/${id}`, "Deteniendo el trabajo.");
      }
      const decision = form.get("decision") === "approve" ? "approve" : "reject";
      const r = await answerAnywhere(ctx, id, decision, form.get("note") || undefined);
      return back(res, `/job/${id}`, "sent" in r ? r.sent : decision === "approve" ? "Aprobado: el trabajo sigue." : "Rechazado: el trabajo se detuvo.");
    }
    const proposalAction = /^\/proposals\/([0-9a-f]{8})\/(approve|reject)$/.exec(path);
    if (proposalAction) {
      const [, id, action] = proposalAction as unknown as [string, string, string];
      if (action === "reject") {
        const r = await decideProposal(ctx, id, "reject", form.get("note") || undefined);
        return back(res, "/proposals", "sent" in r ? r.sent : "Propuesta rechazada.");
      }
      // Approving opens a job or integrates one, so the first press only asks for confirmation.
      if (form.get("confirm") !== "1") {
        const view = proposalsView(ctx);
        const proposal = view.lines.flatMap((l) => l.proposals).find((p) => p.id === id) ?? view.away?.find((p) => p.id === id);
        if (!proposal) throw new Error(`No existe la propuesta ${id}.`);
        return send(res, 200, confirmProposalPage(proposal, nonce), nonce);
      }
      const r = await decideProposal(ctx, id, "approve");
      return back(res, "/proposals", "approved" in r ? `Propuesta aprobada: trabajo ${r.approved.job.id}. ${r.approved.next}` : formatProposalDecision(id, r));
    }
    const revokeAction = /^\/remote-chat\/clients\/([0-9a-f-]{36})\/revoke$/.exec(path);
    if (revokeAction) {
      const id = revokeAction[1]!;
      // Revoking cuts the chat off at once, so the first press only asks for confirmation.
      if (form.get("confirm") !== "1") {
        const client = remoteChatView(ctx, ctx.now?.()).clients.find((c) => c.id === id);
        if (!client) throw new Error(`No hay ningún chat conectado ${id}.`);
        return send(res, 200, confirmRevokePage(client, nonce), nonce);
      }
      return back(res, "/remote-chat", revokeRemoteChatClient(ctx, id) ? "Chat revocado: sus tokens dejaron de servir." : `No hay ningún chat conectado ${id}.`);
    }
    const pendingAction = /^\/remote-chat\/pending\/([0-9a-f]{8})\/confirm$/.exec(path);
    if (pendingAction) {
      if (form.get("confirm") !== "1") return back(res, "/remote-chat");
      const r = await confirmRemoteAction(ctx, pendingAction[1]!, { ...(ctx.now && { now: ctx.now() }), ...(opts.merges && { merges: opts.merges }) });
      return back(res, "/remote-chat", r.text);
    }
    const researchAction = /^\/research\/([0-9a-f]{8})\/request$/.exec(path);
    if (researchAction) {
      const id = researchAction[1]!;
      // Requesting opens a job, so the first press only asks for confirmation.
      if (form.get("confirm") !== "1") {
        const note = ctx.store.getResearchNote(id);
        if (!note) throw new Error(`No existe la nota de investigación ${id}.`);
        return send(res, 200, confirmResearchPage(note, nonce), nonce);
      }
      const r = requestFromResearchNote(ctx, id);
      return back(res, "/research", `Trabajo pedido: ${r.job.id}. ${r.next}`);
    }
    if (path === "/agents/catalog/add") {
      const input = { id: form.get("id") ?? "", line: form.get("line") ?? "" };
      // Adding writes the factory file and the line's repository, so the first press only shows what would be written.
      if (form.get("confirm") !== "1") return send(res, 200, confirmCatalogPage(catalogAddPlan(ctx, input), nonce), nonce);
      const r = await addFromCatalog(ctx, { ...input, confirm: async () => true });
      return back(res, "/agents", r.text);
    }
    if (path === "/agents/catalog/reject") return back(res, "/agents", rejectCatalogEntry(ctx, { id: form.get("id") ?? "", note: form.get("note") || undefined }));
    if (path === "/packages/run") {
      // Only the person in charge gets here: the session was checked above.
      const r = requestStationRun(ctx, form.get("station") ?? "", new Date(), form.get("pedido") ?? undefined);
      return back(res, "/packages", r.ok ? r.text : r.reason);
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
