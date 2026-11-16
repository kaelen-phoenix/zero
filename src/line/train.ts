import type { FactoryContext } from "../app.js";
import { log } from "../log.js";
import type { Job } from "../state/store.js";
import { mergeKey, type MergeState } from "./automerge.js";

/**
 * The integration train of a line: its pull requests merged one at a time, in order. Only the head is acted on
 * (merged, updated with its base, rerun or taken back); the others wait without anything written to GitHub, so
 * merging one never leaves the next in conflict or behind a base it was not checked against. Once the head is
 * merged or closed the next one becomes the head, with what earlier conflicts spent on it given back once.
 */
export interface TrainEntry {
  job: string;
  url: string;
  /** The head zero verified, for a pull request the factory did not open: the only one it merges. */
  head?: string;
}

export interface Train {
  line: string;
  /** owner/repo of the line's GitHub repository. */
  repository: string;
  /** In merge order: the first is the head. */
  entries: TrainEntry[];
  startedAt: string;
  /** Where the train stopped and what it needs, and from whom. */
  block?: { pull: string; what: string; who: "owner" | "author" | "github" | "factory"; /** The login of the pull request's author, when `who` is `author` and GitHub said it. */ author?: string };
}

export const trainKey = (line: string) => `train:${line}`;

export function readTrain(ctx: FactoryContext, line: string): Train | undefined {
  const raw = ctx.store.getKv(trainKey(line));
  return raw ? (JSON.parse(raw) as Train) : undefined;
}

/** The train holding a job, if any. */
export function trainOf(ctx: FactoryContext, job: Job): Train | undefined {
  const train = readTrain(ctx, job.line);
  return train?.entries.some((e) => e.job === job.id) ? train : undefined;
}

export function saveTrain(ctx: Pick<FactoryContext, "store">, train: Train): void {
  ctx.store.setKv(trainKey(train.line), JSON.stringify(train));
}

/** What a pull request the factory did not open needs when someone pushed to it after zero verified it. */
export const PUSHED = "alguien empujó a la rama después de que la fábrica la verificó";

/**
 * Records `head` as the commit zero verified for a job's pull request in its line's train, after the job's own
 * push: the only commit the train merges for a pull request the factory did not open. A block for someone
 * else's push to it is over, since zero checked what is there now.
 */
export function pinTrainHead(ctx: Pick<FactoryContext, "store">, line: string, job: string, head: string): void {
  const raw = ctx.store.getKv(trainKey(line));
  if (!raw) return;
  const train = JSON.parse(raw) as Train;
  const entry = train.entries.find((e) => e.job === job);
  if (!entry?.head || entry.head === head) return;
  entry.head = head;
  if (train.block?.pull === entry.url) delete train.block;
  saveTrain(ctx, train);
  log.info("train pull request pinned to the head zero pushed", { line, job, head });
}

/** Every train under way. */
export function allTrains(ctx: FactoryContext): Train[] {
  return ctx.store.kvWithPrefix("train:").map(([, raw]) => JSON.parse(raw) as Train);
}

const GONE = new Set<MergeState["status"]>(["merged", "closed", "expired"]);

/**
 * Takes out of each train the head pull requests that are gone (merged, closed, expired, or whose job ended
 * without delivering), deletes an empty train, and gives the new head back, once, what conflicts and refreshes
 * spent on it while it waited (`MergeState.trainHead`).
 */
export function advanceTrains(ctx: FactoryContext): void {
  for (const train of allTrains(ctx)) {
    let changed = false;
    while (train.entries.length) {
      const head = train.entries[0]!;
      const job = ctx.store.getJob(head.job);
      const raw = ctx.store.getKv(mergeKey(head.job));
      const state = raw ? (JSON.parse(raw) as MergeState) : undefined;
      const gone = !job || job.status === "failed" || job.status === "stopped" || (state !== undefined && GONE.has(state.status));
      if (!gone) break;
      train.entries.shift();
      if (train.block?.pull === head.url) delete train.block;
      changed = true;
      log.info("pull request left its line's train", { line: train.line, job: head.job, url: head.url, status: state?.status ?? job?.status });
    }
    if (!train.entries.length) {
      ctx.store.deleteKv(trainKey(train.line));
      log.info("train of a line finished", { line: train.line });
      continue;
    }
    if (changed) ctx.store.setKv(trainKey(train.line), JSON.stringify(train));
    const head = train.entries[0]!;
    const raw = ctx.store.getKv(mergeKey(head.job));
    const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
    if (state.trainHead) continue;
    const { resolutions: _r, refreshes: _f, resolving: _s, conflict: _c, backoff: _b, train: _t, ...rest } = state;
    ctx.store.setKv(mergeKey(head.job), JSON.stringify({ ...rest, trainHead: true } satisfies MergeState));
    log.info("pull request is the head of its line's train", { line: train.line, job: head.job, url: head.url });
  }
}
