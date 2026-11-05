import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Everything a factory owns lives under one directory: ZERO_HOME, or ~/.zero. */
export interface FactoryHome {
  root: string;
  config: string;
  db: string;
  townhall: string;
  worktrees: string;
  jobs: string;
  daemonLog: string;
  /** Held by the running daemon (see daemon-lock.ts). */
  daemonLock: string;
  /** Shared with the egress gate's container: its policy, the passes of running boxes and its connection records. */
  gate: string;
  /** Optional helper binaries zero downloads with the owner's consent (cloudflared). */
  bin: string;
  /** Agent packages installed from npm, in its `node_modules`. */
  packages: string;
}

/** The official image sets ZERO_CONTAINER=1: no system keychain, and no falling back to local copies without the owner's say. */
export const inContainer = (env: NodeJS.ProcessEnv = process.env): boolean => env.ZERO_CONTAINER === "1";

export function factoryHome(root = process.env.ZERO_HOME ?? join(homedir(), ".zero")): FactoryHome {
  const abs = resolve(root);
  return {
    root: abs,
    config: join(abs, "zero.factory.yaml"),
    db: join(abs, "state.db"),
    townhall: join(abs, "townhall"),
    worktrees: join(abs, "worktrees"),
    jobs: join(abs, "jobs"),
    daemonLog: join(abs, "daemon.log"),
    daemonLock: join(abs, "daemon.lock"),
    gate: join(abs, "gate"),
    bin: join(abs, "bin"),
    packages: join(abs, "packages"),
  };
}
