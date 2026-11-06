import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFactory } from "../src/config.js";
import { factoryHome } from "../src/home.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { runSetup, type SetupDeps } from "../src/setup.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

const KEY = "sk-ingresada-1234567890";
const TOKEN = "oauth-pegado-1234567890";
const GH = "ghp-token-de-prueba-123456";

interface Script {
  /** Answers to the ordinary questions, in order. */
  answers: string[];
  secrets?: string[];
  confirms?: boolean[];
  missing?: string[];
  box?: boolean;
  env?: NodeJS.ProcessEnv;
  store?: SecretStore;
  interactive?: boolean;
  file?: string;
}

function wizard(script: Script) {
  const home = factoryHome(tempDir("zero-home-"));
  if (script.file !== undefined) {
    mkdirSync(home.root, { recursive: true });
    writeFileSync(home.config, script.file);
  }
  const said: string[] = [];
  const commands: string[][] = [];
  const answers = [...script.answers];
  const typed = [...(script.secrets ?? [])];
  const confirms = [...(script.confirms ?? [])];
  const env = script.env ?? { ZERO_CONTAINER: "1" };
  const secrets = script.store ?? new SecretStore(home, memoryKeyring(), env);
  const deps: SetupDeps = {
    interactive: script.interactive ?? true,
    ask: async (q) => {
      if (!answers.length) throw new Error(`sin respuesta para: ${q}`);
      return answers.shift()!;
    },
    askSecret: async (label) => {
      if (!typed.length) throw new Error(`sin secreto para: ${label}`);
      return typed.shift()!;
    },
    confirm: async (q) => {
      if (!confirms.length) throw new Error(`sin confirmación para: ${q}`);
      return confirms.shift()!;
    },
    say: (t) => void said.push(t),
    runInteractive: async (bin, args) => {
      commands.push([bin, ...args]);
      return 0;
    },
    isAvailable: (bin) => !(script.missing ?? []).includes(bin),
    boxResponds: () => script.box ?? true,
    secrets,
    cwd: tempDir("zero-cwd-"),
    env,
  };
  return {
    home,
    said,
    commands,
    secrets,
    left: () => ({ answers, typed, confirms }),
    run: () => runSetup(home, deps),
    file: () => readFileSync(home.config, "utf8"),
    config: () => parseFactory(readFileSync(home.config, "utf8")),
    text: () => said.join("\n"),
  };
}

// In a container: isolation first, then mode, engines, limits, panel port and GitHub.
const CAJA = "caja";
const PORT = "";
const NO_GH = "ninguno";

