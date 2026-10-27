import { Octokit } from "@octokit/rest";
import type { FactoryContext } from "../app.js";
import { log } from "../log.js";
import { FACTORY_MARK } from "../intake/keys.js";
import type { Job } from "../state/store.js";

/**
 * Merges the pull requests of lines with `autoMerge` once GitHub says they
 * are ready: every check finished well and there are no conflicts. Polled by
 * the daemon, like the issue intake, so the owner's machine needs no public
 * address. A pull request that is not ready is left as it is.
 */

export interface PullRequestState {
  open: boolean;
  merged: boolean;
  /** `null` while GitHub is still working it out. */
  mergeable: boolean | null;
  headSha: string;
}

export interface Check {
  name: string;
  done: boolean;
  /** Only meaningful once `done`. */
  ok: boolean;
}

/** The slice of GitHub automatic merging needs; tests use a fake. */
export interface MergeApi {
  pullRequest(number: number): Promise<PullRequestState>;
  /** Check runs and commit statuses of a commit. */
  checks(sha: string): Promise<Check[]>;
  /** Merges only if the head is still `sha`, so nothing pushed after the checks gets in. */
  merge(number: number, sha: string): Promise<void>;
  deleteBranch(branch: string): Promise<void>;
  comment(number: number, body: string): Promise<void>;
}

const QUIET = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const PASSED = new Set(["success", "neutral", "skipped"]);

export function githubMerges(token: string, repository: string): MergeApi {
  const [owner, repo] = repository.split("/") as [string, string];
  const gh = new Octokit({ auth: token, log: QUIET });
  return {
    async pullRequest(number) {
      const { data } = await gh.pulls.get({ owner, repo, pull_number: number });
      return { open: data.state === "open", merged: data.merged, mergeable: data.mergeable, headSha: data.head.sha };
    },
    async checks(sha) {
      const runs = await gh.paginate(gh.checks.listForRef, { owner, repo, ref: sha, per_page: 100 });
      const statuses = (await gh.repos.getCombinedStatusForRef({ owner, repo, ref: sha })).data.statuses;
      return [
        ...runs.map((r) => ({ name: r.name, done: r.status === "completed", ok: PASSED.has(r.conclusion ?? "") })),
        ...statuses.map((s) => ({ name: s.context, done: s.state !== "pending", ok: s.state === "success" })),
      ];
    },
    async merge(number, sha) {
      await gh.pulls.merge({ owner, repo, pull_number: number, sha, merge_method: "merge" });
    },
    async deleteBranch(branch) {
      await gh.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    },
    async comment(number, body) {
      await gh.issues.createComment({ owner, repo, issue_number: number, body: `${body}\n\n${FACTORY_MARK}` });
    },
  };
}

/** Checks registered by CI may take a moment to appear after the push. */
const CHECKS_GRACE_MS = 5 * 60_000;
/** A pull request left open this long after delivery is no longer watched. */
const WATCH_MS = 14 * 24 * 3_600_000;

export type MergeDecision =
  | { kind: "merge" }
  | { kind: "wait"; why: string }
  | { kind: "blocked"; key: string; why: string }
  | { kind: "gone"; merged: boolean };

/** What to do with a pull request now. Pure, so every case is tested without GitHub. */
export function mergeDecision(pr: PullRequestState, checks: Check[], sinceDeliveryMs: number): MergeDecision {
  if (pr.merged || !pr.open) return { kind: "gone", merged: pr.merged };
  const failed = checks.filter((c) => c.done && !c.ok).map((c) => c.name);
  if (failed.length) return { kind: "blocked", key: `checks:${pr.headSha}:${failed.join(",")}`, why: `fallaron los checks ${failed.join(", ")}` };
  if (checks.some((c) => !c.done)) return { kind: "wait", why: "esperando checks" };
  if (!checks.length && sinceDeliveryMs < CHECKS_GRACE_MS) return { kind: "wait", why: "esperando que aparezcan los checks" };
  if (pr.mergeable === null) return { kind: "wait", why: "GitHub todavía está calculando si se puede fundir" };
  if (!pr.mergeable) return { kind: "blocked", key: `conflict:${pr.headSha}`, why: "tiene conflictos con la rama base" };
  return { kind: "merge" };
}

