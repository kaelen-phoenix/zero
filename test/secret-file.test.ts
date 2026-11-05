import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentRunner, type EngineExecute } from "../src/agent.js";
import { parseFactory } from "../src/config.js";
import { claudeOptions } from "../src/engines/claude.js";
import { runProcess } from "../src/engines/cli.js";
import type { EngineRequest } from "../src/engines/index.js";
import { factoryHome } from "../src/home.js";
import { defaultKeyring, encryptedFileKeyring, memoryKeyring, SecretStore, systemKeyring } from "../src/keychain.js";
import { gitCredential, githubToken } from "../src/line/integrate.js";
import { sh } from "../src/shell.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

const KEY = "a".repeat(64);
const VALUE = "sk-muy-secreto-1234567890";

function setup(key: string | undefined = KEY) {
  const home = factoryHome(tempDir("zero-home-"));
  const secretsDir = tempDir("zero-run-secrets-");
  const keyFile = join(secretsDir, "zero_master_key");
  if (key) writeFileSync(keyFile, `${key}\n`);
  const env = { ZERO_CONTAINER: "1", ZERO_MASTER_KEY_FILE: keyFile, ZERO_SECRETS_DIR: secretsDir };
  return { home, secretsDir, keyFile, env, enc: join(home.root, "secrets.enc"), index: join(home.root, "secrets.json"), store: () => new SecretStore(home, undefined, env) };
}

describe("encrypted store in the volume", () => {
  it("keeps a value across stores, encrypted, with mode 600", () => {
    const s = setup();
    s.store().set("OPENAI_API_KEY", VALUE);
    expect(s.store().get("OPENAI_API_KEY")).toBe(VALUE);
    expect(readFileSync(s.enc, "utf8")).not.toContain(VALUE);
    expect(readFileSync(s.index, "utf8")).not.toContain(VALUE);
    expect(s.store().list()).toContain("OPENAI_API_KEY");
    if (process.platform !== "win32") expect(statSync(s.enc).mode & 0o777).toBe(0o600);
  });

  it("deletes a value", () => {
    const s = setup();
    s.store().set("OPENAI_API_KEY", VALUE);
    expect(s.store().remove("OPENAI_API_KEY")).toBe(true);
    expect(s.store().get("OPENAI_API_KEY")).toBeUndefined();
    expect(s.store().list()).not.toContain("OPENAI_API_KEY");
  });

  it("writes nothing without a key, and explains how to create it", () => {
    const s = setup("");
    expect(() => s.store().set("OPENAI_API_KEY", VALUE)).toThrow(/zero_master_key/);
    try {
      s.store().set("OPENAI_API_KEY", VALUE);
    } catch (err) {
      expect(String(err)).not.toContain(VALUE);
    }
    expect(existsSync(s.enc)).toBe(false);
    expect(existsSync(s.index)).toBe(false);
  });

  it("refuses a key with the wrong format", () => {
    const s = setup("corta");
    expect(() => s.store().set("OPENAI_API_KEY", VALUE)).toThrow(/zero_master_key/);
    expect(existsSync(s.enc)).toBe(false);
  });

  it("leaves the file as it was with a key that does not open it", () => {
    const s = setup();
    s.store().set("OPENAI_API_KEY", VALUE);
    const before = readFileSync(s.enc);
    writeFileSync(s.keyFile, "b".repeat(64));
    expect(() => s.store().set("OTRO_SECRETO", "otro-valor")).toThrow(/zero_master_key/);
    expect(() => s.store().remove("OPENAI_API_KEY")).toThrow(/zero_master_key/);
    expect(readFileSync(s.enc).equals(before)).toBe(true);
    expect(s.store().get("OPENAI_API_KEY")).toBeUndefined();
    expect(s.store().list()).toContain("OPENAI_API_KEY");
  });

  it("answers no name inherited from the object prototype", () => {
    const s = setup();
    s.store().set("OPENAI_API_KEY", VALUE);
    const backend = encryptedFileKeyring(s.enc, s.keyFile);
    expect(backend.get("__proto__")).toBeNull();
    expect(backend.get("constructor")).toBeNull();
  });
});

