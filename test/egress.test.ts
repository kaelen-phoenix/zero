import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request, type Server as HttpServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from "node:net";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { answer, briefing, egressReport, requestWork, setEgressMode, setEgressRule, trace } from "../src/app.js";
import { egressPolicy, judgeAddresses, judgeName, matchesSite, type EgressEvent, type EgressPolicy } from "../src/box/egress.js";
import { createBoxExecutor } from "../src/box/executor.js";
import { createGate, eventsFile, parseAuthority } from "../src/box/gate.js";
import { createGateHost, gateName, gateRunArgs, ingestEgress, NETWORK, type GateHost } from "../src/box/network.js";
import { boxRunArgs } from "../src/box/run.js";
import type { Exec } from "../src/box/runtime.js";
import { parseFactory } from "../src/config.js";
import { formatEgress } from "../src/format.js";
import { runJob } from "../src/line/runner.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { Store } from "../src/state/store.js";
import { summarizeEgress } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, simulatedBox, tempDir, testFactory, testStore, writeTree } from "./helpers.js";

const servers: (HttpServer | TcpServer)[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  cleanup();
});

const blocklist = (over: Partial<EgressPolicy> = {}): EgressPolicy => ({ mode: "blocklist", allow: [], block: [], ...over });
const listen = async <T extends HttpServer | TcpServer>(server: T): Promise<number> => {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
};

describe("egress rules", () => {
  it("lets an ordinary site through to be resolved, and checks what it resolves to", () => {
    expect(judgeName({ host: "registry.npmjs.org", port: 443 }, blocklist())).toBeUndefined();
    expect(judgeAddresses(["104.16.0.35"])).toEqual({ allowed: true });
    expect(judgeAddresses(["104.16.0.35", "192.168.1.10"])).toMatchObject({ allowed: false, rule: "suspicious", reason: expect.stringContaining("red local") });
  });

  it("refuses what an agent has no reason to reach, saying why", () => {
    const why = (host: string, port = 443) => {
      const v = judgeName({ host, port }, blocklist());
      return v && !v.allowed ? `${v.rule}: ${v.reason}` : "allowed";
    };
    expect(why("pastebin.com")).toMatch(/^suspicious: pastebin.com es un servicio para pegar textos/);
    expect(why("abc.webhook.site")).toMatch(/capturar peticiones/);
    expect(why("x.ngrok-free.app")).toMatch(/túnel/);
    expect(why("140.82.112.3")).toMatch(/IP sin nombre/);
    expect(why("10.0.0.5")).toMatch(/red local/);
    expect(why("169.254.169.254", 80)).toMatch(/red local/);
    expect(why("::1")).toMatch(/red local/);
    expect(judgeAddresses(["::ffff:10.0.0.1"])).toMatchObject({ rule: "suspicious" });
    expect(judgeAddresses(["::ffff:a00:1"])).toMatchObject({ rule: "suspicious" });
    expect(judgeAddresses(["2606:4700::6810:84e5"])).toEqual({ allowed: true });
    expect(why("example.com", 22)).toMatch(/puerto poco común \(22\)/);
    expect(why(`${"a".repeat(60)}.attacker.example`)).toMatch(/datos escondidos/);
    // Look-alikes are not the service.
    expect(why("notpastebin.com")).toBe("allowed");
  });

  it("applies the owner's lists first, then suspicions, then the mode", () => {
    const policy = blocklist({ allow: ["nas.local", "192.168.1.20", "registry.local:8443"], block: ["example.com"] });
    expect(judgeName({ host: "api.example.com", port: 443 }, policy)).toMatchObject({ allowed: false, rule: "listed" });
    expect(judgeName({ host: "nas.local", port: 443 }, policy)).toEqual({ allowed: true });
    expect(judgeName({ host: "192.168.1.20", port: 445 }, policy)).toEqual({ allowed: true });
    expect(judgeName({ host: "registry.local", port: 8443 }, policy)).toEqual({ allowed: true });
    expect(judgeName({ host: "registry.local", port: 9000 }, policy)).toMatchObject({ rule: "suspicious" });

    const allowlist = { ...policy, mode: "allowlist" as const };
    expect(judgeName({ host: "nas.local", port: 443 }, allowlist)).toEqual({ allowed: true });
    expect(judgeName({ host: "github.com", port: 443 }, allowlist)).toMatchObject({ allowed: false, rule: "not-allowed" });
    // A suspicious site is still flagged as suspicious in allowlist mode.
    expect(judgeName({ host: "pastebin.com", port: 443 }, allowlist)).toMatchObject({ rule: "suspicious" });
  });

  it("matches a site with its subdomains, never a look-alike", () => {
    expect(matchesSite("github.com", { host: "api.github.com", port: 443 })).toBe(true);
    expect(matchesSite("github.com", { host: "GitHub.com.", port: 443 })).toBe(true);
    expect(matchesSite("github.com", { host: "evilgithub.com", port: 443 })).toBe(false);
    expect(matchesSite("github.com:443", { host: "github.com", port: 80 })).toBe(false);
    expect(matchesSite("10.0.0.1", { host: "10.0.0.10", port: 443 })).toBe(false);
  });

  it("allows the configured engines' sites in every mode", () => {
    const cfg = parseFactory("egress: { mode: allowlist, allow: [Example.com] }\nstations: { build: { engine: codex, timeoutMinutes: 5 } }\nlines: []\n");
    expect(egressPolicy(cfg)).toEqual({ mode: "allowlist", allow: ["example.com", "api.anthropic.com", "api.openai.com", "chatgpt.com"], block: [] });
    const custom = parseFactory("engine: mine\nengines: { mine: { command: [x], hosts: [api.mine.dev] } }\nlines: []\n");
    expect(egressPolicy(custom).allow).toEqual(["api.mine.dev"]);
  });

  it("defaults to blocking only what is suspicious and rejects malformed sites", () => {
    expect(parseFactory("lines: []\n").egress).toEqual({ mode: "blocklist", allow: [], block: [] });
    expect(() => parseFactory("egress: { block: ['http://x.com/path'] }\n")).toThrow(/egress.block/);
  });
});

