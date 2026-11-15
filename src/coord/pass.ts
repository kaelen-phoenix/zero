import type { FactoryConfig } from "../config.js";
import { githubHalt } from "../github-quota.js";
import { machineCapabilities, machineIdentity } from "../machine.js";
import type { Store } from "../state/store.js";
import { heartbeat, listMachines, type CoordApi, type MachineView } from "./protocol.js";

/** The machines of the factory as the last coordination pass saw them; only written while `distributed` is set. */
export const MACHINES_KEY = "coord:machines";

/**
 * The daemon's coordination pass: this machine's heartbeat in the coordination
 * repository, then every machine's record kept in kv for status, panel and chat.
 * Nothing at all without `distributed`, and nothing while GitHub holds a pause.
 */
export async function coordPass(
  ctx: { store: Store; config: FactoryConfig },
  api: CoordApi,
  box: { ready: boolean } | undefined,
  now: Date,
): Promise<MachineView[] | undefined> {
  const distributed = ctx.config.distributed;
  if (!distributed || githubHalt(ctx.store, now)) return undefined;
  const machine = machineIdentity(ctx.store, ctx.config);
  const jobs = ctx.store.listJobs({ status: ["running"] }).map((j) => j.id);
  await heartbeat(api, machine, machineCapabilities(ctx.config, box), jobs, now);
  const machines = await listMachines(api, now, distributed.leaseMinutes);
  ctx.store.setKv(MACHINES_KEY, JSON.stringify(machines));
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
