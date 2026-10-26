import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import type { AgentRequest, AgentRun, AgentRunner, AgentStation } from "../src/agent.js";
import { openTownhall, type FactoryContext } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { factoryHome } from "../src/home.js";
import type { Spec } from "../src/line/spec.js";
import type { Review } from "../src/line/review.js";
import { Store } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { Tracer } from "../src/telemetry/tracer.js";
import type { BoxExecutor } from "../src/box/executor.js";
import { sh } from "../src/shell.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";

const dirs: string[] = [];
const stores: Store[] = [];

export function tempDir(prefix = "zero-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export function cleanup() {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed by the test
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function run(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

export const gitIn = (cwd: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], cwd);

export function writeTree(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A git repository on `main` with one commit. */
export function gitRepo(files: Record<string, string> = { "README.md": "# demo\n" }): string {
  const repo = tempDir("zero-repo-");
  run("git", ["init", "-q", "-b", "main"], repo);
  run("git", ["config", "core.autocrlf", "false"], repo);
  writeTree(repo, files);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "init");
  return repo;
}

/** A state store in a temporary directory, closed after the test. */
export function testStore(name = "state.db"): Store {
  const store = new Store(join(tempDir(), name));
  stores.push(store);
  return store;
}

/** A factory in a temporary ZERO_HOME, with the given definition. */
export function testFactory(definition: Record<string, unknown>, now?: () => Date): FactoryContext {
  const home = factoryHome(tempDir("zero-home-"));
  const yaml = stringify(definition);
  mkdirSync(home.root, { recursive: true });
  writeFileSync(home.config, yaml);
  const store = new Store(home.db, now);
  stores.push(store);
  return { home, config: parseFactory(yaml), store, tracer: new Tracer(store, now), townhall: openTownhall(home, now), secrets: new SecretStore(home, memoryKeyring(), {}), now };
}

export const validSpec = (over: Partial<Spec> = {}): Spec => ({
  feasible: true,
  reason: "",
  title: "Health endpoint",
  summary: "Vas a tener una dirección /health que confirma que el servicio está vivo.",
  capability: "health-check",
  requirements: [
    {
      name: "Health check",
      text: "The service SHALL answer GET /health with status 200.",
      scenarios: [{ name: "Alive", when: "a client requests GET /health", then: "the response status is 200" }],
    },
  ],
  tasks: ["Add the route", "Add a test"],
  risks: [],
  learnings: [],
  followUps: [],
  ...over,
});

export const cleanReview = (over: Partial<Review> = {}): Review => ({ summary: "LGTM", findings: [], learnings: [], ...over });

type Handler = (req: AgentRequest<any>, call: number) => Partial<AgentRun<any>> | void | Promise<Partial<AgentRun<any>> | void>;

/**
 * An agent runner that never calls a model: each station runs a handler that
 * can write files in `req.cwd` and return structured output. Records an
 * agent span like the real runner does.
 */
export function fakeAgents(handlers: Partial<Record<AgentStation, Handler>>, costPerCall = 0.1) {
  const calls: AgentRequest<any>[] = [];
  const count: Record<string, number> = {};
  const runner: AgentRunner = async <T>(req: AgentRequest<T>): Promise<AgentRun<T>> => {
    calls.push(req);
    count[req.station] = (count[req.station] ?? 0) + 1;
    const span = req.trace?.tracer.start(AGENT_SPAN, { jobId: req.trace.jobId, parentId: req.trace.parentId, attrs: { "gen_ai.agent.name": req.station, "zero.engine": "fake" } });
    const fallback: Partial<AgentRun<any>> =
      req.station === "spec" ? { output: validSpec() } : req.station === "review" ? { output: cleanReview() } : {};
    const result = { ok: true, text: "done", costUsd: costPerCall, costSource: "reported" as const, engine: "fake", ...fallback, ...((await handlers[req.station]?.(req, count[req.station]!)) ?? {}) };
    span?.end(result.ok ? "ok" : "error", { "zero.cost.usd": result.costUsd, "zero.cost.source": result.costSource });
    return result as AgentRun<T>;
  };
  return { runner, calls, count };
}

/**
 * A box that runs everything on this machine, recording what would have run
 * inside the container. Exercises the box code path (clone copy, shell routed
 * through the box, publish before integrating) without a container runtime.
 */
export function simulatedBox(agentRunner: AgentRunner) {
  const calls: { command: string; mount: string; cwd: string }[] = [];
  const box: BoxExecutor = {
    runtime: "simulated",
    image: "zero-box:test",
    async shell(command, o) {
      calls.push({ command, mount: o.mount, cwd: o.cwd });
      return sh(command, o.cwd, { timeoutMs: o.timeoutMs ?? 60_000, signal: o.signal });
    },
    agentRunner: () => agentRunner,
  };
  return { box, calls };
}
