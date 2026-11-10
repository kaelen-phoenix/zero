import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quotaAttrs } from "../src/agent.js";
import { budgetState } from "../src/budget.js";
import { parseFactory } from "../src/config.js";
import { antigravityEngine, codexEngine, customEngine } from "../src/engines/cli.js";
import type { EngineRequest } from "../src/engines/index.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { Tracer } from "../src/telemetry/tracer.js";
import { cleanup, testStore } from "./helpers.js";

// spawn runs without a shell, so a fake `.cmd` on PATH would not start on Windows:
// the built-in engines' binaries are redirected to a real node process instead.
// `codex login status` has its own script: the others would write to `last`, which it does not pass.
const LOGIN_FAILS = "process.exitCode = 1";
const fake = vi.hoisted(() => ({ script: "", login: "", logins: 0, loginMissing: false }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    // By their name alone: where those programs are installed, zero starts them by their full path.
    spawn: (bin: string, args: string[], options: object) => {
      const name = /(^|[\\/])(agy|codex)(\.(com|exe))?$/i.exec(bin)?.[2]?.toLowerCase();
      if (name === "codex" && args[0] === "login") {
        fake.logins++;
        return fake.loginMissing ? real.spawn("zero-no-such-program", args, options) : real.spawn(process.execPath, ["-e", fake.login, "--", ...args], options);
      }
      return name
        ? real.spawn(process.execPath, ["-e", fake.script, "--", ...args], options)
        : real.spawn(bin, args, options);
    },
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

const custom = (name: string, script: string) =>
  customEngine(name, { command: [process.execPath, "-e", script], readArgs: [], writeArgs: [], modelArgs: [], secrets: [], hosts: [] });

/** A fake codex body that can reach the path given after --output-last-message as `last`. */
const codexScript = (body: string) => `
  const fs = require("node:fs");
  const last = process.argv[process.argv.indexOf("--output-last-message") + 1];
  ${body}
`;

/** A fake codex that answers `listo` and prints these events. */
const answering = (...events: unknown[]) => codexScript(`fs.writeFileSync(last, "listo"); process.stdout.write(${JSON.stringify(events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n"))});`);
/** The same fake, failing with the exit code and only events on stdout. */
const failing = (code: number, ...events: unknown[]) => `${answering(...events)} process.exitCode = ${code};`;

const CHATGPT = `process.stderr.write("Logged in using ChatGPT\\n")`;

beforeEach(() => {
  fake.script = "";
  fake.login = LOGIN_FAILS;
  fake.logins = 0;
  fake.loginMissing = false;
  // What the machine has must not decide the billing.
  vi.stubEnv("CODEX_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("engines that answer on stdout", () => {
  it("antigravity without output is a failure", async () => {
    expect(await antigravityEngine.run(req())).toEqual({ ok: false, text: "antigravity devolvió salida vacía" });
  });

  it("a custom engine without output is a failure", async () => {
    expect(await custom("mudo", "").run(req())).toEqual({ ok: false, text: "mudo devolvió salida vacía" });
  });

  it("only whitespace on stdout counts as empty", async () => {
    const result = await custom("mudo", 'process.stdout.write("  \\n\\t\\n")').run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("mudo devolvió salida vacía")).toBe(true);
  });

  it("an empty JSON envelope counts as empty", async () => {
    const result = await custom("mudo", `process.stdout.write('{"result":" "}')`).run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("mudo devolvió salida vacía")).toBe(true);
    fake.script = `process.stdout.write('{"result":" "}')`;
    const agy = await antigravityEngine.run(req());
    expect(agy.ok).toBe(false);
    expect(agy.text.startsWith("antigravity devolvió salida vacía")).toBe(true);
  });

  it("a normal answer does not change", async () => {
    expect(await custom("mudo", `process.stdout.write('{"response":"hola"}')`).run(req())).toEqual({ ok: true, text: "hola" });
    fake.script = `process.stdout.write('{"response":"hola"}')`;
    expect(await antigravityEngine.run(req())).toEqual({ ok: true, text: "hola" });
  });

  it("an envelope without text keys is still the raw JSON", async () => {
    expect(await custom("mudo", `process.stdout.write('{"foo":1}')`).run(req())).toEqual({ ok: true, text: '{"foo":1}' });
  });
});

describe("the end of stderr in the error", () => {
  it("is added after the message", async () => {
    expect(await custom("mudo", 'process.stderr.write("sin TTY\\n")').run(req())).toEqual({ ok: false, text: "mudo devolvió salida vacía: sin TTY" });
  });

  it("keeps only the last 2000 characters", async () => {
    const result = await custom("mudo", 'process.stderr.write("a".repeat(1000) + "b".repeat(2000))').run(req());
    expect(result.ok).toBe(false);
    expect(result.text).toBe(`mudo devolvió salida vacía: ${"b".repeat(2000)}`);
    expect(result.text).not.toContain("a".repeat(2));
  });

  it("is left out when it has only whitespace", async () => {
    expect(await custom("mudo", 'process.stderr.write("  \\n\\n")').run(req())).toEqual({ ok: false, text: "mudo devolvió salida vacía" });
  });
});

describe("codex", () => {
  it("fails with an empty last message", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "");');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía" });
  });

  it("fails with a last message of only whitespace", async () => {
    fake.script = codexScript('fs.writeFileSync(last, " \\n");');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía" });
  });

  it("adds stderr to the error", async () => {
    fake.script = codexScript('fs.writeFileSync(last, ""); process.stderr.write("sin sesión");');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía: sin sesión" });
  });

  it("fails with an empty last message even if stdout has text", async () => {
    fake.script = codexScript('fs.writeFileSync(last, ""); process.stdout.write("progreso");');
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("codex devolvió salida vacía")).toBe(true);
    expect(result.text).not.toContain("progreso");
  });

  it("answers from the file with an empty stdout", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "listo\\n");');
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo" });
  });

  it("fails without a file and without stdout", async () => {
    fake.script = codexScript("");
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex devolvió salida vacía" });
  });

  it("falls back to stdout without a file", async () => {
    fake.script = codexScript('process.stdout.write("hola");');
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "hola" });
  });

  it("keeps the message of a failed exit whatever the file says", async () => {
    fake.script = codexScript('fs.writeFileSync(last, "listo"); process.stderr.write("roto"); process.exitCode = 3;');
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex exited with 3: roto" });
  });
});

