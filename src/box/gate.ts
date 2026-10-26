import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { appendFileSync, readFileSync } from "node:fs";
import { createServer, request as httpRequest, STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import { connect, isIP } from "node:net";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { ALLOWED, judgeAddresses, judgeName, normalizeHost, UNAUTHENTICATED, type Destination, type EgressEvent, type EgressPolicy, type Refusal, type Verdict } from "./egress.js";

/**
 * The egress gate: the only way out of the box. An HTTP proxy (CONNECT for
 * HTTPS, absolute-form requests for plain HTTP) that judges every connection,
 * records it and never sees inside TLS. It runs in its own container and
 * shares one directory with the host:
 * - `policy.json`, written by the host and reloaded when it changes;
 * - `runs/<pass>.json`, one per box run in progress: the job and station a pass belongs to;
 * - `events-<day>.jsonl`, one line per connection, read by the host.
 */

export const GATE_PORT = 3128;
/** A pass is the password of the proxy URL; checked before it is used as a file name. */
export const PASS_PATTERN = /^[a-f0-9]{24}$/;
/** Tunnels with no traffic for this long are closed. */
const IDLE_MS = 15 * 60_000;
const DEFAULT_POLICY: EgressPolicy = { mode: "blocklist", allow: [], block: [] };

export interface GateOptions {
  dir: string;
  /** Resolves a name to its addresses; tests inject one. */
  lookup?: (host: string) => Promise<string[]>;
  now?: () => Date;
  onError?: (message: string) => void;
}

interface Run {
  job?: string;
  station?: string;
}

const systemLookup = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

export const eventsFile = (dir: string, at: Date) => join(dir, `events-${at.toISOString().slice(0, 10)}.jsonl`);

/** `host:port` of a CONNECT request, with IPv6 in brackets. */
export function parseAuthority(authority: string | undefined): Destination | undefined {
  const m = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/.exec(authority ?? "");
  if (!m) return undefined;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: normalizeHost(m[1]!), port } : undefined;
}

