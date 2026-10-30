import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFactory } from "../src/config.js";
import { mergeIntoBase, githubRepository, integrate } from "../src/line/integrate.js";
import { decide } from "../src/line/policy.js";
import { blockingFindings, checkCitations, citationValid } from "../src/line/review.js";
import { changeName, plainSpec, renderOpenSpecChange, specProblems, writeFiles } from "../src/line/spec.js";
import { protectedTouched, testTampering, verifyChange } from "../src/line/verify.js";
import { Store } from "../src/state/store.js";
import { Tracer } from "../src/telemetry/tracer.js";
import { checkedOutAt, openWorkCopy } from "../src/workspace.js";
import { cleanup, gitIn, gitRepo, tempDir, validSpec, writeTree } from "./helpers.js";

afterEach(cleanup);

const tracer = () => new Tracer(new Store(":memory:"));

async function copyOf(repo: string, id = "j1") {
  return openWorkCopy(repo, "main", `zero/${id}`, join(tempDir("zero-wt-"), id));
}

describe("work copies", () => {
  it("work on their own branch without touching the owner's copy", async () => {
    const repo = gitRepo();
    const copy = await copyOf(repo);
    writeTree(copy.cwd, { "src/a.ts": "export const a = 1;\n" });
    expect(copy.hasChanges()).toBe(true);
    expect(copy.commitAll("add a")).toBe(true);
    expect(copy.commitAll("nothing")).toBe(false);
    expect(copy.changedFiles()).toEqual([{ status: "A", path: "src/a.ts" }]);
    expect(copy.addedLines()).toEqual([{ path: "src/a.ts", text: "export const a = 1;" }]);
    expect(copy.commitsAhead()).toBe(1);
    expect(existsSync(join(repo, "src/a.ts"))).toBe(false);
    expect(checkedOutAt(repo, "zero/j1")).toBeTruthy();
    expect(checkedOutAt(repo, "main")).toBeTruthy();
  });

  it("discard uncommitted changes, including new files", async () => {
    const copy = await copyOf(gitRepo());
    writeTree(copy.cwd, { "new.txt": "x", "README.md": "changed" });
    copy.discardChanges();
    expect(copy.hasChanges()).toBe(false);
    expect(existsSync(join(copy.cwd, "new.txt"))).toBe(false);
  });
});