describe("codex with --json on stdout, without the last-message file", () => {
  const printing = (...events: unknown[]) => codexScript(`process.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join("\r\n"))});`);

  it("answers with the last agent message", async () => {
    fake.script = printing(
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "primero" } },
      { type: "item.completed", item: { type: "command_execution", text: "no" } },
      { type: "item.completed", item: { type: "agent_message", text: "hola" } },
    );
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "hola" });
  });

  it("never answers with raw events", async () => {
    fake.script = printing({ type: "turn.started" });
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(false);
    expect(result.text.startsWith("codex devolvió salida vacía")).toBe(true);
    expect(result.text).not.toContain("turn.started");
  });
});

describe("codex failures told by events", () => {
  it("uses the message of an error event", async () => {
    fake.script = failing(1, { type: "error", message: "sin permiso" });
    expect((await codexEngine.run(req())).text).toBe("codex exited with 1: sin permiso");
  });

  it("uses the message of a failed turn", async () => {
    fake.script = failing(1, { type: "turn.started" }, { type: "turn.failed", error: { message: "sin permiso" } });
    expect((await codexEngine.run(req())).text).toBe("codex exited with 1: sin permiso");
  });

  it("takes the last one", async () => {
    fake.script = failing(1, { type: "error", message: "antes" }, { type: "turn.failed", error: { message: "después" } }, { type: "turn.started" });
    expect((await codexEngine.run(req())).text).toBe("codex exited with 1: después");
  });

  it("prefers stderr", async () => {
    fake.script = `${failing(3, { type: "error", message: "sin permiso" })} process.stderr.write("roto");`;
    expect((await codexEngine.run(req())).text).toBe("codex exited with 3: roto");
  });
});

