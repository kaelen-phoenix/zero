import type { Store } from "../state/store.js";
import { decisionKey, type DecisionRecord, type DecisionTarget, type QueueRecord } from "./protocol.js";

/** `coord:outbox:<id>`: what was decided or asked for here and goes out with the coordination pass. */
const OUTBOX_PREFIX = "coord:outbox:";

/**
 * A decision for another machine: `pending` until a pass publishes it, then
 * `published` until that machine attended it. `late` is one that was never
 * published: it had already been answered.
 */
export interface OutboxDecision {
  kind: "decision";
  state: "pending" | "published" | "attended" | "late";
  /** When its state last changed (ISO). */
  at: string;
  record: DecisionRecord;
  /** The name of the machine it goes to. */
  toName: string;
}

/** A request for a published line that is not on this machine; it goes away once a machine tells of its job. */
export interface OutboxRequest {
  kind: "request";
  state: "pending" | "published";
  at: string;
  record: QueueRecord;
}

export type OutboxEntry = OutboxDecision | OutboxRequest;

const keyOf = (e: OutboxEntry): string => OUTBOX_PREFIX + (e.kind === "decision" ? decisionKey(e.record.target) : `request-${e.record.id}`);
const asked = (e: OutboxEntry): number => Date.parse(e.kind === "decision" ? e.record.at : e.record.createdAt);

function read(raw: string): OutboxEntry | undefined {
  try {
    const v = JSON.parse(raw) as OutboxEntry | null;
    return v && (v.kind === "decision" || v.kind === "request") && typeof v.at === "string" && v.record ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Everything in the outbox that reads, oldest first. */
export function outbox(store: Store): OutboxEntry[] {
  return store
    .kvWithPrefix(OUTBOX_PREFIX)
    .map(([, raw]) => read(raw))
    .filter((e) => e !== undefined)
    .sort((a, b) => asked(a) - asked(b));
}

/** The decision on that question or proposal that is on its way from here. */
export function decisionOnItsWay(store: Store, target: DecisionTarget): OutboxDecision | undefined {
  const raw = store.getKv(OUTBOX_PREFIX + decisionKey(target));
  const entry = raw ? read(raw) : undefined;
  return entry?.kind === "decision" && (entry.state === "pending" || entry.state === "published") ? entry : undefined;
}

export const saveOutbox = (store: Store, entry: OutboxEntry): void => store.setKv(keyOf(entry), JSON.stringify(entry));
export const dropOutbox = (store: Store, entry: OutboxEntry): void => store.deleteKv(keyOf(entry));
