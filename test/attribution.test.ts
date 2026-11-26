import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_PATTERNS, isAttributionLine, scrubBranch, stripAttribution } from "../src/attribution.js";
import { requestWork } from "../src/app.js";
import { runJob } from "../src/line/runner.js";
import { DEFAULT_SIGNATURE_TEXT, DEFAULT_SIGNATURE_TRAILER, parseFactory } from "../src/config.js";
import { integrate, mergeIntoBase } from "../src/line/integrate.js";
import { openWorkCopy } from "../src/workspace.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, testFactory, tempDir, writeTree } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  return cleanup();
});

const AI_LINES = [
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
  "Co-authored-by: Codex <codex@openai.com>",
  "Claude-Session: https://claude.ai/code/session_x",
];
const GENERATED = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";

describe("stripAttribution", () => {
  it("removes AI co-authors, session trailers and generated-with lines, leaving subject and body", () => {
    const message = ["Add health check", "", "Explains why.", "", GENERATED, "", ...AI_LINES].join("\n");
    expect(stripAttribution(message)).toBe("Add health check\n\nExplains why.");
    expect(stripAttribution(`${message}\n`)).toBe("Add health check\n\nExplains why.\n");
  });

  it("leaves no doubled blank line where lines were removed", () => {
    const body = ["Resumen", "", GENERATED, "", "Más texto", "", "Co-Authored-By: Claude <noreply@anthropic.com>"].join("\n");
    const out = stripAttribution(body);
    expect(out).toBe("Resumen\n\nMás texto");
    expect(out).not.toMatch(/\n\n\n|\n$/);
  });

  it("keeps a person's co-authorship exactly", () => {
    const human = "Co-Authored-By: Ana Pérez <ana@example.com>";
    expect(stripAttribution(`Fix\n\n${human}\nCo-Authored-By: Claude <noreply@anthropic.com>`)).toBe(`Fix\n\n${human}`);
    expect(isAttributionLine(human)).toBe(false);
  });

  it("keeps the factory's signature identical", () => {
    for (const text of [`zero: x (j1)\n\n${DEFAULT_SIGNATURE_TRAILER}`, `Cuerpo\n\n${DEFAULT_SIGNATURE_TEXT}`, "Built-by: zero in the loop <https://zerointheloop.com>"]) {
      expect(stripAttribution(text)).toBe(text);
    }
  });

  it("recognises other vendors in any letter case of the trailer key", () => {
    const lines = [
      "co-authored-by: Gemini <gemini-code-assist@google.com>",
      "CO-AUTHORED-BY: Antigravity <noreply@google.com>",
      "Co-Authored-by: Jules <jules-noreply@google.com>",
      "Co-authored-by: opencode <opencode@sst.dev>",
      "Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>",
      "Co-authored-by: Cursor Agent <cursoragent@cursor.com>",
    ];
    for (const line of lines) expect(isAttributionLine(line), line).toBe(true);
    expect(stripAttribution(`Subject\n\n${lines.join("\n")}`)).toBe("Subject");
  });

  it("is one extensible list", () => {
    expect(Array.isArray(ATTRIBUTION_PATTERNS)).toBe(true);
    expect(ATTRIBUTION_PATTERNS.length).toBeGreaterThan(0);
  });
});

const lineOf = (repo: string, integrate = "merge") => parseFactory(`lines:\n  - name: demo\n    repo: ${JSON.stringify(repo)}\n    integrate: ${integrate}\n`).lines[0]!;

