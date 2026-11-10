import { posix } from "node:path";
import { sh, tryGit, type ShellResult } from "../shell.js";
import type { Tracer } from "../telemetry/tracer.js";
import type { ChangedFile, WorkCopy } from "../workspace.js";
import { DEFAULT_VERIFY_MINUTES, VERIFY_COMMAND_SPAN } from "./pace.js";

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
  // Paths and the whole list lower-cased: on case-insensitive disks `.Zero/agents` or `.Claude` is the same folder. Approvals stay exact.
  const globs = [...ALWAYS_PROTECTED, ...patterns].map((g) => g.toLowerCase());
  return files
    .map((f) => f.path)
    .filter((p) => !allowed.includes(p) && globs.some((g) => posix.matchesGlob(p.toLowerCase(), g)));
}

/** Ways the change could make tests pass by switching them off. */
export function testTampering(files: ChangedFile[], added: { path: string; text: string }[]): string[] {
  const problems = files.filter((f) => f.status === "D" && isTestFile(f.path)).map((f) => `se eliminó el archivo de test ${f.path}`);
  for (const a of added) {
    if (isTestFile(a.path) && DISABLING.some((re) => re.test(a.text))) problems.push(`se desactivó un test en ${a.path}: \`${a.text.trim().slice(0, 120)}\``);
  }
  return problems;
}

