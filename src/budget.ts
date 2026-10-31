import { AGENT_STATIONS, customAgentChain, stationChain, type ChainLink, type CustomAgent, type FactoryConfig, type StationName } from "./config.js";
import type { QuotaReport, QuotaWindow } from "./engines/index.js";
import type { SpanRow, Store } from "./state/store.js";
import { AGENT_SPAN, dailyBudgetReached, spentToday, startOfDay } from "./telemetry/metrics.js";

/** Plan readings older than the longest window (a week) say nothing about now. */
const READING_MAX_AGE_MS = 8 * 86_400_000;
/** How long new work waits when a plan refuses calls without saying when it renews. */
const UNKNOWN_RESET_MS = 15 * 60_000;

export interface PlanWindow extends QuotaWindow {
  engine: string;
}

/** Where one engine stands: whether stations may use it now, and why not. */
export interface EngineBudget {
  engine: string;
  /** From its latest reported call; `unknown` until it reports one. */
  billing: QuotaReport["billing"] | "unknown";
  paused: boolean;
  /** When it can work again (ISO); absent for the daily dollar cap, which resets tomorrow. */
  until?: string;
  /** Why it is paused, for the owner. */
  reason?: string;
}

/** A station working with a replacement because its own engine is paused. */
export interface Replacement {
  /** The paused engine. */
  engine: string;
  until?: string;
  reason?: string;
  /** The replacement doing its work. */
  with: string;
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
  /** Every engine the stations may use, their replacements included. */
  engines: EngineBudget[];
  /** Paused engines whose stations keep working with a replacement. */
  replacements: Replacement[];
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

/** When a plan window renews, in the owner's time: "18:30" today, "lun 09:00" another day. */
export function resetTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "")} ${time}`;
}

/** How a call is billed: its own reading, else its engine's latest one (calls made before engines reported their plan). */
const billingOf = (s: SpanRow, all: Map<string, Reading>) => s.attrs["zero.billing"] ?? all.get(String(s.attrs["zero.engine"] ?? ""))?.billing;

/**
 * What today's calls really cost, for every engine or only one. A call billed
 * like its engine's latest reading is not counted while that is unknown: the
 * next call tells.
 */
function billedToday(store: Store, all: Map<string, Reading>, now: Date, engine?: string): number {
  return store
    .spansSince(AGENT_SPAN, startOfDay(now))
    .filter((s) => (engine === undefined || String(s.attrs["zero.engine"] ?? "") === engine) && billingOf(s, all) === "api")
    .reduce((sum, s) => sum + Number(s.attrs["zero.cost.usd"] ?? 0), 0);
}

/**
 * What a job's calls cost that is really charged, for its `usdPerJob` cap.
 * Subscription calls cost nothing extra; calls whose billing is still unknown count.
 */
export function jobBilledUsd(store: Store, jobId: string, now = new Date()): number {
  const all = readings(store, now);
  return store
    .spansForJob(jobId)
    .filter((s) => s.name === AGENT_SPAN && billingOf(s, all) !== "subscription")
    .reduce((sum, s) => sum + Number(s.attrs["zero.cost.usd"] ?? 0), 0);
}

type BudgetConfig = Pick<FactoryConfig, "engine" | "limits" | "stations" | "fallback"> & {
  agents?: Pick<CustomAgent, "engine" | "model">[];
  lines?: { agents?: Pick<CustomAgent, "engine" | "model">[] }[];
};

/** The chains of every custom agent, global and per line. */
function customAgentChains(config: BudgetConfig): ChainLink[][] {
  const agents = [...(config.agents ?? []), ...(config.lines ?? []).flatMap((l) => l.agents ?? [])];
  return agents.map((a) => customAgentChain(config, a));
}

/**
 * Where one engine stands. A subscription waits while one of its windows is
 * used up (or past the owner's reserve) or after it refused a call; per-use
 * billing waits once that engine's own spend today reaches the daily dollar cap.
 */
function engineBudget(store: Store, config: BudgetConfig, engine: string, all: Map<string, Reading>, now: Date, windows: PlanWindow[]): EngineBudget {
  const r = all.get(engine);
  if (!r) return { engine, billing: "unknown", paused: false };
  if (r.billing === "api") {
    return dailyBudgetReached(billedToday(store, all, now, engine), config.limits.usdPerDay)
      ? { engine, billing: "api", paused: true, reason: "se alcanzó el límite de gasto del día" }
      : { engine, billing: "api", paused: false };
  }
  const reservePercent = config.limits.reservePercent;
  let stopAt: Date | undefined;
  let stopBy: PlanWindow | undefined;
  for (const w of r.windows) {
    if (w.resetsAt && new Date(w.resetsAt) <= now) continue;
    const window = { ...w, engine };
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
  if (!stopAt) return { engine, billing: "subscription", paused: false };
  const reason = stopBy
    ? stopBy.status === "exhausted"
      ? `se usó todo el cupo de ${stopBy.label} de la suscripción`
      : `se llegó al ${100 - reservePercent}% del cupo de ${stopBy.label}; el resto queda para vos`
    : "la suscripción no acepta más pedidos por ahora";
  return { engine, billing: "subscription", paused: true, until: stopAt.toISOString(), reason };
}

/** Every engine of the stations' and custom agents' chains, by name. */
function engineBudgets(store: Store, config: BudgetConfig, now: Date, windows: PlanWindow[] = []): Map<string, EngineBudget> {
  const all = readings(store, now);
  const out = new Map<string, EngineBudget>();
  const chains = [...AGENT_STATIONS.map((station) => stationChain(config, station)), ...customAgentChains(config)];
  for (const chain of chains) {
    for (const { engine } of chain) {
      if (!out.has(engine)) out.set(engine, engineBudget(store, config, engine, all, now, windows));
    }
  }
  return out;
}

/** "claude pausado hasta 23:20", or why when it waits until tomorrow. */
export function pausedText(e: Pick<EngineBudget, "engine" | "until" | "reason">, now = new Date()): string {
  return e.until ? `${e.engine} pausado hasta ${resetTime(e.until, now)}` : `${e.engine} pausado (${e.reason ?? "sin cupo"})`;
}

/** The engine a station's next call runs on. */
export interface EngineChoice {
  engine: string;
  model?: string;
  billing: EngineBudget["billing"];
  /** False when every engine of the chain is paused; the station's own is chosen then. */
  available: boolean;
  /** The station's own engine, when this is a replacement. */
  replaces?: string;
  /** Why the replacement, for the trace and the panel. */
  reason?: string;
}

/**
 * The first engine of the station's chain that is not paused, or the
 * station's own engine when all are. Only engines the owner configured are
 * ever chosen.
 */
export function pickEngine(store: Store, config: BudgetConfig, station: StationName, now = new Date()): EngineChoice {
  return pickFromChain(store, config, stationChain(config, station), now);
}

/** pickEngine for a custom agent, on its own chain (see customAgentChain). */
export function pickAgentEngine(store: Store, config: BudgetConfig, agent: Pick<CustomAgent, "engine" | "model">, now = new Date()): EngineChoice {
  return pickFromChain(store, config, customAgentChain(config, agent), now);
}

function pickFromChain(store: Store, config: BudgetConfig, chain: ChainLink[], now: Date): EngineChoice {
  const budgets = engineBudgets(store, config, now);
  const all = readings(store, now);
  for (const { engine } of chain) if (!budgets.has(engine)) budgets.set(engine, engineBudget(store, config, engine, all, now, []));
  const own = chain[0]!;
  const ownBudget = budgets.get(own.engine)!;
  const index = chain.findIndex((l) => !budgets.get(l.engine)!.paused);
  if (index <= 0) return { ...own, billing: ownBudget.billing, available: index === 0 };
  const link = chain[index]!;
  return { ...link, billing: budgets.get(link.engine)!.billing, available: true, replaces: own.engine, reason: pausedText(ownBudget, now) };
}

/** Whether an engine runs on a subscription, so per-job dollar caps do not apply to it. */
export function onSubscription(store: Store, engine: string, now = new Date()): boolean {
  return readings(store, now).get(engine)?.billing === "subscription";
}

/** The stations every queued job needs; `reply` only answers comments. */
const LINE_AGENTS: readonly StationName[] = ["spec", "build", "review", "security"];

const when = (e: EngineBudget) => (e.until ? Date.parse(e.until) : Number.POSITIVE_INFINITY);

/**
 * The single answer to "can the factory start more work now?". Each engine is
 * paused on its own (see engineBudget); work waits only while some station a
 * job needs (or some custom agent) has every engine of its chain paused, and
 * resumes once every such station has one again.
 */
export function budgetState(store: Store, config: BudgetConfig, now = new Date()): BudgetState {
  const all = readings(store, now);
  const windows: PlanWindow[] = [];
  const budgets = engineBudgets(store, config, now, windows);
  const replacements: Replacement[] = [];
  let stop: EngineBudget | undefined;
  const chains = [...LINE_AGENTS.map((station) => stationChain(config, station)), ...customAgentChains(config)];
  for (const links of chains) {
    const chain = links.map((l) => budgets.get(l.engine)!);
    const own = chain[0]!;
    const working = chain.find((e) => !e.paused);
    if (working) {
      if (working !== own && !replacements.some((r) => r.engine === own.engine && r.with === working.engine)) {
        replacements.push({ engine: own.engine, until: own.until, reason: own.reason, with: working.engine });
      }
      continue;
    }
    // The station works again with the first of its engines to renew (tomorrow for a daily cap).
    const first = chain.reduce((a, b) => (when(b) < when(a) ? b : a));
    if (!stop || when(first) > when(stop)) stop = first;
  }

  const base = {
    billing: all.get(config.engine)?.billing ?? ("unknown" as const),
    spentUsd: billedToday(store, all, now),
    estimatedUsd: spentToday(store, now),
    limitUsd: config.limits.usdPerDay,
    reservePercent: config.limits.reservePercent,
    windows,
    engines: [...budgets.values()],
    replacements,
  };
  if (stop) return { ...base, reached: true, reason: stop.reason, ...(stop.until && { until: stop.until }) };
  return { ...base, reached: false };
}
