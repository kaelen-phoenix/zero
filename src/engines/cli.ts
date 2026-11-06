import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomEngine } from "../config.js";
import { spawnTarget } from "../shell.js";
import { toStrictSchema, withoutOptionalNulls } from "./codex-schema.js";
import type { Engine, EngineRequest, EngineResult, QuotaReport, QuotaWindow } from "./types.js";

export interface Invocation {
  bin: string;
  args: string[];
  /** Sent on stdin when the CLI reads the prompt from there. */
  stdin?: string;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export function runProcess({ bin, args, stdin }: Invocation, cwd: string, timeoutMs: number, signal?: AbortSignal, env?: Record<string, string>): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const target = spawnTarget(bin, cwd);
    const child = spawn(target.bin, args, { cwd: target.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, ...(env && { env: { ...process.env, ...env } }) });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const cancel = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    if (signal?.aborted) cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new Error(`cannot start "${bin}": ${err.message}. Is it installed and on PATH?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve({ code, stdout, stderr, timedOut, cancelled });
    });
    // A process that exits without reading breaks the pipe: its `close` or `error` decides the result.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
  });
}

/** The prompt as seen by CLIs without a separate system prompt. */
export const fullPrompt = (req: EngineRequest) => `${req.instructions}\n\n---\n\n${req.prompt}`;

/** Final text from a CLI's stdout: JSON envelopes are unwrapped, plain text is passed through. */
export function finalText(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed) {
      for (const key of ["result", "response", "text", "output", "message"]) {
        if (typeof parsed[key] === "string") return parsed[key];
      }
    }
  } catch {
    // not a JSON envelope
  }
  return trimmed;
}

/** A clean exit without text is an engine failure, not an empty answer. */
function fromText(name: string, text: string, stderr: string): EngineResult {
  if (text.trim()) return { ok: true, text };
  const tail = stderr.trim().slice(-2000);
  return { ok: false, text: `${name} devolvió salida vacía${tail ? `: ${tail}` : ""}` };
}

/** How an engine differs from one that answers on stdout and reports no plan. */
interface ExecuteHooks {
  output?: (r: ProcessResult) => string | Promise<string>;
  /** What explains a failed exit. */
  failure?: (r: ProcessResult) => string;
  /** The plan reading of a call that was not cancelled. */
  quota?: (r: ProcessResult, ok: boolean) => Promise<QuotaReport | undefined>;
}

async function execute(name: string, inv: Invocation, req: EngineRequest, hooks: ExecuteHooks = {}): Promise<EngineResult> {
  const r = await runProcess(inv, req.cwd, req.timeoutMs, req.signal, req.env);
  if (r.cancelled) return { ok: false, text: `${name} cancelled` };
  const result = await outcome(name, r, req, hooks);
  const quota = await hooks.quota?.(r, result.ok);
  return quota ? { ...result, quota } : result;
}

async function outcome(name: string, r: ProcessResult, req: EngineRequest, { output = (p) => finalText(p.stdout), failure = (p) => p.stderr || p.stdout }: ExecuteHooks): Promise<EngineResult> {
  if (r.timedOut) return { ok: false, text: `${name} timed out after ${req.timeoutMs / 60_000} min` };
  if (r.code !== 0) return { ok: false, text: `${name} exited with ${r.code}: ${failure(r).slice(-2000)}` };
  return fromText(name, await output(r), r.stderr);
}

// ── OpenAI Codex ─────────────────────────────────────────────────────────────

/** `codex login status` is only a courtesy: it never holds a finished call for longer than this. */
const CODEX_LOGIN_TIMEOUT_MS = 10_000;
const CODEX_API_KEYS = ["CODEX_API_KEY", "OPENAI_API_KEY"];
/** How deep an event is searched for `rate_limits`. */
const RATE_LIMITS_MAX_DEPTH = 16;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null;

/** The JSON objects among the lines of `codex exec --json`; other lines are skipped. */
export function codexEvents(stdout: string): JsonObject[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    if (!line.trimStart().startsWith("{")) return [];
    try {
      return [JSON.parse(line) as JsonObject];
    } catch {
      return [];
    }
  });
}

/** The answer when the last-message file cannot be read: raw events are never an answer. */
export function codexAnswer(stdout: string): string {
  const events = codexEvents(stdout);
  if (!events.length) return stdout;
  const messages = events.flatMap((e) => (e.type === "item.completed" && isObject(e.item) && e.item.type === "agent_message" && typeof e.item.text === "string" ? [e.item.text] : []));
  return messages.at(-1) ?? "";
}

/** What the last `error` or `turn.failed` event says. */
export function codexError(stdout: string): string | undefined {
  const messages = codexEvents(stdout).flatMap((e) => {
    if (e.type !== "error" && e.type !== "turn.failed") return [];
    const message = isObject(e.error) ? e.error.message : e.message;
    return typeof message === "string" && message.trim() ? [message] : [];
  });
  return messages.at(-1);
}

/** How a `codex login status` output says the session is billed; undefined when it does not say. */
export function codexLoginBilling(output: string): QuotaReport["billing"] | undefined {
  if (/not logged in/i.test(output)) return undefined;
  if (/chatgpt/i.test(output)) return "subscription";
  return /api[ -]?key/i.test(output) ? "api" : undefined;
}

function windowLabel(name: string, minutes: unknown): string {
  if (typeof minutes !== "number" || !(minutes > 0)) return name;
  if (minutes === 10_080) return "semana";
  if (minutes % 60 !== 0) return `${minutes} minutos`;
  return minutes === 60 ? "1 hora" : `${minutes / 60} horas`;
}

function isoTime(ms: number): string | undefined {
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** A window's renewal: `resets_at` (Unix seconds), else `resets_in_seconds` from `now`. */
function windowReset(raw: JsonObject, now: Date): string | undefined {
  const at = typeof raw.resets_at === "number" ? isoTime(raw.resets_at * 1000) : undefined;
  if (at) return at;
  return typeof raw.resets_in_seconds === "number" ? isoTime(now.getTime() + raw.resets_in_seconds * 1000) : undefined;
}

function rateLimitWindows(limits: unknown, now: Date): QuotaWindow[] {
  if (!isObject(limits)) return [];
  return (["primary", "secondary"] as const).flatMap((name): QuotaWindow[] => {
    const raw = limits[name];
    if (!isObject(raw) || typeof raw.used_percent !== "number" || !Number.isFinite(raw.used_percent)) return [];
    const utilization = Math.max(0, Math.min(1, raw.used_percent / 100));
    const resetsAt = windowReset(raw, now);
    return [{ name, label: windowLabel(name, raw.window_minutes), utilization, status: utilization >= 1 ? "exhausted" : "ok", ...(resetsAt && { resetsAt }) }];
  });
}

/** The last valid `rate_limits` at any level of a value. */
function nestedWindows(value: unknown, now: Date, depth = 0): QuotaWindow[] {
  if (!isObject(value) || depth > RATE_LIMITS_MAX_DEPTH) return [];
  let found: QuotaWindow[] = [];
  for (const [key, child] of Object.entries(value)) {
    const windows = key === "rate_limits" ? rateLimitWindows(child, now) : nestedWindows(child, now, depth + 1);
    if (windows.length) found = windows;
  }
  return found;
}

/** The plan's windows from the last valid `rate_limits` of the events. */
export function codexWindows(stdout: string, now = new Date()): QuotaWindow[] {
  let found: QuotaWindow[] = [];
  for (const event of codexEvents(stdout)) {
    const windows = nestedWindows(event, now);
    if (windows.length) found = windows;
  }
  return found;
}

/**
 * What a run tells about the plan. Only plans report usage windows, so windows
 * without any word on the session still mean a subscription; a failed call with
 * a window used up counts as refused by the plan.
 */
export function codexQuota(session: QuotaReport["billing"] | undefined, windows: QuotaWindow[], ok: boolean): QuotaReport | undefined {
  const billing = session ?? (windows.length ? "subscription" : undefined);
  if (!billing) return undefined;
  if (billing === "api") return { billing, windows: [] };
  return { billing, windows, ...(!ok && windows.some((w) => w.status === "exhausted") && { limited: true }) };
}

/** How this call's session is billed: a key in its environment decides; otherwise `codex login status`, and any failure of it means no answer. */
async function codexSession(req: EngineRequest, cwd: string): Promise<QuotaReport["billing"] | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...req.env };
  if (CODEX_API_KEYS.some((key) => env[key])) return "api";
  if (req.signal?.aborted) return undefined;
  try {
    const r = await runProcess({ bin: "codex", args: ["login", "status"] }, cwd, CODEX_LOGIN_TIMEOUT_MS, req.signal, req.env);
    return r.code === 0 ? codexLoginBilling(`${r.stdout}\n${r.stderr}`) : undefined;
  } catch {
    return undefined;
  }
}

export function codexInvocation(req: EngineRequest, files: { lastMessage: string; schema?: string }, sandbox: "on" | "off" = "on"): Invocation {
  return {
    bin: "codex",
    args: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      ...(sandbox === "off" ? ["--sandbox", "danger-full-access", "-c", "approval_policy=\"never\""] : ["--sandbox", req.access === "write" ? "workspace-write" : "read-only"]),
      "--output-last-message", files.lastMessage,
      ...(files.schema ? ["--output-schema", files.schema] : []),
      ...(req.model ? ["--model", req.model] : []),
      "-",
    ],
    stdin: fullPrompt(req),
  };
}

/** An answer that is not JSON stays as text, for the runner's validation to judge. */
function withStructuredOutput(schema: Record<string, unknown>, result: EngineResult): EngineResult {
  let answer: unknown;
  try {
    answer = JSON.parse(result.text);
  } catch {
    return result;
  }
  return { ...result, output: withoutOptionalNulls(schema, answer) };
}

async function runCodex(req: EngineRequest, sandbox: "on" | "off"): Promise<EngineResult> {
  // Codex only takes OpenAI's strict schemas; one with no strict form fails before codex starts.
  let strict: Record<string, unknown> | undefined;
  try {
    strict = req.schema && toStrictSchema(req.schema);
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
  const dir = await mkdtemp(join(tmpdir(), "zero-codex-"));
  try {
    const files = { lastMessage: join(dir, "last.txt"), schema: strict && join(dir, "schema.json") };
    if (files.schema) await writeFile(files.schema, JSON.stringify(strict));
    const result = await execute("codex", codexInvocation(req, files, sandbox), req, {
      // The answer is the last message; stdout is only the fallback when that file cannot be read.
      output: async (r) => (await readFile(files.lastMessage, "utf8").catch(() => codexAnswer(r.stdout))).trim(),
      failure: (r) => (r.stderr.trim() ? r.stderr : (codexError(r.stdout) ?? r.stdout)),
      quota: async (r, ok) => codexQuota(await codexSession(req, dir), codexWindows(r.stdout), ok),
    });
    return req.schema && result.ok ? withStructuredOutput(req.schema, result) : result;
  } finally {
    // A leftover temporary folder never changes the call's result.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** `codex exec`, on a ChatGPT sign-in or with CODEX_API_KEY or OPENAI_API_KEY. Sandboxing is enforced by Codex; schemas go in OpenAI's strict form. */
export const codexEngine: Engine = {
  name: "codex",
  nativeSchema: true,
  // API keys use api.openai.com; a ChatGPT sign-in uses chatgpt.com.
  hosts: ["api.openai.com", "chatgpt.com"],
  run: (req) => runCodex(req, "on"),
};

/** Codex without its own sandbox (`codex.sandbox: off`). Only the host starts it this way: the box resolves plain `codexEngine`. */
export const unsandboxedCodexEngine: Engine = { ...codexEngine, unsandboxed: true, run: (req) => runCodex(req, "off") };

// ── Google Antigravity ───────────────────────────────────────────────────────

/** Longest prompt passed as an argument: the Windows command line stops at about 32K characters. */
const AGY_MAX_ARG_PROMPT = 30_000;
const AGY_STDIN_INSTRUCTION = "Follow the instructions received on stdin.";

export function antigravityInvocation(req: EngineRequest): Invocation {
  const prompt = fullPrompt(req);
  const onStdin = prompt.length > AGY_MAX_ARG_PROMPT;
  return {
    bin: "agy",
    args: [
      "-p", onStdin ? AGY_STDIN_INSTRUCTION : prompt,
      "--output-format", "json",
      ...(req.access === "write" ? ["--dangerously-skip-permissions"] : []),
      ...(req.model ? ["--model", req.model] : []),
    ],
    stdin: onStdin ? prompt : undefined,
  };
}

/** Antigravity CLI `agy -p` (needs ANTIGRAVITY_API_KEY). Read-only access is enforced by zero's workspace guard. */
export const antigravityEngine: Engine = {
  name: "antigravity",
  nativeSchema: false,
  run: (req) => execute("antigravity", antigravityInvocation(req), req),
};

// ── Any other CLI, declared in zero.config.json ──────────────────────────────

export function customInvocation(def: CustomEngine, req: EngineRequest): Invocation {
  const prompt = fullPrompt(req);
  const fill = (args: string[]) =>
    args.map((a) => a.replaceAll("{prompt}", prompt).replaceAll("{model}", req.model ?? ""));
  const [bin, ...base] = fill(def.command);
  if (!bin) throw new Error("custom engine has an empty command");
  return {
    bin,
    args: [
      ...base,
      ...fill(req.access === "write" ? def.writeArgs : def.readArgs),
      ...(req.model ? fill(def.modelArgs) : []),
    ],
    stdin: def.command.some((a) => a.includes("{prompt}")) ? undefined : prompt,
  };
}

export function customEngine(name: string, def: CustomEngine): Engine {
  return {
    name,
    nativeSchema: false,
    hosts: def.hosts,
    run: (req) => execute(name, customInvocation(def, req), req),
  };
}
