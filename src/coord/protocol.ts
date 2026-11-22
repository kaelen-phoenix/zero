import type { MachineCapabilities, MachineIdentity } from "../machine.js";

/**
 * The distributed factory's coordination protocol (docs/adr/0007-fabrica-distribuida.md).
 * Shared state is a set of named refs, each pointing at a record (a JSON text).
 * A job belongs to whoever's name is in `claims/<job>`; each machine writes its
 * latest heartbeat to `machines/<id>`. Creating a ref that exists, or moving one
 * from a tip that is no longer its tip, fails with CoordConflict: that is the only
 * atomicity the protocol needs, and git refs on GitHub give it. A claim is never
 * deleted: releasing moves it, by compare-and-swap, to a closing record.
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
export const probeRef = (id: string): string => `probe/${id}`;

/** Job and machine ids that may go into a ref name or come back from one. */
export const COORD_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface ClaimRecord {
  job: string;
  machine: string;
  name: string;
  at: string;
  /** Set on the closing record releaseJob leaves: the job is free, and ended with `status`. */
  released?: true;
  status?: string;
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

/** `takenFrom` is the expired claim of another machine this one took over: the job is a resume. */
export type ClaimResult = { claimed: true; takenFrom?: ClaimRecord } | { claimed: false; holder: ClaimRecord };

function parse<T>(ref: CoordRef | undefined, check: (v: Record<string, unknown>) => boolean): T | undefined {
  if (!ref) return undefined;
  try {
    const value: unknown = JSON.parse(ref.data);
    return value && typeof value === "object" && check(value as Record<string, unknown>) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

const isTime = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100 && !/[\u0000-\u001f\u007f]/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && COORD_ID.test(v);

const readClaim = (ref: CoordRef | undefined): ClaimRecord | undefined =>
  parse<ClaimRecord>(
    ref,
    (v) =>
      isId(v.job) &&
      isId(v.machine) &&
      isName(v.name) &&
      isTime(v.at) &&
      (v.released === undefined || (v.released === true && typeof v.status === "string" && /^[a-z]{1,20}$/.test(v.status))),
  );

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
 * creating its claim ref, and a closing record, a claim this machine already
 * holds or one whose holder is past its lease is taken over only from the tip
 * read. Taking over another machine's expired claim reports it as `takenFrom`.
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
  const other = holder && !holder.released && holder.machine !== machine.id ? holder : undefined;
  if (other && (await holderAlive(api, other, now, leaseMinutes))) return { claimed: false, holder: other };
  try {
    await api.update(name, data, current.sha);
    return other ? { claimed: true, takenFrom: other } : { claimed: true };
  } catch (err) {
    if (err instanceof CoordConflict) return lostTo(api, jobId);
    throw err;
  }
}

const holds = (claim: ClaimRecord | undefined, machineId: string): boolean => claim?.machine === machineId && !claim.released;

/** False once the claim names another machine, is released or is gone: a returning machine stops there. */
export async function stillHolds(api: CoordApi, jobId: string, machineId: string): Promise<boolean> {
  return holds(readClaim(await api.read(claimRef(jobId))), machineId);
}

/**
 * Releases the claim only while it names this machine, moving it from the tip
 * read to a closing record that tells the others how the job ended. Never a
 * delete: GitHub deletes refs without an expected tip, so a delete could drop a
 * claim another machine just took. True when it released.
 */
export async function releaseJob(api: CoordApi, jobId: string, machine: MachineIdentity, status: string, now: Date): Promise<boolean> {
  const name = claimRef(jobId);
  const current = await api.read(name);
  if (!current || !holds(readClaim(current), machine.id)) return false;
  const record: ClaimRecord = { job: jobId, machine: machine.id, name: machine.name, at: now.toISOString(), released: true, status };
  try {
    await api.update(name, JSON.stringify(record), current.sha);
    return true;
  } catch (err) {
    if (err instanceof CoordConflict) return false;
    throw err;
  }
}

/** The claim as it stands, validated; undefined when it is missing or does not read. */
export async function readClaimOf(api: CoordApi, jobId: string): Promise<ClaimRecord | undefined> {
  return readClaim(await api.read(claimRef(jobId)));
}

export type ProbeResult = { ok: true } | { ok: false; problem: string };

/**
 * Checks that `api` gives the two conflicts the protocol relies on, against the
 * real backend: creating `probe/<id>` twice, and moving it from a sha that is no
 * longer its tip. The probe ref is deleted afterwards whatever happened.
 */
export async function probeCoord(api: CoordApi, id: string): Promise<ProbeResult> {
  if (!COORD_ID.test(id)) return { ok: false, problem: `id de sondeo inválido: ${id}` };
  const name = probeRef(id);
  const conflicts = async (step: () => Promise<unknown>): Promise<boolean> => {
    try {
      await step();
      return false;
    } catch (err) {
      if (err instanceof CoordConflict) return true;
      throw err;
    }
  };
  let created = false;
  try {
    const first = await api.create(name, JSON.stringify({ probe: id, step: 1 }));
    created = true;
    if (!(await conflicts(() => api.create(name, JSON.stringify({ probe: id, step: 2 })))))
      return { ok: false, problem: "crear una referencia que ya existe no dio conflicto" };
    await api.update(name, JSON.stringify({ probe: id, step: 3 }), first);
    if (!(await conflicts(() => api.update(name, JSON.stringify({ probe: id, step: 4 }), first))))
      return { ok: false, problem: "mover una referencia desde un sha que ya no es su punta no dio conflicto" };
    return { ok: true };
  } catch (err) {
    return { ok: false, problem: `el sondeo falló: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (created) await api.delete(name).catch(() => undefined);
  }
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
