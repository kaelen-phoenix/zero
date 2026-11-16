import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDiff3, resolveSimply } from "../src/line/conflicts.js";
import { cleanup, gitIn, gitRepo, writeTree } from "./helpers.js";

afterEach(cleanup);

const hunk = (ours: string[], base: string[], theirs: string[]) => ["<<<<<<< ours", ...ours, "||||||| base", ...base, "=======", ...theirs, ">>>>>>> theirs"].join("\n");

describe("resolveDiff3", () => {
  it("joins import lines, ours first, each once", () => {
    const text = `// head\n${hunk([`import { a } from "./a.js";`, `import { c } from "./c.js";`], [`import { a } from "./a.js";`], [`import { a } from "./a.js";`, `import type { B } from "./b.js";`])}\nbody\n`;
    expect(resolveDiff3(text)).toBe(`// head\nimport { a } from "./a.js";\nimport { c } from "./c.js";\nimport type { B } from "./b.js";\nbody\n`);
  });

  it("joins Python imports and export-from lines", () => {
    expect(resolveDiff3(hunk(["import os", "from a import b"], [], ["import sys", "from a import b"]))).toBe("import os\nfrom a import b\nimport sys");
    expect(resolveDiff3(hunk([`export { x } from "./x";`], [], [`export * from "./y";`]))).toBe(`export { x } from "./x";\nexport * from "./y";`);
  });

  it("does not take the first line of a multi-line import for an import", () => {
    expect(resolveDiff3(hunk(["import {", "  a,"], ["import {"], ["import {", "  b,"]))).toBeUndefined();
  });

  it("puts our lines then theirs when both add at the same place", () => {
    expect(resolveDiff3(`x\n${hunk(["const n = count();"], [], [`<p id="error">Error</p>`])}\ny`)).toBe(`x\nconst n = count();\n<p id="error">Error</p>\ny`);
  });

  it("leaves lines both sides change differently unresolved", () => {
    expect(resolveDiff3(hunk(["value = 1"], ["value = 0"], ["value = 2"]))).toBeUndefined();
    // Both add, but share a line: not a plain addition of each side.
    expect(resolveDiff3(hunk(["a", "b"], [], ["b", "c"]))).toBeUndefined();
  });

  it("keeps one side when both are equal", () => {
    expect(resolveDiff3(hunk(["same", "lines"], ["old"], ["same", "lines"]))).toBe("same\nlines");
  });

  it("refuses malformed markers and keeps CRLF lines", () => {
    expect(resolveDiff3("<<<<<<< ours\na\n=======\nb\n")).toBeUndefined();
    expect(resolveDiff3("a\n>>>>>>> theirs\n")).toBeUndefined();
    expect(resolveDiff3(`<<<<<<< ours\r\nimport a\r\n||||||| base\r\n=======\r\nimport b\r\n>>>>>>> theirs\r\nz\r\n`)).toBe("import a\r\nimport b\r\nz\r\n");
  });
});

/** A repository with `main` and `other` changing the files, `main` checked out and `other` merged into it in conflict. */
function conflicted(base: Record<string, string>, ours: Record<string, string>, theirs: Record<string, string>) {
  const repo = gitRepo(base);
  gitIn(repo, "checkout", "-q", "-b", "other");
  writeTree(repo, theirs);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-qm", "theirs");
  gitIn(repo, "checkout", "-q", "main");
  writeTree(repo, ours);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-qm", "ours");
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "merge", "--no-edit", "other"], { cwd: repo, encoding: "utf8" });
  expect(r.status).not.toBe(0);
  const unmerged = () => gitIn(repo, "diff", "--name-only", "--diff-filter=U");
  return { repo, unmerged };
}

describe("resolveSimply", () => {
  it("resolves and adds every file when all are simple", () => {
    const { repo, unmerged } = conflicted(
      { "a.ts": `import { x } from "./x.js";\n\nexport const n = 1;\n`, "b.txt": "top\nend\n" },
      { "a.ts": `import { x } from "./x.js";\nimport { y } from "./y.js";\n\nexport const n = 1;\n`, "b.txt": "top\nmine\nend\n" },
      { "a.ts": `import { x } from "./x.js";\nimport { z } from "./z.js";\n\nexport const n = 1;\n`, "b.txt": "top\ntheirs\nend\n" },
    );
    expect(resolveSimply(repo, ["a.ts", "b.txt"])).toBe(true);
    expect(unmerged()).toBe("");
    expect(readFileSync(join(repo, "a.ts"), "utf8")).toBe(`import { x } from "./x.js";\nimport { y } from "./y.js";\nimport { z } from "./z.js";\n\nexport const n = 1;\n`);
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("top\nmine\ntheirs\nend\n");
  });

  it("writes and adds nothing when one file is not simple", () => {
    const { repo, unmerged } = conflicted(
      { "a.ts": `import { x } from "./x.js";\n`, "c.txt": "value 0\n" },
      { "a.ts": `import { y } from "./y.js";\n`, "c.txt": "value 1\n" },
      { "a.ts": `import { z } from "./z.js";\n`, "c.txt": "value 2\n" },
    );
    expect(resolveSimply(repo, ["a.ts", "c.txt"])).toBe(false);
    expect(unmerged().split("\n").sort()).toEqual(["a.ts", "c.txt"]);
    expect(readFileSync(join(repo, "a.ts"), "utf8")).toMatch(/^<{7}/m);
  });

  it("refuses a file added on both sides, which has no base stage", () => {
    const { repo } = conflicted({ "README.md": "# demo\n" }, { "new.ts": `import a from "a";\n` }, { "new.ts": `import b from "b";\n` });
    expect(resolveSimply(repo, ["new.ts"])).toBe(false);
  });
});
