import type { MachineCapabilities, MachineIdentity } from "../machine.js";

/**
 * The distributed factory's coordination protocol (docs/adr/0007-fabrica-distribuida.md).
 * Shared state is a set of named refs, each pointing at a record (a JSON text).
 * A job belongs to whoever's name is in `claims/<job>`; each machine writes its
 * latest heartbeat to `machines/<id>`. Creating a ref that exists, or moving one
 * from a tip that is no longer its tip, fails with CoordConflict: that is the only
 * atomicity the protocol needs, and git refs on GitHub give it.
 */

export const DEFAULT_LEASE_MINUTES = 10;

/** A ref and the record it points at. */
export interface CoordRef {
  name: string;
  sha: string;
  data: string;
}

/** Another machine got there first: the ref exists, or moved since it was read. */
export class CoordConflict extends Error {
  constructor(readonly ref: string) {
    super(`la referencia ${ref} cambió o ya existe`);
    this.name = "CoordConflict";
  }
}

export interface CoordApi {
  read(name: string): Promise<CoordRef | undefined>;
  /** Refs whose name starts with `prefix`. */
  list(prefix: string): Promise<CoordRef[]>;
  /** Creates the ref; CoordConflict when it exists. Returns its sha. */
  create(name: string, data: string): Promise<string>;
  /** Moves the ref only from `from` (compare-and-swap); CoordConflict otherwise. */
  update(name: string, data: string, from: string): Promise<string>;
  /** Writes the ref whatever it held: for records only their machine writes. */
  write(name: string, data: string): Promise<string>;
  delete(name: string): Promise<void>;
}

export const claimRef = (job: string): string => `claims/${job}`;
export const machineRef = (id: string): string => `machines/${id}`;

export interface ClaimRecord {
  job: string;
  machine: string;
  name: string;
  at: string;
}

export interface MachineRecord {
  id: string;
  name: string;
  at: string;
  capabilities: MachineCapabilities;
  jobs: string[];
}

export interface MachineView extends MachineRecord {
  alive: boolean;
}

export type ClaimResult = { claimed: true } | { claimed: false; holder: ClaimRecord };