describe("zero setup: engines", () => {
  it("both: subscription first, API key as the replacement", async () => {
    const w = wizard({ answers: [CAJA, "ambas", "claude", "codex", "", "", "", PORT, NO_GH], secrets: [TOKEN, KEY], confirms: [true] });
    await w.run();
    expect(w.config().engine).toBe("claude");
    expect(w.config().fallback).toEqual(["codex"]);
  });

  it("both with the same engine: explains, asks again and does not write it", async () => {
    const w = wizard({ answers: [CAJA, "ambas", "claude", "claude", "codex", "", "", "", PORT, NO_GH], secrets: [TOKEN, KEY], confirms: [true] });
    await w.run();
    expect(w.text()).toMatch(/motores distintos/);
    expect(w.config().engine).toBe("claude");
    expect(w.config().fallback).toEqual(["codex"]);
  });

  it("API key only with Codex", async () => {
    const w = wizard({ answers: [CAJA, "API key", "codex", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().engine).toBe("codex");
    expect(w.config().fallback).toEqual([]);
  });

  it("several engines of one mode keep their order", async () => {
    const w = wizard({ answers: [CAJA, "api", "codex, claude", "", "", PORT, NO_GH], secrets: [KEY, KEY] });
    await w.run();
    expect(w.config().engine).toBe("codex");
    expect(w.config().fallback).toEqual(["claude"]);
  });

  it("a missing CLI: names ZERO_CLIS, runs no install and asks again", async () => {
    const w = wizard({ answers: [CAJA, "api", "codex", "claude", "", "", PORT, NO_GH], secrets: [KEY], missing: ["codex"] });
    await w.run();
    expect(w.text()).toContain("ZERO_CLIS");
    expect(w.commands).toEqual([]);
    expect(w.config().engine).toBe("claude");
  });

  it("an engine zero does not have is refused", async () => {
    const w = wizard({ answers: [CAJA, "api", "gemini", "claude", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.text()).toContain('"gemini"');
    expect(w.config().engine).toBe("claude");
  });
});

describe("zero setup: running it again", () => {
  const EXISTING = `# mi comentario
version: 1
isolation: container
engine: claude
fallback: [codex]
limits:
  usdPerDay: 7 # tope propio
  usdPerJob: 2
lines:
  - name: tienda
    repo: /repos/tienda
`;

  it("changes what it manages and keeps the line and the comments", async () => {
    const w = wizard({ file: EXISTING, answers: [CAJA, "api", "codex", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    const text = w.file();
    expect(text).toContain("# mi comentario");
    expect(text).toContain("# tope propio");
    expect(w.config().engine).toBe("codex");
    expect(w.config().fallback).toEqual([]);
    expect(w.config().lines.map((l) => l.name)).toEqual(["tienda"]);
  });

  it("subscription only: writes the reserve and leaves the dollars alone", async () => {
    const w = wizard({ file: EXISTING, answers: [CAJA, "suscripción", "claude", "20", PORT, NO_GH], secrets: [TOKEN], confirms: [true] });
    await w.run();
    expect(w.config().limits.reservePercent).toBe(20);
    expect(w.config().limits.usdPerDay).toBe(7);
    expect(w.config().limits.usdPerJob).toBe(2);
  });

  it("API key only: writes the dollars and leaves the reserve alone", async () => {
    const w = wizard({ file: `${EXISTING.replace("usdPerJob: 2", "usdPerJob: 2\n  reservePercent: 15")}`, answers: [CAJA, "api", "claude", "9", "4", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().limits).toMatchObject({ usdPerDay: 9, usdPerJob: 4, reservePercent: 15 });
  });

  it("an invalid limit: asks again and does not write it", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "abc", "5", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().limits.usdPerDay).toBe(5);
    expect(w.file()).not.toContain("abc");
  });

  it("refuses a file the factory could not load before asking anything", async () => {
    const w = wizard({ file: "level: L9\n", answers: [] });
    await expect(w.run()).rejects.toThrow();
    expect(w.file()).toBe("level: L9\n");
  });
});

describe("zero setup: without a terminal", () => {
  it("errors, naming docker compose run, and changes nothing", async () => {
    const w = wizard({ interactive: false, answers: [] });
    await expect(w.run()).rejects.toThrow(/docker compose run/);
    expect(existsSync(w.home.config)).toBe(false);
    expect(w.secrets.list()).toEqual([]);
  });
});

describe("zero setup: credentials", () => {
  it("an API key stays out of arguments, the file and the messages", async () => {
    const w = wizard({ answers: [CAJA, "api", "codex", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.secrets.get("OPENAI_API_KEY")).toBe(KEY);
    expect(JSON.stringify(w.commands)).not.toContain(KEY);
    expect(w.file()).not.toContain(KEY);
    expect(w.text()).not.toContain(KEY);
  });

  it("an empty key is asked for again", async () => {
    const w = wizard({ answers: [CAJA, "api", "codex", "", "", PORT, NO_GH], secrets: ["  ", KEY] });
    await w.run();
    expect(w.secrets.get("OPENAI_API_KEY")).toBe(KEY);
  });

  it("Enter keeps the stored key", async () => {
    const w = wizard({ answers: [CAJA, "api", "codex", "", "", PORT, NO_GH], secrets: [""] });
    w.secrets.set("OPENAI_API_KEY", "la-de-antes");
    await w.run();
    expect(w.secrets.get("OPENAI_API_KEY")).toBe("la-de-antes");
  });

  it("Claude with consent: runs setup-token and stores the pasted token", async () => {
    const w = wizard({ answers: [CAJA, "suscripción", "claude", "", PORT, NO_GH], secrets: [TOKEN], confirms: [true] });
    await w.run();
    expect(w.commands).toEqual([["claude", "setup-token"]]);
    expect(w.secrets.get("CLAUDE_CODE_OAUTH_TOKEN")).toBe(TOKEN);
    expect(w.text()).not.toContain(TOKEN);
    expect(w.file()).not.toContain(TOKEN);
  });

  it("Codex with consent, without the box: runs the device login", async () => {
    const w = wizard({ box: false, answers: ["suscripción", "codex", "", PORT, NO_GH], confirms: [true, true] });
    await w.run();
    expect(w.commands).toEqual([["codex", "login", "--device-auth"]]);
    expect(w.config().isolation).toBe("worktree");
  });

  it("without consent: runs nothing and shows the command for later", async () => {
    const w = wizard({ answers: [CAJA, "suscripción", "claude", "", PORT, NO_GH], confirms: [false] });
    await w.run();
    expect(w.commands).toEqual([]);
    expect(w.text()).toContain("claude setup-token");
  });

  it("from API key to subscription: the key leaves the store", async () => {
    const w = wizard({ answers: [CAJA, "suscripción", "claude", "", PORT, NO_GH], secrets: [TOKEN], confirms: [true] });
    w.secrets.set("ANTHROPIC_API_KEY", KEY);
    await w.run();
    expect(w.secrets.get("ANTHROPIC_API_KEY")).toBeUndefined();
    expect(w.secrets.list()).not.toContain("ANTHROPIC_API_KEY");
  });

  it("from subscription to API key: the token leaves the store", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", PORT, NO_GH], secrets: [KEY] });
    w.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", TOKEN);
    await w.run();
    expect(w.secrets.get("CLAUDE_CODE_OAUTH_TOKEN")).toBeUndefined();
  });

  it("a credential in a Docker secret: warns by name, without its value", async () => {
    const dir = tempDir("zero-run-secrets-");
    writeFileSync(join(dir, "ANTHROPIC_API_KEY"), KEY);
    const w = wizard({ env: { ZERO_CONTAINER: "1", ZERO_SECRETS_DIR: dir }, answers: [CAJA, "suscripción", "claude", "", PORT, NO_GH], secrets: [TOKEN], confirms: [true] });
    await w.run();
    expect(w.text()).toMatch(/Aviso: ANTHROPIC_API_KEY viene de un Docker secret/);
    expect(w.text()).not.toContain(KEY);
  });

  it("a credential in an environment variable: warns too", async () => {
    const w = wizard({ env: { ZERO_CONTAINER: "1", ANTHROPIC_API_KEY: KEY }, answers: [CAJA, "suscripción", "claude", "", PORT, NO_GH], secrets: [TOKEN], confirms: [true] });
    await w.run();
    expect(w.text()).toMatch(/Aviso: ANTHROPIC_API_KEY viene de una variable de entorno/);
    expect(w.text()).not.toContain(KEY);
  });
});

describe("zero setup: isolation", () => {
  it("no runtime and no confirmation: stays with the box", async () => {
    const w = wizard({ box: false, answers: ["api", "claude", "", "", PORT, NO_GH], secrets: [KEY], confirms: [false] });
    await w.run();
    expect(w.config().isolation).toBe("container");
    expect(w.text()).toMatch(/esperan en la cola/);
  });

  it("no runtime and confirmed: no box, after warning about the key and the secrets", async () => {
    const w = wizard({ box: false, answers: ["api", "claude", "", "", PORT, NO_GH], secrets: [KEY], confirms: [true] });
    await w.run();
    expect(w.config().isolation).toBe("worktree");
    expect(w.text()).toContain("los agentes corren en el mismo contenedor que la llave y los secretos");
  });

  it("with a runtime, choosing the box: warns about the host and points to box setup", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().isolation).toBe("container");
    expect(w.text()).toContain("control sobre la máquina anfitriona");
    expect(w.text()).toContain("zero box setup");
  });

  it("with a runtime, no box without confirming: asks again", async () => {
    const w = wizard({ answers: ["sin caja", CAJA, "api", "claude", "", "", PORT, NO_GH], secrets: [KEY], confirms: [false] });
    await w.run();
    expect(w.config().isolation).toBe("container");
  });

  it("Codex by subscription with the box: explains and asks again", async () => {
    const w = wizard({ answers: [CAJA, "suscripción", "codex", "claude", "", PORT, NO_GH], secrets: [TOKEN], confirms: [true] });
    await w.run();
    expect(w.text()).toMatch(/Dentro de la caja necesita una API key/);
    expect(w.config().engine).toBe("claude");
    expect(w.file()).not.toContain("codex");
  });

  it("outside a container it does not ask, and leaves isolation alone", async () => {
    const w = wizard({ env: {}, file: "isolation: worktree\nlines: []\n", answers: ["api", "claude", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().isolation).toBe("worktree");
    expect(w.config().panel.host).toBe("127.0.0.1");
  });
});

describe("zero setup: panel", () => {
  it("in a container it listens on every interface, on the published port", async () => {
    const w = wizard({ env: { ZERO_CONTAINER: "1", ZERO_PANEL_PORT: "8080" }, answers: [CAJA, "api", "claude", "", "", "", NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().panel).toEqual({ port: 8080, host: "0.0.0.0" });
  });

  it("a port other than the published one says what to define", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", "9090", NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().panel.port).toBe(9090);
    expect(w.text()).toContain("ZERO_PANEL_PORT=9090");
  });

  it("an invalid port: asks again", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", "99999", "8081", NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.config().panel.port).toBe(8081);
  });
});

describe("zero setup: GitHub", () => {
  it("token: stored, and not in messages, arguments or the file", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", PORT, "token"], secrets: [KEY, GH] });
    await w.run();
    expect(w.secrets.get("GH_TOKEN")).toBe(GH);
    expect(w.text()).not.toContain(GH);
    expect(JSON.stringify(w.commands)).not.toContain(GH);
    expect(w.file()).not.toContain(GH);
  });

  it("login with consent: runs gh auth login", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", PORT, "login"], secrets: [KEY], confirms: [true] });
    await w.run();
    expect(w.commands).toEqual([["gh", "auth", "login"]]);
  });

  it("login without consent: runs nothing", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", PORT, "login"], secrets: [KEY], confirms: [false] });
    await w.run();
    expect(w.commands).toEqual([]);
    expect(w.text()).toContain("gh auth login");
  });

  it("none: runs nothing and stores nothing", async () => {
    const w = wizard({ answers: [CAJA, "api", "claude", "", "", PORT, NO_GH], secrets: [KEY] });
    await w.run();
    expect(w.commands).toEqual([]);
    expect(w.secrets.has("GH_TOKEN")).toBe(false);
  });
});

describe("zero setup: the encrypted store", () => {
  it("without the key it stops before asking anything and leaves no file", async () => {
    const home = tempDir("zero-setup-");
    const w = wizard({ answers: [], store: new SecretStore(factoryHome(home), undefined, { ZERO_CONTAINER: "1", ZERO_MASTER_KEY_FILE: join(home, "no-existe"), ZERO_SECRETS_DIR: home }) });
    await expect(w.run()).rejects.toThrow(/zero_master_key/);
    expect(existsSync(w.home.config)).toBe(false);
  });
});
