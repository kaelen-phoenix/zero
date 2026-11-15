import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { BoxStatus } from "./box/status.js";
import { AGENT_STATIONS, stationChain, type FactoryConfig } from "./config.js";
import type { Store } from "./state/store.js";

/** Where a machine keeps its own id, generated once per ZERO_HOME. */
export const MACHINE_ID_KEY = "machine:id";

export interface MachineIdentity {
  id: string;
  name: string;
}

/** What a machine can do, shared with the other machines: public fields only, never secrets, paths or environment. */
export interface MachineCapabilities {
  platform: NodeJS.Platform;
  box: boolean;
  engines: string[];
}

/** A host name as a machine name: letters, digits and `-` only. */
function machineName(host: string): string {
  return host.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "maquina";
}

/** This ZERO_HOME's machine: the same id on every call, and its name from `distributed.machine` or the host. */
export function machineIdentity(store: Store, config: Pick<FactoryConfig, "distributed">, host: () => string = hostname): MachineIdentity {
  let id = store.getKv(MACHINE_ID_KEY);
  if (!id) {
    id = randomUUID();
    store.setKv(MACHINE_ID_KEY, id);
  }
  return { id, name: config.distributed?.machine ?? machineName(host()) };
}

/** What this machine declares to the others, so no job is given to it that needs what it lacks. */
export function machineCapabilities(
  config: Pick<FactoryConfig, "engine" | "stations" | "fallback">,
  box: Pick<BoxStatus, "ready"> | undefined,
  platform: NodeJS.Platform = process.platform,
): MachineCapabilities {
  const engines = [...new Set(AGENT_STATIONS.flatMap((s) => stationChain(config, s).map((l) => l.engine)))].sort();
  return { platform, box: box?.ready === true, engines };
}
