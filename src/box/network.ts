import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log.js";
import type { Store } from "../state/store.js";
import { EgressEventSchema, type EgressEvent, type EgressPolicy } from "./egress.js";
import { GATE_PORT } from "./gate.js";
import { ownerUser } from "./run.js";
import { exec as realExec, type Exec, type Runtime } from "./runtime.js";

/** The internal network the boxes run on: no route out, only the gate. */
export const NETWORK = "zero-box";
const DEFAULT_NETWORK: Record<Runtime, string> = { podman: "podman", docker: "bridge" };
const EVENTS_FILE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const KEEP_DAYS = 90;
const READY_TIMEOUT_MS = 30_000;

/** One factory, one gate: the name is tied to the factory's gate directory. */
export const gateName = (dir: string) => `zero-gate-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}`;

export interface GateSpec {
  runtime: Runtime;
  image: string;
  dir: string;
  name: string;
  nonce: string;
  platform?: NodeJS.Platform;
  uid?: number;
  gid?: number;
}

/** The gate is zero's own code, hardened like the box, with one mount: its shared directory. */
export function gateRunArgs(spec: GateSpec): string[] {
  return [
    "run", "-d", "--rm",
    "--name", spec.name,
    "--label", `zero.image=${spec.image}`,
    "--network", NETWORK,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    "--tmpfs", "/tmp:rw,size=64m",
    "--cpus", "1",
    "--memory", "256m",
    "--pids-limit", "128",
    ...ownerUser(spec),
    "-v", `${spec.dir}:/gate`,
    "-e", "ZERO_GATE_DIR=/gate",
    "-e", `ZERO_GATE_START=${spec.nonce}`,
    spec.image,
    "node", "/opt/zero/dist/box/gate-main.js",
  ];
}

/** One box run's way out: its network and the proxy URL carrying its pass. */
export interface GateDoor {
  network: string;
  proxy: string;
  /** Revokes the pass. */
  close(): void;
}

export interface GateHost {
  /** Starts the gate if needed and issues a pass for one box run. */
  open(run: { jobId: string; station: string }): Promise<GateDoor>;
  /** Moves the gate's records into the factory's state. Never throws. */
  ingest(): void;
}

export interface GateHostOptions {
  runtime: Runtime;
  image: string;
  dir: string;
  store: Store;
  /** Read at every run, so rule changes apply to the next box run. */
  policy: () => EgressPolicy;
  exec?: Exec;
  sleep?: (ms: number) => Promise<void>;
}

interface GateInfo {
  running: boolean;
  image?: string;
  address?: string;
}

function inspectGate(rt: Runtime, name: string, run: Exec): GateInfo | undefined {
  const r = run(rt, ["container", "inspect", name], { timeoutMs: 30_000 });
  if (r.status !== 0) return undefined;
  try {
    const [c] = JSON.parse(r.stdout) as { State?: { Running?: boolean }; Config?: { Labels?: Record<string, string> }; NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> } }[];
    return { running: Boolean(c?.State?.Running), image: c?.Config?.Labels?.["zero.image"], address: c?.NetworkSettings?.Networks?.[NETWORK]?.IPAddress || undefined };
  } catch {
    return undefined;
  }
}

function writeIfChanged(path: string, text: string) {
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
}

const tail = (s: string) => s.trim().slice(-800);

