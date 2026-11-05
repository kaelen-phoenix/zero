import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFactory } from "../src/config.js";
import { mergeIntoBase, githubRepository, integrate } from "../src/line/integrate.js";
import { decide } from "../src/line/policy.js";
import { blockingFindings, checkCitations, citationValid, findingsFeedback, lowConfidence, ReviewSchema, type Finding } from "../src/line/review.js";
import { changeName, existingRequirementNames, foldRequirementName, plainSpec, renderOpenSpecChange, specProblems, uniqueRequirementNames, writeFiles } from "../src/line/spec.js";
import { filterProposals, type ScoutOutput } from "../src/line/scout.js";
import { ALWAYS_PROTECTED, protectedTouched, testTampering, verifyChange } from "../src/line/verify.js";
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
    const files = renderOpenSpecChange(validSpec(), { jobId: "abc123", newCapability: true });
    await writeFiles(join(root, "openspec", "changes", changeName("abc123")), files);
    const bin = join(process.cwd(), "node_modules", "@fission-ai", "openspec", "bin", "openspec.js");
    const r = spawnSync(process.execPath, [bin, "validate", changeName("abc123")], { cwd: root, encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`).toContain("is valid");
    expect(r.status).toBe(0);
  });

  it("describes the change in the proposal without quoting the request", () => {
    const proposal = renderOpenSpecChange(validSpec(), { jobId: "abc123", newCapability: true })["proposal.md"]!;
    expect(proposal).toContain(validSpec().summary);
    expect(proposal).not.toContain("Pedido original");
  });

  it("explains the spec in plain words for the owner", () => {
    expect(plainSpec(validSpec())).toContain("Qué va a funcionar:\n- Health check");
  });
});

const delta = (...names: string[]) => `## ADDED Requirements\n\n${names.map((n) => `### Requirement: ${n}\nIt MUST work.\n`).join("\n")}`;
const named = (...names: string[]) => validSpec({ requirements: names.map((name) => ({ ...validSpec().requirements[0]!, name })) });
const namesOf = (spec: ReturnType<typeof validSpec>) => spec.requirements.map((r) => r.name);

describe("existing requirement names", () => {
  it("come from the main spec and other changes' deltas of the capability", () => {
    const root = tempDir("zero-names-");
    writeTree(root, {
      "openspec/specs/cap/spec.md": `# cap\n\n## Requirements\n\n${delta("A").replace("## ADDED Requirements\n\n", "")}`,
      "openspec/changes/otro/specs/cap/spec.md": delta("B").replace(/\n/g, "\r\n"),
    });
    expect(existingRequirementNames(root, "cap", "zero-j1").sort()).toEqual(["A", "B"]);
  });

  it("leave out the archive, the job's own change and other capabilities", () => {
    const root = tempDir("zero-names-");
    writeTree(root, {
      "openspec/changes/archive/x/specs/cap/spec.md": delta("Archivado"),
      "openspec/changes/archive/specs/cap/spec.md": delta("Archivado"),
      "openspec/changes/zero-j1/specs/cap/spec.md": delta("Propio"),
      "openspec/changes/otro/specs/otra/spec.md": delta("Otra"),
      "openspec/specs/otra/spec.md": delta("Otra"),
    });
    expect(existingRequirementNames(root, "cap", "zero-j1")).toEqual([]);
  });

  it("use the same folder as the rendered change", () => {
    const root = tempDir("zero-names-");
    const capability = "Salud Óptima";
    const folder = Object.keys(renderOpenSpecChange(validSpec({ capability }), { jobId: "j1", newCapability: false })).find((p) => p.startsWith("specs/"))!;
    writeTree(root, { [`openspec/changes/otro/${folder}`]: delta("A") });
    expect(existingRequirementNames(root, capability, "zero-j1")).toEqual(["A"]);
  });

  it("are empty without OpenSpec", () => {
    expect(existingRequirementNames(tempDir("zero-names-"), "cap", "zero-j1")).toEqual([]);
  });

  it("skip what cannot be read and keep the rest", () => {
    const root = tempDir("zero-names-");
    writeTree(root, { "openspec/changes/suelto.md": "x", "openspec/changes/bien/specs/cap/spec.md": delta("A") });
    mkdirSync(join(root, "openspec", "changes", "carpeta", "specs", "cap", "spec.md"), { recursive: true });
    expect(existingRequirementNames(root, "cap", "zero-j1")).toEqual(["A"]);
  });
});

describe("unique requirement names", () => {
  it("compare like openspec's fold", () => {
    for (const name of ["ÍCONO monocromo", "ícono   monocromo", "  Ícono monocromo\t", "Ícono monocromo ##"]) {
      expect(foldRequirementName(name)).toBe("ícono monocromo");
    }
    expect(foldRequirementName("C#")).toBe("c#");
    expect(namesOf(uniqueRequirementNames(named("ÍCONO monocromo"), "abc123", ["Ícono monocromo"]))).toEqual(["ÍCONO monocromo (abc123)"]);
  });

  it("match a delta's heading with a closing run of #", () => {
    const root = tempDir("zero-names-");
    writeTree(root, { "openspec/changes/otro/specs/cap/spec.md": delta("Foo ###") });
    expect(namesOf(uniqueRequirementNames(named("foo"), "abc123", existingRequirementNames(root, "cap", "zero-abc123")))).toEqual(["foo (abc123)"]);
  });

  it("add the suffix to a name the capability has", () => {
    expect(namesOf(uniqueRequirementNames(named("A", "B"), "abc123", ["A"]))).toEqual(["A (abc123)", "B"]);
  });

  it("keep the first of a name repeated within the request", () => {
    expect(namesOf(uniqueRequirementNames(named("A", "a"), "abc123", []))).toEqual(["A", "a (abc123)"]);
  });

  it("break ties with a number when the suffix is taken", () => {
    expect(namesOf(uniqueRequirementNames(named("A", "A", "A"), "abc123", ["A"]))).toEqual(["A (abc123)", "A (abc123-2)", "A (abc123-3)"]);
    expect(namesOf(uniqueRequirementNames(named("A"), "abc123", ["A", "a (ABC123)"]))).toEqual(["A (abc123-2)"]);
    const crowded = namesOf(uniqueRequirementNames(named("A", "A (abc123)", "A", "A (abc123)"), "abc123", []));
    expect(new Set(crowded.map(foldRequirementName)).size).toBe(4);
  });

  it("leave the closing # out of a suffixed name, so openspec reads a whole name", () => {
    expect(namesOf(uniqueRequirementNames(named("Foo ###"), "abc123", ["foo"]))).toEqual(["Foo (abc123)"]);
  });

  it("change nothing when no names repeat", () => {
    const spec = named("A", "B");
    expect(uniqueRequirementNames(spec, "abc123", ["C"])).toEqual(spec);
    expect(namesOf(uniqueRequirementNames(spec, "abc123", ["A"]))).toEqual(["A (abc123)", "B"]);
    expect(namesOf(spec)).toEqual(["A", "B"]);
  });
});

describe("openspec archive with repeated requirement names", () => {
  const bin = join(process.cwd(), "node_modules", "@fission-ai", "openspec", "bin", "openspec.js");
  const archive = (root: string, change: string) => spawnSync(process.execPath, [bin, "archive", change, "--yes"], { cwd: root, encoding: "utf8" });
  const requirement = (text: string) => validSpec({ capability: "cap", requirements: [{ name: "Ícono monocromo", text: `It MUST ${text}.`, scenarios: validSpec().requirements[0]!.scenarios }] });
  // The runner renders both as new: the capability is not in openspec/specs until the first one is archived.
  const write = (root: string, spec: ReturnType<typeof validSpec>, jobId: string) => writeFiles(join(root, "openspec", "changes", changeName(jobId)), renderOpenSpecChange(spec, { jobId, newCapability: true }));

  function repo() {
    const root = tempDir("zero-archive-");
    writeTree(root, { "openspec/config.yaml": "schema: spec-driven\n" });
    return root;
  }

  it("fails on the second change without unique names", async () => {
    const root = repo();
    await write(root, requirement("use one color"), "aaa111");
    await write(root, requirement("use two colors"), "bbb222");
    expect(archive(root, changeName("aaa111")).status).toBe(0);
    const second = archive(root, changeName("bbb222"));
    expect(`${second.stdout}${second.stderr}`).toContain("already exists");
    expect(readFileSync(join(root, "openspec", "specs", "cap", "spec.md"), "utf8")).not.toContain("two colors");
  }, 60_000);

  it("archives both once the second has gone through unique names", async () => {
    const root = repo();
    await write(root, requirement("use one color"), "aaa111");
    await write(root, uniqueRequirementNames(requirement("use two colors"), "bbb222", existingRequirementNames(root, "cap", changeName("bbb222"))), "bbb222");
    for (const change of ["aaa111", "bbb222"]) {
      const r = archive(root, changeName(change));
      expect(`${r.stdout}${r.stderr}`).not.toContain("already exists");
      expect(r.status).toBe(0);
    }
    const main = readFileSync(join(root, "openspec", "specs", "cap", "spec.md"), "utf8");
    expect(main).toContain("### Requirement: Ícono monocromo\n");
    expect(main).toContain("### Requirement: Ícono monocromo (bbb222)\n");
    expect(main).toContain("use one color");
    expect(main).toContain("use two colors");
  }, 60_000);
});

describe("verification", () => {
  it("flags protected paths unless approved", () => {
    const files = [{ status: "M", path: ".github/workflows/ci.yml" }, { status: "A", path: "src/x.ts" }];
    expect(protectedTouched(files, [".github/**"])).toEqual([".github/workflows/ci.yml"]);
    expect(protectedTouched(files, [".github/**"], [".github/workflows/ci.yml"])).toEqual([]);
  });

  it("always protects the line's agent instructions", () => {
    const files = [{ status: "M", path: ".zero/agents/security.md" }, { status: "A", path: ".Zero/agents/a11y.md" }, { status: "A", path: "src/zero.ts" }];
    expect(protectedTouched(files, [])).toEqual([".zero/agents/security.md", ".Zero/agents/a11y.md"]);
  });

  it("protects agent configuration by default", () => {
    const defaults = parseFactory("lines:\n  - name: api\n    repo: /work/api\n").limits.protectedPaths;
    const files = [{ status: "M", path: ".claude/settings.json" }, { status: "A", path: ".mcp.json" }, { status: "A", path: "src/x.ts" }];
    expect(protectedTouched(files, defaults)).toEqual([".claude/settings.json", ".mcp.json"]);
    expect(protectedTouched([{ status: "M", path: ".claude/settings.json" }], defaults, [".claude/settings.json"])).toEqual([]);
  });

  it("protects Codex skills by default", () => {
    const defaults = parseFactory("lines:\n  - name: api\n    repo: /work/api\n").limits.protectedPaths;
    const files = [{ status: "A", path: ".agents/skills/x/SKILL.md" }, { status: "A", path: "src/x.ts" }];
    expect(protectedTouched(files, defaults)).toEqual([".agents/skills/x/SKILL.md"]);
    expect(protectedTouched([{ status: "A", path: ".agents/skills/x/SKILL.md" }], defaults, [".agents/skills/x/SKILL.md"])).toEqual([]);
  });

  describe("protected paths in any case", () => {
    const defaults = parseFactory("lines:\n  - name: api\n    repo: /work/api\n").limits.protectedPaths;

    it("flags other spellings of the default patterns and keeps the path as written", () => {
      expect(protectedTouched([{ status: "M", path: ".Claude/settings.json" }], defaults)).toEqual([".Claude/settings.json"]);
      expect(protectedTouched([{ status: "A", path: ".MCP.json" }], defaults)).toEqual([".MCP.json"]);
      expect(protectedTouched([{ status: "M", path: ".Github/workflows/ci.yml" }], defaults)).toEqual([".Github/workflows/ci.yml"]);
    });

    it("lower-cases the patterns too", () => {
      expect(protectedTouched([{ status: "A", path: "secrets/a.txt" }], ["Secrets/**"])).toEqual(["secrets/a.txt"]);
    });

    it("does not flag unrelated paths", () => {
      const files = [{ status: "M", path: "src/Claude/settings.json" }, { status: "A", path: "SRC/mcp.JSON" }];
      expect(protectedTouched(files, defaults)).toEqual([]);
    });

    it("keeps approvals exact", () => {
      const files = [{ status: "M", path: ".Claude/settings.json" }];
      expect(protectedTouched(files, defaults, [".Claude/settings.json"])).toEqual([]);
      expect(protectedTouched(files, defaults, [".claude/settings.json"])).toEqual([".Claude/settings.json"]);
    });

    it("drops night-shift proposals on another spelling and keeps unrelated ones", () => {
      const idea = (title: string, path: string): ScoutOutput["proposals"][number] => ({
        title,
        why: "w",
        change: "c",
        estimatedUsd: 0,
        paths: [path],
        needsNewCredentials: false,
        researchNote: null,
        thirdParty: false,
        commercial: false,
        issue: null,
      });
      const kept = idea("keep", "src/x.ts");
      expect(filterProposals([idea("drop", ".Claude/settings.json"), kept], [], [".claude/**"])).toEqual([kept]);
    });

    it("leaves the owner's list in charge: the fixed list does not grow", () => {
      expect(ALWAYS_PROTECTED).toEqual([".zero/**"]);
      expect(protectedTouched([{ status: "M", path: ".Claude/settings.json" }], ["docs/**"])).toEqual([]);
      expect(protectedTouched([{ status: "A", path: ".Zero/agents/a11y.md" }], [])).toEqual([".Zero/agents/a11y.md"]);
    });
  });

  it("stops a diff that adds .claude/settings.json", async () => {
    const copy = await copyOf(gitRepo());
    writeTree(copy.cwd, { ".claude/settings.json": "{\"hooks\":{}}\n" });
    copy.commitAll("settings");
    const r = await verifyChange(copy, {
      commands: [],
      protectedPaths: parseFactory("lines:\n  - name: api\n    repo: /work/api\n").limits.protectedPaths,
      tracer: tracer(),
      jobId: "j1",
      parentId: "p",
    });
    expect(r).toMatchObject({ ok: false, kind: "protected" });
    expect(r.ok === false && r.kind === "protected" && r.paths).toContain(".claude/settings.json");
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
      { severity: "critical", file: "invented.ts", line: 4, problem: "p", fix: "f", confidence: 10 },
      { severity: "low", file: "a.ts", line: 1, problem: "p", fix: "f", confidence: 10 },
      { severity: "high", file: "a.ts", line: 1, problem: "real", fix: "f", confidence: 9 },
    ]);
    expect(invalid).toHaveLength(1);
    expect(blockingFindings(valid).map((f) => f.problem)).toEqual(["real"]);
  });

  const finding = (severity: Finding["severity"], confidence: number, problem = "p"): Finding => ({ severity, file: "a.ts", line: 1, problem, fix: "f", confidence });

  it("blocks only on findings with confidence 8 or more", () => {
    const valid = [finding("critical", 7, "c7"), finding("high", 8, "h8"), finding("high", 10, "h10"), finding("low", 10, "l10")];
    expect(blockingFindings(valid).map((f) => f.problem)).toEqual(["h8", "h10"]);
    expect(lowConfidence(valid).map((f) => f.problem)).toEqual(["c7"]);
  });

  it("requires an integer confidence from 1 to 10 in every finding", () => {
    const review = (f: Record<string, unknown>) => ReviewSchema.safeParse({ summary: "s", findings: [f], learnings: [] });
    const base = { severity: "high", file: "a.ts", line: 1, problem: "p", fix: "f" };
    const ok = review({ ...base, confidence: 9 });
    expect(ok.success && ok.data.findings[0]!.confidence).toBe(9);
    for (const bad of [base, { ...base, confidence: 0 }, { ...base, confidence: 11 }, { ...base, confidence: 7.5 }]) expect(review(bad).success).toBe(false);
  });

  it("tells build each blocking finding's confidence", () => {
    const text = findingsFeedback([{ severity: "high", file: "src/a.ts", line: 3, problem: "p", fix: "f", confidence: 9 }]);
    expect(text).toContain("src/a.ts:3");
    expect(text).toContain("[high, confianza 9]");
  });

  it("asks review and security for a confidence, and security to skip noisy classes", () => {
    const read = (s: string) => readFileSync(new URL(`../agents/${s}.md`, import.meta.url), "utf8");
    for (const s of ["review", "security"]) {
      expect(read(s)).toContain("`confidence`");
      expect(read(s)).toMatch(/confidence` 8 or more/);
    }
    const security = read("security");
    for (const text of ["denial of service (DoS)", "rate limiting", "CPU or memory exhaustion", "open redirect", "validation without a demonstrated impact", "removes or weakens an existing protection"]) expect(security).toContain(text);
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
