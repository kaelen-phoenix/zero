import { log } from "../log.js";
import type { MachineIdentity } from "../machine.js";
import { spawnGit, tryGit } from "../shell.js";
import type { Job, Store } from "../state/store.js";
import type { WorkCopy } from "../workspace.js";
import { CoordConflict, progressRef, stillHolds, type CoordApi } from "./protocol.js";

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
