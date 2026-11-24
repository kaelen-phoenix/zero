import { LINE_PLATFORMS, type LineConfig } from "../config.js";
import type { QuotaWindow } from "../engines/index.js";
import type { MachineCapabilities, MachineIdentity } from "../machine.js";
import { isPriority, type JobPriority } from "../priority.js";
import { findSecret } from "../secrets.js";
import type { JobStatus, Question } from "../state/store.js";

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
export const queueRef = (job: string): string => `queue/${job}`;
export const progressRef = (job: string): string => `progress/${job}`;
export const lineRef = (name: string): string => `lines/${name}`;
export const spendRef = (id: string): string => `spend/${id}`;
export const statusRef = (id: string): string => `status/${id}`;
/** `key` comes from sourceKey: one ref per request origin, naming the one job that serves it. */
export const sourceRef = (key: string): string => `sources/${key}`;

const FINAL = ["delivered", "failed", "stopped"];

/** A closing record of a job that ended (not one sent back to the queue by a shutdown). */
export const finished = (claim: ClaimRecord | undefined): claim is ClaimRecord & { released: true; status: "delivered" | "failed" | "stopped" } =>
  claim?.released === true && FINAL.includes(claim.status ?? "");

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
 * With `keepFinished`, a closing record another machine left for a job that
 * ended is not taken: it comes back as the holder, so that job is not run twice.
 */
export async function claimJob(
  api: CoordApi,
  jobId: string,
  machine: MachineIdentity,
  now: Date,
  leaseMinutes = DEFAULT_LEASE_MINUTES,
  opts: { keepFinished?: boolean } = {},
): Promise<ClaimResult> {
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
  if (opts.keepFinished && finished(holder) && holder.machine !== machine.id) return { claimed: false, holder };
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

/** Every claim that reads, by job: one listing instead of a read per job. */
export async function listClaims(api: CoordApi): Promise<Map<string, ClaimRecord>> {
  const out = new Map<string, ClaimRecord>();
  for (const ref of await api.list("claims/")) {
    const claim = readClaim(ref);
    if (claim && ref.name === claimRef(claim.job)) out.set(claim.job, claim);
  }
  return out;
}

/** What a job needs from the machine that takes it. */
export interface JobNeeds {
  box: boolean;
  engines: string[];
}

/** A job on the shared queue, as the machine that queued it published it: no local paths, no secrets. */
export interface QueueRecord {
  id: string;
  line: string;
  kind: "request" | "spec";
  request: string;
  priority: string;
  source?: Record<string, unknown> & { kind: string };
  createdAt: string;
  needs: JobNeeds;
}

/** The longest request a queue record may carry. */
const MAX_QUEUED_REQUEST = 100_000;
const SOURCE_KINDS = ["github-issue", "linear-issue", "jira-issue", "night-shift", "research", "package", "security-alert", "pull-request"];

/** Only plain fields: strings, finite numbers, booleans and lists of them, as every JobSource is. */
function isSource(v: unknown): v is QueueRecord["source"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const fields = Object.values(v as Record<string, unknown>);
  const plain = (x: unknown) => (typeof x === "string" && x.length <= 2000) || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x));
  return SOURCE_KINDS.includes((v as { kind?: unknown }).kind as string) && fields.length <= 12 && fields.every((x) => plain(x) || (Array.isArray(x) && x.length <= 200 && x.every(plain)));
}

const isNeeds = (v: unknown): v is JobNeeds =>
  !!v && typeof v === "object" && typeof (v as JobNeeds).box === "boolean" && Array.isArray((v as JobNeeds).engines) && (v as JobNeeds).engines.length <= 20 && (v as JobNeeds).engines.every((e) => typeof e === "string" && /^[a-z0-9-]{1,40}$/.test(e));

/** A queue record that reads strictly, and only under its own ref; anything else is undefined. */
export function readQueueRecord(ref: CoordRef): QueueRecord | undefined {
  const record = parse<QueueRecord>(
    ref,
    (v) =>
      isId(v.id) &&
      isName(v.line) &&
      (v.kind === "request" || v.kind === "spec") &&
      typeof v.request === "string" &&
      v.request.trim().length > 0 &&
      v.request.length <= MAX_QUEUED_REQUEST &&
      typeof v.priority === "string" &&
      /^[a-z]{1,20}$/.test(v.priority) &&
      (v.source === undefined || isSource(v.source)) &&
      isTime(v.createdAt) &&
      isNeeds(v.needs),
  );
  return record && ref.name === queueRef(record.id) ? record : undefined;
}

