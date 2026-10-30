import type { EgressRule } from "../box/egress.js";
import type { EgressRow, Store } from "../state/store.js";

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
  /** Connections of the box through the egress gate. */
  egress: { connections: number; blocked: number; suspicious: number };
}

/** One site as the egress gate saw it in a period. */
export interface EgressSite {
  host: string;
  port: number;
  connections: number;
  blocked: number;
  /** Refusals with the `suspicious` rule: the ones that hint at a manipulated agent or dependency. */
  suspicious: number;
  bytesUp: number;
  bytesDown: number;
  jobs: string[];
  stations: string[];
  lastAt: string;
  /** Why the last refusal happened. */
  rule?: EgressRule;
  reason?: string;
  /** First seen by this factory inside the period. */
  isNew: boolean;
}

export interface EgressSummary {
  connections: number;
  blocked: number;
  suspicious: number;
  sites: EgressSite[];
}

/**
 * The one definition of what the box reached: per site, with refusals first
 * (suspicious ones on top), then the busiest allowed sites.
 */
export function summarizeEgress(store: Store, filter: { from?: Date; to?: Date; job?: string }): EgressSummary {
  const rows = store.listEgress(filter);
  const sites = new Map<string, EgressSite>();
  const seen = (list: string[], value?: string) => value && !list.includes(value) && list.push(value);
  for (const r of rows) {
    const key = `${r.host}:${r.port}`;
    const s = sites.get(key) ?? { host: r.host, port: r.port, connections: 0, blocked: 0, suspicious: 0, bytesUp: 0, bytesDown: 0, jobs: [], stations: [], lastAt: r.at, isNew: false };
    s.connections++;
    s.bytesUp += r.bytesUp;
    s.bytesDown += r.bytesDown;
    if (r.at > s.lastAt) s.lastAt = r.at;
    seen(s.jobs, r.job);
    seen(s.stations, r.station);
    if (!r.allowed) refused(s, r);
    sites.set(key, s);
  }
  const firstSeen = store.egressFirstSeen([...new Set(rows.map((r) => r.host))]);
  const from = filter.from?.toISOString();
  for (const s of sites.values()) s.isNew = from !== undefined && (firstSeen.get(s.host) ?? "") >= from;
  const list = [...sites.values()].sort((a, b) => b.suspicious - a.suspicious || b.blocked - a.blocked || b.connections - a.connections || a.host.localeCompare(b.host));
  return {
    connections: rows.length,
    blocked: rows.filter((r) => !r.allowed).length,
    suspicious: rows.filter((r) => !r.allowed && r.rule === "suspicious").length,
    sites: list,
  };
}

function refused(s: EgressSite, r: EgressRow) {
  s.blocked++;
  if (r.rule === "suspicious") s.suspicious++;
  s.rule = r.rule;
  s.reason = r.reason;
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

  const egress = summarizeEgress(store, { from, to });
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
    egress: { connections: egress.connections, blocked: egress.blocked, suspicious: egress.suspicious },
  };
}

/** Local midnight, the boundary of the daily budget. */
export function startOfDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Estimated spend so far today across all agent calls (what is really billed is in src/budget.ts). */
export function spentToday(store: Store, now = new Date()): number {
  return store.spansSince(AGENT_SPAN, startOfDay(now)).reduce((sum, s) => sum + Number(s.attrs["zero.cost.usd"] ?? 0), 0);
}

/** Whether the daily limit stops new jobs. A limit of 0 means "free engines only". */
export function dailyBudgetReached(spent: number, limitUsd: number): boolean {
  return limitUsd === 0 ? spent > 0 : spent >= limitUsd;
}