export function createGateHost(opts: GateHostOptions): GateHost {
  const run = opts.exec ?? realExec;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const name = gateName(opts.dir);
  const must = (args: string[], what: string) => {
    const r = run(opts.runtime, args, { timeoutMs: 120_000 });
    if (r.status !== 0) throw new Error(`${what}: ${tail(r.stderr || r.stdout)}`);
    return r;
  };

  /** The gate's address on the internal network, starting it (or restarting it for a new image) when needed. */
  async function ensure(): Promise<string> {
    if (run(opts.runtime, ["network", "inspect", NETWORK], { timeoutMs: 30_000 }).status !== 0) {
      must(["network", "create", "--internal", NETWORK], "no se pudo crear la red interna de la caja");
    }
    const info = inspectGate(opts.runtime, name, run);
    if (info?.running && info.image === opts.image && info.address) return info.address;
    if (info) run(opts.runtime, ["rm", "-f", name], { timeoutMs: 60_000 });

    // A fresh gate: passes of runs that died with the previous one are void.
    rmSync(join(opts.dir, "runs"), { recursive: true, force: true });
    mkdirSync(join(opts.dir, "runs"), { recursive: true });
    rmSync(join(opts.dir, "ready"), { force: true });
    const nonce = randomBytes(8).toString("hex");
    must(gateRunArgs({ runtime: opts.runtime, image: opts.image, dir: opts.dir, name, nonce }), "no se pudo encender la puerta de salida");
    must(["network", "connect", DEFAULT_NETWORK[opts.runtime], name], "no se pudo conectar la puerta de salida a internet");

    const ready = join(opts.dir, "ready");
    for (const started = Date.now(); Date.now() - started < READY_TIMEOUT_MS; await sleep(200)) {
      if (existsSync(ready) && readFileSync(ready, "utf8") === nonce) {
        const address = inspectGate(opts.runtime, name, run)?.address;
        if (address) return address;
      }
    }
    const logs = run(opts.runtime, ["logs", name], { timeoutMs: 30_000 });
    throw new Error(`la puerta de salida no respondió a tiempo: ${tail(logs.stderr || logs.stdout) || "sin registros"}`);
  }

  // Box runs of different jobs may open the gate at once; only one of them starts it.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    open: (r) =>
      serialized(async () => {
        mkdirSync(join(opts.dir, "runs"), { recursive: true });
        writeIfChanged(join(opts.dir, "policy.json"), JSON.stringify(opts.policy()));
        const address = await ensure();
        const pass = randomBytes(12).toString("hex");
        const file = join(opts.dir, "runs", `${pass}.json`);
        writeFileSync(file, JSON.stringify({ job: r.jobId, station: r.station }));
        return { network: NETWORK, proxy: `http://zero:${pass}@${address}:${GATE_PORT}`, close: () => rmSync(file, { force: true }) };
      }),
    ingest: () => {
      try {
        ingestEgress(opts.store, opts.dir);
      } catch (err) {
        log.warn("cannot read the egress gate's records", { error: String(err) });
      }
    },
  };
}

function readFrom(path: string, offset: number, size: number): Buffer {
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, offset);
  } finally {
    closeSync(fd);
  }
  return buf;
}

/**
 * Moves the gate's records into the store. Each file remembers how far it was
 * read; reading and inserting happen in one transaction, so the daemon and the
 * CLI can ingest at once without duplicates. Only complete lines are taken.
 * Files of past days are removed once read; rows are kept 90 days.
 */
export function ingestEgress(store: Store, dir: string, now = new Date()): number {
  if (!existsSync(dir)) return 0;
  const today = now.toISOString().slice(0, 10);
  let added = 0;
  for (const name of readdirSync(dir).sort()) {
    const day = EVENTS_FILE.exec(name)?.[1];
    if (!day) continue;
    const path = join(dir, name);
    const key = `egress.offset.${name}`;
    const complete = store.transaction(() => {
      const offset = Number(store.getKv(key) ?? 0);
      const size = statSync(path).size;
      if (size <= offset) return true;
      const chunk = readFrom(path, offset, size);
      const end = chunk.lastIndexOf(0x0a) + 1;
      const events: EgressEvent[] = [];
      for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          events.push(EgressEventSchema.parse(JSON.parse(line)));
        } catch {
          log.warn("skipping a malformed egress record", { file: name });
        }
      }
      added += store.insertEgress(events);
      store.setKv(key, String(offset + end));
      return offset + end === size;
    });
    if (complete && day < today) {
      rmSync(path, { force: true });
      store.deleteKv(key);
    }
  }
  store.pruneEgress(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  return added;
}