export function createGate(opts: GateOptions): Server {
  const lookup = opts.lookup ?? systemLookup;
  const now = opts.now ?? (() => new Date());
  const onError = opts.onError ?? ((m) => process.stderr.write(`${m}\n`));

  let policyText = "";
  let policy = DEFAULT_POLICY;
  const currentPolicy = (): EgressPolicy => {
    try {
      const text = readFileSync(join(opts.dir, "policy.json"), "utf8");
      if (text !== policyText) {
        policy = JSON.parse(text) as EgressPolicy;
        policyText = text;
      }
    } catch (err) {
      // A half-written or missing file: keep enforcing the last policy read.
      if (!policyText) onError(`gate: no policy yet (${String(err)})`);
    }
    return policy;
  };

  const runOf = (req: IncomingMessage): Run | undefined => {
    const m = /^basic\s+(\S+)$/i.exec(req.headers["proxy-authorization"] ?? "");
    if (!m) return undefined;
    const credentials = Buffer.from(m[1]!, "base64").toString("utf8");
    const pass = credentials.slice(credentials.indexOf(":") + 1);
    if (!PASS_PATTERN.test(pass)) return undefined;
    try {
      return JSON.parse(readFileSync(join(opts.dir, "runs", `${pass}.json`), "utf8")) as Run;
    } catch {
      return undefined;
    }
  };

  const record = (event: EgressEvent) => {
    try {
      appendFileSync(eventsFile(opts.dir, now()), `${JSON.stringify(event)}\n`);
    } catch (err) {
      onError(`gate: cannot record a connection to ${event.host}: ${String(err)}`);
    }
  };

  /** The verdict and, when allowed, the address to connect to: the same one that was checked. */
  const decide = async (dest: Destination): Promise<{ verdict: Verdict; address?: string }> => {
    const byName = judgeName(dest, currentPolicy());
    if (byName && !byName.allowed) return { verdict: byName };
    const addresses = isIP(dest.host) ? [dest.host] : await lookup(dest.host);
    if (!addresses.length) throw new Error("el nombre no tiene direcciones");
    if (!byName) {
      const verdict = judgeAddresses(addresses);
      if (!verdict.allowed) return { verdict };
    }
    return { verdict: ALLOWED, address: addresses[0] };
  };

  const start = (dest: Destination, run: Run | undefined) => ({
    id: randomUUID(),
    at: now().toISOString(),
    ...(run?.job && { job: run.job }),
    ...(run?.station && { station: run.station }),
    host: dest.host,
    port: dest.port,
  });

  /** Refusals are recorded before answering, so they are on disk by the time the box run ends. */
  const refuse = (base: ReturnType<typeof start>, verdict: Refusal) => {
    record({ ...base, allowed: false, rule: verdict.rule, reason: verdict.reason, bytesUp: 0, bytesDown: 0, durationMs: 0 });
    const body = `zero bloqueó la conexión a ${base.host}:${base.port}: ${verdict.reason}\n`;
    const headers: Record<string, string> = {
      ...(verdict.rule === "unauthenticated" && { "Proxy-Authenticate": 'Basic realm="zero"' }),
      "X-Zero-Rule": verdict.rule,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
      Connection: "close",
    };
    return { status: verdict.rule === "unauthenticated" ? 407 : 403, headers, body };
  };
  const rawResponse = ({ status, headers, body }: ReturnType<typeof refuse>) =>
    [`HTTP/1.1 ${status} ${STATUS_CODES[status]}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", body].join("\r\n");

  const server = createServer();

  // HTTPS and anything else tunnelled: the gate sees the name and the bytes, never the content.
  server.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => client.destroy());
    const dest = parseAuthority(req.url);
    if (!dest) return void client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    const run = runOf(req);
    const base = start(dest, run);
    if (!run) return void client.end(rawResponse(refuse(base, UNAUTHENTICATED)));
    const t0 = Date.now();
    decide(dest).then(
      ({ verdict, address }) => {
        if (!verdict.allowed) return void client.end(rawResponse(refuse(base, verdict)));
        let up = head.length;
        let down = 0;
        let open = false;
        let done = false;
        const upstream = connect({ host: address!, port: dest.port });
        const finish = (error?: string) => {
          if (done) return;
          done = true;
          record({ ...base, allowed: true, bytesUp: up, bytesDown: down, durationMs: Date.now() - t0, ...(error && { error }) });
          client.destroy();
          upstream.destroy();
        };
        upstream.once("connect", () => {
          open = true;
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          client.on("data", (d: Buffer) => (up += d.length));
          upstream.on("data", (d: Buffer) => (down += d.length));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.setTimeout(IDLE_MS, () => finish("sin actividad"));
        upstream.on("error", (err) => {
          if (!open) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
          finish(err.message);
        });
        upstream.on("close", () => finish());
        client.on("close", () => finish());
      },
      (err: unknown) => {
        record({ ...base, allowed: true, bytesUp: 0, bytesDown: 0, durationMs: Date.now() - t0, error: `no se pudo resolver: ${String(err)}` });
        client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      },
    );
  });

  // Plain HTTP through the proxy: `GET http://host/path`.
  server.on("request", (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      return void res.writeHead(400).end("zero gate: use me as a proxy\n");
    }
    if (url.protocol !== "http:") return void res.writeHead(400).end("zero gate: use CONNECT for https\n");
    const dest = { host: normalizeHost(url.hostname), port: Number(url.port || 80) };
    const run = runOf(req);
    const base = start(dest, run);
    const reply = (verdict: Refusal) => {
      const r = refuse(base, verdict);
      res.writeHead(r.status, r.headers).end(r.body);
    };
    if (!run) return reply(UNAUTHENTICATED);
    const t0 = Date.now();
    decide(dest).then(
      ({ verdict, address }) => {
        if (!verdict.allowed) return reply(verdict);
        let up = 0;
        let down = 0;
        let done = false;
        const finish = (error?: string) => {
          if (done) return;
          done = true;
          record({ ...base, allowed: true, bytesUp: up, bytesDown: down, durationMs: Date.now() - t0, ...(error && { error }) });
        };
        const headers = { ...req.headers };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        const upstream = httpRequest({ host: address, port: dest.port, method: req.method, path: `${url.pathname}${url.search}`, headers, setHost: false }, (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.on("data", (d: Buffer) => (down += d.length));
          upRes.pipe(res);
        });
        upstream.setTimeout(IDLE_MS, () => upstream.destroy(new Error("sin actividad")));
        upstream.on("error", (err) => {
          if (!res.headersSent) res.writeHead(502).end();
          else res.destroy();
          finish(err.message);
        });
        req.on("data", (d: Buffer) => (up += d.length));
        req.pipe(upstream);
        res.on("close", () => finish());
      },
      (err: unknown) => {
        record({ ...base, allowed: true, bytesUp: 0, bytesDown: 0, durationMs: Date.now() - t0, error: `no se pudo resolver: ${String(err)}` });
        res.writeHead(502).end();
      },
    );
  });

  server.on("clientError", (_err, socket) => socket.destroy());
  return server;
}
