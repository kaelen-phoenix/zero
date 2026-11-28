import { approveProposal, jobElsewhere, proposalElsewhere, rejectProposal, type FactoryContext } from "../app.js";
import { answerJob } from "../line/answer.js";
import { log } from "../log.js";
import type { MachineIdentity } from "../machine.js";
import { dropOutbox, outbox, saveOutbox, type OutboxDecision, type OutboxEntry, type OutboxRequest } from "./outbox.js";
import { CoordConflict, decisionKey, decisionRef, finished, publishQueued, readDecisionRecord, type ClaimRecord, type CoordApi, type CoordRef, type DecisionRecord } from "./protocol.js";
import { readStatus, STATUS_DAYS } from "./status.js";

/** How long what came of a decision is still told. */
const TOLD_MS = 24 * 60 * 60_000;

/** The decisions as listed, and those to delete once the status tells what came of them. */
export interface Decisions {
  refs: CoordRef[];
  attended: string[];
}

/**
 * The decisions other machines published for this one's jobs and proposals: each
 * is applied only while what it decides still waits, as a local answer would be,
 * and is attended whatever came of it. A record that does not read has no effect,
 * and is cleared when it stands where a decision for this machine would go.
 */
export async function decisionsPass(ctx: FactoryContext, api: CoordApi, machine: MachineIdentity, claims: Map<string, ClaimRecord>): Promise<Decisions> {
  const { store } = ctx;
  const refs = await api.list("decisions/");
  const attended: string[] = [];
  for (const ref of refs) {
    const record = readDecisionRecord(ref);
    if (!record) {
      const asked = store.listJobs({ status: ["waiting"], limit: -1 }).flatMap((j) => (j.question ? [decisionRef({ job: j.id, askedAt: j.question.askedAt })] : []));
      const proposed = store.listProposals({ status: ["pending"] }).map((p) => decisionRef({ proposal: p.id }));
      if ([...asked, ...proposed].includes(ref.name)) attended.push(ref.name);
      continue;
    }
    if (record.to !== machine.id) continue;
    try {
      const applied = await applyDecision(ctx, record, machine, claims);
      log.info(applied ? "decision of another machine applied" : "decision of another machine for something that no longer waits", { target: decisionKey(record.target), from: record.machine });
    } catch (err) {
      log.warn("applying a decision of another machine failed", { target: decisionKey(record.target), error: String(err) });
    }
    attended.push(ref.name);
  }
  return { refs, attended };
}

async function applyDecision(ctx: FactoryContext, record: DecisionRecord, machine: MachineIdentity, claims: Map<string, ClaimRecord>): Promise<boolean> {
  const { target, decision, note } = record;
  if ("proposal" in target) {
    // Only a pending one: what the night shift built on its own is decided through its job's question.
    if (ctx.store.getProposal(target.proposal)?.status !== "pending") return false;
    if (decision === "approve") approveProposal(ctx, target.proposal);
    else await rejectProposal(ctx, target.proposal, note);
    return true;
  }
  const job = ctx.store.getJob(target.job);
  if (job?.status !== "waiting" || job.question?.askedAt !== target.askedAt) return false;
  // Another machine took the job over: this copy's question decides nothing.
  const claim = claims.get(job.id);
  if (claim && claim.machine !== machine.id && (!claim.released || finished(claim))) return false;
  await answerJob(ctx, job, decision, note);
  return true;
}

/**
 * What was decided or asked for here: each entry is published once, and kept with
 * what came of it. Runs after the status, whose view says what still waits.
 */
export async function outboxPass(ctx: FactoryContext, api: CoordApi, machine: MachineIdentity, refs: CoordRef[], now: Date): Promise<void> {
  const save = (entry: OutboxEntry) => saveOutbox(ctx.store, { ...entry, at: now.toISOString() });
  for (const entry of outbox(ctx.store)) {
    if (entry.kind === "request") await sendRequest(ctx, api, entry, save, now);
    else await sendDecision(ctx, api, machine, entry, refs, save, now);
  }
}

async function sendRequest(ctx: FactoryContext, api: CoordApi, entry: OutboxRequest, save: (entry: OutboxEntry) => void, now: Date): Promise<void> {
  const { id } = entry.record;
  if (entry.state === "pending") {
    await publishQueued(api, entry.record);
    return save({ ...entry, state: "published" });
  }
  const told = ctx.store.getJob(id) || readStatus(ctx.store).records.some((r) => r.jobs.some((j) => j.id === id));
  if (told || now.getTime() - Date.parse(entry.at) > STATUS_DAYS * 86_400_000) dropOutbox(ctx.store, entry);
}

async function sendDecision(ctx: FactoryContext, api: CoordApi, machine: MachineIdentity, entry: OutboxDecision, refs: CoordRef[], save: (entry: OutboxEntry) => void, now: Date): Promise<void> {
  const { record } = entry;
  const name = decisionRef(record.target);
  if (entry.state === "published") {
    if (!refs.some((r) => r.name === name && readDecisionRecord(r)?.machine === machine.id)) save({ ...entry, state: "attended" });
    return;
  }
  if (entry.state !== "pending") {
    if (now.getTime() - Date.parse(entry.at) > TOLD_MS) dropOutbox(ctx.store, entry);
    return;
  }
  if (!stillWaits(ctx, record)) return save({ ...entry, state: "late" });
  try {
    await api.create(name, JSON.stringify(record));
    save({ ...entry, state: "published" });
  } catch (err) {
    if (!(err instanceof CoordConflict)) throw err;
    const there = await api.read(name);
    const first = there && readDecisionRecord(there);
    // Its own means a pass that was cut before it could say so; with nothing that reads there, the next pass tries again.
    if (first) save({ ...entry, state: first.machine === machine.id && first.decision === record.decision ? "published" : "late" });
  }
}

/** Whether the machine it goes to still waits for that very decision, as the view of the whole factory says. */
function stillWaits(ctx: FactoryContext, { target, to }: DecisionRecord): boolean {
  if ("proposal" in target) return proposalElsewhere(ctx, target.proposal)?.machine.id === to;
  const job = jobElsewhere(ctx, target.job);
  return job?.machine.id === to && job.question?.askedAt === target.askedAt;
}
