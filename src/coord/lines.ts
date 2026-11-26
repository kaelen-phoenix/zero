import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { addSharedLine, renameFolder, type FactoryContext } from "../app.js";
import { ownedBy, type FactoryConfig, type LineConfig } from "../config.js";
import { githubHalt } from "../github-quota.js";
import { killTree } from "../leftovers.js";
import { githubRepository } from "../line/integrate.js";
import { scrubLocal } from "../line/research.js";
import { log } from "../log.js";
import { machineCapabilities, machineIdentity, type MachineIdentity } from "../machine.js";
import { cleanError, findGit, gitEnv } from "../package-install.js";
import { factoryConfig, isInside } from "../packages.js";
import { TRUSTED_CWD, tryGit } from "../shell.js";
import type { Store } from "../state/store.js";
import { coordReady } from "./pass.js";
import { CoordConflict, lineRef, readLineRecord, type CoordApi, type CoordRef, type LineRecord } from "./protocol.js";
import { primaryEngines } from "./queue.js";

/** `coord:line:<name>`: what this machine did with a line another one published. */
export const lineKey = (name: string) => `coord:line:${name}`;
const LINE_PREFIX = lineKey("");

/** Every line published in the coordination repository as the last pass read it, on this machine or not. */
export const PUBLISHED_LINES_KEY = "coord:lines";

/** A failed clone is tried again at most this often. */
export const CLONE_RETRY_MS = 60 * 60_000;
const CLONE_TIMEOUT_MS = 30 * 60_000;

/** `cloned` stays while the line is taken out by hand, so it does not come back on its own. `why` is for the person in charge. */
export interface LineState {
  state: "cloned" | "unattended" | "failed";
  repository: string;
  at: string;
  why?: string;
}

/** Clones `url` at `branch` into `dir`, an empty folder, or throws with a reason fit to show. */
export type LineCloner = (input: { url: string; branch: string; dir: string; signal?: AbortSignal }) => Promise<void>;

export interface LinesResult {
  cloned: string[];
  unattended: { name: string; why: string }[];
  failed: { name: string; why: string }[];
}

export interface LinesOptions {
  now?: () => Date;
  platform?: NodeJS.Platform;
  clone?: LineCloner;
  signal?: AbortSignal;
}

/** A published line that is not on this machine, and why. */
export interface LineAway {
  name: string;
  state: "unattended" | "failed";
  why: string;
}

/** The published lines that are not on this machine: its requests for them go out through the shared queue. */
export function publishedElsewhere(ctx: { store: Store; config: FactoryConfig }): LineRecord[] {
  const raw = coordReady(ctx) ? ctx.store.getKv(PUBLISHED_LINES_KEY) : undefined;
  if (!raw) return [];
  try {
    const all = JSON.parse(raw) as LineRecord[] | null;
    return Array.isArray(all) ? all.filter((r) => !ctx.config.lines.some((l) => l.name === r.name)) : [];
  } catch {
    return [];
  }
}

/** The published lines the last pass left out of this machine, by name. */
export function linesAway(ctx: { store: Store; config: FactoryConfig }): LineAway[] {
  return ctx.store.kvWithPrefix(LINE_PREFIX).flatMap(([key]) => {
    const name = key.slice(LINE_PREFIX.length);
    const last = readLineState(ctx.store, name);
    if (!last || last.state === "cloned" || ctx.config.lines.some((l) => l.name === name)) return [];
    return [{ name, state: last.state, why: last.why ?? "" }];
  });
}

/** Lets the lines cloned here and then taken out by hand be cloned again: joining again asks for it. */
export function forgetTakenOut(ctx: { store: Store; config: FactoryConfig }): void {
  for (const [key] of ctx.store.kvWithPrefix(LINE_PREFIX)) {
    const name = key.slice(LINE_PREFIX.length);
    if (readLineState(ctx.store, name)?.state === "cloned" && !ctx.config.lines.some((l) => l.name === name)) ctx.store.deleteKv(key);
  }
}

