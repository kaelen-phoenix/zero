import { existsSync } from "node:fs";
import { MAX_STAGES, SpecSchema, specProblems } from "../line/spec.js";
import { log } from "../log.js";
import type { MachineIdentity } from "../machine.js";
import { spawnGit, tryGit } from "../shell.js";
import type { Job, Store } from "../state/store.js";
import { removeWorkCopy, type WorkCopy } from "../workspace.js";
import { COORD_ID, CoordConflict, progressRef, stillHolds, type CoordApi, type CoordRef } from "./protocol.js";

/** `coord:pushed:<id>`: the last sha of the job's branch this machine pushed, the lease of its next push. */
export const pushedKey = (id: string) => `coord:pushed:${id}`;

/** How far a job got, as the machine that holds it last pushed it: enough for another machine to resume there. */
export interface ProgressRecord {
  job: string;
  machine: string;
  checkpoint: Job["checkpoint"];
  stagesDone: number;
  branch: string;
  base: string;
  sha: string;
  title: string | null;
  spec: unknown;
  attempt: number;
  at: string;
}

/** `pushed`: the branch and progress/<job> are up; `lost`: the job is another machine's now; `skipped`: nothing went up this time (no origin, an unreachable remote or repository). */
export type PushOutcome = "pushed" | "lost" | "skipped";

export interface PushDeps {
  api: CoordApi;
  store: Store;
  machine: MachineIdentity;
  /** The line's repository, whose `origin` remote gets the branch. */
  repo: string;
  now: () => Date;
}

/** A push git refused: the lease did not match, so someone else moved the branch. Anything else is a cut or a missing remote. */
const REFUSED = /stale info|\[rejected\]|non-fast-forward|fetch first/i;

/**
 * Pushes the job's branch to the line's `origin` at a checkpoint, only while the
 * job is still this machine's and only over the sha this machine pushed last
 * (`--force-with-lease`; none yet means the branch must not exist there), then
 * writes progress/<job> by compare-and-swap. What is not committed stays behind.
 */
export async function pushProgress(deps: PushDeps, job: Job, copy: WorkCopy): Promise<PushOutcome> {
  const { api, store, machine, repo } = deps;
  let mine: boolean;
  try {
    mine = await stillHolds(api, job.id, machine.id);
  } catch (err) {
    log.warn("checking the job's claim before pushing failed; not pushing this time", { job: job.id, error: String(err) });
    return "skipped";
  }
  if (!mine) return "lost";
  if (tryGit(["remote", "get-url", "origin"], repo) === undefined) {
    log.warn("the line's repository has no origin remote; the job's progress is not pushed", { job: job.id, repo });
    return "skipped";
  }
  copy.publish();
  const ref = `refs/heads/${copy.branch}`;
  const sha = tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repo);
  if (!sha) return "skipped";
  const lease = store.getKv(pushedKey(job.id)) ?? "";
  const pushed = spawnGit(["push", "--quiet", "--no-verify", `--force-with-lease=${ref}:${lease}`, "origin", `${ref}:${ref}`], repo, { timeout: 120_000 });
  if (pushed.status !== 0) {
    const output = `${pushed.stderr ?? ""}${pushed.stdout ?? ""}`.trim();
    if (REFUSED.test(output)) {
      log.warn("pushing the job's branch was refused by its lease: someone else moved it", { job: job.id, branch: copy.branch });
      return "lost";
    }
    log.warn("pushing the job's branch failed; going on", { job: job.id, error: output || String(pushed.error) });
    return "skipped";
  }
  store.setKv(pushedKey(job.id), sha);
  const record: ProgressRecord = {
    job: job.id,
    machine: machine.id,
    checkpoint: job.checkpoint,
    stagesDone: job.stagesDone ?? 0,
    branch: copy.branch,
    base: copy.base,
    sha,
    title: job.title ?? null,
    spec: job.spec ?? null,
    attempt: job.attempt,
    at: deps.now().toISOString(),
  };
  const name = progressRef(job.id);
  try {
    const current = await api.read(name);
    if (current) await api.update(name, JSON.stringify(record), current.sha);
    else await api.create(name, JSON.stringify(record));
  } catch (err) {
    // Only the holder writes progress: a race on it means another machine has the job.
    if (err instanceof CoordConflict) return "lost";
    log.warn("writing the job's progress failed; going on", { job: job.id, error: String(err) });
    return "skipped";
  }
  return "pushed";
}

/** A branch or base name read back from the coordination repository: plain ref characters only, never an option or a path out. */
const REF_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;
const CHECKPOINTS: Job["checkpoint"][] = ["none", "spec", "review"];

