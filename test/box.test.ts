import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credentialProblems, engineCredentials, stationEngines } from "../src/box/credentials.js";
import { imageTag } from "../src/box/image.js";
import { decodeResult, encodeResult, type BoxAgentRequest } from "../src/box/protocol.js";
import { boxRunArgs, type BoxRunSpec } from "../src/box/run.js";
import { planBoxSetup, runBoxSetup, type Probes, type SetupIO } from "../src/box/setup.js";
import { boxAvailability, inspectBox } from "../src/box/status.js";
import type { Exec } from "../src/box/runtime.js";
import { effectiveLevel, parseFactory } from "../src/config.js";
import { factoryHome } from "../src/home.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { openCloneCopy, removeWorkCopy } from "../src/workspace.js";
import { cleanup, gitIn, gitRepo, tempDir, writeTree } from "./helpers.js";

afterEach(cleanup);

const secrets = (env: Record<string, string> = {}) => new SecretStore(factoryHome(tempDir()), memoryKeyring(), env);

describe("secrets", () => {
  it("keeps values in the keychain and only names in the index", () => {
    const home = factoryHome(tempDir());
    const keyring = memoryKeyring();
    const store = new SecretStore(home, keyring, {});
    store.set("CLAUDE_CODE_OAUTH_TOKEN", " tok-123 ");
    expect(store.list()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(store.get("CLAUDE_CODE_OAUTH_TOKEN")).toBe("tok-123");
    expect(keyring.get("CLAUDE_CODE_OAUTH_TOKEN")).toBe("tok-123");
    expect(store.remove("CLAUDE_CODE_OAUTH_TOKEN")).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.has("CLAUDE_CODE_OAUTH_TOKEN")).toBe(false);
  });

  it("prefers the environment over the keychain", () => {
    const store = new SecretStore(factoryHome(tempDir()), memoryKeyring(), { ANTHROPIC_API_KEY: "from-env" });
    store.set("ANTHROPIC_API_KEY", "from-keychain");
    expect(store.get("ANTHROPIC_API_KEY")).toBe("from-env");
  });

  it("rejects bad names and empty values", () => {
    expect(() => secrets().set("lower", "x")).toThrow(/inválido/);
    expect(() => secrets().set("OK_NAME", "  ")).toThrow(/vacío/);
  });
});

describe("engine credentials", () => {
  const cfg = (yaml = "") => parseFactory(`lines: []\n${yaml}`);

  it("asks for a Claude token when none is available", () => {
    expect(engineCredentials("claude", cfg(), secrets()).problem).toMatch(/claude setup-token/);
    expect(engineCredentials("claude", cfg(), secrets({ ANTHROPIC_API_KEY: "k" }))).toEqual({ names: ["ANTHROPIC_API_KEY"] });
  });

  it("passes only the first credential a built-in engine needs", () => {
    expect(engineCredentials("claude", cfg(), secrets({ ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "b" })).names).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
  });

  it("uses the secrets a custom engine declares and refuses Antigravity in the box", () => {
    const c = cfg("engines:\n  local:\n    command: [ollama-agent]\n    secrets: [OLLAMA_TOKEN]\n");
    expect(engineCredentials("local", c, secrets()).problem).toMatch(/OLLAMA_TOKEN/);
    expect(engineCredentials("local", c, secrets({ OLLAMA_TOKEN: "t" }))).toEqual({ names: ["OLLAMA_TOKEN"] });
    expect(engineCredentials("antigravity", c, secrets()).problem).toMatch(/todavía no puede/);
  });

  it("checks every engine the stations use", () => {
    const c = cfg("engine: claude\nstations:\n  review: { engine: codex, timeoutMinutes: 5 }\n");
    expect(stationEngines(c)).toEqual(["claude", "codex"]);
    expect(credentialProblems(c, secrets({ CLAUDE_CODE_OAUTH_TOKEN: "t" }))).toEqual([expect.stringMatching(/Codex/)]);
  });
});

