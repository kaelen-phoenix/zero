import { spawn } from "node:child_process";
import type { CustomEngine } from "../config.js";
import { killTree } from "../leftovers.js";
import { spawnTarget } from "../shell.js";
import { fullPrompt } from "./cli.js";
import type { Engine, EngineRequest, EngineResult } from "./types.js";

// ── Agent Client Protocol ────────────────────────────────────────────────────
// A minimal client: newline-delimited JSON-RPC 2.0 over the agent's stdio.
// zero offers no file system or terminal of its own, so the agent works with its
// own tools and asks before using them; zero answers those asks by access.

const ACP_PROTOCOL_VERSION = 1;
/** How much of stderr is kept to explain a failure. */
const STDERR_TAIL = 2000;
/** Tool kinds a read-only call may run: they change nothing. */
const READ_ONLY_KINDS = new Set(["read", "search", "think"]);

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null;

export interface AcpInvocation {
  bin: string;
  args: string[];
}

/** The agent's command line: the prompt never goes on argv. */
export function acpInvocation(def: CustomEngine, req: EngineRequest): AcpInvocation {
  const fill = (args: string[]) => args.map((a) => a.replaceAll("{model}", req.model ?? ""));
  const [bin, ...base] = def.command;
  if (!bin) throw new Error("ACP engine has an empty command");
  return { bin, args: [...base, ...fill(req.access === "write" ? def.writeArgs : def.readArgs), ...(req.model ? fill(def.modelArgs) : [])] };
}

interface PermissionOption {
  optionId: string;
  kind: string;
}

