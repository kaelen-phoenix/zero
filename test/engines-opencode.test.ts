import { describe, expect, it, vi } from "vitest";
import { engineCredentials } from "../src/box/credentials.js";
import { parseFactory } from "../src/config.js";
import { opencodeEngine, opencodeInvocation, opencodeModel } from "../src/engines/cli.js";
import { resolveEngine, type EngineRequest } from "../src/engines/index.js";
import type { SecretStore } from "../src/keychain.js";

// spawn runs without a shell: `opencode` is redirected to a real node process, by its name
// alone, since where it is installed zero starts it by its full path.
const fake = vi.hoisted(() => ({ script: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (bin: string, args: string[], options: object) =>
      /(^|[\\/])opencode(\.(com|exe))?$/i.test(bin) ? real.spawn(process.execPath, ["-e", fake.script, "--", ...args], options) : real.spawn(bin, args, options),
  };
});

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({
  instructions: "You are the coder.",
  prompt: "Fix bug",
  cwd: process.cwd(),
  access: "read",
  timeoutMs: 30_000,
  ...over,
});

const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n");
const printing = (stdout: string, extra = "") => `process.stdout.write(${JSON.stringify(stdout)}); ${extra}`;
const text = (t: string) => ({ type: "text", part: { type: "text", text: t } });
const stepStart = { type: "step_start", part: { type: "step-start" } };
const stepFinish = (cost: number) => ({ type: "step_finish", part: { type: "step-finish", cost } });

describe("opencode invocation", () => {
  it("runs `opencode run --format json` with the model and the full prompt", () => {
    const inv = opencodeInvocation(req({ model: "anthropic/claude-sonnet-4" }));
    expect(inv.bin).toBe("opencode");
    expect(inv.args[0]).toBe("run");
    expect(inv.args.join(" ")).toContain("--format json");
    expect(inv.args.join(" ")).toContain("--model anthropic/claude-sonnet-4");
    expect(inv.args).toContain("You are the coder.\n\n---\n\nFix bug");
    expect(inv.stdin).toBeUndefined();
  });

  it("sends a long prompt on stdin and only a short instruction as the argument", () => {
    const long = "x".repeat(30_001);
    const inv = opencodeInvocation(req({ prompt: long }));
    expect(inv.stdin).toContain(long);
    expect(inv.args.some((a) => a.includes(long))).toBe(false);
    expect(inv.args.at(-1)).toMatch(/stdin/);
  });

  it("is a known engine name, guarded by zero", () => {
    const config = parseFactory("engine: opencode\nfallback: [opencode]\n");
    const engine = resolveEngine("opencode", config);
    expect(engine.name).toBe("opencode");
    expect(engine.unsandboxed).toBe(true);
    expect(engine.nativeSchema).toBe(false);
  });

  it("cannot work inside the box yet", () => {
    const secrets = { has: () => true } as unknown as SecretStore;
    const r = engineCredentials("opencode", parseFactory(""), secrets);
    expect(r.names).toEqual([]);
    expect(r.problem).toMatch(/opencode.*caja/);
  });
});

describe("opencode run", () => {
  it("answers with the last step's text and the sum of the steps' costs", async () => {
    fake.script = printing(lines(stepStart, text("hola"), stepFinish(0.01), stepStart, text("lis"), text("to"), stepFinish(0.02)) + "\nnot json\n");
    const r = await opencodeEngine.run(req());
    expect(r.ok).toBe(true);
    expect(r.text).toBe("listo");
    expect(r.costUsd).toBeCloseTo(0.03);
    expect(r.quota).toBeUndefined();
  });

  it("reports the model that answered", async () => {
    fake.script = printing(lines(stepStart, { type: "text", part: { text: "ok", providerID: "anthropic", modelID: "claude-sonnet-4" } }));
    const r = await opencodeEngine.run(req());
    expect(r.model).toBe("anthropic/claude-sonnet-4");
    expect(opencodeModel(lines({ a: { b: { providerID: "x", modelID: "y" } } }, { providerID: "p", modelID: "m" }))).toBe("p/m");
  });

  it("fails when it exits 0 without answer text", async () => {
    fake.script = printing(lines(stepFinish(0)), `process.stderr.write("boom");`);
    expect(await opencodeEngine.run(req())).toMatchObject({ ok: false, text: "opencode devolvió salida vacía: boom" });
  });

  it("explains a failed exit with the last error event when stderr is empty", async () => {
    fake.script = printing(lines({ type: "error", error: { name: "ProviderInitError", data: { message: "no provider" } } }), "process.exitCode = 1;");
    const r = await opencodeEngine.run(req());
    expect(r.ok).toBe(false);
    expect(r.text).toContain("opencode exited with 1");
    expect(r.text).toContain("no provider");
  });

  const echoConfig = `process.stdout.write(JSON.stringify({ type: "text", part: { text: process.env.OPENCODE_CONFIG_CONTENT + "|" + (process.env.KEEP ?? "") } }));`;

  it("denies editing, commands and the web on read access, keeping the request's env", async () => {
    fake.script = echoConfig;
    const r = await opencodeEngine.run(req({ env: { KEEP: "yes" } }));
    const [config, keep] = r.text.split("|");
    expect(JSON.parse(config!).permission).toEqual({ edit: "deny", bash: "deny", webfetch: "deny" });
    expect(keep).toBe("yes");
    const web = await opencodeEngine.run(req({ access: "web" }));
    expect(JSON.parse(web.text.split("|")[0]!).permission).toEqual({ edit: "deny", bash: "deny", webfetch: "deny" });
  });

  it("allows editing and commands on write access, never the web", async () => {
    fake.script = echoConfig;
    const r = await opencodeEngine.run(req({ access: "write" }));
    expect(JSON.parse(r.text.split("|")[0]!).permission).toEqual({ edit: "allow", bash: "allow", webfetch: "deny" });
  });

  it("reads a long prompt from stdin", async () => {
    fake.script = `let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ type: "text", part: { text: String(s.length) } })));`;
    const r = await opencodeEngine.run(req({ prompt: "x".repeat(31_000) }));
    expect(Number(r.text)).toBeGreaterThan(31_000);
  });
});