/** A branch or base name read back from the coordination repository: plain ref characters only, never an option or a path out. */
export const REF_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

/** A line of the factory as the machine that has it published it: what another machine needs to clone it, no local paths, no secrets. */
export interface LineRecord {
  name: string;
  /** `account/name` on GitHub. */
  repository: string;
  baseBranch: string;
  setup: string[];
  verify: string[];
  verifyTimeoutMinutes?: number;
  integrate: LineConfig["integrate"];
  autoMerge: boolean;
  /** Engines a machine must have in its chains, and platforms the line runs on (none: any). */
  needs: { engines: string[]; platforms: NonNullable<LineConfig["platforms"]> };
  machine: string;
  at: string;
}

/** A line's name also names its clone's folder: nothing that leaves it, nor a device name of Windows. */
const LINE_NAME = /^(?!(?:con|prn|aux|nul|com\d|lpt\d)$)[a-z0-9][a-z0-9-]{0,63}$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)(?!.*\.git$)[A-Za-z0-9._-]{1,100}$/;

const isCommands = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 50 && v.every((c) => typeof c === "string" && c.trim().length > 0 && c.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(c));

const isLineNeeds = (v: unknown): v is LineRecord["needs"] => {
  const platforms = (v as LineRecord["needs"] | null)?.platforms;
  return isNeeds({ ...(v as object), box: false }) && Array.isArray(platforms) && platforms.length <= LINE_PLATFORMS.length && platforms.every((p) => LINE_PLATFORMS.includes(p));
};

/** A line record that reads strictly, and only under its own ref; only the known fields come back, anything off is undefined. */
export function readLineRecord(ref: CoordRef): LineRecord | undefined {
  if (findSecret(ref.data)) return undefined;
  const v = parse<LineRecord>(
    ref,
    (v) =>
      typeof v.name === "string" &&
      LINE_NAME.test(v.name) &&
      typeof v.repository === "string" &&
      GITHUB_REPOSITORY.test(v.repository) &&
      typeof v.baseBranch === "string" &&
      REF_NAME.test(v.baseBranch) &&
      isCommands(v.setup) &&
      isCommands(v.verify) &&
      (v.verifyTimeoutMinutes === undefined || (typeof v.verifyTimeoutMinutes === "number" && v.verifyTimeoutMinutes > 0 && v.verifyTimeoutMinutes <= 24 * 60)) &&
      (v.integrate === "merge" || v.integrate === "branch" || v.integrate === "pull-request") &&
      typeof v.autoMerge === "boolean" &&
      (!v.autoMerge || v.integrate === "pull-request") &&
      isLineNeeds(v.needs) &&
      isId(v.machine) &&
      isTime(v.at),
  );
  if (!v || ref.name !== lineRef(v.name)) return undefined;
  return {
    name: v.name,
    repository: v.repository,
    baseBranch: v.baseBranch,
    setup: v.setup,
    verify: v.verify,
    ...(v.verifyTimeoutMinutes !== undefined && { verifyTimeoutMinutes: v.verifyTimeoutMinutes }),
    integrate: v.integrate,
    autoMerge: v.autoMerge,
    needs: { engines: v.needs.engines, platforms: v.needs.platforms },
    machine: v.machine,
    at: v.at,
  };
}

export const SPEND_SLOT_MS = 15 * 60_000;

/** What the agent calls that started within one slot cost, as the engines estimate it. */
export interface SpendSlot {
  /** When the slot starts (ISO); it lasts SPEND_SLOT_MS. */
  at: string;
  engine: string;
  /** How they were billed on the machine that made them. */
  billing: "api" | "subscription" | "unknown";
  /** Whether they count against `limits.usdPerNight`. */
  idle: boolean;
  usd: number;
}

/** A machine's latest reading of an engine's subscription: one plan per account, so it says where every machine stands. */
export interface PlanReading {
  engine: string;
  /** When the call that told it ended (ISO). */
  at: string;
  /** Whether that call was refused. */
  limited: boolean;
  windows: QuotaWindow[];
}

/** What a machine spent lately, for the other machines' caps: amounts and plan windows only, no prompts, paths or texts. */
export interface SpendRecord {
  id: string;
  at: string;
  slots: SpendSlot[];
  /** What that machine was charged for each job it has or had lately, whenever it was. */
  jobs: { id: string; usd: number }[];
  /** Its latest plan readings; absent on a machine with no subscription. */
  plans?: PlanReading[];
}

