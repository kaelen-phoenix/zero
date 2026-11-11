import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { log } from "./log.js";
import { tryGit } from "./shell.js";
import type { Store } from "./state/store.js";

/** Where the running zero is installed: the parent of the folder holding cli.js (`dist` once built). */
export function installFolder(entry: string = process.argv[1] ?? ""): string {
  return dirname(dirname(resolve(entry)));
}

/** `zero <version>` plus the install folder's short commit when git can tell it. */
export function versionText(install: string = installFolder()): string {
  let version = "desconocida";
  try {
    version = String((JSON.parse(readFileSync(join(install, "package.json"), "utf8")) as { version?: unknown }).version ?? version);
  } catch {
    // Without a readable package.json the version is unknown, never an error.
  }
  const commit = tryGit(["rev-parse", "--short", "HEAD"], install);
  return commit ? `zero ${version} (${commit})` : `zero ${version}`;
}

export const SELF_UPDATE_STATE_KEY = "self-update:state";
export const SELF_UPDATE_HISTORY_KEY = "self-update:history";
/** How many past updates the history keeps. */
export const HISTORY_LIMIT = 20;

/** Where the self-update stands: idle, a prepared version waiting for a free factory, or a switch under way. */
export interface SelfUpdateState {
  status: "idle" | "ready" | "switching";
  /** Commit running when the update was prepared. */
  from?: string;
  /** Commit prepared. */
  to?: string;
  /** Folder holding the prepared version. */
  dir?: string;
  /** Last check (ISO). */
  checkedAt?: string;
  /** The current problem, recorded once per distinct text. */
  problem?: string;
  /** Commits whose preparation or start failed; never prepared again. */
  failed?: string[];
}

export type SelfUpdateOutcome = "updated" | "rolled-back" | "failed";

export interface SelfUpdateEntry {
  from: string;
  to: string;
  /** When it happened (ISO). */
  at: string;
  outcome: SelfUpdateOutcome;
  reason?: string;
}

const IDLE: SelfUpdateState = { status: "idle" };

/** The state and history on record; a store failure or a broken record reads as nothing. */
export function readSelfUpdate(store: Store): { state: SelfUpdateState; history: SelfUpdateEntry[] } {
  let state: SelfUpdateState = IDLE;
  let history: SelfUpdateEntry[] = [];
  try {
    const raw = store.getKv(SELF_UPDATE_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SelfUpdateState) : undefined;
    if (parsed && typeof parsed === "object" && ["idle", "ready", "switching"].includes(parsed.status)) state = parsed;
  } catch (err) {
    log.warn("cannot read self-update state", { error: String(err) });
  }
  try {
    const raw = store.getKv(SELF_UPDATE_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) history = parsed.filter((e): e is SelfUpdateEntry => Boolean(e) && typeof e.from === "string" && typeof e.to === "string" && typeof e.at === "string");
  } catch (err) {
    log.warn("cannot read self-update history", { error: String(err) });
  }
  return { state, history };
}

/** Writes the state and, when given, appends an entry to the history (last HISTORY_LIMIT kept); store failures are logged, never thrown. */
export function recordSelfUpdate(store: Store, change: { state?: SelfUpdateState; entry?: SelfUpdateEntry }): void {
  try {
    if (change.state) store.setKv(SELF_UPDATE_STATE_KEY, JSON.stringify(change.state));
    if (change.entry) {
      const history = [...readSelfUpdate(store).history, change.entry].slice(-HISTORY_LIMIT);
      store.setKv(SELF_UPDATE_HISTORY_KEY, JSON.stringify(history));
    }
  } catch (err) {
    log.warn("cannot record self-update", { error: String(err) });
  }
}
