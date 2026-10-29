import type { FactoryConfig } from "./config.js";
import type { QuotaReport, QuotaWindow } from "./engines/index.js";
import type { Store } from "./state/store.js";
import { AGENT_SPAN, dailyBudgetReached, spentToday, startOfDay } from "./telemetry/metrics.js";

/** Plan readings older than the longest window (a week) say nothing about now. */
const READING_MAX_AGE_MS = 8 * 86_400_000;
/** How long new work waits when a plan refuses calls without saying when it renews. */
const UNKNOWN_RESET_MS = 15 * 60_000;

export interface PlanWindow extends QuotaWindow {
  engine: string;
}

export interface BudgetState {
  /** How the default engine is billed, from its latest reported call. */
  billing: QuotaReport["billing"] | "unknown";
  /** Real spend today: calls billed per use. Subscription calls cost nothing extra. */
  spentUsd: number;
  /** What every call today would have cost per use, as the engines estimate it. */
  estimatedUsd: number;
  limitUsd: number;
  /** Share of each plan window the factory leaves to the owner, 0 to 99. */
  reservePercent: number;
  /** Current windows of subscription plans; renewed ones are left out. */
  windows: PlanWindow[];
  /** True when new work must wait. */
  reached: boolean;
  /** Why it waits, for the owner. */
  reason?: string;
  /** When the plan lets work resume (ISO), if it is what stops it. */
  until?: string;
}

interface Reading {
  engine: string;
  billing: QuotaReport["billing"];
  windows: QuotaWindow[];
  limited: boolean;
  at: Date;
}

/** The latest plan reading of each engine, from its agent spans. */
function readings(store: Store, now: Date): Map<string, Reading> {
  const latest = new Map<string, Reading>();
  for (const s of store.spansSince(AGENT_SPAN, new Date(now.getTime() - READING_MAX_AGE_MS))) {
    const billing = s.attrs["zero.billing"];
    const engine = String(s.attrs["zero.engine"] ?? "");
    if (billing !== "subscription" && billing !== "api") continue;
    let windows: QuotaWindow[] = [];
    try {
      windows = JSON.parse(String(s.attrs["zero.quota"] ?? "[]")) as QuotaWindow[];
    } catch {
      // a malformed reading only loses its windows
    }
    // Spans come in start order; a later call's reading replaces an earlier one.
    latest.set(engine, { engine, billing, windows, limited: s.attrs["zero.quota.limited"] === true || s.attrs["zero.quota.limited"] === 1, at: new Date(s.end ?? s.start) });
  }
  return latest;
}

/** Whether the default engine runs on a subscription, so per-job dollar caps do not apply. */
export function onSubscription(store: Store, config: Pick<FactoryConfig, "engine">, now = new Date()): boolean {
  return readings(store, now).get(config.engine)?.billing === "subscription";
}

/**
 * What today's calls really cost. A call without its own reading (made before
 * engines reported their plan) is billed like its engine's latest reading, and
 * not counted while that is unknown: the next call tells.
 */
function billedToday(store: Store, all: Map<string, Reading>, now: Date): number {
  return store
    .spansSince(AGENT_SPAN, startOfDay(now))
    .filter((s) => (s.attrs["zero.billing"] ?? all.get(String(s.attrs["zero.engine"] ?? ""))?.billing) === "api")
    .reduce((sum, s) => sum + Number(s.attrs["zero.cost.usd"] ?? 0), 0);
}

/**
 * The single answer to "can the factory start more work now?". Subscription
 * plans are limited by their own usage windows: work waits while one is used
 * up (or past the owner's reserve) and resumes when it renews. Calls billed per
 * use are limited by the daily dollar cap.
 */
export function budgetState(store: Store, config: Pick<FactoryConfig, "engine" | "limits">, now = new Date()): BudgetState {
  const all = readings(store, now);
  const reservePercent = config.limits.reservePercent;
  const spentUsd = billedToday(store, all, now);
  const windows: PlanWindow[] = [];
  let stopAt: Date | undefined;
  let stopBy: PlanWindow | undefined;
  for (const r of all.values()) {
    if (r.billing !== "subscription") continue;
    for (const w of r.windows) {
      if (w.resetsAt && new Date(w.resetsAt) <= now) continue;
      const window = { ...w, engine: r.engine };
      windows.push(window);
      const overReserve = reservePercent > 0 && (w.utilization ?? 0) >= 1 - reservePercent / 100;
      if (w.status !== "exhausted" && !overReserve) continue;
      const until = w.resetsAt ? new Date(w.resetsAt) : new Date(r.at.getTime() + UNKNOWN_RESET_MS);
      if (until > now && (!stopAt || until > stopAt)) {
        stopAt = until;
        stopBy = window;
      }
    }
    // Refused without saying which window: wait a little and try again.
    if (r.limited && !stopBy) {
      const until = new Date(r.at.getTime() + UNKNOWN_RESET_MS);
      if (until > now) stopAt = until;
    }
  }

  const base = {
    billing: all.get(config.engine)?.billing ?? ("unknown" as const),
    spentUsd,
    estimatedUsd: spentToday(store, now),
    limitUsd: config.limits.usdPerDay,
    reservePercent,
    windows,
  };
  if (stopAt) {
    const what = stopBy
      ? stopBy.status === "exhausted"
        ? `se usó todo el cupo de ${stopBy.label} de la suscripción`
        : `se llegó al ${100 - reservePercent}% del cupo de ${stopBy.label}; el resto queda para vos`
      : "la suscripción no acepta más pedidos por ahora";
    return { ...base, reached: true, reason: what, until: stopAt.toISOString() };
  }
  if (dailyBudgetReached(spentUsd, config.limits.usdPerDay)) {
    return { ...base, reached: true, reason: "se alcanzó el límite de gasto del día" };
  }
  return { ...base, reached: false };
}
