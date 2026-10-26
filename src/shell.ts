import { spawn, spawnSync } from "node:child_process";

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

export function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Like `git`, but returns undefined instead of throwing. */
export function tryGit(args: string[], cwd: string): string | undefined {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

export function onPath(bin: string): boolean {
  const probe = process.platform === "win32" ? spawnSync("where", [bin], { windowsHide: true }) : spawnSync("sh", ["-c", `command -v ${bin}`]);
  return probe.status === 0;
}