describe("box network", () => {
  const base = {
    runtime: "podman" as const,
    image: "zero-box:abc",
    copy: "/w",
    mount: "rw" as const,
    limits: { runtime: "auto" as const, cpus: 2, memoryGb: 4, pids: 512 },
    secretNames: [],
    command: ["true"],
    name: "zero-j1-x",
    platform: "win32" as const,
  };

  it("puts the box on the gate's internal network, without DNS, with the proxy and its pass", () => {
    const proxy = `http://zero:${"a".repeat(24)}@10.89.0.2:3128`;
    const args = boxRunArgs({ ...base, egress: { network: NETWORK, proxy } }).join(" ");
    expect(args).toContain("--network zero-box --dns 192.0.2.1");
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) expect(args).toContain(`-e ${name}=${proxy}`);
    expect(args).toContain("-e NO_PROXY=localhost,127.0.0.1,::1");
    expect(args).toContain("-e NODE_USE_ENV_PROXY=1");
  });

  it("runs the gate hardened, with only its own directory mounted", () => {
    const args = gateRunArgs({ runtime: "docker", image: "zero-box:abc", dir: "/f/gate", name: "zero-gate-1", nonce: "n1", platform: "linux", uid: 1000, gid: 1000 });
    const text = args.join(" ");
    for (const flag of ["--cap-drop ALL", "--security-opt no-new-privileges", "--read-only", "--network zero-box", "--label zero.image=zero-box:abc", "--user 1000:1000", "-e ZERO_GATE_START=n1"]) {
      expect(text).toContain(flag);
    }
    expect(args.filter((a) => a === "-v")).toHaveLength(1);
    expect(args.slice(-3)).toEqual(["zero-box:abc", "node", "/opt/zero/dist/box/gate-main.js"]);
  });
});

