import { spawnSync } from "node:child_process";

export type Runtime = "podman" | "docker";

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Synchronous command runner, injectable so probes can be tested without containers. */
export type Exec = (bin: string, args: string[], opts?: { timeoutMs?: number }) => ExecResult;

export const exec: Exec = (bin, args, opts = {}) => {
  const r = spawnSync(bin, args, { encoding: "utf8", windowsHide: true, timeout: opts.timeoutMs ?? 60_000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
};

const installed = (rt: Runtime, run: Exec) => run(rt, ["--version"], { timeoutMs: 15_000 }).status === 0;

/** Installed runtimes in order of preference: Podman (Apache-2.0, no usage limits), then Docker. */
export function installedRuntimes(preference: "auto" | Runtime, run: Exec = exec): Runtime[] {
  const forced = process.env.ZERO_BOX_RUNTIME as Runtime | undefined;
  const order: Runtime[] = forced ? [forced] : preference === "auto" ? ["podman", "docker"] : [preference];
  return order.filter((rt) => installed(rt, run));
}

/** Whether the runtime can run containers right now (on Windows and macOS, its VM must be up). */
export function responds(rt: Runtime, run: Exec = exec): boolean {
  return run(rt, ["info"], { timeoutMs: 30_000 }).status === 0;
}

export function imageExists(rt: Runtime, tag: string, run: Exec = exec): boolean {
  return run(rt, ["image", "inspect", tag], { timeoutMs: 30_000 }).status === 0;
}