/** A failure as it is kept and shown: no credentials, no path of this machine. */
export const lineProblem = (ctx: Pick<FactoryContext, "home">, err: unknown): string => scrubLocal(cleanError(err instanceof Error ? err.message : String(err)), { repo: ctx.home.root });

export function readLineState(store: Store, name: string): LineState | undefined {
  const raw = store.getKv(lineKey(name));
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as LineState | null;
    return v && ["cloned", "unattended", "failed"].includes(v.state) && typeof v.repository === "string" && typeof v.at === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The remotes that are github.com itself: githubRepository alone would also read a folder or another host named like it. */
const GITHUB_REMOTE = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)/i;

/** Absolute paths scrubLocal leaves alone, and the home folder: on another machine they mean something else. */
const COMMAND_PATH = /(?<![\w.:/~-])(?:~[\\/]|\\\\[\w.-]+\\|\/(?:tmp|opt|mnt|srv|var|etc|data|private|Volumes|workspace|Applications)\/)/;

/** What this machine publishes of a line; undefined when it is not one to share. */
function lineRecord(config: FactoryConfig, line: LineConfig, machine: MachineIdentity, now: Date): LineRecord | undefined {
  const url = tryGit(["remote", "get-url", line.remote], line.repo);
  const repository = url && GITHUB_REMOTE.test(url) ? githubRepository(url) : undefined;
  if (!repository) return undefined;
  if ([...line.setup, ...line.verify].some((c) => COMMAND_PATH.test(c) || scrubLocal(c, line) !== c)) return undefined;
  const record: LineRecord = {
    name: line.name,
    repository,
    baseBranch: line.baseBranch,
    setup: line.setup,
    verify: line.verify,
    ...(line.verifyTimeoutMinutes !== undefined && { verifyTimeoutMinutes: line.verifyTimeoutMinutes }),
    integrate: line.integrate,
    autoMerge: line.autoMerge,
    needs: { engines: primaryEngines(config), platforms: line.platforms ?? [] },
    machine: machine.id,
    at: now.toISOString(),
  };
  // What another machine would not accept (a credential included) is not published either.
  return readLineRecord({ name: lineRef(line.name), sha: "", data: JSON.stringify(record) });
}

/** Creates the record of each line of this machine that has none, and updates its own when the line changed; another machine's is never touched. */
async function publishLines(ctx: FactoryContext, api: CoordApi, machine: MachineIdentity, refs: Map<string, CoordRef>, now: Date): Promise<void> {
  const content = (r: LineRecord) => JSON.stringify({ ...r, at: "" });
  for (const line of ctx.config.lines) {
    const name = lineRef(line.name);
    const ref = refs.get(name);
    const published = ref && readLineRecord(ref);
    // The record of another machine, or one that does not read, stays as it is.
    if (ref && published?.machine !== machine.id) continue;
    if (ownedBy(line) || isInside(line.repo, ctx.home.lines) || readLineState(ctx.store, line.name)?.state === "cloned") continue;
    const record = lineRecord(ctx.config, line, machine, now);
    if (!record || (published && content(published) === content(record))) continue;
    try {
      if (ref) await api.update(name, JSON.stringify(record), ref.sha);
      else await api.create(name, JSON.stringify(record));
    } catch (err) {
      if (!(err instanceof CoordConflict)) throw err;
    }
  }
}

/** Why this machine does not take a line: its platform, or an engine no chain here has; undefined when it can. */
export function unattendedWhy(needs: LineRecord["needs"], config: FactoryConfig, platform: NodeJS.Platform = process.platform): string | undefined {
  const here = machineCapabilities(config, undefined, platform);
  if (needs.platforms.length && !needs.platforms.some((p) => p === here.platform)) return `por la plataforma: pide ${needs.platforms.join(" o ")} y esta máquina es ${here.platform}`;
  const missing = needs.engines.filter((e) => !here.engines.includes(e));
  return missing.length ? `por los motores: falta ${missing.join(", ")}` : undefined;
}