/** A container runtime that only remembers networks and one gate container. */
function fakeRuntime(dir: string) {
  const calls: string[][] = [];
  const networks = new Set<string>();
  let gate: { image: string } | undefined;
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const exec: Exec = (_bin, args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === "network" && b === "inspect") return networks.has(args[2]!) ? ok() : { status: 1, stdout: "", stderr: "no such network" };
    if (a === "network" && b === "create") return networks.add(args.at(-1)!), ok();
    if (a === "network" && b === "connect") return ok();
    if (a === "container" && b === "inspect") {
      if (!gate) return { status: 1, stdout: "", stderr: "no such container" };
      return ok(JSON.stringify([{ State: { Running: true }, Config: { Labels: { "zero.image": gate.image } }, NetworkSettings: { Networks: { [NETWORK]: { IPAddress: "10.89.0.2" } } } }]));
    }
    if (a === "run") {
      gate = { image: args[args.indexOf("--label") + 1]!.split("=")[1]! };
      writeFileSync(join(dir, "ready"), args.find((x) => x.startsWith("ZERO_GATE_START="))!.split("=")[1]!);
      return ok();
    }
    if (a === "rm") return (gate = undefined), ok();
    return { status: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
  };
  return { exec, calls };
}

describe("gate host", () => {
  const host = (dir: string, exec: Exec, image = "zero-box:v1", policy = blocklist()) =>
    createGateHost({ runtime: "podman", image, dir, store: testStore(), policy: () => policy, exec, sleep: async () => {} });

  it("creates the internal network and the gate once, and issues a pass per run", async () => {
    const dir = tempDir();
    const rt = fakeRuntime(dir);
    const gate = host(dir, rt.exec, "zero-box:v1", blocklist({ block: ["example.com"] }));

    const door = await gate.open({ jobId: "j1", station: "build" });
    expect(rt.calls).toContainEqual(["network", "create", "--internal", NETWORK]);
    expect(rt.calls).toContainEqual(["network", "connect", "podman", gateName(dir)]);
    expect(door.network).toBe(NETWORK);
    const pass = /^http:\/\/zero:([a-f0-9]{24})@10\.89\.0\.2:3128$/.exec(door.proxy)?.[1];
    expect(pass).toBeDefined();
    expect(JSON.parse(readFileSync(join(dir, "runs", `${pass}.json`), "utf8"))).toEqual({ job: "j1", station: "build" });
    expect(JSON.parse(readFileSync(join(dir, "policy.json"), "utf8"))).toMatchObject({ block: ["example.com"] });

    const second = await gate.open({ jobId: "j2", station: "verify" });
    expect(rt.calls.filter((c) => c[0] === "run")).toHaveLength(1);
    expect(second.proxy).not.toBe(door.proxy);

    door.close();
    expect(existsSync(join(dir, "runs", `${pass}.json`))).toBe(false);
  });

  it("restarts the gate when zero's image changes", async () => {
    const dir = tempDir();
    const rt = fakeRuntime(dir);
    await host(dir, rt.exec, "zero-box:v1").open({ jobId: "j1", station: "build" });
    await host(dir, rt.exec, "zero-box:v2").open({ jobId: "j1", station: "build" });
    expect(rt.calls.filter((c) => c[0] === "run")).toHaveLength(2);
    expect(rt.calls).toContainEqual(["rm", "-f", gateName(dir)]);
  });

  it("fails closed: a box run whose gate cannot open does not run", async () => {
    const broken: GateHost = { open: async () => Promise.reject(new Error("sin runtime")), ingest: () => {} };
    const status = { ready: true, runtime: "podman" as const, image: "zero-box:v1", problems: [], checkedAt: "" };
    const box = createBoxExecutor(parseFactory("lines: []\n"), status, testFactory({}).secrets, broken);
    const r = await box.shell("echo hi", { cwd: tempDir(), mount: "rw", jobId: "j1", station: "setup" });
    expect(r).toMatchObject({ code: 1, output: expect.stringContaining("No se pudo abrir la puerta de salida de la caja: sin runtime") });
  });
});

