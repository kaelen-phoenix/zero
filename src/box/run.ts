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
  /** Host directory with the run's staged skills, mounted read-only at /skills for every station. */
  skills?: string;
  limits: FactoryConfig["box"];
  /** Credential names passed by reference (`-e NAME`); their values come from `env`. */
  secretNames: string[];
  command: string[];
  name: string;
  /** The egress gate's internal network and the proxy URL with this run's pass. */
  egress?: { network: string; proxy: string };
  /** Host platform and ids, to run as the owner on Linux so files in the copy stay theirs. */
  platform?: NodeJS.Platform;
  uid?: number;
  gid?: number;
}

export interface OwnerIds {
  runtime: Runtime;
  platform?: NodeJS.Platform;
  uid?: number;
  gid?: number;
}

/**
 * On Linux mounted directories belong to the owner's uid: run as that uid (the
 * image's own user would not own them). Rootless Podman also needs keep-id so
 * that uid maps to the same uid on the host.
 */
export function ownerUser(o: OwnerIds): string[] {
  if ((o.platform ?? process.platform) !== "linux") return [];
  const owner = ["--user", `${o.uid ?? process.getuid?.() ?? 1000}:${o.gid ?? process.getgid?.() ?? 1000}`];
  return o.runtime === "podman" ? ["--userns=keep-id", ...owner] : owner;
}

/** Inside the box only `localhost` is reached directly; everything else goes through the gate. */
export function proxyEnv(proxy: string): string[] {
  const direct = "localhost,127.0.0.1,::1";
  const vars: [string, string][] = [
    ["HTTP_PROXY", proxy], ["HTTPS_PROXY", proxy], ["http_proxy", proxy], ["https_proxy", proxy],
    ["NO_PROXY", direct], ["no_proxy", direct],
    // Node's own fetch honours the variables only with this flag.
    ["NODE_USE_ENV_PROXY", "1"],
  ];
  return vars.flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

/** Where the staged skills are inside the box. */
export const BOX_SKILLS = "/skills";

/** TEST-NET-1 (RFC 5737): never routed, so every lookup inside the box fails at once. */
export const NO_DNS = "192.0.2.1";

export const containerName = (jobId: string) => `zero-${jobId}-${randomBytes(3).toString("hex")}`;

/**
 * Every hardening flag the box runs with. Pure, so the security posture is
 * unit-tested rather than trusted.
 */
export function boxRunArgs(spec: BoxRunSpec): string[] {
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
    ...ownerUser(spec),
    // No route out and no DNS, so the gate is the only way out and names cannot smuggle data. The DNS server is a
    // documentation address that is never routed (a loopback one would make Docker forward from the host).
    ...(spec.egress ? ["--network", spec.egress.network, "--dns", NO_DNS, ...proxyEnv(spec.egress.proxy)] : []),
    "-v", `${spec.copy}:/work${spec.mount === "ro" ? ":ro" : ""}`,
    ...(spec.skills ? ["-v", `${spec.skills}:${BOX_SKILLS}:ro`] : []),
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
