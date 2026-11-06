import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";
import { inContainer, type FactoryHome } from "./home.js";

/** Where secret values live. The OS keychain in production; memory in tests. */
export interface KeyringBackend {
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
  /** Throws, in the owner's words, when nothing could be stored right now. */
  check?(): void;
  /** Words for "saved in …", in the owner's language. */
  label?: string;
}

const SERVICE = "zero";

/** Windows Credential Manager, macOS Keychain or the Secret Service on Linux. */
export const systemKeyring: KeyringBackend = {
  get: (name) => new Entry(SERVICE, name).getPassword() ?? null,
  set: (name, value) => new Entry(SERVICE, name).setPassword(value),
  delete: (name) => void new Entry(SERVICE, name).deletePassword(),
  label: "el llavero del sistema",
};

export const memoryKeyring = (): KeyringBackend => {
  const values = new Map<string, string>();
  return { get: (n) => values.get(n) ?? null, set: (n, v) => void values.set(n, v), delete: (n) => void values.delete(n) };
};

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

const MASTER_KEY = /^[0-9a-fA-F]{64}$/;
const MASTER_KEY_HELP = "Creá la llave en la máquina anfitriona con `openssl rand -hex 32 > secrets/zero_master_key` (64 caracteres hexadecimales) y conectala como el Docker secret zero_master_key, como hace compose.yaml.";

/** The store cannot be opened: its key is missing, malformed or not the one that encrypted the file. */
export class MasterKeyError extends Error {}

export const masterKeyFile = (env: NodeJS.ProcessEnv = process.env) => env.ZERO_MASTER_KEY_FILE ?? "/run/secrets/zero_master_key";

/**
 * Secrets encrypted in the factory's volume with AES-256-GCM, for containers
 * where there is no keychain. The key lives outside the volume, as a Docker
 * secret. Never writes without a key that opens what is already there.
 */
export function encryptedFileKeyring(path: string, keyFile: string): KeyringBackend {
  const key = (): Buffer => {
    let text: string;
    try {
      text = readFileSync(keyFile, "utf8").trim();
    } catch {
      throw new MasterKeyError(`No encuentro la llave zero_master_key en ${keyFile}. ${MASTER_KEY_HELP}`);
    }
    if (!MASTER_KEY.test(text)) throw new MasterKeyError(`La llave zero_master_key de ${keyFile} no tiene el formato esperado. ${MASTER_KEY_HELP}`);
    return Buffer.from(text, "hex");
  };
  const read = (k: Buffer): Record<string, string> => {
    if (!existsSync(path)) return {};
    try {
      const file = JSON.parse(readFileSync(path, "utf8")) as { iv: string; tag: string; data: string };
      const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(file.iv, "base64"));
      decipher.setAuthTag(Buffer.from(file.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]).toString("utf8")) as Record<string, string>;
    } catch {
      throw new MasterKeyError(`La llave zero_master_key no abre ${path}: no es la que cifró esos secretos, o el archivo está dañado. Usá la llave original; ${path} quedó como estaba.`);
    }
  };
  const write = (k: Buffer, values: Record<string, string>) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", k, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
    const file = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(join(path, ".."), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(file), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  };
  return {
    get: (name) => {
      const values = read(key());
      return Object.hasOwn(values, name) ? values[name]! : null;
    },
    set: (name, value) => {
      const k = key();
      write(k, { ...read(k), [name]: value });
    },
    delete: (name) => {
      if (!existsSync(path)) return;
      const k = key();
      const values = read(k);
      if (!Object.hasOwn(values, name)) return;
      delete values[name];
      write(k, values);
    },
    check: () => void read(key()),
    label: "el almacén cifrado del volumen",
  };
}

/** The keychain on a machine; the encrypted file in the factory's volume inside a container. */
export function defaultKeyring(home: Pick<FactoryHome, "root">, env: NodeJS.ProcessEnv = process.env): KeyringBackend {
  return inContainer(env) ? encryptedFileKeyring(join(home.root, "secrets.enc"), masterKeyFile(env)) : systemKeyring;
}

/** Where a credential comes from: only the store's can be deleted by zero. */
export type SecretSource = "env" | "file" | "store";

/**
 * The factory's credentials: environment variables win, then (in a container)
 * Docker secrets, then the keychain or encrypted file. Keychains cannot be
 * listed, so the names (never the values) are indexed in `secrets.json` under
 * the factory directory.
 */
export class SecretStore {
  private index: string;
  private backend: KeyringBackend;

  constructor(home: FactoryHome, backend?: KeyringBackend, private env: NodeJS.ProcessEnv = process.env) {
    this.index = join(home.root, "secrets.json");
    this.backend = backend ?? defaultKeyring(home, env);
  }

  private get dockerSecrets(): string | undefined {
    return inContainer(this.env) ? (this.env.ZERO_SECRETS_DIR ?? "/run/secrets") : undefined;
  }

  /** A Docker secret's value. The name's shape is what keeps the read inside the folder. */
  private fromFile(name: string): string | undefined {
    const dir = this.dockerSecrets;
    if (!dir || !SECRET_NAME.test(name)) return undefined;
    try {
      return readFileSync(join(dir, name), "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private fileNames(): string[] {
    const dir = this.dockerSecrets;
    if (!dir) return [];
    try {
      return readdirSync(dir).filter((n) => SECRET_NAME.test(n) && statSync(join(dir, n)).isFile());
    } catch {
      return [];
    }
  }

  private indexed(): string[] {
    return existsSync(this.index) ? (JSON.parse(readFileSync(this.index, "utf8")) as string[]) : [];
  }

  list(): string[] {
    return [...new Set([...this.indexed(), ...this.fileNames()])].sort();
  }

  private writeIndex(names: string[]) {
    mkdirSync(join(this.index, ".."), { recursive: true });
    writeFileSync(this.index, JSON.stringify([...new Set(names)].sort(), null, 2));
  }

  private fromBackend(name: string): string | undefined {
    try {
      return this.backend.get(name) ?? undefined;
    } catch {
      return undefined;
    }
  }

  get(name: string): string | undefined {
    return this.env[name] || this.fromFile(name) || this.fromBackend(name);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Where `get` would find this credential. */
  source(name: string): SecretSource | undefined {
    if (this.env[name]) return "env";
    if (this.fromFile(name)) return "file";
    return this.fromBackend(name) ? "store" : undefined;
  }

  /** Whether the store itself holds this credential, whatever the environment says. */
  stored(name: string): boolean {
    return this.fromBackend(name) !== undefined;
  }

  /** Throws, in the owner's words, when nothing could be stored right now. */
  check() {
    this.backend.check?.();
  }

  /** Where `set` leaves a credential, for what the owner reads. */
  get place(): string {
    return this.backend.label ?? "el almacén";
  }

  set(name: string, value: string) {
    if (!SECRET_NAME.test(name)) throw new Error(`Nombre de secreto inválido: ${name}. Usá mayúsculas, dígitos y _ (por ejemplo OPENAI_API_KEY).`);
    if (!value.trim()) throw new Error("El valor está vacío.");
    this.backend.set(name, value.trim());
    this.writeIndex([...this.indexed(), name]);
  }

  remove(name: string): boolean {
    const known = this.indexed().includes(name);
    try {
      this.backend.delete(name);
    } catch (err) {
      // A store zero cannot open still holds the value: saying it is gone would be a lie.
      if (err instanceof MasterKeyError) throw err;
      // not in the keychain
    }
    this.writeIndex(this.indexed().filter((n) => n !== name));
    return known;
  }
}