describe("the gate", () => {
  const PASS = "ab".repeat(12);
  const auth = (pass = PASS) => `Basic ${Buffer.from(`zero:${pass}`).toString("base64")}`;

  async function gate(policy: EgressPolicy, lookup: (host: string) => Promise<string[]> = async () => ["127.0.0.1"]) {
    const dir = tempDir();
    mkdirSync(join(dir, "runs"));
    writeFileSync(join(dir, "policy.json"), JSON.stringify(policy));
    writeFileSync(join(dir, "runs", `${PASS}.json`), JSON.stringify({ job: "j1", station: "build" }));
    const looked: string[] = [];
    const port = await listen(createGate({ dir, lookup: async (h) => (looked.push(h), lookup(h)), onError: () => {} }));
    const events = (): EgressEvent[] => {
      const file = eventsFile(dir, new Date());
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    };
    return { dir, port, events, looked };
  }

  /** Opens a tunnel through the gate; resolves with the gate's answer and, if 200, the tunnel. */
  const tunnel = (gatePort: number, target: string, proxyAuth?: string) =>
    new Promise<{ status: number; socket: Socket; rule?: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: gatePort, method: "CONNECT", path: target, headers: proxyAuth ? { "proxy-authorization": proxyAuth } : {} });
      req.on("connect", (res, socket) => {
        sockets.push(socket);
        resolve({ status: res.statusCode!, socket, rule: res.headers["x-zero-rule"] as string | undefined });
      });
      req.on("error", reject);
      req.end();
    });

  const until = async <T>(fn: () => T | undefined, ms = 3000): Promise<T> => {
    for (const start = Date.now(); Date.now() - start < ms; await new Promise((r) => setTimeout(r, 20))) {
      const v = fn();
      if (v !== undefined) return v;
    }
    throw new Error("timed out");
  };

  it("tunnels an allowed connection and records who made it and how many bytes went each way", async () => {
    const echo = await listen(createTcpServer((s) => s.pipe(s)));
    const g = await gate(blocklist({ allow: ["127.0.0.1"] }));

    const t = await tunnel(g.port, `127.0.0.1:${echo}`, auth());
    expect(t.status).toBe(200);
    const reply = new Promise<string>((r) => t.socket.once("data", (d) => r(String(d))));
    t.socket.write("hello");
    expect(await reply).toBe("hello");
    t.socket.end();

    const event = await until(() => g.events()[0]);
    expect(event).toMatchObject({ job: "j1", station: "build", host: "127.0.0.1", port: echo, allowed: true, bytesUp: 5, bytesDown: 5 });
  });

  it("refuses a connection without a valid pass", async () => {
    const g = await gate(blocklist({ allow: ["127.0.0.1"] }));
    expect((await tunnel(g.port, "127.0.0.1:9", undefined)).status).toBe(407);
    expect((await tunnel(g.port, "127.0.0.1:9", auth("cd".repeat(12)))).status).toBe(407);
    expect((await tunnel(g.port, "127.0.0.1:9", auth("../../etc/passwd"))).status).toBe(407);
    expect(g.events().map((e) => [e.allowed, e.rule, e.job])).toEqual(Array(3).fill([false, "unauthenticated", undefined]));
  });

  it("refuses a suspicious site before resolving it, and has recorded it by the time it answers", async () => {
    const g = await gate(blocklist());
    const t = await tunnel(g.port, "pastebin.com:443", auth());
    expect(t).toMatchObject({ status: 403, rule: "suspicious" });
    expect(g.events()).toEqual([expect.objectContaining({ job: "j1", station: "build", host: "pastebin.com", allowed: false, rule: "suspicious", reason: expect.stringContaining("pegar textos") })]);
    expect(g.looked).toEqual([]);
  });

  it("refuses a name that points at the owner's network", async () => {
    const g = await gate(blocklist(), async () => ["192.168.1.10"]);
    expect(await tunnel(g.port, "printer.example:443", auth())).toMatchObject({ status: 403, rule: "suspicious" });
    expect(g.events()[0]!.reason).toMatch(/red local.*192\.168\.1\.10/);
  });

  it("never resolves an unlisted name in allowlist mode", async () => {
    const g = await gate({ mode: "allowlist", allow: [], block: [] });
    expect(await tunnel(g.port, "example.com:443", auth())).toMatchObject({ status: 403, rule: "not-allowed" });
    expect(g.looked).toEqual([]);
  });

  it("reloads the policy when the host changes it", async () => {
    const echo = await listen(createTcpServer((s) => s.pipe(s)));
    const g = await gate(blocklist({ allow: ["127.0.0.1"] }));
    expect((await tunnel(g.port, `127.0.0.1:${echo}`, auth())).status).toBe(200);
    writeFileSync(join(g.dir, "policy.json"), JSON.stringify(blocklist({ block: ["127.0.0.1"] })));
    expect(await tunnel(g.port, `127.0.0.1:${echo}`, auth())).toMatchObject({ status: 403, rule: "listed" });
  });

  it("forwards plain HTTP requests and counts their bytes", async () => {
    const web = await listen(createHttpServer((req, res) => req.resume().on("end", () => res.end(`hola ${req.url}`))));
    const g = await gate(blocklist({ allow: ["127.0.0.1"] }));
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: g.port, method: "POST", path: `http://127.0.0.1:${web}/x?y=1`, headers: { "proxy-authorization": auth() } }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d)).on("end", () => resolve(text));
      });
      req.on("error", reject);
      req.end("datos");
    });
    expect(body).toBe("hola /x?y=1");
    expect(await until(() => g.events()[0])).toMatchObject({ allowed: true, host: "127.0.0.1", port: web, bytesUp: 5, bytesDown: 11 });
  });

  it("reads CONNECT targets, including IPv6", () => {
    expect(parseAuthority("Example.com:443")).toEqual({ host: "example.com", port: 443 });
    expect(parseAuthority("[::1]:8080")).toEqual({ host: "::1", port: 8080 });
    expect(parseAuthority("example.com")).toBeUndefined();
    expect(parseAuthority("example.com:99999")).toBeUndefined();
  });
});

