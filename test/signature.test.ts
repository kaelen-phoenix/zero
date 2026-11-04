import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SIGNATURE_TEXT, DEFAULT_SIGNATURE_TRAILER, ConfigError, lineSignature, parseFactory } from "../src/config.js";
import type { IssueApi } from "../src/intake/github.js";
import type { MergeApi } from "../src/line/automerge.js";
import { signedIssues, signedMerges, signText, withTrailer } from "../src/signature.js";
import { cleanup } from "./helpers.js";

afterEach(cleanup);

const TEXT = "— Hecho con [zero in the loop](https://zerointheloop.com)";
const TRAILER = "Built-by: zero in the loop <https://zerointheloop.com>";
const signature = { text: TEXT, trailer: TRAILER };
const factory = (yaml: string) => parseFactory(`lines:\n  - name: a\n    repo: /r/a\n  - name: b\n    repo: /r/b\n${yaml}`);

describe("signature configuration", () => {
  it("is on with both default texts when absent", () => {
    const config = parseFactory("lines:\n  - name: a\n    repo: /r/a\n");
    expect(DEFAULT_SIGNATURE_TEXT).toBe(TEXT);
    expect(DEFAULT_SIGNATURE_TRAILER).toBe(TRAILER);
    expect(lineSignature(config, config.lines[0]!)).toEqual(signature);
  });

  it("turns off globally", () => {
    const config = parseFactory("signature: off\nlines:\n  - name: a\n    repo: /r/a\n");
    expect(lineSignature(config, config.lines[0]!)).toBeUndefined();
  });

  it("refuses a trailer that is not one `Token: value` line, and unknown keys", () => {
    expect(() => parseFactory('signature: { trailer: "no colon here" }\n')).toThrow(ConfigError);
    expect(() => parseFactory('signature: { trailer: "Built-by: a\\nOther: b" }\n')).toThrow(ConfigError);
    expect(() => parseFactory("signature: { text: x, footer: y }\n")).toThrow(ConfigError);
    expect(() => parseFactory("signature: on\n")).toThrow(ConfigError);
  });

  it("fills in the default trailer when only the text is given", () => {
    const config = parseFactory('signature: { text: "Firmado" }\nlines:\n  - name: a\n    repo: /r/a\n');
    expect(lineSignature(config, config.lines[0]!)).toEqual({ text: "Firmado", trailer: TRAILER });
  });

  it("lets a line turn it off while the others keep the global one", () => {
    const config = factory("");
    const off = parseFactory("lines:\n  - name: a\n    repo: /r/a\n    signature: off\n  - name: b\n    repo: /r/b\n");
    expect(lineSignature(config, config.lines[0]!)).toEqual(signature);
    expect(lineSignature(off, off.lines[0]!)).toBeUndefined();
    expect(lineSignature(off, off.lines[1]!)).toEqual(signature);
  });

  it("lets a line turn it on with its own text when the global one is off", () => {
    const config = parseFactory('signature: off\nlines:\n  - name: a\n    repo: /r/a\n    signature: { text: "Hecho por la línea" }\n  - name: b\n    repo: /r/b\n');
    expect(lineSignature(config, config.lines[0]!)).toEqual({ text: "Hecho por la línea", trailer: TRAILER });
    expect(lineSignature(config, config.lines[1]!)).toBeUndefined();
  });
});

describe("signing", () => {
  it("adds the trailer as its own last paragraph, and the text at the end", () => {
    expect(withTrailer("zero(j): intento 1", signature)).toBe(`zero(j): intento 1\n\n${TRAILER}`);
    expect(withTrailer("zero(j): intento 1")).toBe("zero(j): intento 1");
    expect(signText("cuerpo", signature)).toBe(`cuerpo\n\n${TEXT}`);
    expect(signText("cuerpo")).toBe("cuerpo");
  });

  function fakeIssues() {
    const calls: { op: string; args: unknown[] }[] = [];
    const record =
      (op: string, result?: unknown) =>
      async (...args: unknown[]) => {
        calls.push({ op, args });
        return result;
      };
    const api = {
      labeled: record("labeled", []),
      unlabeled: record("unlabeled", []),
      issue: record("issue", { state: "open", labels: [] }),
      lastLabeled: record("lastLabeled"),
      permission: record("permission", "admin"),
      comment: record("comment"),
      comments: record("comments", []),
      ensureLabel: record("ensureLabel", false),
      createIssue: record("createIssue", { number: 3, url: "u" }),
      addLabels: record("addLabels"),
      close: record("close"),
    } as IssueApi;
    return { api, calls };
  }

  it("signs comments and created issues, and passes everything else through", async () => {
    const gh = fakeIssues();
    const signed = signedIssues(gh.api, signature);
    await signed.comment(7, "Hola");
    expect(await signed.createIssue("t", "cuerpo", ["zero:propuesta"])).toEqual({ number: 3, url: "u" });
    expect(await signed.permission("owner")).toBe("admin");
    await signed.addLabels(7, ["zero"]);
    await signed.close(7, "completed");
    expect(gh.calls).toEqual([
      { op: "comment", args: [7, `Hola\n\n${TEXT}`] },
      { op: "createIssue", args: ["t", `cuerpo\n\n${TEXT}`, ["zero:propuesta"]] },
      { op: "permission", args: ["owner"] },
      { op: "addLabels", args: [7, ["zero"]] },
      { op: "close", args: [7, "completed"] },
    ]);
  });

  it("leaves the bodies unchanged without a signature", async () => {
    const gh = fakeIssues();
    const signed = signedIssues(gh.api, undefined);
    await signed.comment(7, "Hola");
    await signed.createIssue("t", "cuerpo", []);
    expect(gh.calls.map((c) => c.args[1])).toEqual(["Hola", "cuerpo"]);
  });

  it("signs the automatic merge's comments", async () => {
    const said: string[] = [];
    const merges: MergeApi = {
      pullRequest: async () => ({ open: true, merged: false, mergeable: true, headSha: "abc" }),
      checks: async () => [],
      merge: async () => "sha",
      deleteBranch: async () => {},
      comment: async (_n, body) => void said.push(body),
    };
    await signedMerges(merges, signature).comment(10, "x");
    await signedMerges(merges, undefined).comment(10, "y");
    expect(await signedMerges(merges, signature).merge(10, "abc")).toBe("sha");
    expect(said).toEqual([`x\n\n${TEXT}`, "y"]);
  });
});
