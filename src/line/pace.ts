import type { LineConfig } from "../config.js";
import type { SpanRow } from "../state/store.js";

/**
 * How the commands of the lines (setup, verify) share this machine, and how long each may take. A machine that
 * runs the test suites of several jobs at once runs out of memory and makes every one of them miss its time
 * limit; and a limit that fits a fast machine fails, on a slow one, every job whose tests pass.
 */

export interface Limiter {
  /** Runs `fn` when one of the `max` turns is free, in order of arrival. With an aborted signal it does not run and returns `undefined`. */
  run<T>(max: number, fn: () => Promise<T>, signal?: AbortSignal): Promise<T | undefined>;
}

export function createLimiter(): Limiter {
  let busy = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    busy--;
    waiting.shift()?.();
  };
  return {
    async run(max, fn, signal) {
      // The count is read again after every wake-up: a turn freed for one waiter is never taken by two.
      while (busy >= Math.max(1, max)) {
        if (signal?.aborted) return undefined;
        await new Promise<void>((wake) => {
          const onAbort = () => {
            const at = waiting.indexOf(go);
            if (at !== -1) waiting.splice(at, 1);
            wake();
          };
          const go = () => {
            signal?.removeEventListener("abort", onAbort);
            wake();
          };
          waiting.push(go);
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      if (signal?.aborted) return undefined;
      busy++;
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/** The commands the lines run on this machine, outside the box: one daemon, one queue. */
export const localCommands = createLimiter();

/** The name of the span of each verify command. */
export const VERIFY_COMMAND_SPAN = "zero.verify.command";
/** Without history or a limit of its own, a verify command gets this long. */
export const DEFAULT_VERIFY_MINUTES = 20;
/** However slow its past runs were, no verify command is given more than this by history alone. */
const MAX_LEARNED_MS = 4 * 3_600_000;
const HISTORY_DAYS = 30;
const HISTORY_RUNS = 5;

export interface VerifyHistory {
  spansSince(name: string, since: Date): SpanRow[];
  getJob(id: string): { line: string } | undefined;
}

/**
 * The time limit of one verify command of a line: the line's `verifyTimeoutMinutes` (20 by default), and never
 * less than twice what the slowest of its last 5 passing runs on that line took, so a suite that grows or a
 * machine that is slow does not fail jobs whose tests pass. A run that hangs still ends: history alone never gives more than 4 hours.
 */
export function verifyTimeoutMs(history: VerifyHistory, line: Pick<LineConfig, "name" | "verifyTimeoutMinutes">, command: string, now: Date): number {
  const floor = (line.verifyTimeoutMinutes ?? DEFAULT_VERIFY_MINUTES) * 60_000;
  const lines = new Map<string, string | undefined>();
  const lineOf = (jobId: string) => {
    if (!lines.has(jobId)) lines.set(jobId, history.getJob(jobId)?.line);
    return lines.get(jobId);
  };
  const took = history
    .spansSince(VERIFY_COMMAND_SPAN, new Date(now.getTime() - HISTORY_DAYS * 86_400_000))
    .filter((s) => s.status === "ok" && s.end && s.jobId && s.attrs["process.command_line"] === command && lineOf(s.jobId) === line.name)
    .slice(-HISTORY_RUNS)
    .map((s) => (typeof s.attrs["zero.run_ms"] === "number" ? (s.attrs["zero.run_ms"] as number) : Date.parse(s.end!) - Date.parse(s.start)))
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  const learned = Math.min(2 * Math.max(0, ...took), MAX_LEARNED_MS);
  return Math.max(floor, learned);
}