const event = (over: Partial<EgressEvent> = {}): EgressEvent => ({
  id: randomUUID(),
  at: new Date().toISOString(),
  job: "j1",
  station: "build",
  host: "registry.npmjs.org",
  port: 443,
  allowed: true,
  bytesUp: 100,
  bytesDown: 5000,
  durationMs: 10,
  ...over,
});
const suspicious = (over: Partial<EgressEvent> = {}) =>
  event({ host: "pastebin.com", allowed: false, rule: "suspicious", reason: "pastebin.com es un servicio para pegar textos o compartir archivos, muy usado para sacar datos", bytesUp: 0, bytesDown: 0, ...over });

describe("gate records", () => {
  it("moves complete lines into the store once, even from two processes, and cleans up", () => {
    const dir = tempDir();
    const store = testStore();
    const other = new Store(store.db.location()!);
    const now = new Date("2026-10-26T12:00:00Z");
    const line = (e: EgressEvent) => `${JSON.stringify(e)}\n`;
    writeFileSync(join(dir, "events-2026-10-25.jsonl"), line(event({ at: "2026-10-25T10:00:00Z" })) + line(event({ at: "2026-10-25T11:00:00Z" })));
    const late = line(event({ at: "2026-10-26T11:00:00Z" }));
    writeFileSync(join(dir, "events-2026-10-26.jsonl"), line(event({ at: "2026-10-26T10:00:00Z" })) + "not json\n" + late.slice(0, 20));

    expect(ingestEgress(store, dir, now)).toBe(3);
    expect(existsSync(join(dir, "events-2026-10-25.jsonl"))).toBe(false);
    appendFileSync(join(dir, "events-2026-10-26.jsonl"), late.slice(20));
    expect(ingestEgress(other, dir, now)).toBe(1);
    other.close();
    expect(ingestEgress(store, dir, now)).toBe(0);
    expect(store.listEgress()).toHaveLength(4);
  });

  it("keeps 90 days", () => {
    const dir = tempDir();
    const store = testStore();
    store.insertEgress([event({ at: "2026-01-01T00:00:00Z" }), event({ at: "2026-10-01T00:00:00Z" })]);
    ingestEgress(store, dir, new Date("2026-10-26T00:00:00Z"));
    expect(store.listEgress().map((e) => e.at)).toEqual(["2026-10-01T00:00:00Z"]);
  });

  it("summarizes per site, refusals first, and marks new sites", () => {
    const store = testStore();
    store.insertEgress([event({ at: "2026-10-20T00:00:00Z" }), event(), event({ station: "setup", job: "j2" }), suspicious(), event({ host: "api.anthropic.com", bytesUp: 2_000_000 })]);
    const s = summarizeEgress(store, { from: new Date(Date.now() - 86_400_000) });
    expect(s).toMatchObject({ connections: 4, blocked: 1, suspicious: 1 });
    expect(s.sites.map((x) => [x.host, x.connections, x.isNew])).toEqual([
      ["pastebin.com", 1, true],
      ["registry.npmjs.org", 2, false],
      ["api.anthropic.com", 1, true],
    ]);
    expect(s.sites[1]).toMatchObject({ jobs: ["j1", "j2"], stations: ["build", "setup"], bytesDown: 10_000 });
  });
});