function parse<T>(ref: CoordRef | undefined, check: (v: Record<string, unknown>) => boolean): T | undefined {
  if (!ref) return undefined;
  try {
    const value: unknown = JSON.parse(ref.data);
    return value && typeof value === "object" && check(value as Record<string, unknown>) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

const readClaim = (ref: CoordRef | undefined): ClaimRecord | undefined =>
  parse<ClaimRecord>(ref, (v) => typeof v.job === "string" && typeof v.machine === "string" && typeof v.name === "string" && typeof v.at === "string");

const readMachine = (ref: CoordRef | undefined): MachineRecord | undefined =>
  parse<MachineRecord>(ref, (v) => typeof v.id === "string" && typeof v.name === "string" && typeof v.at === "string" && Array.isArray(v.jobs) && typeof v.capabilities === "object" && v.capabilities !== null);

function within(at: string, now: Date, leaseMinutes: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now.getTime() - t <= leaseMinutes * 60_000;
}

/** The holder's last sign of life: its heartbeat, or the claim itself when that is newer. */
async function holderAlive(api: CoordApi, claim: ClaimRecord, now: Date, leaseMinutes: number): Promise<boolean> {
  if (within(claim.at, now, leaseMinutes)) return true;
  const beat = readMachine(await api.read(machineRef(claim.machine)));
  return beat !== undefined && within(beat.at, now, leaseMinutes);
}

function claimData(job: string, machine: MachineIdentity, now: Date): string {
  const record: ClaimRecord = { job, machine: machine.id, name: machine.name, at: now.toISOString() };
  return JSON.stringify(record);
}

/** Whoever holds the claim now, after a write lost a race; a claim gone meanwhile is reported as the loser's best read. */
async function lostTo(api: CoordApi, jobId: string): Promise<ClaimResult> {
  const holder = readClaim(await api.read(claimRef(jobId)));
  return { claimed: false, holder: holder ?? { job: jobId, machine: "", name: "", at: "" } };
}

/**
 * Takes a job for `machine`. Exactly one machine wins: a free job is taken by
 * creating its claim ref, and a claim whose holder is past its lease (or one this
 * machine already holds) is taken over only from the tip read.
 */
export async function claimJob(api: CoordApi, jobId: string, machine: MachineIdentity, now: Date, leaseMinutes = DEFAULT_LEASE_MINUTES): Promise<ClaimResult> {
  const name = claimRef(jobId);
  const data = claimData(jobId, machine, now);
  const current = await api.read(name);
  if (!current) {
    try {
      await api.create(name, data);
      return { claimed: true };
    } catch (err) {
      if (err instanceof CoordConflict) return lostTo(api, jobId);
      throw err;
    }
  }
  const holder = readClaim(current);
  if (holder && holder.machine !== machine.id && (await holderAlive(api, holder, now, leaseMinutes))) return { claimed: false, holder };
  try {
    await api.update(name, data, current.sha);
    return { claimed: true };
  } catch (err) {
    if (err instanceof CoordConflict) return lostTo(api, jobId);
    throw err;
  }
}

/** False once the claim names another machine, or is gone: a returning machine stops there. */
export async function stillHolds(api: CoordApi, jobId: string, machineId: string): Promise<boolean> {
  return readClaim(await api.read(claimRef(jobId)))?.machine === machineId;
}

/** Deletes the claim only while it names this machine; true when it did. */
export async function releaseJob(api: CoordApi, jobId: string, machineId: string): Promise<boolean> {
  if (!(await stillHolds(api, jobId, machineId))) return false;
  await api.delete(claimRef(jobId));
  return true;
}

/** Writes this machine's heartbeat: public fields only. */
export async function heartbeat(api: CoordApi, machine: MachineIdentity, capabilities: MachineCapabilities, jobs: string[], now: Date): Promise<MachineRecord> {
  const record: MachineRecord = {
    id: machine.id,
    name: machine.name,
    at: now.toISOString(),
    capabilities: { platform: capabilities.platform, box: capabilities.box, engines: [...capabilities.engines] },
    jobs: [...jobs],
  };
  await api.write(machineRef(machine.id), JSON.stringify(record));
  return record;
}

/** Every machine that ever beat, alive only within the lease. */
export async function listMachines(api: CoordApi, now: Date, leaseMinutes = DEFAULT_LEASE_MINUTES): Promise<MachineView[]> {
  const out: MachineView[] = [];
  for (const ref of await api.list("machines/")) {
    const record = readMachine(ref);
    if (record) out.push({ ...record, alive: within(record.at, now, leaseMinutes) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** An in-memory CoordApi with the same conflicts as GitHub's, for tests and a single process. `calls` records every operation. */
export function memoryCoord(): CoordApi & { calls: string[]; refs: Map<string, CoordRef> } {
  const refs = new Map<string, CoordRef>();
  const calls: string[] = [];
  let n = 0;
  const put = (name: string, data: string): string => {
    const sha = (++n).toString(16).padStart(40, "0");
    refs.set(name, { name, sha, data });
    return sha;
  };
  // Each operation yields first, so concurrent callers interleave as they would over the network.
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return {
    calls,
    refs,
    async read(name) {
      calls.push(`read ${name}`);
      await tick();
      const ref = refs.get(name);
      return ref && { ...ref };
    },
    async list(prefix) {
      calls.push(`list ${prefix}`);
      await tick();
      return [...refs.values()].filter((r) => r.name.startsWith(prefix)).map((r) => ({ ...r }));
    },
    async create(name, data) {
      calls.push(`create ${name}`);
      await tick();
      if (refs.has(name)) throw new CoordConflict(name);
      return put(name, data);
    },
    async update(name, data, from) {
      calls.push(`update ${name}`);
      await tick();
      if (refs.get(name)?.sha !== from) throw new CoordConflict(name);
      return put(name, data);
    },
    async write(name, data) {
      calls.push(`write ${name}`);
      await tick();
      return put(name, data);
    },
    async delete(name) {
      calls.push(`delete ${name}`);
      await tick();
      refs.delete(name);
    },
  };
}