describe("box status and effective level", () => {
  const cfg = parseFactory("level: L3\nisolation: container\nlines: []\n");
  const fakeExec = (answers: Record<string, number>): Exec => (bin, args) => ({ status: answers[`${bin} ${args[0]}`] ?? 1, stdout: "", stderr: "" });

  it("reports a missing runtime", () => {
    const s = inspectBox(cfg, { exec: fakeExec({}), tag: "zero-box:t" });
    expect(s).toMatchObject({ ready: false, problems: [expect.stringMatching(/no hay Podman ni Docker/)] });
  });

  it("reports a runtime that does not respond, then a missing image, then ready", () => {
    expect(inspectBox(cfg, { exec: fakeExec({ "podman --version": 0 }), tag: "t" }).problems[0]).toMatch(/no responde/);
    expect(inspectBox(cfg, { exec: fakeExec({ "podman --version": 0, "podman info": 0 }), tag: "t" }).problems[0]).toMatch(/falta construir la imagen/);
    expect(inspectBox(cfg, { exec: fakeExec({ "docker --version": 0, "docker info": 0, "docker image": 0 }), tag: "t" })).toMatchObject({ ready: true, runtime: "docker" });
  });

  it("is L3 only with a ready box and the engines' credentials", () => {
    const ready = { ready: true, runtime: "podman" as const, image: "t", problems: [], checkedAt: "" };
    expect(effectiveLevel(cfg, boxAvailability(cfg, ready, secrets({ CLAUDE_CODE_OAUTH_TOKEN: "t" })))).toEqual({ level: "L3", configured: "L3" });
    const noToken = effectiveLevel(cfg, boxAvailability(cfg, ready, secrets()));
    expect(noToken).toMatchObject({ level: "L2", reason: expect.stringMatching(/claude setup-token/) });
    const noBox = effectiveLevel(cfg, boxAvailability(cfg, { ...ready, ready: false, problems: ["no hay Podman ni Docker instalados: corré `zero box setup`"] }, secrets()));
    expect(noBox.reason).toMatch(/zero box setup/);
    expect(effectiveLevel(cfg, boxAvailability(cfg, undefined, secrets())).reason).toMatch(/zero box status/);
  });
});

describe("box image", () => {
  it("is tagged by the content of what it is built from", () => {
    const root = tempDir();
    writeTree(root, { "package.json": "{}", "package-lock.json": "{}", "dist/cli.js": "1", "agents/spec.md": "a", "box/Dockerfile": "FROM x" });
    const first = imageTag(root);
    expect(first).toMatch(/^zero-box:[0-9a-f]{12}$/);
    expect(imageTag(root)).toBe(first);
    writeTree(root, { "dist/cli.js": "2" });
    expect(imageTag(root)).not.toBe(first);
  });
});

describe("running in the box", () => {
  const spec = (over: Partial<BoxRunSpec> = {}): BoxRunSpec => ({
    runtime: "podman",
    image: "zero-box:abc",
    copy: "/factory/worktrees/demo/j1",
    mount: "rw",
    limits: { runtime: "auto", cpus: 2, memoryGb: 4, pids: 512 },
    secretNames: ["CLAUDE_CODE_OAUTH_TOKEN"],
    command: ["node", "/opt/zero/dist/box/agent.js"],
    name: "zero-j1-abc",
    platform: "win32",
    ...over,
  });

  it("drops privileges, limits resources and mounts only the job's copy", () => {
    const args = boxRunArgs(spec());
    for (const flag of ["--rm", "--read-only", "--init"]) expect(args).toContain(flag);
    expect(args.join(" ")).toContain("--cap-drop ALL");
    expect(args.join(" ")).toContain("--security-opt no-new-privileges");
    expect(args.join(" ")).toContain("--cpus 2 --memory 4g --pids-limit 512");
    expect(args.filter((a) => a === "-v")).toHaveLength(1);
    expect(args).toContain("/factory/worktrees/demo/j1:/work");
    expect(args.slice(-3)).toEqual(["zero-box:abc", "node", "/opt/zero/dist/box/agent.js"]);
  });

  it("mounts read-only stations read-only", () => {
    expect(boxRunArgs(spec({ mount: "ro" }))).toContain("/factory/worktrees/demo/j1:/work:ro");
  });

  it("passes credentials by name, never by value", () => {
    const args = boxRunArgs(spec());
    expect(args.join(" ")).toContain("-e CLAUDE_CODE_OAUTH_TOKEN");
    expect(args.some((a) => a.includes("CLAUDE_CODE_OAUTH_TOKEN="))).toBe(false);
  });

  it("runs as the owner on Linux", () => {
    expect(boxRunArgs(spec({ platform: "linux", runtime: "docker", uid: 1001, gid: 1002 })).join(" ")).toContain("--user 1001:1002");
    expect(boxRunArgs(spec({ platform: "linux", runtime: "podman", uid: 1001, gid: 1002 })).join(" ")).toContain("--userns=keep-id --user 1001:1002");
    expect(boxRunArgs(spec({ platform: "win32" })).some((a) => a.startsWith("--user"))).toBe(false);
  });
});

describe("box agent protocol", () => {
  it("round-trips the result marker and ignores engine noise", () => {
    const out = `engine chatter\n${encodeResult({ ok: true, text: "done", costUsd: 0.2 })}more noise`;
    expect(decodeResult(out)).toEqual({ ok: true, text: "done", costUsd: 0.2 });
    expect(decodeResult("nothing here")).toBeUndefined();
  });

  it("runs the requested engine in the work directory", () => {
    const work = tempDir();
    const request: BoxAgentRequest = {
      engine: "echo",
      engines: { echo: { command: [process.execPath, "-e", "console.log(JSON.stringify({response: process.cwd()}))"], readArgs: [], writeArgs: [], modelArgs: [], secrets: [], hosts: [] } },
      request: { instructions: "i", prompt: "p", access: "read", timeoutMs: 30_000 },
    };
    const r = spawnSync(process.execPath, ["--import", "tsx", join("src", "box", "agent.ts")], {
      input: JSON.stringify(request),
      encoding: "utf8",
      env: { ...process.env, ZERO_BOX_WORKDIR: work },
    });
    expect(r.status).toBe(0);
    const result = decodeResult(r.stdout)!;
    expect(result.ok).toBe(true);
    expect(result.text.toLowerCase()).toBe(work.toLowerCase());
  });
});