/** progress/<job> read strictly: anything off, a spec that would not pass the spec station included, reads as none. */
export function readProgress(ref: CoordRef | undefined, jobId: string): ProgressRecord | undefined {
  if (!ref) return undefined;
  let v: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(ref.data);
    if (!value || typeof value !== "object") return undefined;
    v = value as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const count = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
  const ok =
    v.job === jobId &&
    typeof v.machine === "string" &&
    COORD_ID.test(v.machine) &&
    CHECKPOINTS.includes(v.checkpoint as Job["checkpoint"]) &&
    count(v.stagesDone, MAX_STAGES) &&
    typeof v.branch === "string" &&
    REF_NAME.test(v.branch) &&
    typeof v.base === "string" &&
    REF_NAME.test(v.base) &&
    typeof v.sha === "string" &&
    SHA.test(v.sha) &&
    (v.title === null || (typeof v.title === "string" && v.title.length <= 500)) &&
    count(v.attempt, 100) &&
    typeof v.at === "string" &&
    Number.isFinite(Date.parse(v.at));
  if (!ok) return undefined;
  if (v.checkpoint === "none") return { ...(v as unknown as ProgressRecord), spec: null };
  const spec = SpecSchema.safeParse(v.spec);
  if (!spec.success || specProblems(spec.data).length) return undefined;
  return { ...(v as unknown as ProgressRecord), spec: spec.data };
}

export interface ResumeDeps {
  api: CoordApi;
  store: Store;
  machine: MachineIdentity;
  /** The line's repository, whose `origin` remote has the branch the earlier holder pushed. */
  repo: string;
}

/**
 * Puts a job this machine just took over at the checkpoint its earlier holder
 * last pushed: the branch comes from the line's `origin` at progress's sha, and
 * the job gets its spec, title, stages, branch, base and attempt, so the runner
 * goes on from there. What this machine had of the job before is dropped. An
 * invalid or missing progress, or a branch that cannot be fetched, starts the
 * job from scratch. Either way the next push's lease is the branch's tip on the
 * remote, which is this machine's to move now. A job no other machine pushed
 * and that was not taken over (`takenOver`, a claim's `takenFrom`) stays as it is.
 */
export async function resumeProgress(deps: ResumeDeps, jobId: string, takenOver: boolean): Promise<Job> {
  const { api, store, machine, repo } = deps;
  let job = store.getJob(jobId)!;
  let record: ProgressRecord | undefined;
  try {
    record = readProgress(await api.read(progressRef(jobId)), jobId);
  } catch (err) {
    log.warn("reading the job's progress failed; starting it from scratch", { job: jobId, error: String(err) });
  }
  // This machine's own record: what it has locally is at least as far.
  if (record?.machine === machine.id || (!record && !takenOver)) return job;
  try {
    if (job.worktree && existsSync(job.worktree)) removeWorkCopy(repo, job.worktree);
  } catch (err) {
    log.warn("removing the job's old work copy before resuming failed", { job: jobId, error: String(err) });
  }
  const branch = record?.branch ?? job.branch ?? `zero/${jobId}`;
  const ref = `refs/heads/${branch}`;
  const remoteTip = tryGit(["ls-remote", "origin", ref], repo)?.split(/\s/)[0];
  const lease = (tip: string | undefined) => (tip && SHA.test(tip) ? store.setKv(pushedKey(jobId), tip) : store.deleteKv(pushedKey(jobId)));
  if (record && remoteTip) {
    const fetched = spawnGit(["fetch", "-q", "origin", `+${ref}:${ref}`], repo, { timeout: 120_000 });
    const usable =
      fetched.status === 0 &&
      tryGit(["cat-file", "-e", `${record.sha}^{commit}`], repo) !== undefined &&
      tryGit(["rev-parse", "--verify", "--quiet", `${record.base}^{commit}`], repo) !== undefined &&
      tryGit(["update-ref", ref, record.sha], repo) !== undefined;
    if (usable) {
      lease(remoteTip);
      log.info("resuming the job at the checkpoint another machine pushed", { job: jobId, checkpoint: record.checkpoint, stagesDone: record.stagesDone, from: record.machine });
      job = store.updateJob(jobId, {
        checkpoint: record.checkpoint,
        spec: record.spec,
        title: record.title,
        stagesDone: record.stagesDone,
        branch,
        base: record.base,
        attempt: record.attempt,
        worktree: null,
        station: null,
        feedback: null,
      });
      return job;
    }
    log.warn("the branch another machine pushed could not be brought here; starting the job from scratch", { job: jobId, branch, error: (fetched.stderr ?? "").trim().slice(0, 500) });
  }
  // From scratch: a branch this machine had for the job would carry stale work.
  tryGit(["branch", "-D", branch], repo);
  lease(remoteTip);
  return store.updateJob(jobId, { checkpoint: "none", spec: null, title: null, stagesDone: 0, attempt: 0, branch: null, base: null, worktree: null, station: null, feedback: null });
}
