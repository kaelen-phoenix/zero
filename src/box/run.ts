import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { FactoryConfig } from "../config.js";
import type { Runtime } from "./runtime.js";

export type Mount = "ro" | "rw";

export interface BoxRunSpec {
  runtime: Runtime;
  image: string;
  /** Host directory mounted at /work: the job's own copy, nothing else. */
  copy: string;
  mount: Mount;
  limits: FactoryConfig["box"];
  /** Credential names passed by reference (`-e NAME`); their values come from `env`. */
  secretNames: string[];
  command: string[];
  name: string;
  /** Host platform and ids, to run as the owner on Linux so files in the copy stay theirs. */
  platform?: NodeJS.Platform;
  uid?: number;
  gid?: number;
}

export const containerName = (jobId: string) => `zero-${jobId}-${randomBytes(3).toString("hex")}`;

/**
 * Every hardening flag the box runs with. Pure, so the security posture is
 * unit-tested rather than trusted.
 */
export function boxRunArgs(spec: BoxRunSpec): string[] {
  const platform = spec.platform ?? process.platform;
  const user =
    platform === "linux"
      ? spec.runtime === "podman"
        ? ["--userns=keep-id"]
        : ["--user", `${spec.uid ?? process.getuid?.() ?? 1000}:${spec.gid ?? process.getgid?.() ?? 1000}`]
      : [];
  return [
    "run", "--rm", "-i", "--init",
    "--name", spec.name,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    "--tmpfs", "/tmp:rw,size=1g,mode=1777",
    "--tmpfs", "/home/zero:rw,size=2g,mode=1777",
    "-e", "HOME=/home/zero",
    "--cpus", String(spec.limits.cpus),
    "--memory", `${spec.limits.memoryGb}g`,
    "--pids-limit", String(spec.limits.pids),
    ...user,
    "-v", `${spec.copy}:/work${spec.mount === "ro" ? ":ro" : ""}`,
    "-w", "/work",
    ...spec.secretNames.flatMap((n) => ["-e", n]),
    spec.image,
    ...spec.command,
  ];
}

export interface BoxRunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

/** Runs one container to completion; aborting or timing out kills it. */
export function runInBox(spec: BoxRunSpec, opts: { input?: string; env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<BoxRunResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.runtime, boxRunArgs(spec), { windowsHide: true, env: { ...process.env, ...opts.env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    const kill = () => {
      spawnSync(spec.runtime, ["kill", spec.name], { windowsHide: true, timeout: 30_000 });
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => ((timedOut = true), kill()), opts.timeoutMs);
    const cancel = () => ((cancelled = true), kill());
    if (opts.signal?.aborted) cancel();
    opts.signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => (stderr += String(err)));
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", cancel);
      resolve({ code: code ?? 1, stdout, stderr, timedOut, cancelled });
    });
    child.stdin.end(opts.input ?? "");
  });
}
