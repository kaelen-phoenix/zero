import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";
import type { FactoryHome } from "./home.js";

/** Where secret values live. The OS keychain in production; memory in tests. */
export interface KeyringBackend {
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
}

const SERVICE = "zero";

/** Windows Credential Manager, macOS Keychain or the Secret Service on Linux. */
export const systemKeyring: KeyringBackend = {
  get: (name) => new Entry(SERVICE, name).getPassword() ?? null,
  set: (name, value) => new Entry(SERVICE, name).setPassword(value),
  delete: (name) => void new Entry(SERVICE, name).deletePassword(),
};

export const memoryKeyring = (): KeyringBackend => {
  const values = new Map<string, string>();
  return { get: (n) => values.get(n) ?? null, set: (n, v) => void values.set(n, v), delete: (n) => void values.delete(n) };
};

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * The factory's credentials: environment variables win, then the keychain.
 * Keychains cannot be listed, so the names (never the values) are indexed in
 * `secrets.json` under the factory directory.
 */
export class SecretStore {
  private index: string;

  constructor(home: FactoryHome, private backend: KeyringBackend = systemKeyring, private env: NodeJS.ProcessEnv = process.env) {
    this.index = join(home.root, "secrets.json");
  }

  list(): string[] {
    return existsSync(this.index) ? (JSON.parse(readFileSync(this.index, "utf8")) as string[]) : [];
  }

  private writeIndex(names: string[]) {
    mkdirSync(join(this.index, ".."), { recursive: true });
    writeFileSync(this.index, JSON.stringify([...new Set(names)].sort(), null, 2));
  }

  get(name: string): string | undefined {
    const fromEnv = this.env[name];
    if (fromEnv) return fromEnv;
    try {
      return this.backend.get(name) ?? undefined;
    } catch {
      return undefined;
    }
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  set(name: string, value: string) {
    if (!SECRET_NAME.test(name)) throw new Error(`Nombre de secreto inválido: ${name}. Usá mayúsculas, dígitos y _ (por ejemplo OPENAI_API_KEY).`);
    if (!value.trim()) throw new Error("El valor está vacío.");
    this.backend.set(name, value.trim());
    this.writeIndex([...this.list(), name]);
  }

  remove(name: string): boolean {
    const known = this.list().includes(name);
    try {
      this.backend.delete(name);
    } catch {
      // not in the keychain
    }
    this.writeIndex(this.list().filter((n) => n !== name));
    return known;
  }
}
