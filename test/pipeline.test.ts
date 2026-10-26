import { describe, expect, it, vi } from "vitest";
import type { AgentRequest, AgentRun } from "../src/agent.js";
import { ConfigSchema } from "../src/config.js";
import { branchName, runTask, type Plan, type Review } from "../src/pipeline.js";
import type { Task, Tracker } from "../src/tracker.js";
import type { Workspace } from "../src/workspace.js";

const task: Task = { number: 7, title: "Add health check endpoint!", body: "GET /health returns 200" };
const plan: Plan = { feasible: true, reason: "", summary: "Add route", steps: ["edit server.ts"], risks: [] };

function fakes(opts: { reviews?: Review[]; verify?: (string | null)[]; plan?: Plan } = {}) {
  const reviews = [...(opts.reviews ?? [{ approved: true, summary: "LGTM", issues: [] }])];
  const verify = [...(opts.verify ?? [null])];
  const labels: string[] = [];
  const prompts: AgentRequest[] = [];

  const tracker: Tracker = {
    nextReady: vi.fn(async () => task),
    get: vi.fn(async () => task),
    setState: vi.fn(async (_n, add) => void labels.push(add)),
    comment: vi.fn(async () => {}),
    openPullRequest: vi.fn(async () => "https://github.com/k/zero/pull/1"),
  };
  const workspace: Workspace = {
    cwd: "/repo",
    checkoutBranch: vi.fn(),
    hasChanges: vi.fn(() => true),
    commitAll: vi.fn(),
    push: vi.fn(),
    verify: vi.fn(() => verify.shift() ?? null),
  };
  const runAgent = vi.fn(async (req: AgentRequest): Promise<AgentRun<any>> => {
    prompts.push(req);
    const output = req.role === "planner" ? (opts.plan ?? plan) : req.role === "reviewer" ? reviews.shift() : undefined;
    return { ok: true, text: "done", output, costUsd: 0.5, turns: 3 };
  });

  const config = ConfigSchema.parse({ maxAttempts: 2 });
  return { deps: { config, tracker, workspace, runAgent: runAgent as any }, labels, prompts, tracker, workspace };
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
        { approved: false, summary: "Missing test", issues: ["add test for /health"] },
        { approved: true, summary: "LGTM", issues: [] },
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

describe("branchName", () => {
  it("slugifies the title", () => {
    expect(branchName("zero/", { ...task, title: "  Fix: Ñandú & co. " })).toBe("zero/7-fix-and-co");
  });
});