describe("codex billing", () => {
  it("a ChatGPT session is a subscription, on stderr or stdout", async () => {
    fake.script = answering();
    fake.login = CHATGPT;
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo", quota: { billing: "subscription", windows: [] } });
    fake.login = `process.stdout.write("Logged in using ChatGPT\\n")`;
    expect((await codexEngine.run(req())).quota?.billing).toBe("subscription");
  });

  it("a key in the call's environment is pay-per-use, without asking for the session", async () => {
    fake.script = answering();
    fake.login = CHATGPT;
    for (const key of ["CODEX_API_KEY", "OPENAI_API_KEY"]) {
      expect((await codexEngine.run(req({ env: { [key]: "k" } }))).quota).toEqual({ billing: "api", windows: [] });
    }
    expect(fake.logins).toBe(0);
  });

  it("OPENAI_API_KEY in the process is pay-per-use", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    fake.script = answering();
    fake.login = CHATGPT;
    expect((await codexEngine.run(req())).quota?.billing).toBe("api");
    expect(fake.logins).toBe(0);
  });

  it("empty keys do not count", async () => {
    fake.script = answering();
    fake.login = CHATGPT;
    expect((await codexEngine.run(req({ env: { CODEX_API_KEY: "", OPENAI_API_KEY: "" } }))).quota?.billing).toBe("subscription");
    expect(fake.logins).toBe(1);
  });

  it("an API key kept by the session is pay-per-use", async () => {
    fake.script = answering();
    fake.login = `process.stdout.write("Logged in using an API key - sk-***\\n")`;
    expect((await codexEngine.run(req())).quota).toEqual({ billing: "api", windows: [] });
  });

  it("asks from outside the work copy", async () => {
    fake.script = answering();
    fake.login = `process.stdout.write("Logged in using ChatGPT"); if (process.cwd() === ${JSON.stringify(process.cwd())}) process.exitCode = 1;`;
    expect((await codexEngine.run(req())).quota?.billing).toBe("subscription");
  });
});

describe("a session query that fails stays out of the way", () => {
  it("without a session", async () => {
    fake.script = answering();
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo" });
  });

  it("with output it does not recognize", async () => {
    fake.script = answering();
    fake.login = `process.stdout.write("Not logged in, use ChatGPT")`;
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo" });
  });

  it("when it hangs", async () => {
    fake.script = answering();
    fake.login = "setTimeout(() => {}, 60000)";
    const start = Date.now();
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo" });
    expect(Date.now() - start).toBeLessThan(15_000);
  }, 20_000);

  it("when the program cannot start", async () => {
    fake.script = answering();
    fake.loginMissing = true;
    expect(await codexEngine.run(req())).toEqual({ ok: true, text: "listo" });
    expect(fake.logins).toBe(1);
  });

  it("a failed call keeps its message", async () => {
    fake.script = failing(1, { type: "error", message: "sin permiso" });
    expect(await codexEngine.run(req())).toEqual({ ok: false, text: "codex exited with 1: sin permiso" });
  });
});

describe("codex usage windows", () => {
  const limits = (primary: unknown, secondary?: unknown) => ({ type: "token_count", rate_limits: { primary, secondary } });
  const window = (used_percent: number, over: object = {}) => ({ used_percent, window_minutes: 300, resets_at: 1790000000, ...over });

  beforeEach(() => {
    fake.login = CHATGPT;
  });

  it("turns primary and secondary into windows", async () => {
    fake.script = answering(limits({ used_percent: 25, window_minutes: 300, resets_at: 1790000000 }, { used_percent: 100, window_minutes: 10080, resets_in_seconds: 3600 }));
    const before = Date.now();
    const { quota } = await codexEngine.run(req());
    const after = Date.now();
    expect(quota?.billing).toBe("subscription");
    expect(quota?.windows[0]).toEqual({ name: "primary", label: "5 horas", utilization: 0.25, status: "ok", resetsAt: new Date(1790000000_000).toISOString() });
    expect(quota?.windows[1]).toMatchObject({ name: "secondary", label: "semana", utilization: 1, status: "exhausted" });
    const reset = Date.parse(quota!.windows[1]!.resetsAt!);
    expect(reset).toBeGreaterThanOrEqual(before + 3_600_000 - 1000);
    expect(reset).toBeLessThanOrEqual(after + 3_600_000);
  });

  it("the last valid reading wins", async () => {
    fake.script = answering(limits(window(10)), limits(window(60)), { type: "token_count", rate_limits: null }, "esto no es JSON", limits({ used_percent: "mucho" }));
    expect((await codexEngine.run(req())).quota?.windows).toMatchObject([{ name: "primary", utilization: 0.6 }]);
  });

  it("reads it nested in the event", async () => {
    fake.script = answering({ type: "event_msg", payload: limits(window(25)) });
    expect((await codexEngine.run(req())).quota?.windows).toMatchObject([{ name: "primary", label: "5 horas", utilization: 0.25, status: "ok" }]);
  });

  it("a window with invalid data is left out", async () => {
    fake.script = answering(limits({ window_minutes: 300 }, window(40)));
    expect((await codexEngine.run(req())).quota?.windows).toMatchObject([{ name: "secondary", utilization: 0.4 }]);
  });

  it("caps utilization at 1 and ignores an impossible reset", async () => {
    fake.script = answering(limits({ used_percent: 130, resets_at: 1e300 }));
    const w = (await codexEngine.run(req())).quota!.windows[0]!;
    expect(w).toMatchObject({ utilization: 1, status: "exhausted" });
    expect(w.resetsAt).toBeUndefined();
  });

  it.each([
    [{ window_minutes: 120 }, "2 horas"],
    [{ window_minutes: 60 }, "1 hora"],
    [{ window_minutes: 45 }, "45 minutos"],
    [{ window_minutes: undefined }, "primary"],
  ])("labels %j", async (over, label) => {
    fake.script = answering(limits(window(10, over)));
    expect((await codexEngine.run(req())).quota?.windows[0]?.label).toBe(label);
  });

  it("pay-per-use has no windows", async () => {
    fake.script = answering(limits(window(25)));
    expect((await codexEngine.run(req({ env: { CODEX_API_KEY: "k" } }))).quota).toEqual({ billing: "api", windows: [] });
    fake.login = `process.stdout.write("Logged in using an API key")`;
    expect((await codexEngine.run(req())).quota).toEqual({ billing: "api", windows: [] });
  });

  it("windows without a word on the session are a subscription", async () => {
    fake.login = LOGIN_FAILS;
    fake.script = answering(limits(window(25)));
    expect((await codexEngine.run(req())).quota).toMatchObject({ billing: "subscription", windows: [{ name: "primary", utilization: 0.25 }] });
  });
});