describe("integration text", () => {
  it("keeps AI attribution out of the merge commit message", async () => {
    const repo = gitRepo();
    const copy = await openWorkCopy(repo, "main", "zero/j1", join(tempDir("zero-wt-"), "j1"), []);
    writeTree(copy.cwd, { "a.txt": "a\n" });
    copy.commitAll("a");
    const r = mergeIntoBase(lineOf(repo), copy, { jobId: "j1", title: `Add a\n${GENERATED}`, body: "", scratchDir: tempDir() });
    expect(r.ok).toBe(true);
    const message = run("git", ["log", "-1", "--format=%B", "main"], repo);
    expect(message).toContain("Add a");
    expect(message).not.toContain("Generated with");
  });

  it("keeps AI attribution out of the pull request title and body", async () => {
    const bare = join(tempDir("zero-remote-"), "github.com", "kaelen", "demo.git").replace(/\\/g, "/");
    mkdirSync(bare, { recursive: true });
    run("git", ["init", "-q", "--bare", "-b", "main"], bare);
    const repo = gitRepo();
    gitIn(repo, "remote", "add", "origin", bare);
    gitIn(repo, "push", "-q", "origin", "main");
    vi.stubEnv("GH_TOKEN", "test-token");
    const copy = await openWorkCopy(repo, "main", "zero/j2", join(tempDir("zero-wt-"), "j2"), []);
    writeTree(copy.cwd, { "b.txt": "b\n" });
    copy.commitAll("b");
    const opened: { title: string; body: string }[] = [];
    const r = await integrate(lineOf(repo, "pull-request"), copy, {
      jobId: "j2",
      title: `Add b\n${GENERATED}`,
      body: `Qué cambió.\n\n${GENERATED}\nCo-Authored-By: Claude <noreply@anthropic.com>`,
      scratchDir: tempDir(),
      pullRequests: () => ({ openPullRequest: async ({ title, body }) => (opened.push({ title, body }), "https://github.com/kaelen/demo/pull/1") }),
    });
    expect(r.ok).toBe(true);
    expect(opened).toEqual([{ title: "Add b", body: "Qué cambió." }]);
  });
});

const AI_TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";
const HUMAN = "Co-Authored-By: Ana Pérez <ana@example.com>";