/** The most slots or jobs a spend record may carry. */
const MAX_SPEND_ITEMS = 20_000;

const isUsd = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isItems = (v: unknown, check: (item: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(v) && v.length <= MAX_SPEND_ITEMS && v.every((item) => !!item && typeof item === "object" && check(item as Record<string, unknown>));
const isSpendSlot = (v: Record<string, unknown>): boolean =>
  isTime(v.at) && isName(v.engine) && (v.billing === "api" || v.billing === "subscription" || v.billing === "unknown") && typeof v.idle === "boolean" && isUsd(v.usd);

const isPlanWindow = (v: Record<string, unknown>): boolean =>
  isName(v.name) && isName(v.label) && (v.utilization === undefined || isUsd(v.utilization)) && (v.status === "ok" || v.status === "warning" || v.status === "exhausted") && (v.resetsAt === undefined || isTime(v.resetsAt));
const isPlanReading = (v: Record<string, unknown>): boolean => isName(v.engine) && isTime(v.at) && typeof v.limited === "boolean" && isItems(v.windows, isPlanWindow);

/** The windows of a reading that may go into a record, with only the known fields. */
export function planWindows(windows: unknown): QuotaWindow[] {
  const valid = (Array.isArray(windows) ? windows : []).filter((w) => isItems([w], isPlanWindow)) as QuotaWindow[];
  return valid.map(({ name, label, utilization, status, resetsAt }) => ({ name, label, ...(utilization !== undefined && { utilization }), status, ...(resetsAt !== undefined && { resetsAt }) }));
}

/** A spend record that reads strictly, and only under its own ref; only the known fields come back, anything off is undefined. */
export function readSpendRecord(ref: CoordRef): SpendRecord | undefined {
  const v = parse<SpendRecord>(ref, (v) => isId(v.id) && isTime(v.at) && isItems(v.slots, isSpendSlot) && isItems(v.jobs, (j) => isId(j.id) && isUsd(j.usd)) && (v.plans === undefined || isItems(v.plans, isPlanReading)));
  if (!v || ref.name !== spendRef(v.id)) return undefined;
  return {
    id: v.id,
    at: v.at,
    slots: v.slots.map(({ at, engine, billing, idle, usd }) => ({ at, engine, billing, idle, usd })),
    jobs: v.jobs.map(({ id, usd }) => ({ id, usd })),
    ...(v.plans?.length && { plans: v.plans.map(({ engine, at, limited, windows }) => ({ engine, at, limited, windows: planWindows(windows) })) }),
  };
}

/** A job as its machine tells the others about it: no local paths, no secrets. */
export interface StatusJob {
  id: string;
  line: string;
  title: string;
  status: JobStatus;
  station?: string;
  attempt?: number;
  stage?: { n: number; total: number; title: string };
  priority: JobPriority;
  createdAt: string;
  finishedAt?: string;
  /** Only while it waits. */
  question?: Pick<Question, "kind" | "text" | "askedAt" | "expiresAt" | "onTimeout">;
}

/** A scout proposal that waits to be decided on its machine. */
export interface StatusProposal {
  id: string;
  line: string;
  title: string;
  why: string;
  change: string;
  estimatedUsd: number;
  createdAt: string;
}

/** Where a machine's jobs and proposals stand, for the view of the whole factory. */
export interface StatusRecord {
  id: string;
  at: string;
  jobs: StatusJob[];
  proposals: StatusProposal[];
}

/** The most jobs or proposals a status record may carry, and how long its texts may be. */
export const MAX_STATUS_ITEMS = 1000;
export const MAX_STATUS_TITLE = 300;
export const MAX_STATUS_TEXT = 20_000;

const JOB_STATUSES: readonly JobStatus[] = ["queued", "running", "waiting", "delivered", "failed", "stopped"];
const QUESTION_KINDS: readonly Question["kind"][] = ["spec-ready", "before-integrate", "protected-path", "budget-exceeded", "integration-blocked", "egress-suspicious"];

/** Characters a terminal would obey instead of showing; a text of several lines keeps its line breaks and tabs. */
export const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
export const TEXT_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;

const isTitle = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_STATUS_TITLE && v.search(CONTROL) < 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_STATUS_TEXT && v.search(TEXT_CONTROL) < 0;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000;
const isStage = (v: Partial<NonNullable<StatusJob["stage"]>> | null): boolean => !!v && isCount(v.n) && isCount(v.total) && (v.title === "" || isTitle(v.title));
const isAsked = (v: Partial<NonNullable<StatusJob["question"]>> | null): boolean =>
  !!v && QUESTION_KINDS.includes(v.kind!) && isText(v.text) && isTime(v.askedAt) && isTime(v.expiresAt) && (v.onTimeout === "approve" || v.onTimeout === "reject");

/** A job fit for a status record, with only the known fields; undefined when anything is off. */
export function statusJob(value: unknown): StatusJob | undefined {
  const v = value as StatusJob | null;
  const valid =
    !!v &&
    typeof v === "object" &&
    isId(v.id) &&
    isName(v.line) &&
    isTitle(v.title) &&
    JOB_STATUSES.includes(v.status) &&
    (v.station === undefined || isTitle(v.station)) &&
    (v.attempt === undefined || isCount(v.attempt)) &&
    (v.stage === undefined || isStage(v.stage)) &&
    isPriority(v.priority) &&
    isTime(v.createdAt) &&
    (v.finishedAt === undefined || isTime(v.finishedAt)) &&
    (v.question === undefined || (v.status === "waiting" && isAsked(v.question)));
  if (!valid) return undefined;
  const { stage, question } = v;
  return {
    id: v.id,
    line: v.line,
    title: v.title,
    status: v.status,
    ...(v.station !== undefined && { station: v.station }),
    ...(v.attempt !== undefined && { attempt: v.attempt }),
    ...(stage && { stage: { n: stage.n, total: stage.total, title: stage.title } }),
    priority: v.priority,
    createdAt: v.createdAt,
    ...(v.finishedAt !== undefined && { finishedAt: v.finishedAt }),
    ...(question && { question: { kind: question.kind, text: question.text, askedAt: question.askedAt, expiresAt: question.expiresAt, onTimeout: question.onTimeout } }),
  };
}

/** A proposal fit for a status record, with only the known fields; undefined when anything is off. */
export function statusProposal(value: unknown): StatusProposal | undefined {
  const v = value as StatusProposal | null;
  if (!v || typeof v !== "object" || !isId(v.id) || !isName(v.line) || !isTitle(v.title) || !isText(v.why) || !isText(v.change) || !isUsd(v.estimatedUsd) || !isTime(v.createdAt)) return undefined;
  return { id: v.id, line: v.line, title: v.title, why: v.why, change: v.change, estimatedUsd: v.estimatedUsd, createdAt: v.createdAt };
}

/** A status record that reads strictly, and only under its own ref; only the known fields come back, anything off is undefined. */
export function readStatusRecord(ref: CoordRef): StatusRecord | undefined {
  const fits = (v: unknown) => Array.isArray(v) && v.length <= MAX_STATUS_ITEMS;
  const v = parse<StatusRecord>(ref, (v) => isId(v.id) && isTime(v.at) && fits(v.jobs) && fits(v.proposals));
  if (!v || ref.name !== statusRef(v.id)) return undefined;
  const jobs = v.jobs.map(statusJob).filter((j) => j !== undefined);
  const proposals = v.proposals.map(statusProposal).filter((p) => p !== undefined);
  if (jobs.length !== v.jobs.length || proposals.length !== v.proposals.length) return undefined;
  return { id: v.id, at: v.at, jobs, proposals };
}

/** Publishes the job on the shared queue; false when it was already there. */
export async function publishQueued(api: CoordApi, record: QueueRecord): Promise<boolean> {
  try {
    await api.create(queueRef(record.id), JSON.stringify(record));
    return true;
  } catch (err) {
    if (err instanceof CoordConflict) return false;
    throw err;
  }
}

/**
 * Makes `jobId` the one job of the request origin `key`, unless another job
 * already is: then that job's id comes back, and the local job is a duplicate.
 */
export async function claimSource(api: CoordApi, key: string, jobId: string): Promise<string> {
  const name = sourceRef(key);
  const record = JSON.stringify({ job: jobId });
  try {
    await api.create(name, record);
    return jobId;
  } catch (err) {
    if (!(err instanceof CoordConflict)) throw err;
  }
  const owner = parse<{ job: string }>(await api.read(name), (v) => isId(v.job));
  // A record that does not read names no job: this one stays its own.
  return owner?.job ?? jobId;
}

export type ProbeResult ={ ok: true } | { ok: false; problem: string };

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
