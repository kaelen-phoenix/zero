import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IssueApi } from "../src/intake/github.js";
import { RESEARCH_LABEL, syncResearchIssues } from "../src/intake/research.js";
import { cleanup, gitIn, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const finding = { topic: "Vitest 5 browser mode", findings: "Corre los tests en un navegador real.", sources: ["https://vitest.dev/guide/browser", "https://github.com/vitest-dev/vitest/releases"], serves: "test", maturity: "estable" };

/** GitHub in memory: records every call the sync makes. */
function fakeGitHub(opts: { failCreate?: number } = {}) {
  const calls: { op: string; title?: string; body?: string; labels?: string[] }[] = [];
  let failures = opts.failCreate ?? 0;
  let next = 10;
  const api: IssueApi = {
    labeled: async () => [],
    issue: async () => ({ state: "open", labels: [] }),
    lastLabeled: async () => undefined,
    permission: async () => "admin",
    comment: async () => {},
    comments: async () => [],
    ensureLabel: async (label) => {
      calls.push({ op: "ensureLabel", labels: [label] });
      return true;
    },
    createIssue: async (title, body, labels) => {
      if (failures-- > 0) throw new Error("GitHub no responde");
      calls.push({ op: "createIssue", title, body, labels });
      const number = next++;
      return { number, url: `https://github.com/kaelen/demo/issues/${number}` };
    },
    addLabels: async () => {},
    close: async () => {},
  };
  return { api, calls, created: () => calls.filter((c) => c.op === "createIssue") };
}

function factory(remote = "https://github.com/kaelen/demo.git") {
  const repo = gitRepo();
  gitIn(repo, "remote", "add", "origin", remote);
  return testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request" }] });
}

describe("research notes as GitHub issues", () => {
  it("publishes each note once, with only the research label, creating it first", async () => {
    const ctx = factory();
    const note = ctx.store.createResearchNote({ line: "demo", ...finding });
    const gh = fakeGitHub();
    await syncResearchIssues(ctx, () => gh.api);
    await syncResearchIssues(ctx, () => gh.api);

    expect(gh.calls.map((c) => c.op)).toEqual(["ensureLabel", "createIssue"]);
    expect(gh.calls[0]!.labels).toEqual([RESEARCH_LABEL]);
    expect(gh.created()[0]!.labels).toEqual(["zero:investigacion"]);
    expect(ctx.store.getResearchNote(note.id)).toMatchObject({ issueNumber: 10, issueUrl: "https://github.com/kaelen/demo/issues/10" });
  });

  it("leaves lines without GitHub alone", async () => {
    const ctx = factory("https://gitlab.com/kaelen/demo.git");
    const note = ctx.store.createResearchNote({ line: "demo", ...finding });
    let asked = 0;
    await syncResearchIssues(ctx, () => {
      asked++;
      return fakeGitHub().api;
    });
    expect(asked).toBe(0);
    expect(ctx.store.getResearchNote(note.id)!.issueNumber).toBeUndefined();
  });

  it("retries on the next pass when GitHub fails", async () => {
    const ctx = factory();
    const note = ctx.store.createResearchNote({ line: "demo", ...finding });
    const gh = fakeGitHub({ failCreate: 1 });
    await expect(syncResearchIssues(ctx, () => gh.api)).resolves.toBeUndefined();
    expect(ctx.store.getResearchNote(note.id)!.issueNumber).toBeUndefined();
    await syncResearchIssues(ctx, () => gh.api);
    expect(ctx.store.getResearchNote(note.id)!.issueNumber).toBe(10);
  });

  it("publishes no paths of the owner's machine, no secrets and no mentions", async () => {
    const ctx = factory();
    const repo = ctx.config.lines[0]!.repo;
    const token = `ghp_${"a1B2".repeat(9)}`;
    const home = join(homedir(), "notas", "x.md");
    ctx.store.createResearchNote({
      line: "demo",
      ...finding,
      topic: `Avisar a @someone`,
      findings: `Vi ${home}, C:\\Users\\x\\secret.txt, ${join(repo, "src", "a.ts")} y el token ${token}; preguntale a @someone.`,
    });
    const gh = fakeGitHub();
    await syncResearchIssues(ctx, () => gh.api);
    const [issue] = gh.created();
    for (const text of [issue!.title!, issue!.body!]) {
      expect(text.toLowerCase()).not.toContain(homedir().toLowerCase());
      expect(text).not.toContain("C:\\Users\\x\\secret.txt");
      expect(text).not.toContain("secret.txt");
      expect(text.toLowerCase()).not.toContain(repo.toLowerCase());
      expect(text).not.toContain(token);
      expect(text).not.toContain("@someone");
    }
  });

  it("carries the findings, what it serves, its maturity, its sources and how to request work", async () => {
    const ctx = factory();
    const note = ctx.store.createResearchNote({ line: "demo", ...finding });
    const gh = fakeGitHub();
    await syncResearchIssues(ctx, () => gh.api);
    const body = gh.created()[0]!.body!;
    for (const part of [finding.findings, finding.serves, finding.maturity, ...finding.sources, note.id, `zero research request ${note.id}`]) expect(body).toContain(part);
  });
});
