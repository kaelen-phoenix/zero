import { posix } from "node:path";
import type { Job } from "../state/store.js";
import type { Spec } from "./spec.js";

/** A job the night shift opened on its own, under the line's `build` or `auto` autonomy. */
export const autonomous = (job: Job) => job.source?.kind === "night-shift" && Boolean(job.source.autonomy);

/** The patterns a job's spec declared: undefined with no spec yet, [] when it declared nothing (also an older spec without the field). */
export function declaredPaths(job: Pick<Job, "spec">): string[] | undefined {
  if (!job.spec) return undefined;
  const paths = (job.spec as Partial<Spec>).paths;
  return Array.isArray(paths) ? paths : [];
}

const GLOB = /[*?[\]{}()!+@]/;

/** A pattern with one spelling: forward slashes, lower case, no `./`, no trailing `/` or `/**`. */
const normalize = (pattern: string) =>
  pattern
    .trim()
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .filter((s, i) => s !== "." && (s !== "" || i === 0))
    .join("/")
    .replace(/(^|\/)\*\*$/, "");

/** Whether two patterns may match the same file. Compares literal prefixes by segment: only a differing segment rules an overlap out. */
export function patternsOverlap(a: string, b: string): boolean {
  const literal = (pattern: string) => {
    const norm = normalize(pattern);
    // Empty, absolute or climbing out: it could be anything.
    if (!norm || norm.startsWith("/") || /^[a-z]:/.test(norm) || norm.split("/").includes("..")) return undefined;
    const segments = norm.split("/");
    const glob = segments.findIndex((s) => GLOB.test(s));
    return glob < 0 ? segments : segments.slice(0, glob);
  };
  const left = literal(a);
  const right = literal(b);
  if (!left || !right) return true;
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return false;
  return true;
}

/** The changed files outside the declared patterns. */
export function undeclaredFiles(changed: string[], patterns: string[]): string[] {
  const norms = patterns.map(normalize);
  return changed.filter((file) => {
    const path = file.toLowerCase();
    return !norms.some((p) => !p || p === path || path.startsWith(`${p}/`) || posix.matchesGlob(path, p));
  });
}

/**
 * Whether the daemon may start this job now, given the jobs of its line running
 * right now. A job with no spec yet only reads, so it just needs a free place;
 * with a spec it must not overlap anything running, and a job that declared
 * nothing, like one the night shift took on its own, has the line to itself.
 */
export function mayStart(job: Job, runningSameLine: Job[], parallel: number): boolean {
  if (runningSameLine.length >= parallel) return false;
  if (autonomous(job)) return runningSameLine.length === 0;
  if (runningSameLine.some((r) => autonomous(r) || declaredPaths(r)?.length === 0)) return false;
  const mine = declaredPaths(job);
  if (!mine) return true;
  if (!mine.length) return runningSameLine.length === 0;
  return runningSameLine.every((r) => (declaredPaths(r) ?? []).every((theirs) => mine.every((p) => !patternsOverlap(p, theirs))));
}
