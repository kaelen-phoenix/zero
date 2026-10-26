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
  /** Shared with the egress gate's container: its policy, the passes of running boxes and its connection records. */
  gate: string;
}

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
    gate: join(abs, "gate"),
  };
}
