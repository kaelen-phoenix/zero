import type { Job, JobSource } from "./state/store.js";

/** From lowest to highest. */
export const PRIORITIES = ["baja", "media", "alta", "urgente"] as const;
export type JobPriority = (typeof PRIORITIES)[number];

/** A queued job climbs one level for each full day it waits, never past `alta`. */
export const PRIORITY_AGING_MS = 24 * 60 * 60 * 1000;

export const isPriority = (name: unknown): name is JobPriority => typeof name === "string" && (PRIORITIES as readonly string[]).includes(name);

/** Jobs nobody is waiting for (the night shift's own and the packages') are `baja`; the rest `media`. */
export function defaultPriority(source?: JobSource): JobPriority {
  return (source?.kind === "night-shift" && Boolean(source.autonomy)) || source?.kind === "package" ? "baja" : "media";
}

export const storedPriority = (job: Pick<Job, "priority" | "source">): JobPriority => job.priority ?? defaultPriority(job.source);

/** The priority the daemon schedules by: the stored one raised by the wait. */
export function effectivePriority(job: Pick<Job, "priority" | "source" | "createdAt">, now: Date = new Date()): JobPriority {
  const stored = storedPriority(job);
  if (stored === "urgente") return stored;
  const created = job.createdAt ? Date.parse(job.createdAt) : NaN;
  const days = Number.isNaN(created) ? 0 : Math.max(0, Math.floor((now.getTime() - created) / PRIORITY_AGING_MS));
  const level = Math.max(Math.min(PRIORITIES.indexOf(stored) + days, PRIORITIES.indexOf("alta")), PRIORITIES.indexOf(stored));
  return PRIORITIES[level]!;
}

export const priorityRank = (p: JobPriority) => PRIORITIES.indexOf(p);
