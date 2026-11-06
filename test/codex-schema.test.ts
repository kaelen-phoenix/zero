import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgentRunner, toEngineSchema, type EngineExecute } from "../src/agent.js";
import { toStrictSchema, withoutOptionalNulls } from "../src/engines/codex-schema.js";
import { antigravityEngine, codexEngine } from "../src/engines/cli.js";
import type { EngineRequest } from "../src/engines/index.js";
import { ResearchOutput } from "../src/line/research.js";
import { ReviewSchema } from "../src/line/review.js";
import { ScoutOutput } from "../src/line/scout.js";
import { SpecSchema } from "../src/line/spec.js";
import { ReplySchema } from "../src/intake/comments.js";
import { cleanup, tempDir, testFactory } from "./helpers.js";

// spawn runs without a shell, so the codex binary is redirected to a real node process.
const fake = vi.hoisted(() => ({ script: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (bin: string, args: string[], options: object) =>
      // By name or, on Windows with a codex installed, by the full path `spawnTarget` finds: never the real one.
      /(^|[\\/])codex(\.(com|exe))?$/i.test(bin) ? real.spawn(process.execPath, ["-e", fake.script, "--", ...args], options) : real.spawn(bin, args, options),
  };
});

type Json = Record<string, unknown>;

const ALLOWED = new Set(["type", "properties", "required", "additionalProperties", "items", "anyOf", "enum", "const", "description", "title", "$ref", "$defs", "definitions", "multipleOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "format"]);
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);

/** What strict mode requires, written from OpenAI's rules and walking the whole schema without the conversion's code. */
function strictProblems(schema: Json): string[] {
  const problems: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      problems.push(`${path}: not a schema`);
      return;
    }
    const s = node as Json;
    for (const key of Object.keys(s)) if (!ALLOWED.has(key)) problems.push(`${path}: keyword ${key}`);
    if ("$ref" in s && Object.keys(s).length > 1) problems.push(`${path}: keys next to $ref`);
    if (!("type" in s) && !("anyOf" in s) && !("$ref" in s)) problems.push(`${path}: no type, anyOf or $ref`);
    if ("format" in s && !FORMATS.has(s.format as string)) problems.push(`${path}: format ${String(s.format)}`);
    const types = [s.type].flat();
    if (types.includes("object")) {
      const keys = Object.keys((s.properties ?? {}) as Json).sort();
      if (s.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`);
      if (JSON.stringify([...((s.required ?? []) as string[])].sort()) !== JSON.stringify(keys)) problems.push(`${path}: required does not list every property`);
    }
    if (types.includes("array") && !("items" in s)) problems.push(`${path}: array without items`);
    for (const [k, v] of Object.entries((s.properties ?? {}) as Json)) visit(v, `${path}.${k}`);
    if ("items" in s) visit(s.items, `${path}[]`);
    if ("anyOf" in s) (s.anyOf as unknown[]).forEach((v, i) => visit(v, `${path}|${i}`));
    for (const defs of ["$defs", "definitions"]) for (const [k, v] of Object.entries((s[defs] ?? {}) as Json)) visit(v, `${path}/${defs}/${k}`);
  };
  if (schema.type !== "object") problems.push("root is not an object");
  visit(schema, "#");
  return problems;
}

const strictOf = (schema: z.ZodType) => {
  const strict = toStrictSchema(toEngineSchema(schema));
  expect(strictProblems(strict)).toEqual([]);
  return strict;
};
const prop = (schema: Json, name: string) => (schema.properties as Json)[name] as Json;
/** How many times a converted property names null. */
const nulls = (s: Json) => JSON.stringify(s).match(/"null"/g)?.length ?? 0;

const roundTrip = <T extends z.ZodType>(schema: T, answer: unknown) => {
  const output = withoutOptionalNulls(toEngineSchema(schema), answer);
  const parsed = schema.safeParse(output);
  expect(parsed.error).toBeUndefined();
  return output;
};

describe("the strict schema", () => {
  it("closes and fills required on an object inside an array", () => {
    const strict = strictOf(z.object({ drafts: z.array(z.object({ text: z.string(), image: z.string().optional() })) }));
    const items = prop(strict, "drafts").items as Json;
    expect(items.required).toEqual(["text", "image"]);
    expect(items.additionalProperties).toBe(false);
  });

  it("does the same inside anyOf, oneOf and $defs", () => {
    const inner = { type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] };
    const strict = toStrictSchema({
      type: "object",
      properties: { u: { anyOf: [inner, { type: "string" }] }, o: { oneOf: [inner, { type: "number" }] }, r: { $ref: "#/$defs/d" }, l: { $ref: "#/definitions/e" } },
      required: ["u", "o", "r", "l"],
      $defs: { d: inner },
      definitions: { e: inner },
    });
    expect(strictProblems(strict)).toEqual([]);
    expect((strict.$defs as Json).d).toMatchObject({ required: ["a", "b"], additionalProperties: false });
    expect((strict.definitions as Json).e).toMatchObject({ required: ["a", "b"], additionalProperties: false });
    expect((prop(strict, "u").anyOf as Json[])[0]).toMatchObject({ required: ["a", "b"] });
    expect((prop(strict, "o").anyOf as Json[])[0]).toMatchObject({ required: ["a", "b"] });
  });

  it("makes an optional string nullable", () => {
    const strict = strictOf(z.object({ a: z.string().optional() }));
    expect(prop(strict, "a")).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("keeps the values of an optional enum and const", () => {
    const strict = strictOf(z.object({ e: z.enum(["a", "b"]).optional(), c: z.literal("x").optional() }));
    expect(prop(strict, "e")).toEqual({ anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] });
    expect(prop(strict, "c")).toEqual({ anyOf: [{ type: "string", const: "x" }, { type: "null" }] });
  });

  it("does not repeat null on an optional that was already nullable", () => {
    const strict = strictOf(z.object({ a: z.string().nullable().optional(), b: z.enum(["x"]).nullable().optional(), c: z.literal(["x", null]).optional() }));
    expect(nulls(prop(strict, "a"))).toBe(1);
    expect(nulls(prop(strict, "b"))).toBe(1);
    expect(prop(strict, "c")).toEqual({ type: ["string", "null"], enum: ["x", null] });
  });

  it("adds null to an optional union instead of nesting it", () => {
    const strict = strictOf(z.object({ u: z.discriminatedUnion("k", [z.object({ k: z.literal("x") }), z.object({ k: z.literal("y") })]).optional() }));
    const anyOf = prop(strict, "u").anyOf as Json[];
    expect(anyOf).toHaveLength(3);
    expect(anyOf[2]).toEqual({ type: "null" });
  });

  it("does not treat a type with null but an enum without it as nullable", () => {
    const strict = toStrictSchema({ type: "object", properties: { a: { type: ["string", "null"], enum: ["x"] } }, required: [] });
    expect(prop(strict, "a")).toEqual({ anyOf: [{ type: ["string", "null"], enum: ["x"] }, { type: "null" }] });
  });

  it("wraps an optional $ref with nothing next to it", () => {
    const strict = toStrictSchema({ type: "object", properties: { r: { $ref: "#/$defs/d" } }, $defs: { d: { type: "string" } } });
    expect(strictProblems(strict)).toEqual([]);
    expect(prop(strict, "r")).toEqual({ anyOf: [{ $ref: "#/$defs/d" }, { type: "null" }] });
  });

  it("does not add null to a $ref that already accepts it", () => {
    const strict = toStrictSchema({ type: "object", properties: { r: { $ref: "#/$defs/d" } }, $defs: { d: { type: ["string", "null"] } } });
    expect(prop(strict, "r")).toEqual({ $ref: "#/$defs/d" });
  });

  it("removes default and keeps description", () => {
    const strict = strictOf(z.object({ a: z.string().default("x").describe("algo") }));
    expect(prop(strict, "a")).toEqual({ type: "string", description: "algo" });
  });

  it("keeps the description of an optional on the property's schema", () => {
    const strict = strictOf(z.object({ a: z.string().describe("algo").optional(), b: z.object({ c: z.string() }).describe("otro").optional() }));
    expect(prop(strict, "a")).toEqual({ anyOf: [{ type: "string" }, { type: "null" }], description: "algo" });
    expect(prop(strict, "b").description).toBe("otro");
  });

  it("moves a description next to a $ref to a wrapping anyOf", () => {
    const strict = toStrictSchema({ type: "object", properties: { r: { $ref: "#/$defs/d", description: "algo", default: "x" } }, required: ["r"], $defs: { d: { type: "string" } } });
    expect(strictProblems(strict)).toEqual([]);
    expect(prop(strict, "r")).toEqual({ anyOf: [{ $ref: "#/$defs/d" }], description: "algo" });
  });

  it("changes oneOf into anyOf and takes out what strict mode does not admit", () => {
    const strict = strictOf(
      z.object({
        o: z.xor([z.string().min(2).max(9), z.number()]),
        u: z.url(),
        m: z.email(),
        d: z.iso.datetime(),
        r: z.string().regex(/^a/),
        l: z.array(z.string()).meta({ examples: [["a"]] }),
      }),
    );
    const text = JSON.stringify(strict);
    for (const word of ["oneOf", "minLength", "maxLength", "pattern", "examples", '"uri"']) expect(text).not.toContain(word);
    expect(prop(strict, "m").format).toBe("email");
  });

  it("keeps the documented restrictions", () => {
    const strict = strictOf(z.object({ n: z.number().min(1).max(5), l: z.array(z.string()).min(2).max(3) }));
    expect(prop(strict, "n")).toMatchObject({ minimum: 1, maximum: 5 });
    expect(prop(strict, "l")).toMatchObject({ minItems: 2, maxItems: 3 });
  });

  it("does not confuse a property named like a keyword with the keyword", () => {
    const strict = strictOf(z.object({ default: z.string(), pattern: z.string().optional(), title: z.number() }));
    expect(Object.keys(strict.properties as Json)).toEqual(["default", "pattern", "title"]);
  });

  it("accepts a closed object without properties", () => {
    expect(prop(strictOf(z.object({ e: z.object({}) })), "e")).toEqual({ type: "object", properties: {}, required: [], additionalProperties: false });
  });

  it("does not change its input", () => {
    const schema = toEngineSchema(z.object({ a: z.string().default("x"), b: z.array(z.object({ c: z.string().optional() })) }));
    const copy = structuredClone(schema);
    toStrictSchema(schema);
    expect(schema).toEqual(copy);
  });
});

describe("schemas with no strict equivalent", () => {
  const refused = (schema: z.ZodType) => () => toStrictSchema(toEngineSchema(schema));

  it("refuses a dictionary, a free value and an array of free values, naming the path", () => {
    expect(refused(z.object({ m: z.record(z.string(), z.number()) }))).toThrow(/`m`/);
    expect(refused(z.object({ v: z.unknown() }))).toThrow(/`v`/);
    expect(refused(z.object({ a: z.object({ l: z.array(z.any()) }) }))).toThrow(/`a\.l\[\]`/);
  });

  it("refuses a root that is not an object", () => {
    expect(refused(z.array(z.string()))).toThrow(/raíz/);
    expect(refused(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]))).toThrow(/raíz/);
  });

  it("refuses a tuple, allOf and an array without items", () => {
    expect(refused(z.object({ t: z.tuple([z.string(), z.number()]) }))).toThrow(/`t`.*prefixItems/);
    expect(() => toStrictSchema({ type: "object", properties: { x: { allOf: [{ type: "string" }] } }, required: ["x"] })).toThrow(/`x`.*allOf/);
    expect(() => toStrictSchema({ type: "object", properties: { x: { type: "array" } }, required: ["x"] })).toThrow(/`x`.*items/);
  });

  it("refuses an open object without properties and additional properties with a schema", () => {
    expect(() => toStrictSchema({ type: "object", properties: { x: { type: "object" } }, required: ["x"] })).toThrow(/`x`/);
    expect(refused(z.object({ c: z.object({ a: z.string() }).catchall(z.string()) }))).toThrow(/`c`/);
    expect(refused(z.object({ c: z.looseObject({}) }))).toThrow(/`c`/);
  });

  it("refuses a description alone and a reference that leads nowhere", () => {
    expect(() => toStrictSchema({ type: "object", properties: { x: { description: "algo" } }, required: ["x"] })).toThrow(/`x`/);
    expect(() => toStrictSchema({ type: "object", properties: { x: { $ref: "#/$defs/no" } }, required: ["x"] })).toThrow(/`x`/);
    expect(() => toStrictSchema({ type: "object", properties: { x: { $ref: "https://example.com/s.json" } }, required: ["x"] })).toThrow(/`x`/);
  });

  it("names a definition's path", () => {
    expect(() => toStrictSchema({ type: "object", properties: {}, additionalProperties: false, $defs: { d: { type: "object", properties: { a: {} } } } })).toThrow(/`\$defs\.d\.a`/);
  });

  it("takes a loose object with declared properties and closes it", () => {
    const strict = toStrictSchema(toEngineSchema(z.looseObject({ a: z.string() })));
    expect(strict.additionalProperties).toBe(false);
    expect(strictProblems(strict)).toEqual([]);
  });
});

describe("the answer without the nulls of optionals", () => {
  it("takes out an optional's null inside an array and validates", () => {
    const schema = z.object({ drafts: z.array(z.object({ text: z.string(), image: z.string().optional() })) });
    expect(roundTrip(schema, { drafts: [{ text: "a", image: null }, { text: "b", image: "i.png" }] })).toEqual({ drafts: [{ text: "a" }, { text: "b", image: "i.png" }] });
  });

  it("keeps the null of a required nullable", () => {
    const schema = z.object({ a: z.string().nullable(), b: z.string().nullable().default(null) });
    expect(roundTrip(schema, { a: null, b: null })).toEqual({ a: null, b: null });
  });

  it("chooses the first branch the value fits", () => {
    const schema = z.object({ u: z.discriminatedUnion("k", [z.object({ k: z.literal("x") }), z.object({ k: z.literal("y"), v: z.number().optional() })]) });
    expect(roundTrip(schema, { u: { k: "y", v: null } })).toEqual({ u: { k: "y" } });
    const plain = z.union([z.object({ k: z.literal("x") }), z.object({ k: z.literal("y"), v: z.number().optional() })]);
    expect(withoutOptionalNulls(toEngineSchema(z.object({ u: plain })), { u: { k: "y", v: 3 } })).toEqual({ u: { k: "y", v: 3 } });
  });

  it("leaves a value no branch fits as it is", () => {
    const schema = { type: "object", properties: { u: { anyOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "number" }] } }, required: ["u"] };
    expect(withoutOptionalNulls(schema, { u: { a: null, b: 1 } })).toEqual({ u: { a: null, b: 1 } });
  });

  it("follows recursive references to the root and to $defs", () => {
    type Node = { v?: string; next?: Node; kids: Node[] };
    const Tree: z.ZodType<Node> = z.object({ v: z.string().optional(), next: z.lazy(() => Tree).optional(), kids: z.array(z.lazy(() => Tree)) });
    const strict = toStrictSchema(toEngineSchema(Tree));
    expect(strictProblems(strict)).toEqual([]);
    const leaf = { v: null, next: null, kids: [] };
    expect(roundTrip(Tree, { v: null, next: { v: "a", next: leaf, kids: [leaf] }, kids: [leaf] })).toEqual({ next: { v: "a", next: { kids: [] }, kids: [{ kids: [] }] }, kids: [{ kids: [] }] });

    const inDefs = { type: "object", properties: { n: { $ref: "#/$defs/n" } }, required: ["n"], $defs: { n: { type: "object", properties: { v: { type: "string" }, c: { $ref: "#/$defs/n" } } } } };
    expect(withoutOptionalNulls(inDefs, { n: { v: null, c: { v: null, c: null } } })).toEqual({ n: { c: {} } });
  });

  it("does not hang on a reference that leads back to itself", () => {
    const schema = { type: "object", properties: { a: { $ref: "#/$defs/a" } }, $defs: { a: { $ref: "#/$defs/a" } } };
    expect(toStrictSchema(schema)).toBeDefined();
    expect(withoutOptionalNulls(schema, { a: 1 })).toEqual({ a: 1 });
  });

  it("keeps present values, unknown keys and the prototype", () => {
    const schema = { type: "object", properties: { a: { type: "number" }, f: { type: "boolean" }, s: { type: "string" } } };
    expect(withoutOptionalNulls(schema, { a: 0, f: false, s: "", other: null })).toEqual({ a: 0, f: false, s: "", other: null });
    const parsed = JSON.parse('{"__proto__":{"x":null},"constructor":null}');
    const out = withoutOptionalNulls(schema, parsed) as Json;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out, "constructor")).toBe(true);
  });

  it("does not change its input", () => {
    const answer = { drafts: [{ image: null }] };
    withoutOptionalNulls(toEngineSchema(z.object({ drafts: z.array(z.object({ image: z.string().optional() })) })), answer);
    expect(answer).toEqual({ drafts: [{ image: null }] });
  });
});

describe("the stations' real schemas", () => {
  it("scout", () => {
    const strict = strictOf(ScoutOutput);
    const text = JSON.stringify(strict);
    expect(text).not.toContain('"default"');
    expect(text).not.toContain("minLength");
    const proposal = { title: "t", why: "w", change: "c", estimatedUsd: 1, paths: ["a"], needsNewCredentials: false, researchNote: null, thirdParty: false, commercial: false, issue: null };
    expect(roundTrip(ScoutOutput, { proposals: [proposal] })).toEqual({ proposals: [proposal] });
  });

  it("review", () => {
    const strict = strictOf(ReviewSchema);
    expect(prop(strict, "findings").description).toBe("Concrete defects. Empty when there are none.");
    expect((prop(strict, "findings").items as { properties: Record<string, Json> }).properties.confidence!.description).toContain("How sure you are");
    const answer = {
      summary: "s",
      findings: [{ severity: "high", file: "a.ts", line: 1, problem: "p", fix: "f", confidence: 9 }],
      learnings: [{ kind: "finding", topic: "t", body: "b", source: "" }],
    };
    expect(roundTrip(ReviewSchema, answer)).toEqual(answer);
  });

  it("research", () => {
    strictOf(ResearchOutput);
    const answer = { notes: [{ topic: "t", findings: "f", sources: ["https://a"], serves: "s", maturity: "m" }] };
    expect(roundTrip(ResearchOutput, answer)).toEqual(answer);
  });

  it("spec and reply", () => {
    strictOf(SpecSchema);
    strictOf(ReplySchema);
    const reply = { action: "answer", reply: "r", request: "" };
    expect(roundTrip(ReplySchema, reply)).toEqual(reply);
  });
});

/** What the fake codex's `login status` makes the engine report. */
const SUBSCRIPTION = { billing: "subscription", windows: [] };

describe("codexEngine.run", () => {
  const dir = mkdtempSync(join(tmpdir(), "zero-codex-test-"));
  const seen = join(dir, "seen.json").replaceAll("\\", "/");
  const ran = join(dir, "ran").replaceAll("\\", "/");
  const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({ instructions: "i", prompt: "p", cwd: process.cwd(), access: "read", timeoutMs: 30_000, ...over });
  /** A fake codex that keeps a copy of its schema file and its arguments, then answers `message`. */
  const answers = (message: string) => `
    const fs = require("node:fs");
    const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
    // After the call the engine asks \`codex login status\`; only the exec call is recorded.
    if (!process.argv.includes("exec")) { console.log("Logged in using ChatGPT"); process.exit(0); }
    fs.writeFileSync(${JSON.stringify(ran)}, "x");
    const args = process.argv.slice(2);
    fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args, schema: args.includes("--output-schema") ? JSON.parse(fs.readFileSync(arg("--output-schema"), "utf8")) : null }));
    fs.writeFileSync(arg("--output-last-message"), ${JSON.stringify(message)});
  `;
  const received = () => JSON.parse(readFileSync(seen, "utf8")) as { args: string[]; schema: Json | null };
  const Drafts = z.object({ drafts: z.array(z.object({ text: z.string(), image: z.string().optional() })) });

  beforeEach(() => {
    fake.script = "";
    rmSync(seen, { force: true });
    rmSync(ran, { force: true });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the strict schema and hands back the answer without the optionals' nulls", async () => {
    const message = '{"drafts":[{"text":"a","image":null}]}';
    fake.script = answers(message);
    const schema = toEngineSchema(Drafts);
    const copy = structuredClone(schema);
    const result = await codexEngine.run(req({ schema }));
    expect(received().schema).toEqual(toStrictSchema(schema));
    expect(strictProblems(received().schema!)).toEqual([]);
    expect(result).toEqual({ ok: true, text: message, output: { drafts: [{ text: "a" }] }, quota: SUBSCRIPTION });
    expect(Drafts.safeParse(result.output).success).toBe(true);
    expect(schema).toEqual(copy);
  });

  it("gives a scout proposal back with its legitimate nulls", async () => {
    const proposal = { title: "t", why: "w", change: "c", estimatedUsd: 1, paths: [], needsNewCredentials: false, researchNote: null, thirdParty: false, commercial: false, issue: null };
    fake.script = answers(JSON.stringify({ proposals: [proposal] }));
    const result = await codexEngine.run(req({ schema: toEngineSchema(ScoutOutput) }));
    expect(result.output).toEqual({ proposals: [proposal] });
    expect(ScoutOutput.safeParse(result.output).success).toBe(true);
  });

  it("gives review and research answers that validate", async () => {
    const review = { summary: "s", findings: [{ severity: "low", file: "a", line: 1, problem: "p", fix: "f", confidence: 1 }], learnings: [] };
    fake.script = answers(JSON.stringify(review));
    expect(ReviewSchema.safeParse((await codexEngine.run(req({ schema: toEngineSchema(ReviewSchema) }))).output).success).toBe(true);
    fake.script = answers(JSON.stringify({ notes: [] }));
    expect(ResearchOutput.safeParse((await codexEngine.run(req({ schema: toEngineSchema(ResearchOutput) }))).output).success).toBe(true);
  });

  it("returns an answer that is not JSON as text, without output", async () => {
    fake.script = answers("no pude");
    expect(await codexEngine.run(req({ schema: toEngineSchema(Drafts) }))).toEqual({ ok: true, text: "no pude", quota: SUBSCRIPTION });
  });

  it("leaves the text alone without a schema", async () => {
    const message = '{"image":null}';
    fake.script = answers(message);
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: message, quota: SUBSCRIPTION });
    expect(received().args).not.toContain("--output-schema");
    expect(received().schema).toBeNull();
  });

  it("does not start codex with a schema that has no strict form", async () => {
    fake.script = answers("{}");
    const dictionary = await codexEngine.run(req({ schema: toEngineSchema(z.object({ m: z.record(z.string(), z.number()) })) }));
    expect(dictionary.ok).toBe(false);
    expect(dictionary.text).toContain("`m`");
    const free = await codexEngine.run(req({ schema: toEngineSchema(z.object({ libre: z.unknown() })) }));
    expect(free.ok).toBe(false);
    expect(free.text).toContain("`libre`");
    for (const root of [z.array(z.string()), z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])]) {
      expect((await codexEngine.run(req({ schema: toEngineSchema(root) }))).ok).toBe(false);
    }
    expect(existsSync(ran)).toBe(false);
  });

  it("keeps a failed exit as a failure", async () => {
    fake.script = 'process.stderr.write("roto"); process.exitCode = 2;';
    expect(await codexEngine.run(req({ schema: toEngineSchema(Drafts) }))).toEqual({ ok: false, text: "codex exited with 2: roto" });
  });
});

describe("other engines", () => {
  afterEach(cleanup);
  const schema = z.object({ text: z.string(), image: z.string().optional() });

  it("the prompt of an engine without a native schema carries the original schema", async () => {
    const ctx = testFactory({ engine: "antigravity", lines: [] });
    const prompts: EngineRequest[] = [];
    const execute: EngineExecute = async (engine, r) => {
      expect(engine.name).toBe(antigravityEngine.name);
      prompts.push(r);
      return { ok: true, text: '{"text":"a"}' };
    };
    const run = await createAgentRunner(ctx.config, { execute })({ station: "review", prompt: "p", cwd: tempDir(), schema });
    expect(prompts[0]!.prompt).toContain(JSON.stringify(toEngineSchema(schema)));
    expect((prompts[0]!.schema as { required: string[] }).required).toEqual(["text"]);
    expect(run.ok).toBe(true);
  });

  it("the runner hands codex the original schema: only its engine converts it", async () => {
    const ctx = testFactory({ engine: "codex", lines: [] });
    const seen: EngineRequest[] = [];
    const execute: EngineExecute = async (_, r) => (seen.push(r), { ok: true, text: '{"text":"a"}' });
    await createAgentRunner(ctx.config, { execute })({ station: "review", prompt: "p", cwd: tempDir(), schema });
    expect(seen[0]!.schema).toEqual(toEngineSchema(schema));
  });
});