describe("Docker secrets", () => {
  it("reads a secret's file without its final newline, and lists it without showing it", () => {
    const s = setup();
    writeFileSync(join(s.secretsDir, "OPENAI_API_KEY"), `${VALUE}\n`);
    expect(s.store().get("OPENAI_API_KEY")).toBe(VALUE);
    expect(s.store().source("OPENAI_API_KEY")).toBe("file");
    expect(s.store().list()).toContain("OPENAI_API_KEY");
    expect(s.store().list()).not.toContain("zero_master_key");
    expect(s.store().list().join()).not.toContain(VALUE);
  });

  it("looks in the environment first, then the file, then the store", () => {
    const s = setup();
    s.store().set("OPENAI_API_KEY", "del-almacen");
    expect(s.store().source("OPENAI_API_KEY")).toBe("store");
    writeFileSync(join(s.secretsDir, "OPENAI_API_KEY"), "del-archivo");
    expect(s.store().get("OPENAI_API_KEY")).toBe("del-archivo");
    const withEnv = new SecretStore(s.home, undefined, { ...s.env, OPENAI_API_KEY: "del-entorno" });
    expect(withEnv.get("OPENAI_API_KEY")).toBe("del-entorno");
    expect(withEnv.source("OPENAI_API_KEY")).toBe("env");
  });

  it("does not read outside the folder through a name with a path", () => {
    const s = setup();
    const parent = join(s.secretsDir, "..");
    const outside = join(parent, "OTRO_FUERA");
    writeFileSync(outside, "no-deberia-verse");
    try {
      expect(s.store().get("../otro")).toBeUndefined();
      expect(s.store().get("../OTRO_FUERA")).toBeUndefined();
    } finally {
      writeFileSync(outside, "");
    }
  });
});

describe("outside a container", () => {
  it("keeps the system keychain and never reads the secrets folder or secrets.enc", () => {
    const s = setup();
    new SecretStore(s.home, undefined, s.env).set("OPENAI_API_KEY", VALUE);
    writeFileSync(join(s.secretsDir, "OTRO_SECRETO"), VALUE);
    const env = { ZERO_MASTER_KEY_FILE: s.keyFile, ZERO_SECRETS_DIR: s.secretsDir };
    expect(defaultKeyring(s.home, env)).toBe(systemKeyring);
    const outside = new SecretStore(s.home, memoryKeyring(), env);
    expect(outside.get("OTRO_SECRETO")).toBeUndefined();
    expect(outside.get("OPENAI_API_KEY")).toBeUndefined();
    expect(outside.list()).not.toContain("OTRO_SECRETO");
  });

  it("chooses the encrypted file inside a container", () => {
    const s = setup();
    expect(defaultKeyring(s.home, s.env)).not.toBe(systemKeyring);
  });
});

describe("GitHub token in a container", () => {
  it("uses the store's GH_TOKEN with no environment variable, without starting gh", () => {
    const secrets = { get: (n: string) => (n === "GH_TOKEN" ? "tok-del-almacen" : undefined) };
    expect(githubToken({ ZERO_CONTAINER: "1", PATH: "" }, secrets)).toBe("tok-del-almacen");
  });

  it("prefers the environment variable", () => {
    const secrets = { get: () => "tok-del-almacen" };
    expect(githubToken({ ZERO_CONTAINER: "1", GH_TOKEN: "tok-del-entorno" }, secrets)).toBe("tok-del-entorno");
  });

  it("ignores the store outside a container", () => {
    const secrets = { get: () => "tok-del-almacen" };
    // Compared, never printed: this machine may have a real `gh` session.
    expect(githubToken({ PATH: "" }, secrets) === "tok-del-almacen").toBe(false);
  });
});

