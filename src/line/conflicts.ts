import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { spawnGit } from "../shell.js";

/**
 * Model-free resolution of the simple conflicts of merging the base into a branch: sides that are equal, sides
 * that only touch single-line imports, and sides that both add different lines where the base had none. Anything
 * else is left to the build station.
 */

const OPEN = /^<{7}(?: .*)?\r?$/;
const BASE = /^\|{7}(?: .*)?\r?$/;
const SPLIT = /^={7}\r?$/;
const CLOSE = /^>{7}(?: .*)?\r?$/;

/** Single-line import statements: JS/TS `import … from "x"`, `import "x"`, `export … from "x"`, Python `import a` and `from a import b`. */
const IMPORT_LINES = [
  /^\s*import\s+(?:type\s+)?[^;]*?\bfrom\s+(['"])[^'"]+\1\s*;?\s*$/,
  /^\s*import\s+(['"])[^'"]+\1\s*;?\s*$/,
  /^\s*export\s+(?:type\s+)?[^;]*?\bfrom\s+(['"])[^'"]+\1\s*;?\s*$/,
  /^import\s+[\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*\s*$/,
  /^from\s+[\w.]+\s+import\s+[^()\\#]+$/,
];

const bare = (line: string) => line.replace(/\r$/, "");
const isImport = (line: string) => IMPORT_LINES.some((re) => re.test(bare(line)));

/** One conflict hunk: what each side holds, and the base when the markers carry it (diff3). */
interface Hunk {
  ours: string[];
  base?: string[];
  theirs: string[];
}

function resolveHunk({ ours, base, theirs }: Hunk): string[] | undefined {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => bare(l) === bare(b[i]!));
  if (same(ours, theirs)) return ours;
  const sides = [...ours, ...theirs];
  if (sides.length && sides.every(isImport) && (base ?? []).every(isImport)) {
    const seen = new Set<string>();
    return sides.filter((l) => !seen.has(bare(l)) && seen.add(bare(l)));
  }
  if (base?.length === 0 && ours.length && theirs.length) {
    const mine = new Set(ours.map(bare));
    if (theirs.every((l) => !mine.has(bare(l)))) return sides;
  }
  return undefined;
}

/** The text of a file with diff3 conflict markers, every hunk resolved; undefined when a hunk is not simple or the markers are malformed. */
export function resolveDiff3(text: string): string | undefined {
  const out: string[] = [];
  let hunk: Hunk | undefined;
  let part: "ours" | "base" | "theirs" = "ours";
  for (const line of text.split("\n")) {
    if (!hunk) {
      if (OPEN.test(line)) (hunk = { ours: [], theirs: [] }), (part = "ours");
      else if (BASE.test(line) || CLOSE.test(line)) return undefined;
      else out.push(line);
      continue;
    }
    if (OPEN.test(line)) return undefined;
    if (BASE.test(line)) {
      if (part !== "ours") return undefined;
      (hunk.base = []), (part = "base");
    } else if (SPLIT.test(line) && part !== "theirs") part = "theirs";
    else if (CLOSE.test(line)) {
      if (part !== "theirs") return undefined;
      const resolved = resolveHunk(hunk);
      if (!resolved) return undefined;
      out.push(...resolved);
      hunk = undefined;
    } else if (part === "base") hunk.base!.push(line);
    else hunk[part].push(line);
  }
  return hunk ? undefined : out.join("\n");
}

/** Whether a conflicted path has the three stages of a regular file: a common base, ours and theirs. */
function threeStages(cwd: string, path: string): boolean {
  const r = spawnGit(["ls-files", "-u", "-z", "--", path], cwd);
  if (r.status !== 0) return false;
  const entries = r.stdout.split("\0").filter(Boolean).map((e) => /^(\d+) [0-9a-f]+ ([123])\t/.exec(e));
  const stages = new Set(entries.map((m) => (m && /^100(?:644|755)$/.test(m[1]!) ? m[2] : undefined)));
  return entries.length === 3 && stages.size === 3 && !stages.has(undefined);
}

/**
 * Resolves the conflicts of a merge in progress in `cwd` without a model, all files or none: each one is
 * rewritten with diff3 markers and resolved by `resolveDiff3`; only when every file resolves are they written
 * and added. A binary file, a missing stage or one hunk that is not simple writes nothing and gives false.
 */
export function resolveSimply(cwd: string, paths: string[]): boolean {
  if (!paths.length) return false;
  const resolved: { path: string; text: string }[] = [];
  for (const path of paths) {
    if (!threeStages(cwd, path)) return false;
    if (spawnGit(["checkout", "--conflict=diff3", "--", path], cwd).status !== 0) return false;
    // latin1 keeps every byte as it is, whatever the file's encoding.
    const text = readFileSync(join(cwd, path), "latin1");
    if (text.includes("\0")) return false;
    const done = resolveDiff3(text);
    if (done === undefined) return false;
    resolved.push({ path, text: done });
  }
  for (const { path, text } of resolved) writeFileSync(join(cwd, path), text, "latin1");
  return spawnGit(["add", "--", ...paths], cwd).status === 0;
}

/** What a conflict agent answers: for every conflicted file, resolved in the work copy or returned with why. */
export const ConflictSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().describe("The conflicted file, exactly as listed."),
        status: z.enum(["resolved", "returned"]).describe("`resolved`: written in the work copy without conflict markers. `returned`: left for the build station."),
        reason: z.string().describe("Why it was returned; empty when resolved."),
      }),
    )
    .describe("One entry per conflicted file."),
  summary: z.string(),
});

export type ConflictAnswer = z.infer<typeof ConflictSchema>;

/** At most this much of a file's conflict blocks reaches the prompt. */
const BLOCKS_CHARS = 6000;
/** At most this many base commits reach the prompt. */
const MAX_BASE_COMMITS = 20;

/** The conflict blocks (from `<<<<<<<` to `>>>>>>>`) of a file with a merge in progress, cut to `BLOCKS_CHARS`; empty for a binary or missing file. */
export function conflictBlocks(cwd: string, path: string): string {
  let text: string;
  try {
    text = readFileSync(join(cwd, path), "utf8");
  } catch {
    return "";
  }
  if (text.includes("\0")) return "";
  const blocks: string[] = [];
  let open: string[] | undefined;
  for (const line of text.split("\n")) {
    if (!open && OPEN.test(line)) open = [line];
    else if (open) {
      open.push(line);
      if (CLOSE.test(line)) (blocks.push(open.join("\n")), (open = undefined));
    }
  }
  const all = blocks.join("\n\n");
  return all.length > BLOCKS_CHARS ? `${all.slice(0, BLOCKS_CHARS)}\n[…]` : all;
}

/** The commits of the base (from `baseCommit`, not reachable from `head`) that touched these paths, newest first: short hash and subject. */
export function baseCommits(cwd: string, head: string, baseCommit: string, paths: string[]): string[] {
  const r = spawnGit(["log", `--max-count=${MAX_BASE_COMMITS}`, "--no-color", "--format=%h %s", `${head}..${baseCommit}`, "--", ...paths], cwd);
  if (r.status !== 0) return [];
  return r.stdout.split("\n").map((l) => l.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim()).filter(Boolean);
}
