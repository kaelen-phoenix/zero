import { posix } from "node:path";
import { sh, type ShellResult } from "../shell.js";
import type { Tracer } from "../telemetry/tracer.js";
import type { ChangedFile, WorkCopy } from "../workspace.js";

const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|(^|\/)test_[^/]*\.py$|Tests?\.(java|kt|cs)$/;

/** Markers that switch tests off: `.skip`/`.only` (which skips the others), x-prefixed blocks, framework skip annotations. */
const DISABLING = [
  /\b(?:it|test|describe)\.(?:skip|only)\s*\(/,
  /\bx(?:it|describe|test)\s*\(/,
  /@pytest\.mark\.skip/,
  /@unittest\.skip/,
  /\bt\.Skip(?:Now|f)?\(/,
  /#\[ignore\]/,
  /@(?:Disabled|Ignore)\b/,
];

const MAX_FEEDBACK = 8_000;

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/**
 * Paths zero always protects, whatever `limits.protectedPaths` says: the
 * line's agent instructions are read from the owner's checkout, so a
 * delivered change to them would steer every later job.
 */
export const ALWAYS_PROTECTED = [".zero/**"];

export function protectedTouched(files: ChangedFile[], patterns: string[], allowed: string[] = []): string[] {
  // Lower-cased for the fixed list: on case-insensitive disks `.Zero/agents` is the same folder.
  const always = (p: string) => ALWAYS_PROTECTED.some((g) => posix.matchesGlob(p.toLowerCase(), g));
  return files
    .map((f) => f.path)
    .filter((p) => !allowed.includes(p) && (always(p) || patterns.some((g) => posix.matchesGlob(p, g))));
}

/** Ways the change could make tests pass by switching them off. */
export function testTampering(files: ChangedFile[], added: { path: string; text: string }[]): string[] {
  const problems = files.filter((f) => f.status === "D" && isTestFile(f.path)).map((f) => `se eliminó el archivo de test ${f.path}`);
  for (const a of added) {
    if (isTestFile(a.path) && DISABLING.some((re) => re.test(a.text))) problems.push(`se desactivó un test en ${a.path}: \`${a.text.trim().slice(0, 120)}\``);
  }
  return problems;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; kind: "protected"; paths: string[] }
  | { ok: false; kind: "failed"; feedback: string };

export interface VerifyOptions {
  commands: string[];
  protectedPaths: string[];
  allowedProtected?: string[];
  tracer: Tracer;
  jobId: string;
  parentId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Where commands run: on this machine by default, or in the isolation box. */
  run?: (command: string, opts: { timeoutMs: number; signal?: AbortSignal; parentId: string }) => Promise<ShellResult>;
}

/**
 * The verify station is run by zero itself, never by an agent: protected
 * paths first, then test tampering, then the line's commands.
 */
export async function verifyChange(copy: WorkCopy, opts: VerifyOptions): Promise<VerifyResult> {
  const files = copy.changedFiles();
  const touched = protectedTouched(files, opts.protectedPaths, opts.allowedProtected);
  if (touched.length) return { ok: false, kind: "protected", paths: touched };

  const tampering = testTampering(files, copy.addedLines());
  if (tampering.length) return { ok: false, kind: "failed", feedback: `La verificación rechazó el cambio:\n- ${tampering.join("\n- ")}\nNo elimines ni desactives tests; arreglá el código para que pasen.` };

  for (const command of opts.commands) {
    const span = opts.tracer.start("zero.verify.command", { jobId: opts.jobId, parentId: opts.parentId, attrs: { "process.command_line": command } });
    const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
    const r = opts.run ? await opts.run(command, { timeoutMs, signal: opts.signal, parentId: span.id }) : await sh(command, copy.cwd, { timeoutMs, signal: opts.signal });
    span.end(r.code === 0 ? "ok" : "error", { "process.exit.code": r.code, "zero.timed_out": r.timedOut });
    if (r.code !== 0) {
      const why = r.timedOut ? "superó el tiempo límite" : `terminó con código ${r.code}`;
      return { ok: false, kind: "failed", feedback: `\`${command}\` ${why}:\n${r.output.slice(-MAX_FEEDBACK)}` };
    }
  }
  return { ok: true };
}
