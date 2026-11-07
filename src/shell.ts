import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

export interface ShellResult {
  code: number;
  output: string;
  timedOut: boolean;
}

/** Runs a shell command, capturing stdout and stderr together. */
export function sh(command: string, cwd: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    let timedOut = false;
    const kill = () => child.kill("SIGKILL");
    const timer = opts.timeoutMs ? setTimeout(() => ((timedOut = true), kill()), opts.timeoutMs) : undefined;
    opts.signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => (output += String(err)));
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      resolve({ code: code ?? 1, output, timedOut });
    });
  });
}

/** A folder with nothing of a third party's: where git and npm start, so that neither Windows nor what they start can pick up a program or a library from a package's folder. */
export const TRUSTED_CWD = dirname(process.execPath);

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

/** A name Windows would look for in the folder a program starts in. A path, relative or not, was declared by the person in charge and stays as it is. */
const isBareName = (name: string) => !/[\\/:]/.test(name);

const resolved = new Map<string, string>();

/**
 * The program a bare name means. On Windows a spawn without a shell looks in its cwd
 * before PATH, so what an agent left in a work copy would run on the host: this finds
 * the same .com or .exe in PATH's absolute entries only. Elsewhere, or when it is not
 * found, the name comes back unchanged; only what was found is kept.
 */
export function resolveBin(name: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32" || !isBareName(name)) return name;
  const path = process.env.PATH ?? "";
  const key = `${name}\0${path}`;
  const known = resolved.get(key);
  if (known) return known;
  const file = findOnPath(name, extname(name) ? ["", ".com", ".exe"] : [".com", ".exe"], path);
  if (!file) return name;
  resolved.set(key, file);
  return file;
}

/** What to spawn and where. A bare name not found on PATH starts away from the given folder, so that it fails as any missing program does instead of running what is there. */
export function spawnTarget(name: string, cwd: string, platform: NodeJS.Platform = process.platform): { bin: string; cwd: string } {
  const bin = resolveBin(name, platform);
  return platform === "win32" && bin === name && isBareName(name) ? { bin, cwd: TRUSTED_CWD } : { bin, cwd };
}

/** The only way to start git in a folder an agent or a third party can write to. */
export function spawnGit(args: string[], cwd: string, opts: { env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number } = {}): SpawnSyncReturns<string> {
  const target = spawnTarget("git", cwd);
  return spawnSync(target.bin, args, { ...opts, cwd: target.cwd, encoding: "utf8", windowsHide: true });
}

export function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const r = spawnGit(args, cwd, env && { env });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Like `git`, but returns undefined instead of throwing. */
export function tryGit(args: string[], cwd: string): string | undefined {
  const r = spawnGit(args, cwd);
  return r.status === 0 ? r.stdout.trim() : undefined;
}

export function onPath(bin: string): boolean {
  const probe = process.platform === "win32" ? spawnSync("where", [bin], { windowsHide: true }) : spawnSync("sh", ["-c", `command -v ${bin}`]);
  return probe.status === 0;
}
