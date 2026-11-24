import { callBilling, planReadings } from "../budget.js";
import type { FactoryConfig } from "../config.js";
import type { MachineIdentity } from "../machine.js";
import type { SpanRow, Store } from "../state/store.js";
import { AGENT_SPAN, isIdleCall } from "../telemetry/metrics.js";
import { planWindows, readSpendRecord, SPEND_SLOT_MS, spendRef, type CoordApi, type PlanReading, type SpendRecord, type SpendSlot } from "./protocol.js";

/** What the other machines spent as the last coordination pass read it; only counted while `distributed` is set. */
export const SPEND_KEY = "coord:spend";

/** How far back the published slots and finished jobs go: enough for any day or night, whatever the time zone. */
const SPEND_WINDOW_MS = 48 * 3_600_000;

type Distributed = Pick<FactoryConfig, "distributed"> | undefined;

const slotStart = (time: number): string => new Date(Math.floor(time / SPEND_SLOT_MS) * SPEND_SLOT_MS).toISOString();

/** Rounded so the same calls always add up to the same record. */
const round = (usd: number): number => Math.round(usd * 1e6) / 1e6;

const costOf = (s: SpanRow): number => {
  const usd = Number(s.attrs["zero.cost.usd"] ?? 0);
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
};

const ENGINE_NAME = /^[\w.-]{1,100}$/;

/** An engine's name fit for a record. */
const engineOf = (s: SpanRow): string => {
  const engine = String(s.attrs["zero.engine"] ?? "");
  return ENGINE_NAME.test(engine) ? engine : "unknown";
};

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What this machine spent on its own; nothing of the other machines is in it. */
export function ownSpend(store: Store, id: string, now: Date): SpendRecord {
  const from = now.getTime() - SPEND_WINDOW_MS;
  const billing = callBilling(store, now);
  const slots = new Map<string, SpendSlot>();
  for (const s of store.spansSince(AGENT_SPAN, new Date(slotStart(from)))) {
    const usd = costOf(s);
    if (!usd) continue;
    const slot = { at: slotStart(Date.parse(s.start)), engine: engineOf(s), billing: billing(s), idle: isIdleCall(s) };
    const key = Object.values(slot).join(" ");
    slots.set(key, { ...slot, usd: (slots.get(key)?.usd ?? 0) + usd });
  }
  const jobs = [...store.listJobs({ status: ["queued", "running", "waiting"], limit: -1 }), ...store.finishedSince(new Date(from))].flatMap((job) => {
    const charged = store.spansForJob(job.id).filter((s) => s.name === AGENT_SPAN && billing(s) !== "subscription");
    const usd = round(charged.reduce((sum, s) => sum + costOf(s), 0));
    return usd ? [{ id: job.id, usd }] : [];
  });
  const plans = planReadings(store, now)
    .filter((r) => ENGINE_NAME.test(r.engine))
    .map((r): PlanReading => ({ engine: r.engine, at: r.at.toISOString(), limited: r.limited, windows: planWindows(r.windows) }));
  return {
    id,
    at: now.toISOString(),
    slots: [...slots].sort(([a], [b]) => order(a, b)).map(([, s]) => ({ ...s, usd: round(s.usd) })),
    jobs: jobs.sort((a, b) => order(a.id, b.id)),
    ...(plans.length && { plans: plans.sort((a, b) => order(a.engine, b.engine)) }),
  };
}

/**
 * The spend's share of the coordination pass, only with the protocol on: the
 * valid records of the other machines, alive or not, are kept in kv for the
 * budget, and this machine's `spend/<id>` is written when it says something
 * new (slots that only grew old do not count as a change).
 */
export async function spendPass(store: Store, api: CoordApi, machine: MachineIdentity, now: Date): Promise<void> {
  const refs = await api.list(spendRef(""));
  const records = refs.map(readSpendRecord).filter((r) => r !== undefined);
  store.setKv(SPEND_KEY, JSON.stringify(records.filter((r) => r.id !== machine.id)));

  const own = ownSpend(store, machine.id, now);
  const published = records.find((r) => r.id === machine.id);
  const oldest = slotStart(now.getTime() - SPEND_WINDOW_MS);
  const content = (r: SpendRecord | undefined) => JSON.stringify([r?.slots.filter((s) => s.at >= oldest) ?? [], r?.jobs ?? [], r?.plans ?? []]);
  if (content(published) === content(own)) return;
  await api.write(spendRef(machine.id), JSON.stringify(own));
}

/** What the other machines published; nothing without `distributed`, whatever was kept from before. */
function othersSpend(store: Store, config: Distributed): SpendRecord[] {
  const raw = config?.distributed && store.getKv(SPEND_KEY);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as SpendRecord[]) : [];
  } catch {
    return [];
  }
}

/** What the other machines spent since `since`, in the slots `counts` takes; a slot that crosses `since` counts whole. */
export function othersSpentSince(store: Store, config: Distributed, since: Date, counts: (slot: SpendSlot) => boolean = () => true): number {
  return othersSpend(store, config)
    .flatMap((r) => r.slots)
    .filter((s) => Date.parse(s.at) + SPEND_SLOT_MS > since.getTime() && counts(s))
    .reduce((sum, s) => sum + s.usd, 0);
}

/** What the other machines were charged for a job they had before. */
export function othersJobUsd(store: Store, config: Distributed, jobId: string): number {
  return othersSpend(store, config)
    .flatMap((r) => r.jobs)
    .filter((j) => j.id === jobId)
    .reduce((sum, j) => sum + j.usd, 0);
}

/** The newest plan reading of each engine among the other machines, alive or not; one older than `since`, or dated ahead of this machine's clock, says nothing yet. */
export function othersPlans(store: Store, config: Distributed, since: Date, now: Date): Map<string, PlanReading> {
  const newest = new Map<string, PlanReading>();
  for (const plan of othersSpend(store, config).flatMap((r) => r.plans ?? [])) {
    const at = Date.parse(plan.at);
    const known = newest.get(plan.engine);
    if (at >= since.getTime() && at <= now.getTime() && (!known || at > Date.parse(known.at))) newest.set(plan.engine, plan);
  }
  return newest;
}