const cloneUrl = (repository: string) => `https://github.com/${repository}.git`;

/** Where a line's clone lives; undefined for a name that would leave `ZERO_HOME/lines`. */
function cloneFolder(home: FactoryContext["home"], name: string): string | undefined {
  const dir = join(home.lines, name);
  return dir !== join(home.lines) && isInside(dir, home.lines) && join(dir, "..") === join(home.lines) ? dir : undefined;
}

/**
 * Clones a published line into a temporary folder that takes its name only once
 * the clone is whole, and then adds the line. A folder a cut pass left already
 * cloned from that same repository is used as it is.
 */
async function cloneLine(ctx: FactoryContext, record: LineRecord, clone: LineCloner, signal?: AbortSignal): Promise<void> {
  const dir = cloneFolder(ctx.home, record.name);
  if (!dir) throw new Error(`el nombre "${record.name}" sale de la carpeta de líneas`);
  const url = cloneUrl(record.repository);
  const whole = () => {
    if (!existsSync(dir)) return false;
    if (!existsSync(join(dir, ".git")) || tryGit(["config", "--get", "remote.origin.url"], dir) !== url) throw new Error("su carpeta en ZERO_HOME/lines ya existe y no es un clon de ese repositorio");
    return true;
  };
  if (!whole()) {
    await mkdir(ctx.home.lines, { recursive: true });
    // A line's name never starts with a dot, so it cannot be another line's folder.
    const temp = await mkdtemp(join(ctx.home.lines, `.${record.name}-`));
    try {
      await clone({ url, branch: record.baseBranch, dir: temp, signal });
      signal?.throwIfAborted();
      if (tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${record.baseBranch}^{commit}`], temp) === undefined) throw new Error(`el repositorio no tiene la rama ${record.baseBranch}`);
      // The daemon's pass and `zero unirse` may clone it at the same time: the first one to finish stays.
      if (!whole()) await renameFolder(temp, dir);
    } finally {
      await rm(temp, { recursive: true, force: true, maxRetries: 3 }).catch((err) => log.warn("cannot remove a line's partial clone", { line: record.name, error: String(err) }));
    }
  }
  await addSharedLine(ctx, record, dir);
}

/** git on its own, never asking for anything: the credentials are whatever its credential helper gives. A time limit or an abort kills it with everything it started. */
export const gitCloneLine: LineCloner = ({ url, branch, dir, signal }) =>
  new Promise((resolve, reject) => {
    const git = findGit();
    if (!git) return reject(new Error("No encontré git en el PATH."));
    if (signal?.aborted) return reject(new Error("cortado"));
    const args = ["-c", "core.longpaths=true", "clone", "--quiet", `--branch=${branch}`, "--", url, dir];
    const env = { ...gitEnv(), GIT_ALLOW_PROTOCOL: "https", GIT_ASKPASS: "", GCM_INTERACTIVE: "never" };
    const child = spawn(git, args, { cwd: TRUSTED_CWD, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const kill = () => killTree(child);
    const timer = setTimeout(() => ((timedOut = true), kill()), CLONE_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
    };
    signal?.addEventListener("abort", kill, { once: true });
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr = (stderr + d).slice(-10_000)));
    child.on("error", (err) => (done(), reject(new Error(cleanError(err.message)))));
    child.on("close", (code) => {
      done();
      if (code === 0) return resolve();
      reject(new Error(timedOut ? `el clon superó los ${CLONE_TIMEOUT_MS / 60_000} minutos` : cleanError(stderr) || `git clone terminó con código ${code}`));
    });
  });

/**
 * The factory's lines, in a pass of its own since a clone may take long: this
 * machine's lines on GitHub go out as `lines/<name>`, and those of the other
 * machines whose name is not in the factory file are cloned in ZERO_HOME/lines
 * and added, unless this machine cannot take them. A line that exists is never
 * changed, and one cloned (or published) here and taken out by hand does not come back
 * (one cloned, until `zero unirse` runs again).
 * Undefined, and nothing done, while the protocol is off or GitHub holds a pause.
 */
export async function linesPass(ctx: FactoryContext, api: CoordApi, opts: LinesOptions = {}): Promise<LinesResult | undefined> {
  const { store } = ctx;
  const now = () => (opts.now ?? ctx.now ?? (() => new Date()))();
  if (!coordReady(ctx) || githubHalt(store, now())) return undefined;
  const refs = new Map((await api.list(lineRef(""))).map((r) => [r.name, r]));
  const machine = machineIdentity(store, ctx.config);
  await publishLines(ctx, api, machine, refs, now());

  const result: LinesResult = { cloned: [], unattended: [], failed: [] };
  const records = [...refs.values()].map(readLineRecord).filter((r) => r !== undefined);
  store.setKv(PUBLISHED_LINES_KEY, JSON.stringify(records));
  // What was kept of a line that is here now, or that nobody publishes any more, says nothing.
  for (const [key] of store.kvWithPrefix(LINE_PREFIX)) {
    const name = key.slice(LINE_PREFIX.length);
    if (readLineState(store, name)?.state === "cloned") continue;
    if (ctx.config.lines.some((l) => l.name === name) || !records.some((r) => r.name === name)) store.deleteKv(key);
  }
  for (const record of records) {
    if (opts.signal?.aborted) break;
    // The definition may be reloaded, or stop being distributed, during a long clone.
    if (!coordReady(ctx)) break;
    // Its own record says nothing to it: a line taken out of this machine's file stays out.
    if (record.machine === machine.id) continue;
    const last = readLineState(store, record.name);
    if (last?.state === "cloned") continue;
    const save = (state: LineState["state"], why?: string) =>
      store.setKv(lineKey(record.name), JSON.stringify({ state, repository: record.repository, at: now().toISOString(), ...(why && { why }) } satisfies LineState));
    const existing = ctx.config.lines.find((l) => l.name === record.name);
    if (existing) {
      // Added by a pass that was cut before it could say so.
      if (isInside(existing.repo, ctx.home.lines)) save("cloned");
      continue;
    }
    const unattended = unattendedWhy(record.needs, ctx.config, opts.platform);
    if (unattended) {
      if (last?.state !== "unattended" || last.why !== unattended || last.repository !== record.repository) save("unattended", unattended);
      result.unattended.push({ name: record.name, why: unattended });
      continue;
    }
    if (last?.state === "failed" && last.repository === record.repository && now().getTime() - Date.parse(last.at) < CLONE_RETRY_MS) {
      result.failed.push({ name: record.name, why: last.why ?? "" });
      continue;
    }
    try {
      await cloneLine(ctx, record, opts.clone ?? gitCloneLine, opts.signal);
      save("cloned");
      result.cloned.push(record.name);
      log.info("line of the factory cloned", { line: record.name, repository: record.repository });
    } catch (err) {
      // A shutdown cut it: nothing failed, the next pass starts over.
      if (opts.signal?.aborted) break;
      // Another process of this machine added it meanwhile: the line is here.
      const fresh = await factoryConfig(ctx.home).catch(() => undefined);
      if (fresh?.lines.some((l) => l.name === record.name && isInside(l.repo, ctx.home.lines))) {
        ctx.config = fresh;
        save("cloned");
        result.cloned.push(record.name);
        continue;
      }
      const why = lineProblem(ctx, err);
      save("failed", why);
      result.failed.push({ name: record.name, why });
      log.warn("cloning a line of the factory failed", { line: record.name, repository: record.repository, error: why });
    }
  }
  return result;
}
