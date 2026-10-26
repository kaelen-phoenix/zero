import { spawnSync } from "node:child_process";

export interface ShellResult {
  code: number;
  output: string;
}

export function sh(command: string, cwd: string): ShellResult {
  const r = spawnSync(command, { cwd, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