export interface MergeState {
  status: "waiting" | "blocked" | "merged" | "closed" | "expired";
  why?: string;
  /** Last problem the pull request was told about, so each is said once. */
  reported?: string;
}

export const mergeKey = (jobId: string) => `automerge:${jobId}`;
const FINAL = new Set<MergeState["status"]>(["merged", "closed", "expired"]);

/** owner/repo and number of a GitHub pull request URL. */
export function pullRequestOf(url: string): { repository: string; number: number } | undefined {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  return m ? { repository: m[1]!, number: Number(m[2]) } : undefined;
}

/** Delivered jobs whose pull request the factory still has to merge. */
export function watchedJobs(ctx: FactoryContext): Job[] {
  return ctx.store.listJobs({ status: ["delivered"], limit: 200 }).filter((job) => {
    if (!job.delivery?.autoMerge || !job.delivery.url) return false;
    const raw = ctx.store.getKv(mergeKey(job.id));
    return !raw || !FINAL.has((JSON.parse(raw) as MergeState).status);
  });
}

async function watch(ctx: FactoryContext, job: Job, gh: MergeApi, number: number) {
  const key = mergeKey(job.id);
  const raw = ctx.store.getKv(key);
  const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
  const save = (next: MergeState) => ctx.store.setKv(key, JSON.stringify(next));
  const now = (ctx.now ?? (() => new Date()))().getTime();
  const since = now - Date.parse(job.finishedAt ?? job.updatedAt);

  const pr = await gh.pullRequest(number);
  const decision = mergeDecision(pr, pr.open ? await gh.checks(pr.headSha) : [], since);
  if (decision.kind === "gone") return save({ status: decision.merged ? "merged" : "closed", why: decision.merged ? "fundido por otra persona" : "cerrado sin fundir" });
  if (since > WATCH_MS) return save({ status: "expired", why: "pasaron 14 días sin poder fundirlo" });
  if (decision.kind === "wait") return save({ ...state, status: "waiting", why: decision.why });
  if (decision.kind === "blocked") {
    if (state.reported !== decision.key) {
      await gh.comment(number, `La fábrica no funde este pull request: ${decision.why}. Queda abierto; si se arregla, lo funde en la próxima revisión.`);
    }
    return save({ status: "blocked", why: decision.why, reported: decision.key });
  }

  await gh.merge(number, pr.headSha);
  save({ status: "merged", why: "fundido por la fábrica" });
  log.info("pull request merged", { job: job.id, url: job.delivery!.url });
  await gh.deleteBranch(job.delivery!.branch).catch((err) => log.warn("could not delete merged branch", { job: job.id, error: String(err) }));
  if (job.source?.kind === "github-issue") {
    await gh.comment(job.source.number, `La fábrica fundió ${job.delivery!.url}: el cambio ya está en la rama base.`);
  }
}

/** Keeps what the pull request was already told, so a problem reaching GitHub never repeats a comment. */
function waiting(ctx: FactoryContext, job: Job, why: string) {
  const raw = ctx.store.getKv(mergeKey(job.id));
  const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
  ctx.store.setKv(mergeKey(job.id), JSON.stringify({ ...state, status: "waiting", why: why.slice(0, 300) } satisfies MergeState));
}

/** One pass over every pull request waiting to be merged; one that fails never stops the others. */
export async function pollMerges(ctx: FactoryContext, api: (repository: string) => MergeApi | undefined): Promise<void> {
  for (const job of watchedJobs(ctx)) {
    const pr = pullRequestOf(job.delivery!.url!);
    const gh = pr && api(pr.repository);
    if (!pr || !gh) {
      waiting(ctx, job, "sin acceso a GitHub: iniciá sesión con `gh auth login` o definí GH_TOKEN");
      continue;
    }
    try {
      await watch(ctx, job, gh, pr.number);
    } catch (err) {
      log.warn("automatic merge failed", { job: job.id, error: String(err) });
      waiting(ctx, job, `no se pudo consultar GitHub: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
