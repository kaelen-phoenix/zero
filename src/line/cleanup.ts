import { log } from "../log.js";
import { FINAL_STATUSES, type Store } from "../state/store.js";
import { removeWorkCopy } from "../workspace.js";

/** A work copy that could not be removed when its job ended, retried by the daemon. */
export interface PendingCleanup {
  repo: string;
  path: string;
  error: string;
  /** When the removal first failed (ISO). */
  since: string;
}

export const CLEANUP_PREFIX = "cleanup:";
export const cleanupKey = (jobId: string) => `${CLEANUP_PREFIX}${jobId}`;

/** Records a failed removal; a store failure is logged, never thrown. */
export function recordCleanup(store: Store, jobId: string, record: PendingCleanup) {
  try {
    store.setKv(cleanupKey(jobId), JSON.stringify(record));
  } catch (err) {
    log.warn("cannot record pending cleanup", { job: jobId, error: String(err) });
  }
}

/** Every pending cleanup, skipping records that are not valid JSON. */
export function pendingCleanups(store: Store): { job: string; cleanup: PendingCleanup }[] {
  const out: { job: string; cleanup: PendingCleanup }[] = [];
  for (const [key, value] of store.kvWithPrefix(CLEANUP_PREFIX)) {
    try {
      const c = JSON.parse(value) as PendingCleanup;
      if (c && typeof c.repo === "string" && typeof c.path === "string") out.push({ job: key.slice(CLEANUP_PREFIX.length), cleanup: c });
    } catch {
      // A broken record is left for the person in charge; it never stops the others.
    }
  }
  return out;
}

/**
 * Tries again every pending cleanup: a removed (or already gone, which the real removal skips) copy loses its
 * record, one that fails again keeps it with the new error. Jobs are never touched, and neither is the copy of a
 * job that is at work again in that same folder (a delivered job taken back to update its pull request): its
 * next end removes it.
 */
export async function cleanupPass(ctx: { store: Store }, remove: (repo: string, path: string) => void = removeWorkCopy): Promise<void> {
  let pending: ReturnType<typeof pendingCleanups>;
  try {
    pending = pendingCleanups(ctx.store);
  } catch (err) {
    log.warn("cannot read pending cleanups", { error: String(err) });
    return;
  }
  for (const { job, cleanup } of pending) {
    const owner = ctx.store.getJob(job);
    if (owner && !FINAL_STATUSES.includes(owner.status)) continue;
    try {
      remove(cleanup.repo, cleanup.path);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.info("work copy cleanup failed again", { job, path: cleanup.path, error });
      recordCleanup(ctx.store, job, { ...cleanup, error });
      continue;
    }
    try {
      ctx.store.deleteKv(cleanupKey(job));
      log.info("work copy removed", { job, path: cleanup.path });
    } catch (err) {
      log.warn("cannot clear pending cleanup", { job, error: String(err) });
    }
  }
}