describe("zero git-credential", () => {
  it("gives the token only to github.com", () => {
    expect(gitCredential("protocol=https\nhost=github.com\n\n", () => "tok")).toBe("username=x-access-token\npassword=tok\n");
    expect(gitCredential("host=github.com\n", () => "tok")).toBe("username=x-access-token\npassword=tok\n");
  });

  it("prints nothing for another host, a look-alike or another protocol", () => {
    let asked = 0;
    const token = () => (asked++, "tok");
    expect(gitCredential("protocol=https\nhost=ejemplo.com\n\n", token)).toBe("");
    expect(gitCredential("protocol=https\nhost=github.com.ejemplo.com\n\n", token)).toBe("");
    expect(gitCredential("protocol=http\nhost=github.com\n\n", token)).toBe("");
    expect(asked).toBe(0);
  });

  it("prints nothing without a token", () => {
    expect(gitCredential("host=github.com\n", () => undefined)).toBe("");
  });
});

describe("credentials for an engine outside the box", () => {
  const fake = () => {
    const seen: EngineRequest[] = [];
    const execute: EngineExecute = async (_engine, req) => {
      seen.push(req);
      return { ok: true, text: "ok" };
    };
    return { seen, execute };
  };
  const config = () => parseFactory("engine: codex\nisolation: worktree\nlines: []\n");
  const store = () => new SecretStore(factoryHome(tempDir("zero-home-")), memoryKeyring(), {});

  afterEach(() => vi.unstubAllEnvs());

  it("in a container: the request carries the store's credential, and process.env does not", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
    const secrets = store();
    secrets.set("OPENAI_API_KEY", VALUE);
    const { seen, execute } = fake();
    await createAgentRunner(config(), { execute, secrets })({ station: "build", prompt: "p", cwd: tempDir() });
    expect(seen[0]!.env).toEqual({ OPENAI_API_KEY: VALUE });
    expect(process.env.OPENAI_API_KEY).toBe("");
  });

  it("outside a container: the request carries no credentials", async () => {
    vi.stubEnv("ZERO_CONTAINER", "");
    const secrets = store();
    secrets.set("OPENAI_API_KEY", VALUE);
    const { seen, execute } = fake();
    await createAgentRunner(config(), { execute, secrets })({ station: "build", prompt: "p", cwd: tempDir() });
    expect(seen[0]!.env).toBeUndefined();
  });

  it("a runner for the box gets no secrets, so its requests carry none", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    const { seen, execute } = fake();
    await createAgentRunner(config(), { execute })({ station: "build", prompt: "p", cwd: tempDir() });
    expect(seen[0]!.env).toBeUndefined();
  });

  it("verification commands in a local copy do not receive it", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    const secrets = store();
    secrets.set("OPENAI_API_KEY", VALUE);
    const { execute } = fake();
    await createAgentRunner(config(), { execute, secrets })({ station: "build", prompt: "p", cwd: tempDir() });
    const r = await sh(`node -e "process.stdout.write(process.env.OPENAI_API_KEY || 'nada')"`, tempDir());
    expect(r.output).toBe("nada");
  });

  it("a CLI engine's process gets the credential, and only that process", async () => {
    const script = join(tempDir(), "env.mjs");
    writeFileSync(script, `process.stdout.write(process.env.CANARY_SECRET ?? "nada")`);
    const r = await runProcess({ bin: process.execPath, args: [script] }, tempDir(), 30_000, undefined, { CANARY_SECRET: VALUE });
    expect(r.stdout).toBe(VALUE);
    expect(process.env.CANARY_SECRET).toBeUndefined();
  });

  it("Claude's options carry it too", () => {
    const options = claudeOptions({ instructions: "", prompt: "", cwd: ".", access: "read", timeoutMs: 1, env: { ANTHROPIC_API_KEY: VALUE } }, new AbortController());
    expect(options.env?.ANTHROPIC_API_KEY).toBe(VALUE);
  });
});
