import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { parse } from "yaml";
import { NPM_NAME } from "./config.js";
import { MANIFEST, ManifestSchema, type PackageManifest } from "./packages.js";
import { redact } from "./secrets.js";
import type { Store } from "./state/store.js";

export const PACKAGE_LOCK = "package-lock.json";

/** Runs git and gives its output, trimmed, or throws with a clean reason; tests wrap real git to reach temporary repositories. */
export type GitRunner = (args: string[], opts?: { cwd?: string }) => Promise<string>;
/** Installs a package's dependencies in its folder; tests inject a fake. */
export type DependencyInstaller = (dir: string) => Promise<void>;
/** The latest version an npm package has; tests inject a fake. */
export type NpmLatest = (name: string) => Promise<string>;

const GIT_TIMEOUT_MS = 5 * 60_000;
const NPM_TIMEOUT_MS = 10 * 60_000;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

/** What a third party wrote, safe to show on a terminal: no control characters, escapes or direction overrides. */
export const cleanText = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").trim();

/** Git's own words without anything that looks like a credential. */
const cleanError = (text: string) => cleanText(redact(text).replace(/:\/\/[^/\s@]+@/g, "://[REDACTED]@")).slice(0, 500);

/** A folder with nothing of a third party's: where git and npm start, so that neither Windows nor what they start can pick up a program or a library from a package's folder. */
const TRUSTED_CWD = dirname(process.execPath);

/** Where the first absolute entry of PATH that has a program keeps it. Relative entries mean whatever folder a process stands in, so they do not count. */
export function findOnPath(name: string, extensions: string[], path = process.env.PATH ?? ""): string | undefined {
  for (const entry of path.split(delimiter).map((e) => e.replace(/^"|"$/g, ""))) {
    if (!isAbsolute(entry)) continue;
    for (const extension of extensions) {
      const file = join(entry, name + extension);
      try {
        if (!statSync(file).isFile()) continue;
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        // Not here.
      }
    }
  }
  return undefined;
}

const findGit = () => findOnPath("git", process.platform === "win32" ? [".com", ".exe"] : [""]);

/** How to start npm without a shell: through this Node when npm-cli.js is at hand, since Windows only starts a .cmd through cmd.exe, and a shell looks in the current folder first. */
export function npmCommand(path?: string): string[] {
  const found = findOnPath("npm", process.platform === "win32" ? [".com", ".exe", ".cmd", ".bat"] : [""], path);
  if (!found) throw new Error("No encontré npm en el PATH.");
  const cli = [realpathSync(found), join(dirname(found), "node_modules", "npm", "bin", "npm-cli.js")].find((f) => f.endsWith("npm-cli.js") && existsSync(f));
  if (cli) return [process.execPath, cli];
  if (/\.(cmd|bat)$/i.test(found)) throw new Error(`No encontré npm-cli.js junto a ${found}, y zero no inicia npm a través de un shell.`);
  return [found];
}

function runProcess(label: string, command: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    // stdin closed: nothing it starts can sit waiting for an answer.
    const child = spawn(command, args, { cwd: TRUSTED_CWD, env: opts.env, shell: false, windowsHide: true, timeout: opts.timeout, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (err) => reject(new Error(`${label}: ${cleanError(err.message)}`)));
    child.on("close", (code) => (code === 0 ? resolve(stdout.trim()) : reject(new Error(`${label}: ${cleanError(stderr) || `terminó con código ${code}`}`))));
  });
}

/** Whatever these programs start finds its own programs on PATH too, never in the current folder. */
const noCurrentFolder = (): NodeJS.ProcessEnv => ({ ...process.env, NoDefaultCurrentDirectoryInExePath: "1" });

