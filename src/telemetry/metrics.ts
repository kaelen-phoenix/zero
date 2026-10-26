import type { Store } from "../state/store.js";

/** Span names the metrics are derived from. */
export const AGENT_SPAN = "gen_ai.invoke_agent";
export const APPROVAL_SPAN = "zero.approval";

export interface EngineMetrics {
  calls: number;
  costUsd: number;
  unknownCostCalls: number;
}

export interface Metrics {
  from: string;
  to: string;
  delivered: number;
  failed: number;
  stopped: number;
  /** delivered / (delivered + failed); jobs stopped by the owner do not count. Null when nothing finished. */
  successRate: number | null;
  costUsd: number;
  costPerDeliveryUsd: number | null;
  avgDurationMin: number | null;
  /** Agent calls whose engine did not report cost. */
  unknownCostCalls: number;
  pendingQuestions: number;
  /** Time jobs spent waiting for the owner, for questions answered in the window. */
  humanWaitMin: number;
  byEngine: Record<string, EngineMetrics>;
}

/**
 * The one definition of every factory metric. `zero status`, the briefing
 * and the MCP tools all call this, so they can never disagree.
 */
export function computeMetrics(store: Store, from: Date, to: Date = new Date()): Metrics {
  const finished = store.finishedSince(from).filter((j) => Date.parse(j.finishedAt!) <= to.getTime());
  const count = (status: string) => finished.filter((j) => j.status === status).length;
  const delivered = count("delivered");
  const failed = count("failed");

  const agents = store.spansSince(AGENT_SPAN, from).filter((s) => Date.parse(s.start) <= to.getTime());
  const byEngine: Record<string, EngineMetrics> = {};
  let costUsd = 0;
  let unknownCostCalls = 0;
  for (const s of agents) {
    const engine = String(s.attrs["zero.engine"] ?? "unknown");
    const cost = Number(s.attrs["zero.cost.usd"] ?? 0);
    const unknown = s.attrs["zero.cost.source"] !== "reported";
    const e = (byEngine[engine] ??= { calls: 0, costUsd: 0, unknownCostCalls: 0 });
    e.calls++;
    e.costUsd += cost;
    if (unknown) e.unknownCostCalls++;
    costUsd += cost;
    if (unknown) unknownCostCalls++;
  }

  const durations = finished.filter((j) => j.status !== "stopped").map((j) => (Date.parse(j.finishedAt!) - Date.parse(j.createdAt)) / 60_000);
  const waits = store
    .spansSince(APPROVAL_SPAN, new Date(0))
    .filter((s) => s.end && Date.parse(s.end) >= from.getTime() && Date.parse(s.end) <= to.getTime())
    .map((s) => (Date.parse(s.end!) - Date.parse(s.start)) / 60_000);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    delivered,
    failed,
    stopped: count("stopped"),
    successRate: delivered + failed ? delivered / (delivered + failed) : null,
    costUsd,
    costPerDeliveryUsd: delivered ? costUsd / delivered : null,
    avgDurationMin: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    unknownCostCalls,
    pendingQuestions: store.listJobs({ status: ["waiting"] }).length,
    humanWaitMin: waits.reduce((a, b) => a + b, 0),
    byEngine,
  };
}

/** Local midnight, the boundary of the daily budget. */
export function startOfDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Spend so far today across all agent calls. */
export function spentToday(store: Store, now = new Date()): number {
  return store.spansSince(AGENT_SPAN, startOfDay(now)).reduce((sum, s) => sum + Number(s.attrs["zero.cost.usd"] ?? 0), 0);
}

/** Whether the daily limit stops new jobs. A limit of 0 means "free engines only". */
export function dailyBudgetReached(spent: number, limitUsd: number): boolean {
  return limitUsd === 0 ? spent > 0 : spent >= limitUsd;
}