describe("box setup", () => {
  const probes = (over: Partial<Probes>): Probes => ({ platform: "win32", runtimes: [], imageBuilt: false, ...over });

  it("starts with WSL on Windows and stops there for a reboot", () => {
    const plan = planBoxSetup(probes({ wsl: false }));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: "wsl", installs: true, admin: true, reboot: true });
  });

  it("installs Podman, creates and starts its machine, then builds the image", () => {
    expect(planBoxSetup(probes({ wsl: true })).map((s) => s.id)).toEqual(["install-podman", "machine-init", "machine-start", "image"]);
    expect(planBoxSetup(probes({ platform: "darwin", brew: true })).map((s) => s.id)).toEqual(["install-podman", "machine-init", "machine-start", "image"]);
  });

  it("only gives instructions on Linux and when Docker does not answer", () => {
    expect(planBoxSetup(probes({ platform: "linux" }))[0]).toMatchObject({ id: "manual" });
    expect(planBoxSetup(probes({ platform: "linux", runtimes: ["docker"] }))[0]!.title).toMatch(/no responde/);
  });

  it("only builds the image when the runtime already answers", () => {
    expect(planBoxSetup(probes({ platform: "linux", runtimes: ["docker"], responding: "docker" }))).toMatchObject([{ id: "image", installs: false }]);
    expect(planBoxSetup(probes({ platform: "linux", runtimes: ["docker"], responding: "docker", imageBuilt: true }))).toEqual([]);
  });

  function io(states: Probes[], answer: boolean) {
    const ran: string[] = [];
    const said: string[] = [];
    let i = 0;
    const value: SetupIO = {
      confirm: async () => answer,
      say: (t) => void said.push(t),
      run: (bin, args) => (ran.push(`${bin} ${args.join(" ")}`), i++, 0),
      buildImage: async () => void (ran.push("build"), i++),
      probe: () => states[Math.min(i, states.length - 1)]!,
    };
    return { value, ran, said };
  }

  it("never installs anything without consent", async () => {
    const t = io([probes({ wsl: true })], false);
    expect(await runBoxSetup(t.value, { yes: false })).toBe("needs-consent");
    expect(t.ran).toEqual([]);
    expect(t.said.join("\n")).toMatch(/Plan pendiente/);
  });

  it("walks the plan with consent until the box is ready", async () => {
    const states = [
      probes({ wsl: true }),
      probes({ wsl: true, runtimes: ["podman"], podmanMachines: 0 }),
      probes({ wsl: true, runtimes: ["podman"], podmanMachines: 1 }),
      probes({ wsl: true, runtimes: ["podman"], podmanMachines: 1, responding: "podman" }),
      probes({ wsl: true, runtimes: ["podman"], podmanMachines: 1, responding: "podman", imageBuilt: true }),
    ];
    const t = io(states, true);
    expect(await runBoxSetup(t.value, { yes: false })).toBe("ready");
    expect(t.ran.map((r) => r.split(" ").slice(0, 3).join(" "))).toEqual(["winget install -e", "podman machine init", "podman machine start", "build"]);
  });

  it("stops after enabling WSL until the owner reboots", async () => {
    const t = io([probes({ wsl: false })], true);
    expect(await runBoxSetup(t.value, { yes: true })).toBe("reboot");
    expect(t.ran).toHaveLength(1);
  });
});

describe("box work copy", () => {
  it("is an independent clone whose branch is fetched back before integrating", async () => {
    const repo = gitRepo();
    const path = join(tempDir(), "j1");
    const copy = await openCloneCopy(repo, "main", "zero/j1", path);
    expect(statSync(join(path, ".git")).isDirectory()).toBe(true);
    expect(existsSync(join(path, ".git", "objects", "info", "alternates"))).toBe(false);
    writeTree(path, { "a.txt": "from the box\n" });
    copy.commitAll("a");
    expect(copy.changedFiles()).toEqual([{ status: "A", path: "a.txt" }]);
    expect(() => gitIn(repo, "rev-parse", "--verify", "zero/j1")).toThrow();
    copy.publish();
    expect(gitIn(repo, "show", "zero/j1:a.txt")).toBe("from the box");
    removeWorkCopy(repo, path);
    expect(existsSync(path)).toBe(false);
  });
});