describe("suspicious connections and the job", () => {
  function factory(level: string) {
    const ctx = testFactory({ level, isolation: "container", lines: [{ name: "demo", repo: gitRepo(), verify: [] }] });
    return ctx;
  }
  /** Build writes the change and, as the gate would, records what the run tried. */
  const building = (ctx: ReturnType<typeof factory>, events: (job: string) => EgressEvent[]) =>
    fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { "src/health.ts": "export const ok = true;\n" });
        ctx.store.insertEgress(events(req.trace!.jobId));
      },
    });

  it("fails the job at L3 instead of integrating, naming the site and how to allow it", async () => {
    const ctx = factory("L3");
    const agents = building(ctx, (job) => [suspicious({ job })]);
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, box: simulatedBox(agents.runner).box, boxAvailability: { ready: true, problems: [] } });
    expect(done.status).toBe("failed");
    expect(done.reason).toContain("pastebin.com:443 (build)");
    expect(done.reason).toContain("zero egress allow");
    expect(done.delivery).toBeUndefined();
  });

  it("asks at L2 and, once approved, delivers; a new suspicion would ask again", async () => {
    const ctx = factory("L2");
    const agents = building(ctx, (job) => [suspicious({ job, host: "140.82.112.3", reason: "es una dirección IP sin nombre de sitio (140.82.112.3)" })]);
    const { job } = requestWork(ctx, { text: "health" });
    const deps = { ...ctx, runAgent: agents.runner, box: simulatedBox(agents.runner).box, boxAvailability: { ready: true, problems: [] } };

    const waiting = await runJob(job.id, deps);
    expect(waiting.question).toMatchObject({ kind: "egress-suspicious", text: expect.stringContaining("140.82.112.3:443 (build)") });
    const approved = await answer(ctx, job.id, "approve");
    expect(approved.approvals.egressSeq).toBe(ctx.store.listEgress({ job: job.id }).at(-1)!.seq);
    expect((await runJob(job.id, deps)).status).toBe("delivered");
  });

  it("ignores refusals that are the owner's own policy", async () => {
    const ctx = factory("L3");
    const agents = building(ctx, (job) => [
      event({ job, host: "example.com", allowed: false, rule: "listed", reason: "está en tu lista de sitios bloqueados" }),
      event({ job, host: "telemetry.example", allowed: false, rule: "not-allowed", reason: "no está en tu lista de sitios permitidos" }),
    ]);
    const { job } = requestWork(ctx, { text: "health" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner, box: simulatedBox(agents.runner).box, boxAvailability: { ready: true, problems: [] } });
    expect(done.status).toBe("delivered");
  });
});

