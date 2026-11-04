import { existsSync } from "node:fs";
import type { FactoryHome } from "./home.js";
import { loadSqlite } from "./state/store.js";

const { DatabaseSync: Database } = loadSqlite();

const SQLITE_BUSY = 5;
/** Long enough to outlast another process's `daemonLockHeld`, which takes a shared lock for an instant. */
const ACQUIRE_WAIT_MS = 1_000;

const isBusy = (err: unknown) => ((err as { errcode?: number }).errcode! & 0xff) === SQLITE_BUSY;

export interface DaemonLock {
  release(): void;
}

/**
 * Takes the factory's exclusive lock, or returns undefined if another holder has it.
 * Node has no file-lock API, and SQLite's transaction lock is an operating system one
 * (LockFileEx, fcntl): it dies with the process, children do not inherit it and it needs no native
 * dependency. The file stays empty: the transaction never writes, and without a journal on disk it leaves nothing behind.
 * Keep the returned object referenced: collecting it would close the database and drop the lock.
 */
export function acquireDaemonLock(home: Pick<FactoryHome, "daemonLock">): DaemonLock | undefined {
  const db = new Database(home.daemonLock);
  try {
    db.exec(`PRAGMA busy_timeout=${ACQUIRE_WAIT_MS}`);
    db.exec("PRAGMA journal_mode=MEMORY");
    db.exec("BEGIN EXCLUSIVE");
  } catch (err) {
    db.close();
    if (isBusy(err)) return undefined;
    throw err; // never run without the lock
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    },
  };
}

/** Whether a process (this one too) holds the lock. A read-only look: it never creates the file nor takes the lock for long. */
export function daemonLockHeld(home: Pick<FactoryHome, "daemonLock">): boolean {
  if (!existsSync(home.daemonLock)) return false;
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(home.daemonLock, { readOnly: true });
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return false;
  } catch (err) {
    return isBusy(err);
  } finally {
    db?.close();
  }
}
