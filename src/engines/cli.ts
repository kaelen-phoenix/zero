import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomEngine } from "../config.js";
import type { Engine, EngineRequest, EngineResult } from "./types.js";

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
}

function runProcess({ bin, args, stdin }: Invocation, cwd: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`cannot start "${bin}": ${err.message}. Is it installed and on PATH?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
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

async function execute(name: string, inv: Invocation, req: EngineRequest): Promise<EngineResult> {
  const r = await runProcess(inv, req.cwd, req.timeoutMs);
  if (r.timedOut) return { ok: false, text: `${name} timed out after ${req.timeoutMs / 60_000} min` };
  if (r.code !== 0) return { ok: false, text: `${name} exited with ${r.code}: ${(r.stderr || r.stdout).slice(-2000)}` };
  return { ok: true, text: finalText(r.stdout) };
}

// ── OpenAI Codex ─────────────────────────────────────────────────────────────

export function codexInvocation(req: EngineRequest, files: { lastMessage: string; schema?: string }): Invocation {
  return {
    bin: "codex",
    args: [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox", req.access === "write" ? "workspace-write" : "read-only",
      "--output-last-message", files.lastMessage,
      ...(files.schema ? ["--output-schema", files.schema] : []),
      ...(req.model ? ["--model", req.model] : []),
      "-",
    ],
    stdin: fullPrompt(req),
  };
}

/** `codex exec` (needs CODEX_API_KEY or OPENAI_API_KEY). Sandboxing and schema are enforced by Codex. */
export const codexEngine: Engine = {
  name: "codex",
  nativeSchema: true,
  async run(req) {
    const dir = await mkdtemp(join(tmpdir(), "zero-codex-"));
    try {
      const files = { lastMessage: join(dir, "last.txt"), schema: req.schema && join(dir, "schema.json") };
      if (files.schema) await writeFile(files.schema, JSON.stringify(req.schema));
      const result = await execute("codex", codexInvocation(req, files), req);
      if (!result.ok) return result;
      const text = (await readFile(files.lastMessage, "utf8").catch(() => result.text)).trim();
      return { ok: true, text };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

// ── Google Antigravity ───────────────────────────────────────────────────────

export function antigravityInvocation(req: EngineRequest): Invocation {
  return {
    bin: "agy",
    args: [
      "-p", fullPrompt(req),
      "--output-format", "json",
      ...(req.access === "write" ? ["--dangerously-skip-permissions"] : []),
      ...(req.model ? ["--model", req.model] : []),
    ],
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
    run: (req) => execute(name, customInvocation(def, req), req),
  };
}
