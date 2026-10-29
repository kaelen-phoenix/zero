import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentRunner } from "../agent.js";
import { answer, requestWork, type FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { mergeKey, type MergeState } from "../line/automerge.js";
import { describeDelivery } from "../line/finish.js";
import { log } from "../log.js";
import { FINAL_STATUSES, type Job } from "../state/store.js";
import { dailyBudgetReached, spentToday } from "../telemetry/metrics.js";
import { TRUSTED, type IssueApi, type IssueComment, type IssueState } from "./github.js";
import { FACTORY_MARK, issueKey } from "./keys.js";

/**
 * The owner's comments on an issue with a job: read only from people with
 * write access, handled once the job ended or is waiting for the owner, and
 * answered by the read-only `reply` station from facts zero computes.
 */

export const ReplySchema = z.object({
  action: z.enum(["answer", "change", "approve", "reject"]),
  reply: z.string().describe("What the factory says on the issue, in the owner's language."),
  request: z.string().describe("For `change`: what to build now, self-contained. Empty otherwise."),
});
export type Reply = z.infer<typeof ReplySchema>;

/** Comments the factory posted before it marked them; it comments as the owner, so it must recognise its own. */
const LEGACY_FACTORY = [/^La fábrica (tomó|no toma|necesita|fundió|no funde)/, /^Listo: /, /^El trabajo `/];
const isFactory = (c: IssueComment) => c.body.includes(FACTORY_MARK) || LEGACY_FACTORY.some((re) => re.test(c.body));
const MAX_COMMENT = 4_000;
const MAX_REQUEST = 20_000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Where the job's change is now, computed by zero (never guessed by an agent). */
export function whereIsTheChange(line: LineConfig, job: Job, merge?: MergeState): string {
  const d = job.delivery;
  if (job.status === "failed" || job.status === "stopped") return `The job did not deliver anything (${job.status}): ${job.reason ?? "no detail"}.`;
  if (job.status === "waiting") return `The job is waiting for the owner's answer to: ${job.question?.text ?? "(no question)"}`;
  if (!d) return "The job has not delivered yet.";
  if (d.mode === "merge") {
    if (!d.commit) return "The change was merged into the owner's local base branch.";
    spawnSync("git", ["fetch", "-q", line.remote, line.baseBranch], { cwd: line.repo, windowsHide: true, timeout: 60_000 });
    const remote = `${line.remote}/${line.baseBranch}`;
    const published = spawnSync("git", ["merge-base", "--is-ancestor", d.commit, remote], { cwd: line.repo, windowsHide: true }).status === 0;
    return published
      ? `The change (commit ${d.commit.slice(0, 8)}) was merged into ${line.baseBranch} and is on GitHub: ${remote} contains it.`
      : `The change (commit ${d.commit.slice(0, 8)}) was merged into ${line.baseBranch} only on the owner's PC; it is NOT on GitHub (${remote} does not contain it). Nothing is published until the owner pushes ${line.baseBranch} (\`git push\` in ${line.repo}). This line integrates with \`merge\`; with \`integrate: pull-request\` the factory would publish its work on GitHub.`;
  }
  if (d.mode === "branch") return `The change is on branch ${d.branch} on the owner's PC, not pushed to GitHub.`;
  const state = merge
    ? { merged: "the factory merged it into the base branch on GitHub", closed: "it was closed (or merged by someone else)", expired: "the factory stopped watching it", waiting: `the factory will merge it when ready (${merge.why ?? "waiting"})`, blocked: `the factory cannot merge it: ${merge.why}` }[merge.status]
    : d.autoMerge
      ? "the factory will merge it when every check passes"
      : "it waits for the owner to merge it; this line does not merge automatically";
  return `The change is in pull request ${d.url}: ${state}.`;
}

function prompt(line: LineConfig, job: Job, issue: { number: number; title: string }, thread: IssueComment[], fresh: IssueComment[], where: string): string {
  return [
    `## The issue\n#${issue.number}: ${issue.title}`,
    `## The job (facts computed by the factory)\n- Line: ${line.name} (integrates with \`${line.integrate}\`${line.autoMerge ? ", merges automatically" : ""})\n- Job ${job.id}: ${job.status}${job.title ? ` — ${job.title}` : ""}\n- Delivered: ${job.delivery ? describeDelivery(job.delivery) : "nothing"}\n- Where the change is: ${where}`,
    `## What was asked\n${clip(job.request, 4_000)}`,
    thread.length && `## Earlier conversation on the issue\n${thread.map((c) => `- @${c.author}: ${clip(c.body.replace(FACTORY_MARK, "").trim(), 800)}`).join("\n")}`,
    `## New comments to handle\n${fresh.map((c) => `- @${c.author} (${c.createdAt}): ${clip(c.body, MAX_COMMENT)}`).join("\n")}`,
    `The job ${job.status === "waiting" ? "is waiting for the owner, so `approve` or `reject` are possible if the comments clearly answer its question" : FINAL_STATUSES.includes(job.status) ? "has ended, so `change` is possible" : "is still running"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function handle(ctx: FactoryContext, line: LineConfig, repository: string, number: number, state: IssueState, job: Job, gh: IssueApi, runAgent: AgentRunner, trusted: (login: string) => Promise<boolean>) {
  const key = issueKey(repository, number);
  const all = await gh.comments(number);
  const since = state.commentsSeen ?? job.createdAt;
  const later = all.filter((c) => c.createdAt > since && !isFactory(c));
  if (!later.length) return;
  const fresh: IssueComment[] = [];
  for (const c of later) if (await trusted(c.author)) fresh.push(c);
  const seen = later.at(-1)!.createdAt;
  const save = (next: Partial<IssueState>) => ctx.store.setKv(key, JSON.stringify({ ...state, commentsSeen: seen, ...next } satisfies IssueState));
  if (!fresh.length) return save({});

  // Untrusted comments never reach an agent, not even as earlier conversation.
  const thread: IssueComment[] = [];
  for (const c of all.filter((c) => c.createdAt <= since).slice(-10)) if (isFactory(c) || (await trusted(c.author))) thread.push(c);
  const merge = ctx.store.getKv(mergeKey(job.id));
  const where = whereIsTheChange(line, job, merge ? (JSON.parse(merge) as MergeState) : undefined);
  const cwd = join(ctx.home.jobs, "reply");
  await mkdir(cwd, { recursive: true });
  const run = await runAgent({
    station: "reply",
    line: line.name,
    cwd,
    schema: ReplySchema,
    maxBudgetUsd: 0.5,
    trace: { tracer: ctx.tracer, jobId: job.id, parentId: ctx.tracer.jobSpanId(job.id) },
    prompt: prompt(line, job, { number, title: job.title ?? job.request.split("\n")[0]! }, thread, fresh, where),
  });
  if (!run.ok || !run.output) {
    log.warn("could not answer issue comments", { issue: key, error: run.text.slice(0, 200) });
    await gh.comment(number, "La fábrica leyó tu comentario pero no pudo procesarlo. Volvé a comentar en un rato, o pedilo desde el panel o el chat.");
    return save({});
  }

  const reply = run.output;
  const owner = fresh.at(-1)!;
  if ((reply.action === "approve" || reply.action === "reject") && job.status === "waiting") {
    await answer(ctx, job.id, reply.action, `Respondido en el issue por @${owner.author}: ${clip(owner.body, 500)}`);
    await gh.comment(number, reply.reply);
    return save({});
  }
  if (reply.action === "change" && FINAL_STATUSES.includes(job.status) && reply.request.trim()) {
    const issueText = job.request;
    const text = `${issueText}\n\n## Seguimiento del trabajo ${job.id}\nEntregado: ${job.delivery ? describeDelivery(job.delivery) : `nada (${job.reason ?? job.status})`}.\n\n## Lo que pide ahora @${owner.author}\n${reply.request.trim()}`.slice(0, MAX_REQUEST);
    const r = requestWork(ctx, { text, line: line.name, source: job.source });
    await gh.comment(number, `${reply.reply}\n\nLo tomé como trabajo \`${r.job.id}\`. Te aviso acá cómo va.`);
    return save({ job: r.job.id, reported: "queued" });
  }
  await gh.comment(number, reply.reply);
  return save({});
}

/** Answers new comments on every issue of the line that has a job; one issue's problem never stops the others. */
export async function answerComments(ctx: FactoryContext, line: LineConfig, repository: string, gh: IssueApi, runAgent: AgentRunner): Promise<void> {
  const now = (ctx.now ?? (() => new Date()))();
  if (dailyBudgetReached(spentToday(ctx.store, now), ctx.config.limits.usdPerDay)) return;
  const trust = new Map<string, Promise<boolean>>();
  const trusted = (login: string) => {
    if (!trust.has(login)) trust.set(login, gh.permission(login).then((p) => TRUSTED.has(p)));
    return trust.get(login)!;
  };
  for (const [key, raw] of ctx.store.kvWithPrefix(`issue:${repository}#`)) {
    const state = JSON.parse(raw) as IssueState;
    const job = state.job ? ctx.store.getJob(state.job) : undefined;
    // Comments made while the job works wait until it ends or asks the owner.
    if (!job || !(FINAL_STATUSES.includes(job.status) || job.status === "waiting")) continue;
    const number = Number(key.slice(key.lastIndexOf("#") + 1));
    try {
      await handle(ctx, line, repository, number, state, job, gh, runAgent, trusted);
    } catch (err) {
      log.warn("issue comments failed", { issue: key, error: String(err) });
    }
  }
}
