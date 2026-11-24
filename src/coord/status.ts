import type { FactoryConfig } from "../config.js";
import { jobName } from "../format.js";
import { endedElsewhere } from "../line/finish.js";
import { scrubLocal } from "../line/research.js";
import { jobStage } from "../line/spec.js";
import type { MachineIdentity } from "../machine.js";
import { storedPriority } from "../priority.js";
import { FINAL_STATUSES, type Job, type Store } from "../state/store.js";
import { outbox } from "./outbox.js";
import { CONTROL, MAX_STATUS_ITEMS, MAX_STATUS_TEXT, MAX_STATUS_TITLE, readStatusRecord, statusJob, statusProposal, statusRef, TEXT_CONTROL, type ClaimRecord, type CoordApi, type StatusJob, type StatusRecord } from "./protocol.js";

/** What the other machines said of their jobs, and who holds them, as the last coordination pass read it. */
export const STATUS_KEY = "coord:status";

/** How far back a finished job is still told, and how many of them. */
export const STATUS_DAYS = 7;
const STATUS_FINISHED = 10;

export interface StoredStatus {
  records: StatusRecord[];
  /** The claims of the jobs told in `records`, not finished here or asked for from here. */
  claims: ClaimRecord[];
}

interface StatusCtx {
  store: Store;
  config: FactoryConfig;
  home?: { root: string };
}

const order = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A job as this machine shows it, with its texts as they are. */
export function ownStatusJob(job: Job): StatusJob {
  const stage = FINAL_STATUSES.includes(job.status) ? undefined : jobStage(job);
  const question = job.status === "waiting" ? job.question : undefined;
  return {
    id: job.id,
    line: job.line,
    title: jobName(job),
    status: job.status,
    ...(job.station && { station: job.station }),
    ...(job.attempt && { attempt: job.attempt }),
    ...(stage && { stage }),
    priority: storedPriority(job),
    createdAt: job.createdAt,
    ...(job.finishedAt && { finishedAt: job.finishedAt }),
    ...(question && { question }),
  };
}

/** What this machine tells the others: its jobs, but not those another machine finished, and the proposals that wait. */
export function ownStatus(ctx: StatusCtx, id: string, now: Date): StatusRecord {
  const { store, config } = ctx;
  // No local paths, no secrets and nothing a terminal obeys. Whole texts first, so a cut never leaves half a secret behind.
  const text = (line: string, value: string, control = TEXT_CONTROL, max = MAX_STATUS_TEXT): string => {
    const repos = [config.lines.find((l) => l.name === line)?.repo, ctx.home?.root].filter((r) => r !== undefined);
    const shown = value.replace(/\r\n?/g, "\n").replace(control, " ");
    return repos.reduce((out, repo) => scrubLocal(out, { repo }), shown).trim().slice(0, max);
  };
  const title = (line: string, value: string) => text(line, value, CONTROL, MAX_STATUS_TITLE);
  const told = (job: Job): StatusJob | undefined => {
    const clean = ownStatusJob({ ...job, request: title(job.line, job.request), title: job.title && title(job.line, job.title) });
    const { stage, question } = clean;
    return statusJob({
      ...clean,
      title: clean.title || job.id,
      ...(stage && { stage: { ...stage, title: title(job.line, stage.title) } }),
      ...(question && { question: { ...question, text: text(job.line, question.text) } }),
    });
  };
  const listed = (status: Job["status"]) => store.listJobs({ status: [status], limit: -1 });
  const finished = store
    .finishedSince(new Date(now.getTime() - STATUS_DAYS * 86_400_000))
    .filter((j) => FINAL_STATUSES.includes(j.status) && !endedElsewhere(j))
    .slice(-STATUS_FINISHED);
  const open = [...listed("running"), ...listed("waiting"), ...listed("queued")].slice(0, MAX_STATUS_ITEMS - STATUS_FINISHED);
  return {
    id,
    at: now.toISOString(),
    jobs: [...open, ...finished].map(told).filter((j) => j !== undefined).sort(order),
    proposals: store
      .listProposals({ status: ["pending"] })
      .slice(-MAX_STATUS_ITEMS)
      .map((p) => statusProposal({ ...p, title: title(p.line, p.title) || p.id, why: text(p.line, p.why), change: text(p.line, p.change) }))
      .filter((p) => p !== undefined)
      .sort(order),
  };
}

/**
 * The status's share of the coordination pass, only with the protocol on and
 * after the queue, whose `claims` say which machine has each job: the valid
 * records of the other machines, alive or not, are kept in kv for the view of
 * the whole factory, and this machine's `status/<id>` is written when it says
 * something new (a finished job that only grew old is no change).
 */
export async function statusPass(ctx: StatusCtx, api: CoordApi, machine: MachineIdentity, claims: Map<string, ClaimRecord>, now: Date): Promise<void> {
  const { store } = ctx;
  const refs = await api.list(statusRef(""));
  const all = refs.map(readStatusRecord).filter((r) => r !== undefined);
  const records = all.filter((r) => r.id !== machine.id);
  const open = store.listJobs({ status: ["queued", "running", "waiting"], limit: -1 });
  const asked = outbox(store).flatMap((e) => (e.kind === "request" ? [e.record] : []));
  const ids = new Set([...open, ...records.flatMap((r) => r.jobs), ...asked].map((j) => j.id));
  store.setKv(STATUS_KEY, JSON.stringify({ records, claims: [...claims.values()].filter((c) => ids.has(c.job)) } satisfies StoredStatus));

  const own = ownStatus(ctx, machine.id, now);
  const published = all.find((r) => r.id === machine.id);
  const oldest = new Date(now.getTime() - STATUS_DAYS * 86_400_000).toISOString();
  const content = (r: StatusRecord | undefined) => JSON.stringify([r?.jobs.filter((j) => !j.finishedAt || j.finishedAt >= oldest) ?? [], r?.proposals ?? []]);
  if (content(published) === content(own)) return;
  await api.write(statusRef(machine.id), JSON.stringify(own));
}

/** What the last pass kept of the other machines; nothing when it does not read. */
export function readStatus(store: Store): StoredStatus {
  const raw = store.getKv(STATUS_KEY);
  try {
    const v = raw ? (JSON.parse(raw) as StoredStatus | null) : undefined;
    if (v && Array.isArray(v.records) && Array.isArray(v.claims)) return v;
  } catch {
    // Nothing kept, then.
  }
  return { records: [], claims: [] };
}