/** zero's answer to `session/request_permission`: writing calls allow, read-only ones allow only tools that change nothing. */
export function permissionOutcome(params: unknown, access: EngineRequest["access"]): JsonObject {
  const p = isObject(params) ? params : {};
  const options: PermissionOption[] = (Array.isArray(p.options) ? p.options : []).flatMap((o) =>
    isObject(o) && typeof o.optionId === "string" && typeof o.kind === "string" ? [{ optionId: o.optionId, kind: o.kind }] : [],
  );
  const kind = isObject(p.toolCall) ? p.toolCall.kind : undefined;
  const allowed = access === "write" || (typeof kind === "string" && READ_ONLY_KINDS.has(kind));
  const order = allowed ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const wanted of order) {
    const option = options.find((o) => o.kind === wanted);
    if (option) return { outcome: { outcome: "selected", optionId: option.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

class RpcError extends Error {}

async function runAcp(name: string, def: CustomEngine, req: EngineRequest): Promise<EngineResult> {
  const inv = acpInvocation(def, req);
  const target = spawnTarget(inv.bin, req.cwd);
  const child = spawn(target.bin, inv.args, { cwd: target.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32", ...(req.env && { env: { ...process.env, ...req.env } }) });
  const closed = new Promise<number | null>((resolve) => child.on("close", resolve));

  let stderr = "";
  let text = "";
  let model: string | undefined;
  let costUsd: number | undefined;
  let sessionId: string | undefined;
  let nextId = 0;
  const pending = new Map<number, { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // Whatever ends the run early (exit, timeout, cancel, a start failure) rejects every pending request at once.
  let fail: (e: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  let ended: Error | undefined;
  const end = (e: Error) => {
    if (ended) return;
    ended = e;
    for (const p of pending.values()) p.reject(e);
    pending.clear();
    fail(e);
  };

  const send = (message: JsonObject) => {
    if (!child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const request = (method: string, params: JsonObject): Promise<unknown> => {
    if (ended) return Promise.reject(ended);
    const id = nextId++;
    const answer = new Promise((resolve, reject) => pending.set(id, { method, resolve, reject }));
    send({ id, method, params });
    return answer;
  };

  const onUpdate = (params: unknown) => {
    if (!isObject(params) || !isObject(params.update)) return;
    if (sessionId !== undefined && params.sessionId !== sessionId) return;
    const update = params.update;
    if (update.sessionUpdate === "agent_message_chunk" && isObject(update.content) && update.content.type === "text" && typeof update.content.text === "string") {
      text += update.content.text;
    } else if (update.sessionUpdate === "usage_update" && isObject(update.cost) && update.cost.currency === "USD" && typeof update.cost.amount === "number" && Number.isFinite(update.cost.amount)) {
      costUsd = update.cost.amount;
    }
  };

  const onMessage = (message: JsonObject) => {
    const hasId = typeof message.id === "number" || typeof message.id === "string";
    if (typeof message.method === "string") {
      if (!hasId) {
        if (message.method === "session/update") onUpdate(message.params);
        return;
      }
      if (message.method === "session/request_permission") send({ id: message.id, result: permissionOutcome(message.params, req.access) });
      else send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      return;
    }
    if (!hasId) return;
    const waiting = pending.get(message.id as number);
    if (!waiting) return;
    pending.delete(message.id as number);
    if (isObject(message.error)) {
      const detail = typeof message.error.message === "string" ? message.error.message : JSON.stringify(message.error);
      waiting.reject(new RpcError(`${name} rechazó ${waiting.method}: ${detail}`));
    } else waiting.resolve(message.result);
  };

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("{")) continue;
      try {
        onMessage(JSON.parse(line) as JsonObject);
      } catch {
        // not a JSON-RPC message
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-4 * STDERR_TAIL)));
  child.stdin.on("error", () => {});
  child.on("error", (err) => end(new Error(`cannot start "${inv.bin}": ${err.message}. Is it installed and on PATH?`)));
  closed.then((code) => end(new Error(`${name} exited with ${code}: ${stderr.trim().slice(-STDERR_TAIL)}`)));

  const timer = setTimeout(() => end(new Error(`${name} timed out after ${req.timeoutMs / 60_000} min`)), req.timeoutMs);
  const cancel = () => end(new Error(`${name} cancelled`));
  if (req.signal?.aborted) cancel();
  req.signal?.addEventListener("abort", cancel, { once: true });

  const converse = async (): Promise<EngineResult> => {
    await request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const session = await request("session/new", { cwd: req.cwd, mcpServers: [] });
    if (!isObject(session) || typeof session.sessionId !== "string") return { ok: false, text: `${name} no devolvió una sesión` };
    sessionId = session.sessionId;
    if (isObject(session.models) && typeof session.models.currentModelId === "string") model = session.models.currentModelId;
    const answer = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: fullPrompt(req) }] });
    const stopReason = isObject(answer) ? answer.stopReason : undefined;
    if (stopReason !== "end_turn") return { ok: false, text: `${name} terminó con ${String(stopReason)}` };
    if (text.trim()) return { ok: true, text };
    const tail = stderr.trim().slice(-STDERR_TAIL);
    return { ok: false, text: `${name} devolvió salida vacía${tail ? `: ${tail}` : ""}` };
  };

  let result: EngineResult;
  try {
    result = await Promise.race([converse(), failed]);
  } catch (err) {
    // A start failure is thrown, as for every other engine; everything else is a failed call.
    if (!(err instanceof RpcError) && (err as Error).message.startsWith("cannot start")) throw err;
    result = { ok: false, text: (err as Error).message };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", cancel);
    // The agent is never left running: the call ends with its answer.
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) killTree(child);
    if (child.pid !== undefined) await closed;
  }
  return { ...result, ...(model && { model }), ...(costUsd !== undefined && { costUsd }) };
}

/** Any agent that speaks the Agent Client Protocol on stdio (`protocol: acp`). Read-only access is enforced by zero's workspace guard and by its answers to permission requests. */
export function acpEngine(name: string, def: CustomEngine): Engine {
  return {
    name,
    nativeSchema: false,
    unsandboxed: true,
    hosts: def.hosts,
    run: (req) => runAcp(name, def, req),
  };
}
