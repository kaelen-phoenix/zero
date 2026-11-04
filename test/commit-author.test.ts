import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork } from "../src/app.js";
import { commitAuthor, parseFactory, type CommitAuthor } from "../src/config.js";
import { mergeIntoBase } from "../src/line/integrate.js";
import { detectReverts } from "../src/line/reverts.js";
import { openCloneCopy, openWorkCopy } from "../src/workspace.js";
import { cleanup, gitIn, gitRepo, run, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const ZERO = "zero <zero@kaelen.invalid>";
const who = (repo: string, ref = "HEAD") => run("git", ["log", "-1", "--format=%an <%ae>|%cn <%ce>", ref], repo);
const withOwner = (repo: string) => {
  run("git", ["config", "user.name", "Dueña"], repo);
  run("git", ["config", "user.email", "duena@example.com"], repo);
  return repo;
};
const lineOf = (repo: string, extra = "") => parseFactory(`${extra}lines:\n  - name: demo\n    repo: ${JSON.stringify(repo)}\n`);

describe("commitAuthor option", () => {
  it("is zero by default", () => {
    const cfg = lineOf("/r");
    expect(cfg.commitAuthor).toBe("zero");
    expect(commitAuthor(cfg, cfg.lines[0]!)).toBe("zero");
  });

  it("inherits a global owner", () => {
    const cfg = lineOf("/r", "commitAuthor: owner\n");
    expect(commitAuthor(cfg, cfg.lines[0]!)).toBe("owner");
  });

  it("lets the line decide", () => {
    const cfg = parseFactory(`commitAuthor: owner\nlines:\n  - name: demo\n    repo: /r\n    commitAuthor: zero\n`);
    expect(commitAuthor(cfg, cfg.lines[0]!)).toBe("zero");
  });

  it("refuses any other value", () => {
    expect(() => parseFactory(`lines:\n  - name: demo\n    repo: /r\n    commitAuthor: alguien\n`)).toThrow();
  });

  it("needs no name or email in the factory file", async () => {
    const repo = withOwner(gitRepo());
    const cfg = lineOf(repo, "commitAuthor: owner\n");
    expect(JSON.stringify(cfg)).not.toMatch(/duena|Dueña/);
    expect(cfg.lines[0]).not.toHaveProperty("name", "Dueña");
    const copy = await openWorkCopy(repo, "main", "zero/j1", join(tempDir("zero-wt-"), "j1"), [], commitAuthor(cfg, cfg.lines[0]!));
    writeTree(copy.cwd, { "a.txt": "a\n" });
    copy.commitAll("a");
    expect(who(copy.cwd)).toBe(`Dueña <duena@example.com>|${ZERO}`);
  });
});

describe("work copy commits", () => {
  it("are authored by the owner and committed by zero with owner", async () => {
    const repo = withOwner(gitRepo());
    const copy = await openWorkCopy(repo, "main", "zero/j1", join(tempDir("zero-wt-"), "j1"), [], "owner");
    writeTree(copy.cwd, { "a.txt": "a\n" });
    expect(copy.commitAll("a")).toBe(true);
    expect(who(copy.cwd)).toBe(`Dueña <duena@example.com>|${ZERO}`);
  });

  it("stay zero's with zero or no mode", async () => {
    const repo = withOwner(gitRepo());
    for (const [i, mode] of ([undefined, "zero"] as const).entries()) {
      const copy = await openWorkCopy(repo, "main", `zero/j${i}`, join(tempDir("zero-wt-"), `j${i}`), [], mode);
      writeTree(copy.cwd, { "a.txt": "a\n" });
      expect(copy.commitAll("a")).toBe(true);
      expect(who(copy.cwd)).toBe(`${ZERO}|${ZERO}`);
    }
  });

  it("take the owner from the line's repository in a box clone", async () => {
    const repo = withOwner(gitRepo());
    const copy = await openCloneCopy(repo, "main", "zero/j1", join(tempDir("zero-clone-"), "j1"), [], "owner");
    writeTree(copy.cwd, { "a.txt": "a\n" });
    expect(copy.commitAll("a")).toBe(true);
    expect(who(copy.cwd)).toBe(`Dueña <duena@example.com>|${ZERO}`);
  });

  it("fall back to zero when the repository has no identity", async () => {
    const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
    const empty = join(tempDir(), "gitconfig");
    writeFileSync(empty, "");
    process.env.GIT_CONFIG_GLOBAL = empty;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    try {
      const repo = gitRepo();
      const copy = await openWorkCopy(repo, "main", "zero/j1", join(tempDir("zero-wt-"), "j1"), [], "owner");
      writeTree(copy.cwd, { "a.txt": "a\n" });
      expect(copy.commitAll("a")).toBe(true);
      expect(who(copy.cwd)).toBe(`${ZERO}|${ZERO}`);
    } finally {
      for (const [key, value] of [["GIT_CONFIG_GLOBAL", saved.global], ["GIT_CONFIG_NOSYSTEM", saved.nosystem]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("merge integration", () => {
  async function merged(author: CommitAuthor, checkedOut: boolean) {
    const repo = withOwner(gitRepo());
    if (!checkedOut) gitIn(repo, "checkout", "-q", "-b", "elsewhere");
    const copy = await openWorkCopy(repo, "main", "zero/j1", join(tempDir("zero-wt-"), "j1"), [], author);
    writeTree(copy.cwd, { "a.txt": "a\n" });
    copy.commitAll("a");
    const r = mergeIntoBase(lineOf(repo).lines[0]!, copy, { jobId: "j1", title: "Add a", body: "", scratchDir: tempDir(), author });
    expect(r.ok).toBe(true);
    return { repo, r };
  }

  for (const checkedOut of [true, false]) {
    it(`uses the owner as author and zero as committer (${checkedOut ? "owner's copy" : "temporary worktree"})`, async () => {
      const { repo } = await merged("owner", checkedOut);
      expect(run("git", ["log", "-1", "--format=%P", "main"], repo).split(" ")).toHaveLength(2);
      expect(who(repo, "main")).toBe(`Dueña <duena@example.com>|${ZERO}`);
    });
  }

  it("stays zero's with zero", async () => {
    const { repo } = await merged("zero", true);
    expect(who(repo, "main")).toBe(`${ZERO}|${ZERO}`);
  });

  it("is still recognised when the owner's merge is reverted", async () => {
    const repo = withOwner(gitRepo());
    const ctx = testFactory({ level: "L2", isolation: "worktree", commitAuthor: "owner", lines: [{ name: "tienda", repo }] });
    const line = ctx.config.lines[0]!;
    const copy = await openWorkCopy(repo, "main", "zero/j1", join(tempDir("zero-wt-"), "j1"), [], commitAuthor(ctx.config, line));
    writeTree(copy.cwd, { "src/health.ts": "ok\n" });
    copy.commitAll("health");
    const r = mergeIntoBase(line, copy, { jobId: "j1", title: "Agregar health", body: "", scratchDir: tempDir(), author: commitAuthor(ctx.config, line) });
    if (!r.ok) throw new Error(r.reason);
    expect(who(repo, "main")).toBe(`Dueña <duena@example.com>|${ZERO}`);
    const proposal = ctx.store.createProposal({ title: "Agregar health", why: "falla", change: "health", estimatedUsd: 0.5, paths: ["src/health.ts"], line: line.name });
    const { job } = requestWork(ctx, { text: "Agregar health", line: line.name, source: { kind: "night-shift", proposal: proposal.id, autonomy: "auto" } });
    ctx.store.updateProposal(proposal.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
    ctx.store.finishJob(job.id, "delivered", { approvals: {}, delivery: r.delivery });
    gitIn(repo, "revert", "-m", "1", "--no-edit", r.delivery.commit!);
    expect(await detectReverts(ctx)).toBe(1);
    expect(ctx.store.getProposal(proposal.id)).toMatchObject({ status: "reverted" });
  });
});
