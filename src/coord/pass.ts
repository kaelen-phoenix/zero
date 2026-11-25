import type { FactoryContext } from "../app.js";
import type { FactoryConfig } from "../config.js";
import { githubHalt } from "../github-quota.js";
import { machineCapabilities, machineIdentity } from "../machine.js";
import type { Store } from "../state/store.js";
import { decisionsPass, outboxPass } from "./actions.js";
import { queuePass } from "./queue.js";
import { heartbeat, listMachines, probeCoord, type CoordApi, type MachineView } from "./protocol.js";
import { spendPass } from "./spend.js";
import { statusPass } from "./status.js";

/** The machines of the factory as the last coordination pass saw them; only written while `distributed` is set. */
export const MACHINES_KEY = "coord:machines";

/** The last probe of the coordination repository: {repository, at, ok, problem?}. */
export const PROBE_KEY = "coord:probe";

/** A failed probe is tried again at most this often. */
export const PROBE_RETRY_MS = 60 * 60_000;

export interface ProbeRecord {
  repository: string;
  at: string;
  ok: boolean;
  problem?: string;
}

/** The stored probe; undefined when there is none or it does not read. */
export function readProbe(store: Store): ProbeRecord | undefined {
  const raw = store.getKv(PROBE_KEY);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<ProbeRecord> | null;
    return v && typeof v.repository === "string" && typeof v.at === "string" && typeof v.ok === "boolean" ? (v as ProbeRecord) : undefined;
  } catch {
    return undefined;
  }
}

/** True only with `distributed` and a passed probe of its current repository: the runner relies on the protocol only then. */
export function coordReady(ctx: { store: Store; config: FactoryConfig }): boolean {
  const distributed = ctx.config.distributed;
  if (!distributed) return false;
  const probe = readProbe(ctx.store);
  return probe?.ok === true && probe.repository === distributed.repository;
}

/** Probes the repository once, and a failed probe again at most every `retryMs`. */
export async function probeOnce(ctx: { store: Store }, api: CoordApi, repository: string, machineId: string, now: Date, retryMs = PROBE_RETRY_MS): Promise<void> {
  const last = readProbe(ctx.store);
  if (last && last.repository === repository && (last.ok || now.getTime() - Date.parse(last.at) < retryMs)) return;
  const result = await probeCoord(api, `${machineId}-${now.getTime()}`);
  const record: ProbeRecord = { repository, at: now.toISOString(), ok: result.ok, ...(result.ok ? {} : { problem: result.problem }) };
  ctx.store.setKv(PROBE_KEY, JSON.stringify(record));
}

/**
 * The daemon's coordination pass: this machine's heartbeat in the coordination
 * repository, then every machine's record kept in kv for status, panel and chat.
 * Before that, once per coordination repository, the probe that confirms its
 * conflicts (`coord:probe`), and once it passed, what each machine spent
 * (spendPass), the shared queue (queuePass), what other machines decided for
 * this one (decisionsPass), where every machine's jobs stand (statusPass) and
 * what was decided or asked for here (outboxPass). A decision attended here is
 * deleted only after the status tells what came of it.
 * Nothing at all without `distributed`, and nothing while GitHub holds a pause.
 */
export async function coordPass(
  ctx: FactoryContext,
  api: CoordApi,
  box: { ready: boolean } | undefined,
  now: Date,
): Promise<MachineView[] | undefined> {
  const distributed = ctx.config.distributed;
  if (!distributed || githubHalt(ctx.store, now)) return undefined;
  const machine = machineIdentity(ctx.store, ctx.config);
  await probeOnce(ctx, api, distributed.repository, machine.id, now);
  const jobs = ctx.store.listJobs({ status: ["running"] }).map((j) => j.id);
  await heartbeat(api, machine, machineCapabilities(ctx.config, box), jobs, now);
  const machines = await listMachines(api, now, distributed.leaseMinutes);
  ctx.store.setKv(MACHINES_KEY, JSON.stringify(machines));
  if (coordReady(ctx)) {
    await spendPass(ctx.store, api, machine, now);
    const claims = await queuePass(ctx, api, machine, box?.ready === true);
    const decisions = await decisionsPass(ctx, api, machine, claims);
    await statusPass(ctx, api, machine, claims, now);
    for (const name of decisions.attended) await api.delete(name);
    await outboxPass(ctx, api, machine, decisions.refs, now);
  }
  return machines;
}

/** The stored machine list; undefined when there is none or it does not read. */
export function readMachines(store: Store): MachineView[] | undefined {
  const raw = store.getKv(MACHINES_KEY);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as MachineView[]) : undefined;
  } catch {
    return undefined;
  }
}