describe("the budget pauses codex on its plan", () => {
  const config = parseFactory("engine: codex\nlimits: { reservePercent: 20 }\nlines: []\n");
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const reading = (used_percent: number) => ({ type: "token_count", rate_limits: { primary: { used_percent, window_minutes: 300, resets_at: reset } } });

  afterEach(cleanup);

  async function budgetAfter(used: number) {
    fake.login = CHATGPT;
    fake.script = answering(reading(used));
    const { quota } = await codexEngine.run(req());
    const store = testStore();
    new Tracer(store).start(AGENT_SPAN, { attrs: { "zero.engine": "codex" } }).end("ok", quotaAttrs(quota));
    return budgetState(store, config).engines.find((e) => e.engine === "codex");
  }

  it("at the reserve", async () => {
    expect(await budgetAfter(85)).toMatchObject({ paused: true, billing: "subscription", until: new Date(reset * 1000).toISOString() });
  });

  it("below the reserve", async () => {
    expect(await budgetAfter(50)).toMatchObject({ paused: false, billing: "subscription" });
  });

  it("a refused call carries limited", async () => {
    fake.login = CHATGPT;
    fake.script = failing(1, reading(100));
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(false);
    expect(result.quota).toMatchObject({ limited: true, windows: [{ status: "exhausted" }] });
  });

  it("a failure with quota left does not", async () => {
    fake.login = CHATGPT;
    fake.script = failing(1, reading(40));
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(false);
    expect(result.quota?.windows).toMatchObject([{ utilization: 0.4 }]);
    expect(result.quota?.limited).toBeUndefined();
  });

  it("an answered call with a window used up was not refused", async () => {
    fake.login = CHATGPT;
    fake.script = answering(reading(100));
    const result = await codexEngine.run(req());
    expect(result.ok).toBe(true);
    expect(result.quota?.limited).toBeUndefined();
  });

  it("a cancelled call asks nothing", async () => {
    fake.login = CHATGPT;
    fake.script = "setTimeout(() => {}, 60000)";
    const controller = new AbortController();
    setTimeout(() => controller.abort("andon"), 200);
    expect(await codexEngine.run(req({ timeoutMs: 60_000, signal: controller.signal }))).toEqual({ ok: false, text: "codex cancelled" });
    expect(fake.logins).toBe(0);
  });
});

describe("other failures keep their message", () => {
  it("a non-zero exit without output", async () => {
    const result = await custom("mudo", "process.exitCode = 3").run(req());
    expect(result).toEqual({ ok: false, text: "mudo exited with 3: " });
  });

  it("a cancelled run", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("andon"), 200);
    const result = await custom("sleeper", "setTimeout(() => {}, 60000)").run(req({ timeoutMs: 60_000, signal: controller.signal }));
    expect(result).toEqual({ ok: false, text: "sleeper cancelled" });
  });

  it("a run out of time", async () => {
    const result = await custom("sleeper", "setTimeout(() => {}, 60000)").run(req({ timeoutMs: 300 }));
    expect(result).toEqual({ ok: false, text: `sleeper timed out after ${300 / 60_000} min` });
  });
});
