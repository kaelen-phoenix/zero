import { describe, expect, it, vi } from "vitest";
import type { AgentRequest, AgentRun } from "../src/agent.js";
import { ConfigSchema } from "../src/config.js";
import { branchName, runTask, type Plan, type Review } from "../src/pipeline.js";
import type { Task, Tracker } from "../src/tracker.js";
import type { Workspace } from "../src/workspace.js";
import type { NewPost, Townhall } from "../src/townhall/index.js";

const task: Task = { number: 7, title: "Add health check endpoint!", body: "GET /health returns 200" };
const plan: Plan = {
  feasible: true, reason: "", summary: "Add route", steps: ["edit server.ts"], risks: [],
  learnings: [{ kind: "finding", topic: "server", body: "routes live in server.ts" }],
  followUps: ["Add rate limiting"],
};

function fakes(opts: { reviews?: Review[]; verify?: (string | null)[]; plan?: Plan; dirtyAfterReadOnly?: boolean } = {}) {
  const reviews = [...(opts.reviews ?? [{ approved: true, summary: "LGTM", issues: [], learnings: [] }])];
  const verify = [...(opts.verify ?? [null])];
  const labels: string[] = [];
  const prompts: AgentRequest[] = [];

  const tracker: Tracker = {
    nextReady: vi.fn(async () => task),
    get: vi.fn(async () => task),
    setState: vi.fn(async (_n, add) => void labels.push(add)),
    comment: vi.fn(async () => {}),
    openPullRequest: vi.fn(async () => "https://github.com/k/zero/pull/1"),
    createIssue: vi.fn(async () => ""),
  };
  const published: NewPost[] = [];
  const townhall: Townhall = {
    publish: vi.fn(async (posts) => void published.push(...posts)),
    recall: vi.fn(async () => [{ id: "m", at: "", kind: "lesson" as const, source: "zero", topic: "style", body: "use .js imports" }]),
  };
  const workspace: Workspace = {
    cwd: "/repo",
    checkoutBranch: vi.fn(),
    hasChanges: vi.fn(() => opts.dirtyAfterReadOnly ?? false),
    commitAll: vi.fn(),
    discardChanges: vi.fn(),
    push: vi.fn(),
    verify: vi.fn(() => verify.shift() ?? null),
  };
  const runAgent = vi.fn(async (req: AgentRequest): Promise<AgentRun<any>> => {
    prompts.push(req);
    const output = req.role === "planner" ? (opts.plan ?? plan) : req.role === "reviewer" ? reviews.shift() : undefined;
    return { ok: true, text: "done", output, costUsd: 0.5 };
  });

  const config = ConfigSchema.parse({ maxAttempts: 2 });
  return { deps: { config, tracker, workspace, runAgent: runAgent as any, townhall }, labels, prompts, tracker, workspace, published };
}

describe("runTask", () => {
  it("opens a PR when verification and review pass", async () => {
    const f = fakes();
    const outcome = await runTask(task, f.deps);
    expect(outcome).toMatchObject({ status: "review", attempts: 1, costUsd: 1.5 });
    expect(f.workspace.push).toHaveBeenCalledWith("zero/7-add-health-check-endpoint");
    expect(f.labels).toEqual(["zero:working", "zero:review"]);
  });

  it("feeds reviewer issues back to the coder and retries", async () => {
    const f = fakes({
      reviews: [
        { approved: false, summary: "Missing test", issues: ["add test for /health"], learnings: [{ kind: "lesson", topic: "tests", body: "every route needs a test" }] },
        { approved: true, summary: "LGTM", issues: [], learnings: [] },
      ],
    });
    const outcome = await runTask(task, f.deps);
    expect(outcome.status).toBe("review");
    const secondCoder = f.prompts.filter((p) => p.role === "coder")[1];
    expect(secondCoder?.prompt).toContain("add test for /health");
  });

  it("does not review a change that fails verification", async () => {
    const f = fakes({ verify: ["tests failed", "tests failed"] });
    const outcome = await runTask(task, f.deps);
    expect(outcome).toMatchObject({ status: "failed", attempts: 2 });
    expect(f.prompts.some((p) => p.role === "reviewer")).toBe(false);
    expect(f.labels.at(-1)).toBe("zero:failed");
  });

  it("stops when the planner rejects the task", async () => {
    const f = fakes({ plan: { ...plan, feasible: false, reason: "needs prod credentials" } });
    const outcome = await runTask(task, f.deps);
    expect(outcome.status).toBe("failed");
    expect(f.prompts.map((p) => p.role)).toEqual(["planner"]);
  });

  it("marks the task failed on unexpected errors instead of leaving it stuck", async () => {
    const f = fakes();
    f.workspace.checkoutBranch = vi.fn(() => {
      throw new Error("fetch failed");
    });
    const outcome = await runTask(task, f.deps);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(f.labels.at(-1)).toBe("zero:failed");
  });
});

describe("read-only guard", () => {
  it("discards anything a read-only role wrote", async () => {
    const f = fakes({ dirtyAfterReadOnly: true });
    await runTask(task, f.deps);
    // after planner and after reviewer
    expect(f.workspace.discardChanges).toHaveBeenCalledTimes(2);
  });
});

describe("townhall integration", () => {
  it("gives agents the network memory and reports the run", async () => {
    const f = fakes();
    await runTask(task, f.deps);
    expect(f.prompts.find((p) => p.role === "planner")?.prompt).toContain("use .js imports");
    expect(f.prompts.find((p) => p.role === "coder")?.prompt).toContain("use .js imports");
    expect(f.published.map((p) => p.kind)).toEqual(["run", "finding", "proposal"]);
    expect(f.published[0]).toMatchObject({ kind: "run", data: { status: "review", attempts: 1 } });
  });

  it("raises a blocker for humans when the line fails", async () => {
    const f = fakes({ plan: { ...plan, feasible: false, reason: "needs prod credentials" } });
    await runTask(task, f.deps);
    expect(f.published.find((p) => p.kind === "blocker")?.body).toContain("needs prod credentials");
  });
});

describe("branchName", () => {
  it("slugifies the title", () => {
    expect(branchName("zero/", { ...task, title: "  Fix: Ñandú & co. " })).toBe("zero/7-fix-and-co");
  });
});
