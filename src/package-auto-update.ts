import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import type { FactoryContext } from "./app.js";
import { acquireDaemonLock, daemonLockHeld, type DaemonLock } from "./daemon-lock.js";
import { inContainer, type FactoryHome } from "./home.js";
import { pidAlive } from "./leftovers.js";
import { readSeen } from "./package-install.js";
import { entryName } from "./packages.js";
import type { Store } from "./state/store.js";

/** Starts `zero package update <name>` as a process of its own and gives its pid; tests inject a fake. */
export type PackageUpdateLauncher = (ctx: FactoryContext, name: string) => Promise<number | undefined>;

/** A release the factory tried to bring a package to on its own. */
export interface PackageAttempt {
  version: string;
  at: string;
}

/** The automatic update at work, or the last one nobody saw end. */
export interface PackageAutoRun extends PackageAttempt {
  package: string;
  pid: number;
}

export const PACKAGE_RUN_KEY = "package-auto-update:run";
/** How long the launched process may take to hold the lock. */
const LAUNCH_MS = 5 * 60_000;
/** How long an automatic update waits for the factory to stop: nobody is there to turn it on again after giving up. */
export const UNATTENDED_SHUTDOWN_MS = 30 * 60_000;
const ATTEMPTS_KEPT = 50;

const attemptsKey = (name: string) => `package-auto-update:attempts:${name}`;

function readJson<T>(store: Pick<Store, "getKv">, key: string): T | undefined {
  try {
    const raw = store.getKv(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

const readAttempts = (store: Pick<Store, "getKv">, name: string): PackageAttempt[] => readJson<PackageAttempt[]>(store, attemptsKey(name)) ?? [];

export const readPackageRun = (store: Pick<Store, "getKv">) => readJson<PackageAutoRun>(store, PACKAGE_RUN_KEY);

/** When the factory tried that release of a package on its own; undefined when it did not. */
export const attemptOf = (store: Pick<Store, "getKv">, name: string, version: string) => readAttempts(store, name).find((a) => a.version === version);

export function recordAttempt(store: Pick<Store, "getKv" | "setKv">, name: string, attempt: PackageAttempt): void {
  const others = readAttempts(store, name).filter((a) => a.version !== attempt.version);
  store.setKv(attemptsKey(name), JSON.stringify([...others, attempt].slice(-ATTEMPTS_KEPT)));
}

const lockOf = (home: Pick<FactoryHome, "packageUpdateLock">) => ({ daemonLock: home.packageUpdateLock });

/** Held by a package update, by hand or automatic, from its start to its end; undefined while another one runs. It dies with its process. */
export const acquirePackageUpdateLock = (home: Pick<FactoryHome, "packageUpdateLock">): DaemonLock | undefined => acquireDaemonLock(lockOf(home));

export const packageUpdateLockHeld = (home: Pick<FactoryHome, "packageUpdateLock">): boolean => daemonLockHeld(lockOf(home));

/** The automatic update at work, across restarts of the daemon: its process lives, and holds the lock or has not had time to. */
export function packageRunUnderWay(ctx: Pick<FactoryContext, "store" | "home">, now: Date): PackageAutoRun | undefined {
  const run = readPackageRun(ctx.store);
  if (!run || !pidAlive(run.pid)) return undefined;
  return now.getTime() - Date.parse(run.at) < LAUNCH_MS || packageUpdateLockHeld(ctx.home) ? run : undefined;
}

/** Whether this process is the one the daemon started. */
export const isAutomaticUpdate = (store: Pick<Store, "getKv">) => readPackageRun(store)?.pid === process.pid;

export interface PackageNewRelease {
  name: string;
  version: string;
  /** When the factory already tried it on its own. */
  attempt?: PackageAttempt;
}

/** The packages on the stable channel with a newer release on record; no network. */
export function packagesWithNewRelease(ctx: Pick<FactoryContext, "config" | "store" | "home">): PackageNewRelease[] {
  return ctx.config.packages.flatMap((entry) => {
    if (!entry.git || entry.channel !== "estable") return [];
    const name = entryName(entry, ctx.home);
    const seen = readSeen(ctx.store, name);
    if (!seen?.seen || !seen.version || seen.seen === entry.commit || seen.ahead === entry.commit) return [];
    const attempt = attemptOf(ctx.store, name, seen.version);
    return [{ name, version: seen.version, ...(attempt && { attempt }) }];
  });
}

/** The releases the factory tried and did not apply, which are left for the person in charge. */
export function packagesToApplyByHand(ctx: Pick<FactoryContext, "config" | "store" | "home">, now: Date): { package: string; version: string; at: string }[] {
  const tried = packagesWithNewRelease(ctx).filter((p) => p.attempt);
  if (!tried.length) return [];
  const run = packageRunUnderWay(ctx, now);
  return tried.filter((p) => run?.package !== p.name).map((p) => ({ package: p.name, version: p.version, at: p.attempt!.at }));
}

/** The next package to update on its own; only with automatic updates on, and never a release already tried. */
export function duePackageUpdate(ctx: Pick<FactoryContext, "config" | "store" | "home">): PackageNewRelease | undefined {
  if (!ctx.config.selfUpdate.enabled) return undefined;
  return packagesWithNewRelease(ctx).find((p) => !p.attempt);
}

/** Starts the update, with its attempt on record before anything runs, so a failure or a restart never tries that release again. */
export async function launchPackage(ctx: FactoryContext, due: PackageNewRelease, launch: PackageUpdateLauncher, now: Date): Promise<void> {
  const attempt: PackageAttempt = { version: due.version, at: now.toISOString() };
  recordAttempt(ctx.store, due.name, attempt);
  const pid = await launch(ctx, due.name);
  if (pid !== undefined) ctx.store.setKv(PACKAGE_RUN_KEY, JSON.stringify({ package: due.name, ...attempt, pid } satisfies PackageAutoRun));
}

/** The real launcher: no terminal, so nobody answers yes to a package that asks for more; what it says goes to the daemon's log. */
export const launchPackageUpdate: PackageUpdateLauncher = async (ctx, name) => {
  // The container ends with its daemon, and the update would go with it.
  if (inContainer()) throw new Error("en el contenedor la actualización no sobrevive al apagado de la fábrica");
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot locate the zero CLI to start the package update");
  const out = openSync(ctx.home.daemonLog, "a");
  try {
    const child = spawn(process.execPath, [...process.execArgv, entry, "package", "update", name], {
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
      env: { ...process.env, ZERO_HOME: ctx.home.root },
    });
    await new Promise<void>((resolve, reject) => child.once("spawn", resolve).once("error", reject));
    child.unref();
    return child.pid;
  } finally {
    closeSync(out);
  }
};