/** A commit with fixed dates and a distinct committer, as an agent would leave it in its copy. */
function commit(repo: string, file: string, message: string, date = "1700000000 -0300") {
  writeTree(repo, { [file]: `${file}\n` });
  run("git", ["add", "-A"], repo);
  const env = { ...process.env, GIT_AUTHOR_NAME: "Agente", GIT_AUTHOR_EMAIL: "agente@example.com", GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: "Otra", GIT_COMMITTER_EMAIL: "otra@example.com", GIT_COMMITTER_DATE: "1700000500 +0100" };
  const r = spawnSync("git", ["commit", "-q", "--no-verify", "-m", message], { cwd: repo, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(r.stderr);
  return run("git", ["rev-parse", "HEAD"], repo);
}
const meta = (repo: string, sha: string) => run("git", ["log", "-1", "--format=%T|%an|%ae|%ad|%cn|%ce|%cd", "--date=raw", sha], repo);
const message = (repo: string, sha: string) => run("git", ["log", "-1", "--format=%B", sha], repo);
const tipOf = (repo: string, branch: string) => run("git", ["rev-parse", `refs/heads/${branch}`], repo);
const messages = (repo: string, range: string) => run("git", ["log", "--format=%B", range], repo);

describe("scrubBranch", () => {
  it("removes AI attribution from the job's commits, keeping tree, author, committer, dates and a person's co-authorship", () => {
    const repo = gitRepo();
    run("git", ["checkout", "-q", "-b", "zero/j1"], repo);
    const first = commit(repo, "a.txt", `Add a\n\nWhy.\n\n${HUMAN}\n${AI_TRAILER}`);
    const second = commit(repo, "b.txt", `Add b\n\n${GENERATED}\n\n${AI_TRAILER}`, "1700000100 -0300");
    const tip = scrubBranch(repo, "zero/j1", ["main"]);
    expect(tip).not.toBe(second);
    expect(tipOf(repo, "zero/j1")).toBe(tip);
    expect(messages(repo, "main..zero/j1")).not.toMatch(/anthropic|Generated with/);
    const parent = run("git", ["rev-parse", `${tip}^`], repo);
    expect(message(repo, parent)).toBe(`Add a\n\nWhy.\n\n${HUMAN}`);
    expect(message(repo, tip)).toBe("Add b");
    expect(meta(repo, parent)).toBe(meta(repo, first));
    expect(meta(repo, tip)).toBe(meta(repo, second));
    expect(run("git", ["rev-parse", `${parent}^`], repo)).toBe(run("git", ["rev-parse", "main"], repo));
    // The checkout that has the branch sees nothing changed.
    expect(run("git", ["status", "--porcelain"], repo)).toBe("");
  });

  it("gives the same SHAs every time it runs over the same commits", () => {
    const repo = gitRepo();
    run("git", ["checkout", "-q", "-b", "zero/j1"], repo);
    const original = commit(repo, "a.txt", `Add a\n\n${AI_TRAILER}`);
    const once = scrubBranch(repo, "zero/j1", ["main"]);
    run("git", ["update-ref", "refs/heads/zero/j1", original], repo);
    expect(scrubBranch(repo, "zero/j1", ["main"])).toBe(once);
  });

  it("leaves a clean branch untouched", () => {
    const repo = gitRepo();
    run("git", ["checkout", "-q", "-b", "zero/j1"], repo);
    const tip = commit(repo, "a.txt", `Add a\n\n${HUMAN}`);
    expect(scrubBranch(repo, "zero/j1", ["main"])).toBe(tip);
    expect(tipOf(repo, "zero/j1")).toBe(tip);
  });

  it("never rewrites a base commit, even with attribution", () => {
    const repo = gitRepo();
    const based = commit(repo, "base.txt", `Base\n\n${AI_TRAILER}`);
    run("git", ["checkout", "-q", "-b", "zero/j1"], repo);
    commit(repo, "a.txt", `Add a\n\n${AI_TRAILER}`);
    const tip = scrubBranch(repo, "zero/j1", ["main", undefined, "no-such-ref"]);
    expect(run("git", ["rev-parse", "main"], repo)).toBe(based);
    expect(run("git", ["rev-parse", `${tip}^`], repo)).toBe(based);
    expect(message(repo, based)).toContain(AI_TRAILER);
  });

  it("keeps what is already pushed or is the pull request's head, and the next push fast-forwards", () => {
    const remote = tempDir("zero-remote-");
    run("git", ["init", "-q", "--bare", "-b", "main"], remote);
    const repo = gitRepo();
    run("git", ["remote", "add", "origin", remote], repo);
    run("git", ["push", "-q", "origin", "main"], repo);
    run("git", ["checkout", "-q", "-b", "zero/j1"], repo);
    const pushed = commit(repo, "a.txt", `Add a\n\n${AI_TRAILER}`);
    run("git", ["push", "-q", "origin", "zero/j1"], repo);
    const fresh = commit(repo, "b.txt", `Add b\n\n${AI_TRAILER}`);
    const tip = scrubBranch(repo, "zero/j1", ["main"]);
    expect(tip).not.toBe(fresh);
    expect(run("git", ["rev-parse", `${tip}^`], repo)).toBe(pushed);
    expect(message(repo, tip)).toBe("Add b");
    run("git", ["push", "-q", "origin", "zero/j1"], repo);
    expect(run("git", ["rev-parse", "refs/heads/zero/j1"], remote)).toBe(tip);

    // The head of the pull request being updated counts as published even without a remote-tracking ref.
    const other = gitRepo();
    run("git", ["checkout", "-q", "-b", "zero/j2"], other);
    const head = commit(other, "a.txt", `Add a\n\n${AI_TRAILER}`);
    commit(other, "b.txt", `Add b\n\n${AI_TRAILER}`);
    const updated = scrubBranch(other, "zero/j2", ["main", head]);
    expect(run("git", ["rev-parse", `${updated}^`], other)).toBe(head);
    expect(message(other, updated)).toBe("Add b");
  });
});

describe("delivering a job whose agent committed with AI attribution", () => {
  it("integrates the branch without the attribution, keeping a person's co-authorship", async () => {
    const repo = gitRepo();
    const before = run("git", ["rev-parse", "main"], repo);
    const ctx = testFactory({ level: "L2", isolation: "worktree", limits: { usdPerJob: 3 }, lines: [{ name: "demo", repo, verify: [`node -e "process.exit(0)"`] }] });
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });
        gitIn(req.cwd, "add", "-A");
        gitIn(req.cwd, "commit", "-q", "-m", `Add health\n\n${HUMAN}\n${AI_TRAILER}`);
      },
    });
    const { job } = requestWork(ctx, { text: "agregá un endpoint de salud" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done.status).toBe("delivered");
    const merged = messages(repo, `${before}..main`);
    expect(merged).toContain("Add health");
    expect(merged).toContain(HUMAN);
    expect(merged).not.toContain("noreply@anthropic.com");
    expect(messages(repo, `${before}..zero/${job.id}`)).not.toContain("noreply@anthropic.com");
  });
});
