import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTownhall, memoryBlock, resilient, type Post } from "../src/townhall/index.js";
import { renderBriefing } from "../src/townhall/briefing.js";
import { createLocalStore, shardsSince } from "../src/townhall/store.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function localTownhall(at: string) {
  const dir = await mkdtemp(join(tmpdir(), "zero-townhall-"));
  dirs.push(dir);
  return createTownhall(createLocalStore(dir), () => new Date(at));
}

describe("townhall", () => {
  it("publishes and recalls posts filtered by kind", async () => {
    const th = await localTownhall("2026-10-26T10:00:00Z");
    await th.publish([
      { kind: "lesson", source: "zero", task: 3, topic: "tests", body: "Run vitest with --run in CI" },
      { kind: "proposal", source: "zero", task: 3, topic: "refactor", body: "Split tracker.ts" },
    ]);
    const lessons = await th.recall({ kinds: ["lesson"] });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ kind: "lesson", topic: "tests", at: "2026-10-26T10:00:00.000Z" });
    expect(lessons[0]?.id).toBeTruthy();
  });

  it("never lets a broken store break the line", async () => {
    const broken = resilient({
      publish: async () => Promise.reject(new Error("disk full")),
      recall: async () => Promise.reject(new Error("offline")),
    });
    await expect(broken.publish([])).resolves.toBeUndefined();
    await expect(broken.recall()).resolves.toEqual([]);
  });

  it("renders memory as prompt context", () => {
    const block = memoryBlock([{ id: "1", at: "", kind: "finding", source: "zero", task: 9, topic: "build", body: "uses tsc 7" }]);
    expect(block).toContain("[finding] build: uses tsc 7 (#9)");
    expect(memoryBlock([])).toBe("");
  });

  it("shards by month across year boundaries", () => {
    expect(shardsSince(new Date("2025-11-15Z"), new Date("2026-01-02Z"))).toEqual([
      "posts/2025-11.jsonl",
      "posts/2025-12.jsonl",
      "posts/2026-01.jsonl",
    ]);
  });
});

describe("briefing", () => {
  const base = { at: "2026-10-26T08:00:00Z", source: "zero" };
  const posts: Post[] = [
    { ...base, id: "1", kind: "run", task: 1, topic: "a", body: "", data: { status: "review", attempts: 1, costUsd: 1.5, durationMs: 600_000, engines: "coder=codex", pullRequest: "https://x/pull/1" } },
    { ...base, id: "2", kind: "run", task: 2, topic: "b", body: "", data: { status: "failed", attempts: 3, costUsd: 4.5, durationMs: 1_200_000, engines: "coder=codex" } },
    { ...base, id: "3", kind: "blocker", task: 2, topic: "b", body: "needs prod credentials" },
    { ...base, id: "4", kind: "lesson", task: 1, topic: "tests", body: "mock the GitHub API" },
  ];

  it("summarises production, cost, decisions and learnings", () => {
    const b = renderBriefing(posts, new Date("2026-10-25T07:00:00Z"), new Date("2026-10-26T07:00:00Z"));
    expect(b.title).toBe("Townhall — 2026-10-26");
    expect(b.stats).toEqual({ runs: 2, delivered: 1, failed: 1, costUsd: 6 });
    expect(b.body).toContain("| 2 | 1 | 1 | 50% | 2.0 | 15.0 min | $6.00 | $6.00 |");
    expect(b.body).toContain("**Blocked** (#2): b. needs prod credentials");
    expect(b.body).toContain("[lesson] **tests**: mock the GitHub API (#1)");
  });

  it("says when nothing needs a human", () => {
    expect(renderBriefing([], new Date(0), new Date()).body).toContain("Nothing. The line ran on its own.");
  });
});