/** git never asks on a terminal and only ever speaks the protocols zero accepts; the credentials are whatever the person's git already has. */
export const gitEnv = (): NodeJS.ProcessEnv => ({ ...noCurrentFolder(), GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https:ssh" });

// The folder goes as -C: git is found and started before it stands in a package's folder.
export const realGit: GitRunner = async (args, opts = {}) => {
  const git = findGit();
  if (!git) throw new Error("No encontré git en el PATH.");
  return runProcess(`git ${args[0]}`, git, [...(opts.cwd ? ["-C", opts.cwd] : []), ...args], { env: gitEnv(), timeout: GIT_TIMEOUT_MS });
};

/** npm from a trusted folder; `npm_config_git` outranks a package's .npmrc, which could otherwise name its own git for git dependencies. */
export async function runNpm(args: string[], timeout: number): Promise<string> {
  const [command, ...before] = npmCommand();
  return runProcess(`npm ${args[0]}`, command!, [...before, ...args], { env: { ...noCurrentFolder(), npm_config_git: findGit() ?? "git" }, timeout });
}

/** Install scripts never run, and only what the package needs at run time goes in. */
export const npmCiArgs = (): string[] => ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];

export const realDependencies: DependencyInstaller = async (dir) => {
  await runNpm([...npmCiArgs(), "--prefix", dir], NPM_TIMEOUT_MS);
};

export const realNpmLatest: NpmLatest = async (name) => {
  if (!NPM_NAME.test(name)) throw new Error(`"${name}" no es un nombre válido de paquete npm.`);
  return runNpm(["view", name, "version"], GIT_TIMEOUT_MS);
};

/** Whether a version npm reported can be handed back to npm as an argument. */
export const validVersion = (version: string) => VERSION.test(version);

/** The commit of a reference, fetched into the repository without touching its files. */
export async function fetchRef(git: GitRunner, dir: string, ref: string | undefined): Promise<string> {
  await git(["fetch", "--force", "origin", ref ?? "HEAD"], { cwd: dir });
  return git(["rev-parse", "FETCH_HEAD^{commit}"], { cwd: dir });
}

export async function resolveAndCheckout(git: GitRunner, dir: string, ref: string | undefined): Promise<string> {
  const sha = await fetchRef(git, dir, ref);
  await git(["checkout", "--detach", sha], { cwd: dir });
  return sha;
}

/** The manifest as a commit has it, without checking it out; undefined when that commit has none or it is not valid. */
export async function manifestAt(git: GitRunner, dir: string, sha: string): Promise<PackageManifest | undefined> {
  try {
    const parsed = ManifestSchema.safeParse(parse(await git(["show", `${sha}:${MANIFEST}`], { cwd: dir })));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A manifest that is a link or a folder reads one way in a commit and another on disk, so nothing said about it would hold. */
export const MANIFEST_NOT_A_FILE = `${MANIFEST} no es un archivo común, y zero no acepta un manifiesto que apunta a otra parte`;

/** Whether a commit has something at the manifest's place other than a regular file; having nothing there is not this. */
export async function manifestNotAFile(git: GitRunner, dir: string, sha: string): Promise<boolean> {
  const tree = await git(["ls-tree", sha, "--", MANIFEST], { cwd: dir });
  return tree !== "" && !/^100\d{3} blob /.test(tree);
}

export const declaredSecrets = (m: Pick<PackageManifest, "stations">) => [...new Set(m.stations.flatMap((s) => s.secrets))];

/** What a new manifest asks for that the old one did not. */
export interface Widening {
  secrets: string[];
  stations: string[];
  requests: string[];
  buildAgents: string[];
}

export function widening(before: PackageManifest | undefined, after: PackageManifest): Widening {
  const old: Pick<PackageManifest, "stations" | "agents"> = before ?? { stations: [], agents: [] };
  const oldSecrets = declaredSecrets(old);
  const oldStation = (name: string) => old.stations.find((s) => s.name === name);
  return {
    secrets: declaredSecrets(after).filter((s) => !oldSecrets.includes(s)),
    stations: after.stations.filter((s) => !oldStation(s.name)).map((s) => s.name),
    requests: after.stations.filter((s) => s.requests && s.requests.perLinePerDay > (oldStation(s.name)?.requests?.perLinePerDay ?? 0)).map((s) => s.name),
    buildAgents: after.agents.filter((a) => a.type === "build" && old.agents.find((o) => o.name === a.name)?.type !== "build").map((a) => a.name),
  };
}

export const widens = (w: Widening) => Object.values(w).some((names: string[]) => names.length > 0);

/** A hash of a folder's lock file, or undefined when it has none. */
export function lockPrint(dir: string): string | undefined {
  const file = join(dir, PACKAGE_LOCK);
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : undefined;
}

export const lockKey = (dir: string) => `package-lock:${dir}`;

/** The version npm installed in a folder; `package.json` is npm's own record. */
export function npmInstalledVersion(dir: string): string | undefined {
  try {
    const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: unknown };
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/** The last the factory saw on a package's remote, without having applied it. */
export interface SeenUpdate {
  seen?: string;
  at: string;
  /** Why the last look failed; `seen` stays what an earlier one found. */
  error?: string;
}

export const updateKey = (name: string) => `package-update:${name}`;

export function readSeen(store: Pick<Store, "getKv">, name: string): SeenUpdate | undefined {
  const raw = store.getKv(updateKey(name));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SeenUpdate;
  } catch {
    return undefined;
  }
}

export function recordSeen(store: Pick<Store, "setKv">, name: string, seen: string, at: Date): void {
  store.setKv(updateKey(name), JSON.stringify({ seen, at: at.toISOString() } satisfies SeenUpdate));
}

export function recordLookFailed(store: Pick<Store, "getKv" | "setKv">, name: string, error: string, at: Date): void {
  const { seen } = readSeen(store, name) ?? {};
  store.setKv(updateKey(name), JSON.stringify({ ...(seen && { seen }), at: at.toISOString(), error: cleanError(error) } satisfies SeenUpdate));
}
