import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_PATTERNS, isAttributionLine, stripAttribution } from "../src/attribution.js";
import { DEFAULT_SIGNATURE_TEXT, DEFAULT_SIGNATURE_TRAILER, parseFactory } from "../src/config.js";
import { integrate, mergeIntoBase } from "../src/line/integrate.js";
import { openWorkCopy } from "../src/workspace.js";
import { cleanup, gitIn, gitRepo, run, tempDir, writeTree } from "./helpers.js";

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