describe("spec station output", () => {
  it("requires SHALL/MUST and scenarios on feasible specs", () => {
    expect(specProblems(validSpec())).toEqual([]);
    const bad = validSpec({ requirements: [{ name: "R", text: "it does things", scenarios: [] }] });
    expect(specProblems(bad)).toEqual([expect.stringMatching(/SHALL or MUST/), expect.stringMatching(/scenario/)]);
    expect(specProblems(validSpec({ feasible: false, reason: "needs prod access", requirements: [] }))).toEqual([]);
  });

  it("renders a change that `openspec validate` accepts", async () => {
    const root = tempDir("zero-openspec-");
    writeTree(root, { "openspec/config.yaml": "schema: spec-driven\n" });
    const files = renderOpenSpecChange(validSpec(), { jobId: "abc123", request: "agregá /health", newCapability: true });
    await writeFiles(join(root, "openspec", "changes", changeName("abc123")), files);
    const bin = join(process.cwd(), "node_modules", "@fission-ai", "openspec", "bin", "openspec.js");
    const r = spawnSync(process.execPath, [bin, "validate", changeName("abc123")], { cwd: root, encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`).toContain("is valid");
    expect(r.status).toBe(0);
  });

  it("explains the spec in plain words for the owner", () => {
    expect(plainSpec(validSpec())).toContain("Qué va a funcionar:\n- Health check");
  });
});

describe("verification", () => {
  it("flags protected paths unless approved", () => {
    const files = [{ status: "M", path: ".github/workflows/ci.yml" }, { status: "A", path: "src/x.ts" }];
    expect(protectedTouched(files, [".github/**"])).toEqual([".github/workflows/ci.yml"]);
    expect(protectedTouched(files, [".github/**"], [".github/workflows/ci.yml"])).toEqual([]);
  });

  it("detects deleted and disabled tests", () => {
    const problems = testTampering(
      [{ status: "D", path: "test/api.test.ts" }, { status: "D", path: "src/old.ts" }],
      [
        { path: "test/x.test.ts", text: "  it.skip('works', () => {" },
        { path: "tests/test_api.py", text: "@pytest.mark.skip" },
        { path: "src/x.ts", text: "const skip = it.skip; // not a test file" },
      ],
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/test\/api\.test\.ts/);
  });

  it("fails with the command's output and records a span per command", async () => {
    const copy = await copyOf(gitRepo());
    writeTree(copy.cwd, { "src/a.ts": "x" });
    copy.commitAll("a");
    const t = tracer();
    const r = await verifyChange(copy, {
      commands: [`node -e "console.log('first ok')"`, `node -e "console.error('boom'); process.exit(3)"`],
      protectedPaths: [],
      tracer: t,
      jobId: "j1",
      parentId: "p",
    });
    expect(r).toMatchObject({ ok: false, kind: "failed" });
    expect(r.ok === false && r.kind === "failed" && r.feedback).toMatch(/código 3[\s\S]*boom/);
  });
});

describe("review citations", () => {
  it("accepts only files and lines that exist inside the work copy", () => {
    const root = tempDir();
    writeTree(root, { "src/a.ts": "one\ntwo\nthree\n" });
    expect(citationValid(root, "src/a.ts", 2)).toBe(true);
    expect(citationValid(root, "src\\a.ts", 3)).toBe(true);
    expect(citationValid(root, "src/a.ts", 99)).toBe(false);
    expect(citationValid(root, "src/missing.ts", 1)).toBe(false);
    expect(citationValid(root, "../outside.ts", 1)).toBe(false);
    expect(citationValid(root, "src", 1)).toBe(false);
  });

  it("blocks only on verified high or critical findings", () => {
    const root = tempDir();
    writeTree(root, { "a.ts": "x\n" });
    const { valid, invalid } = checkCitations(root, [
      { severity: "critical", file: "invented.ts", line: 4, problem: "p", fix: "f" },
      { severity: "low", file: "a.ts", line: 1, problem: "p", fix: "f" },
      { severity: "high", file: "a.ts", line: 1, problem: "real", fix: "f" },
    ]);
    expect(invalid).toHaveLength(1);
    expect(blockingFindings(valid).map((f) => f.problem)).toEqual(["real"]);
  });
});

describe("integration", () => {
  const line = (repo: string, integrate: "merge" | "branch" = "merge") => parseFactory(`lines:\n  - name: demo\n    repo: ${JSON.stringify(repo)}\n    integrate: ${integrate}\n`).lines[0]!;
  const opts = () => ({ jobId: "j1", title: "Add a", body: "", scratchDir: tempDir() });

  it("merges into the owner's copy when it is clean", async () => {
    const repo = gitRepo();
    const copy = await copyOf(repo);
    writeTree(copy.cwd, { "a.txt": "from zero\n" });
    copy.commitAll("a");
    const r = mergeIntoBase(line(repo), copy, opts());
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("from zero\n");
  });

  it("does not touch the owner's copy when it has unsaved changes", async () => {
    const repo = gitRepo();
    const copy = await copyOf(repo);
    writeTree(copy.cwd, { "a.txt": "from zero\n" });
    copy.commitAll("a");
    writeFileSync(join(repo, "README.md"), "owner is editing\n");
    const r = mergeIntoBase(line(repo), copy, opts());
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/cambios sin guardar/) });
    expect(existsSync(join(repo, "a.txt"))).toBe(false);
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("owner is editing\n");
  });

  it("uses a temporary copy when the base branch is not checked out", async () => {
    const repo = gitRepo();
    gitIn(repo, "checkout", "-q", "-b", "other");
    const copy = await copyOf(repo);
    writeTree(copy.cwd, { "a.txt": "x\n" });
    copy.commitAll("a");
    const r = mergeIntoBase(line(repo), copy, opts());
    expect(r.ok).toBe(true);
    expect(gitIn(repo, "show", "main:a.txt")).toBe("x");
  });

  it("reports conflicts and leaves the base intact", async () => {
    const repo = gitRepo({ "a.txt": "base\n" });
    const copy = await copyOf(repo);
    writeTree(copy.cwd, { "a.txt": "zero\n" });
    copy.commitAll("zero edit");
    writeTree(repo, { "a.txt": "owner\n" });
    gitIn(repo, "commit", "-q", "-am", "owner edit");
    const r = mergeIntoBase(line(repo), copy, opts());
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/conflictos/) });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("owner\n");
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
  });

  it("leaves the branch ready in branch mode", async () => {
    const repo = gitRepo();
    const copy = await copyOf(repo);
    expect(await integrate(line(repo, "branch"), copy, opts())).toEqual({ ok: true, delivery: { mode: "branch", branch: "zero/j1" } });
  });

  it("signs the merge commit with the trailer as its last line, and not when the signature is off", async () => {
    const trailer = "Built-by: zero in the loop <https://zerointheloop.com>";
    const repo = gitRepo();
    const copy = await copyOf(repo);
    writeTree(copy.cwd, { "a.txt": "x\n" });
    copy.commitAll("a");
    const signature = { text: "t", trailer };
    expect(mergeIntoBase(line(repo), copy, { ...opts(), signature }).ok).toBe(true);
    const message = gitIn(repo, "log", "-1", "--format=%B", "main");
    expect(message.split("\n")[0]).toBe("zero: Add a (j1)");
    expect(message.trim().split("\n").at(-1)).toBe(trailer);
    expect(gitIn(repo, "log", "-1", "--format=%(trailers:key=Built-by,valueonly)", "main")).toBe("zero in the loop <https://zerointheloop.com>");

    const unsigned = gitRepo();
    const other = await copyOf(unsigned);
    writeTree(other.cwd, { "a.txt": "x\n" });
    other.commitAll("a");
    expect(mergeIntoBase(line(unsigned), other, opts()).ok).toBe(true);
    expect(gitIn(unsigned, "log", "--format=%B", "main")).not.toContain("Built-by:");
  });

  it("parses GitHub remotes", () => {
    expect(githubRepository("https://github.com/kaelen-phoenix/zero.git")).toBe("kaelen-phoenix/zero");
    expect(githubRepository("git@github.com:kaelen-phoenix/zero.git")).toBe("kaelen-phoenix/zero");
    expect(githubRepository("https://gitlab.com/a/b.git")).toBeUndefined();
  });
});

describe("policy", () => {
  it("asks less as autonomy grows and never asks at L3", () => {
    expect(decide("L0", "before-integrate")).toBe("ask");
    expect(decide("L1", "spec-ready")).toBe("ask");
    expect(decide("L2", "spec-ready")).toBe("continue");
    expect(decide("L2", "protected-path")).toBe("ask");
    expect(decide("L3", "protected-path")).toBe("fail");
    expect(decide("L3", "budget-exceeded")).toBe("fail");
  });
});