describe("egress views and rules", () => {
  const withBox = () => {
    const ctx = testFactory({ isolation: "container", lines: [{ name: "demo", repo: gitRepo() }] });
    ctx.store.setKv("box", JSON.stringify({ ready: true, runtime: "podman", image: "zero-box:x", problems: [], checkedAt: new Date().toISOString() }));
    ctx.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "t");
    return ctx;
  };

  it("reports per site for the factory and for one job, also in its trace and the briefing", async () => {
    const ctx = withBox();
    const { job } = requestWork(ctx, { text: "x" });
    ctx.store.insertEgress([event({ job: job.id }), suspicious({ job: job.id })]);

    const report = formatEgress(egressReport(ctx));
    expect(report).toContain("Modo blocklist: sale todo salvo lo sospechoso");
    expect(report).toContain("- pastebin.com:443 · 1 intento · build");
    expect(report).toContain("SOSPECHOSO: pastebin.com es un servicio para pegar textos");
    expect(report).toContain("- registry.npmjs.org:443 · 1 conexión · envió 100 B, recibió 5 KB · build");
    expect(formatEgress(egressReport(ctx, { job: job.id }))).toContain(`Salidas a internet del trabajo ${job.id}`);
    expect(trace(ctx, job.id)).toContain("Salidas a internet: 2 conexiones a 2 sitios · 1 bloqueadas (1 sospechosas)");

    const b = await briefing(ctx);
    expect(b.body).toContain("**Salida sospechosa bloqueada**: pastebin.com:443");
    expect(b.body).toContain("## Salidas a internet");
  });

  it("says when the gate cannot see the work", () => {
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "demo", repo: gitRepo() }] });
    expect(egressReport(ctx).note).toMatch(/fuera de la caja/);
  });

  it("edits the lists and the mode keeping the file's comments", async () => {
    const ctx = withBox();
    writeFileSync(ctx.home.config, `# mi fábrica\n${readFileSync(ctx.home.config, "utf8")}`);
    expect(await setEgressRule(ctx, "Pastebin.com", "allow")).toMatch(/Permitido: .*pastebin.com aunque parezca sospechoso/);
    expect(await setEgressRule(ctx, "pastebin.com", "block")).toMatch(/Bloqueado/);
    expect(ctx.config.egress).toMatchObject({ allow: [], block: ["pastebin.com"] });
    expect(await setEgressRule(ctx, "pastebin.com", "remove")).toMatch(/ya no está en tus listas/);
    expect(await setEgressMode(ctx, "allowlist")).toMatch(/Modo allowlist/);
    const text = readFileSync(ctx.home.config, "utf8");
    expect(text.startsWith("# mi fábrica")).toBe(true);
    expect(parseFactory(text).egress).toEqual({ mode: "allowlist", allow: [], block: [] });
    await expect(setEgressRule(ctx, "http://x/y", "block")).rejects.toThrow(/no es un sitio válido/);
    await expect(setEgressMode(ctx, "open")).rejects.toThrow(/blocklist/);
  });

  it("lets the chat block a site but offers no way to allow one", async () => {
    const ctx = withBox();
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["zero_egress", "zero_egress_block"]));
    expect(names.some((n) => /allow|permit|mode/.test(n))).toBe(false);
    const r = (await client.callTool({ name: "zero_egress_block", arguments: { site: "webhook.site" } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toMatch(/Bloqueado/);
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).egress.block).toEqual(["webhook.site"]);
  });
});
