import { z } from "zod";
import type { AgentRequest, AgentRunner } from "./agent.js";
import type { Config } from "./config.js";
import { log } from "./log.js";
import { LearningSchema, memoryBlock, type Learning, type NewPost, type Townhall } from "./townhall/index.js";
import type { Task, Tracker } from "./tracker.js";
import type { Workspace } from "./workspace.js";

export const PlanSchema = z.object({
  feasible: z.boolean().describe("False when the task is ambiguous, unsafe or impossible without a human."),
  reason: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  risks: z.array(z.string()),
  learnings: z.array(LearningSchema).describe("What you learned about this codebase that future runs should know. Empty if nothing new."),
  followUps: z.array(z.string()).describe("Work you noticed that is out of scope for this task but worth doing. Empty if none."),
});

export const ReviewSchema = z.object({
  approved: z.boolean(),
  summary: z.string(),
  issues: z.array(z.string()).describe("Blocking problems the coder must fix."),
  learnings: z.array(LearningSchema).describe("Lessons future coders should apply (recurring mistakes, conventions). Empty if nothing new."),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Review = z.infer<typeof ReviewSchema>;

export type Outcome =
  | { status: "review"; pullRequest: string; attempts: number; costUsd: number }
  | { status: "failed"; reason: string; attempts: number; costUsd: number };

export interface PipelineDeps {
  config: Config;
  tracker: Tracker;
  workspace: Workspace;
  runAgent: AgentRunner;
  townhall: Townhall;
  now?: () => number;
}

export function branchName(prefix: string, task: Task): string {
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${prefix}${task.number}-${slug}`;
}

const taskBlock = (task: Task) => `# Task #${task.number}: ${task.title}\n\n${task.body}`;
const list = (items: string[]) => items.map((s) => `- ${s}`).join("\n");
const engineSummary = (config: Config) =>
  (["planner", "coder", "reviewer"] as const).map((r) => `${r}=${config.roles[r].engine ?? config.engine}`).join(", ");

/**
 * One task, end to end: plan → (code → verify → review) × maxAttempts → pull request.
 * Every exit path leaves the issue labelled with a terminal state and a comment explaining it.
 */
export async function runTask(task: Task, deps: PipelineDeps): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const learnings: Learning[] = [];
  const followUps: string[] = [];
  const outcome = await runLine(task, deps, learnings, followUps);

  // Every run reports to the townhall: its outcome, what agents learned, and what needs a human.
  const source = "zero";
  const posts: NewPost[] = [
    {
      kind: "run", task: task.number, source, topic: task.title,
      body: outcome.status === "review" ? `Delivered ${outcome.pullRequest}` : outcome.reason.slice(0, 500),
      data: {
        status: outcome.status, attempts: outcome.attempts, costUsd: outcome.costUsd,
        durationMs: now() - started, engines: engineSummary(deps.config),
        ...(outcome.status === "review" && { pullRequest: outcome.pullRequest }),
      },
    },
    ...learnings.map((l) => ({ ...l, task: task.number, source })),
    ...followUps.map((f) => ({ kind: "proposal" as const, task: task.number, source, topic: f.slice(0, 80), body: f })),
    ...(outcome.status === "failed"
      ? [{ kind: "blocker" as const, task: task.number, source, topic: task.title, body: outcome.reason.slice(0, 1000) }]
      : []),
  ];
  await deps.townhall.publish(posts);
  return outcome;
}

async function runLine(
  task: Task,
  { config, tracker, workspace, runAgent, townhall }: PipelineDeps,
  learnings: Learning[],
  followUps: string[],
): Promise<Outcome> {
  const { labels } = config;
  const branch = branchName(config.branchPrefix, task);
  let costUsd = 0;
  let attempts = 0;

  const fail = async (reason: string): Promise<Outcome> => {
    await tracker.setState(task.number, labels.failed, [labels.ready, labels.working]);
    await tracker.comment(task.number, `**zero** could not complete this task.\n\n${reason}`);
    log.warn("task failed", { task: task.number, reason: reason.slice(0, 200) });
    return { status: "failed", reason, attempts, costUsd };
  };

  /** Not every engine can sandbox a read-only role, so zero enforces it: anything it wrote is discarded. */
  const runReadOnly = async <T>(req: AgentRequest<T>) => {
    const run = await runAgent(req);
    if (workspace.hasChanges()) {
      log.warn("read-only agent modified the workspace; discarding", { role: req.role });
      workspace.discardChanges();
    }
    return run;
  };

  await tracker.setState(task.number, labels.working, [labels.ready, labels.failed]);
  try {
    return await execute();
  } catch (err) {
    return fail(`Unexpected error: \`${err instanceof Error ? err.message : String(err)}\``);
  }

  async function execute(): Promise<Outcome> {
    workspace.checkoutBranch(branch, config.baseBranch);
    const memory = memoryBlock(await townhall.recall({ kinds: ["lesson", "finding", "blocker"], limit: config.townhall.recallLimit }));

    const planRun = await runReadOnly({
      role: "planner",
      cwd: workspace.cwd,
      schema: PlanSchema,
      prompt: [taskBlock(task), memory, "Study the repository and produce an implementation plan for this task."]
        .filter(Boolean)
        .join("\n\n"),
    });
    costUsd += planRun.costUsd;
    const plan = planRun.output;
    if (!planRun.ok || !plan) return fail(`Planner did not produce a plan (${planRun.text}).`);
    learnings.push(...plan.learnings);
    followUps.push(...plan.followUps);
    if (!plan.feasible) return fail(`Planner rejected the task: ${plan.reason}`);
    await tracker.comment(task.number, `**Plan**\n\n${plan.summary}\n\n${list(plan.steps)}`);

    let feedback = "";
    while (attempts < config.maxAttempts) {
      attempts++;
      log.info("attempt", { task: task.number, attempt: attempts });

      const coderRun = await runAgent({
        role: "coder",
        cwd: workspace.cwd,
        prompt: [
          taskBlock(task),
          `## Plan\n${plan.summary}\n\n${list(plan.steps)}`,
          memory,
          feedback && `## Feedback from the previous attempt (fix all of it)\n${feedback}`,
          `Implement the task. Verification commands that must pass: ${config.verify.join(", ") || "none"}.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      costUsd += coderRun.costUsd;
      if (!coderRun.ok) {
        feedback = `The coder run ended abnormally (${coderRun.text}). Make smaller, focused changes.`;
        continue;
      }
      if (workspace.hasChanges()) workspace.commitAll(`zero: #${task.number} attempt ${attempts}`);

      const verifyFailure = workspace.verify(config.verify);
      if (verifyFailure) {
        feedback = `Verification failed:\n${verifyFailure}`;
        continue;
      }

      const reviewRun = await runReadOnly({
        role: "reviewer",
        cwd: workspace.cwd,
        schema: ReviewSchema,
        prompt: `${taskBlock(task)}\n\nReview the change with \`git diff origin/${config.baseBranch}...HEAD\`. Approve only if it fully and correctly solves the task.`,
      });
      costUsd += reviewRun.costUsd;
      const review = reviewRun.output;
      if (!reviewRun.ok || !review) {
        feedback = `Review could not be completed (${reviewRun.text}).`;
        continue;
      }
      learnings.push(...review.learnings);
      if (!review.approved) {
        feedback = `Reviewer requested changes:\n${review.summary}\n\n${list(review.issues)}`;
        continue;
      }

      workspace.push(branch);
      const pullRequest = await tracker.openPullRequest({
        head: branch,
        base: config.baseBranch,
        title: task.title,
        body: `Closes #${task.number}\n\n## Plan\n${plan.summary}\n\n## Review\n${review.summary}\n\n---\nengines: ${engineSummary(config)} · attempts: ${attempts} · est. cost: $${costUsd.toFixed(2)}`,
      });
      await tracker.setState(task.number, labels.review, [labels.working]);
      await tracker.comment(task.number, `Pull request ready: ${pullRequest}`);
      log.info("task ready for merge", { task: task.number, pullRequest, attempts });
      return { status: "review", pullRequest, attempts, costUsd };
    }

    return fail(`Exhausted ${config.maxAttempts} attempts. Last feedback:\n\n${feedback}`);
  }
}