/** Shapes of what the factory produces while working, with what the person reading the refusal is told. */
const ARTIFACT_SHAPES: { shape: RegExp; why: string }[] = [
  { shape: /\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3)$/i, why: "base de datos" },
  { shape: /\.log$/i, why: "log" },
  { shape: /(^|\/)(zero\.factory\.yaml|daemon\.lock|secrets\.enc)$/i, why: "archivo de ZERO_HOME" },
  { shape: /(^|\/)\.zero\/(townhall|worktrees|jobs|gate|bin|packages|reports|drills)\//i, why: "carpeta de ZERO_HOME" },
  { shape: /(^|\/)plus-[^/]+\//i, why: "carpeta plus-* de la operación" },
  { shape: /(^|\/)(reports?|informes?)\/(.*\/)?[^/]+\.(md|html|htm|pdf|csv|json|xlsx|txt|xml)$/i, why: "informe generado" },
  { shape: /(^|\/)(informe|briefing)-[^/]*\.(md|html|pdf)$/i, why: "informe generado" },
];

/** What a regeneration drill writes next to its copy of the repository: `drills/<id>/informe.md` and `resultado.json`. */
const DRILL_OUTPUT = /^(?:(.*)\/)?(informe\.md|resultado\.json)$/i;
const DRILL_FOLDER = /(^|\/)drills\/[^/]+$/i;

/** Lower-cased folders whose added files are a drill's: `drills/<id>/` holding its output, and folders holding the whole pair. */
function drillFolders(paths: string[]): { drills: string[]; pairs: Set<string> } {
  const seen = new Map<string, Set<string>>();
  for (const path of paths) {
    const m = DRILL_OUTPUT.exec(path.toLowerCase());
    if (!m) continue;
    const dir = m[1] ?? "";
    seen.set(dir, (seen.get(dir) ?? new Set()).add(m[2]!));
  }
  const dirs = [...seen.keys()];
  return { drills: dirs.filter((d) => DRILL_FOLDER.test(d)).map((d) => `${d}/`), pairs: new Set(dirs.filter((d) => seen.get(d)!.size === 2)) };
}

const MEDIA =/\.(png|jpe?g|gif|webp|avif|bmp|tiff?|heic|svg|ico|mp4|m4v|mov|webm|mkv|avi)$/i;

export interface OperationArtifact {
  path: string;
  why: string;
}

/**
 * Files the change adds that look like the factory's operation output, which
 * stays in ZERO_HOME: only development for a repository enters it. Files
 * already versioned are not its doing; `allowed` is the line's say.
 */
export function operationArtifacts(files: ChangedFile[], opts: { allowed: string[]; ownSpecDir?: string; referenced: (path: string) => boolean }): OperationArtifact[] {
  const globs = opts.allowed.map((g) => g.toLowerCase());
  const found: OperationArtifact[] = [];
  // Drill output is told by its siblings, so allowed paths still count here.
  const { drills, pairs } = drillFolders(files.filter((f) => f.status === "A").map((f) => f.path));
  const drill = (path: string) => {
    const lower = path.toLowerCase();
    const m = DRILL_OUTPUT.exec(lower);
    return drills.some((d) => lower.startsWith(d)) || (m !== null && pairs.has(m[1] ?? ""));
  };
  for (const { status, path } of files) {
    if (status !== "A" || globs.some((g) => posix.matchesGlob(path.toLowerCase(), g))) continue;
    // The job's own specification, whatever its capability is called (`specs/reports/spec.md`).
    if (opts.ownSpecDir && path.startsWith(opts.ownSpecDir) && /\.md$/i.test(path)) continue;
    const why =
      ARTIFACT_SHAPES.find((a) => a.shape.test(path))?.why ??
      (drill(path) ? "simulacro de regeneración" : undefined) ??
      (MEDIA.test(path) && !opts.referenced(path) ? "imagen o video que nada del repositorio menciona" : undefined);
    if (why) found.push({ path, why });
  }
  return found;
}

/** Whether a text file of HEAD names the file, not counting itself or `openspec/`. A git that does not answer counts as no reference. */
function referencedAtHead(cwd: string, path: string): boolean {
  return tryGit(["grep", "-F", "-i", "-I", "-l", "-e", posix.basename(path), "HEAD", "--", ".", ":(exclude)openspec/**", `:(exclude,literal)${path}`], cwd) !== undefined;
}

/** The operation output in everything the job's branch adds to its base. */
export function changeArtifacts(copy: Pick<WorkCopy, "cwd" | "changedFiles">, allowed: string[] = [], ownSpecDir?: string): OperationArtifact[] {
  return operationArtifacts(copy.changedFiles(), { allowed, ownSpecDir, referenced: (path) => referencedAtHead(copy.cwd, path) });
}

export function artifactFeedback(found: OperationArtifact[]): string {
  return `El cambio agrega archivos con forma de producto de la operación de la fábrica, que queda solo en ZERO_HOME; a un repositorio solo entra desarrollo para ese repositorio:\n${found.map((a) => `- ${a.path}: ${a.why}`).join("\n")}\nQuitalos del cambio. Si esta línea los versiona a propósito, sus rutas van en \`allowedArtifacts\` de la línea, en el archivo de la fábrica.`;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; kind: "protected"; paths: string[] }
  | { ok: false; kind: "failed"; feedback: string };

export interface VerifyOptions {
  commands: string[];
  protectedPaths: string[];
  allowedProtected?: string[];
  /** The line's `allowedArtifacts`. */
  allowedArtifacts?: string[];
  /** The job's own `openspec/changes/<change>/` folder. */
  ownSpecDir?: string;
  tracer: Tracer;
  jobId: string;
  parentId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** The time limit of each command, when it depends on the command (see `verifyTimeoutMs`); `timeoutMs` otherwise. */
  timeoutFor?: (command: string) => number;
  /** Where commands run: on this machine by default, or in the isolation box. */
  run?: (command: string, opts: { timeoutMs: number; signal?: AbortSignal; parentId: string }) => Promise<ShellResult>;
}

/**
 * Whether the output of a failed command reads like trouble of the machine and not of the change: a test that ran
 * out of its own time (a busy machine), no memory, a file something else holds, a worker that died, a network cut.
 * Such a failure is worth one more run before the build agent is asked to fix code that may be fine.
 */
export function machineTrouble(output: string): boolean {
  return MACHINE_TROUBLE.test(output);
}

const MACHINE_TROUBLE = new RegExp(
  [
    String.raw`(?:Test|Hook) timed out in \d+ ?ms`, // vitest
    String.raw`Exceeded timeout of \d+ ?ms`, // jest
    String.raw`[Tt]imeout of \d+ ?ms exceeded`, // playwright, mocha
    "heap out of memory",
    "cannot allocate memory",
    String.raw`\b(?:ENOMEM|EBUSY|EMFILE|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b`,
    "Worker exited unexpectedly",
  ].join("|"),
);

/**
 * The verify station is run by zero itself, never by an agent: operation
 * output first (nobody is asked about a change that fails anyway), then
 * protected paths, then test tampering, then the line's commands.
 */
export async function verifyChange(copy: WorkCopy, opts: VerifyOptions): Promise<VerifyResult> {
  const artifacts = changeArtifacts(copy, opts.allowedArtifacts, opts.ownSpecDir);
  if (artifacts.length) return { ok: false, kind: "failed", feedback: artifactFeedback(artifacts) };

  const files = copy.changedFiles();
  const touched = protectedTouched(files, opts.protectedPaths, opts.allowedProtected);
  if (touched.length) return { ok: false, kind: "protected", paths: touched };

  const tampering = testTampering(files, copy.addedLines());
  if (tampering.length) return { ok: false, kind: "failed", feedback: `La verificación rechazó el cambio:\n- ${tampering.join("\n- ")}\nNo elimines ni desactives tests; arreglá el código para que pasen.` };

  for (const command of opts.commands) {
    const timeoutMs = opts.timeoutFor?.(command) ?? opts.timeoutMs ?? DEFAULT_VERIFY_MINUTES * 60_000;
    const once = async (again: boolean) => {
      const span = opts.tracer.start(VERIFY_COMMAND_SPAN, { jobId: opts.jobId, parentId: opts.parentId, attrs: { "process.command_line": command, ...(again && { "zero.verify.again": true }) } });
      const r = opts.run ? await opts.run(command, { timeoutMs, signal: opts.signal, parentId: span.id }) : await sh(command, copy.cwd, { timeoutMs, signal: opts.signal });
      const machine = r.code !== 0 && !r.timedOut && machineTrouble(r.output);
      span.end(r.code === 0 ? "ok" : "error", { "process.exit.code": r.code, "zero.timed_out": r.timedOut, "zero.timeout_ms": timeoutMs, ...(r.ms !== undefined && { "zero.run_ms": r.ms }), ...(machine && { "zero.verify.machine": true }) });
      return { r, machine };
    };
    let { r, machine } = await once(false);
    // A failure that reads like the machine and not the change is run once more before it costs an attempt.
    if (machine && !opts.signal?.aborted) ({ r } = await once(true));
    if (r.code !== 0) {
      // A limit reached says so with its size and where it is set: the tests may be fine and the machine slow.
      const why = r.timedOut
        ? `superó el tiempo límite de ${Math.round(timeoutMs / 60_000)} minutos (si el comando necesita más en esta máquina, el límite es \`verifyTimeoutMinutes\` de la línea, en el archivo de la fábrica)`
        : `terminó con código ${r.code}`;
      return { ok: false, kind: "failed", feedback: `\`${command}\` ${why}:\n${r.output.slice(-MAX_FEEDBACK)}` };
    }
  }
  return { ok: true };
}
