import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAutostart, SHUTDOWN_KEY } from "../src/app.js";
import { autostartName, syncAutostart, type AutostartDeps, type AutostartFs } from "../src/autostart.js";
import { editFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { factoryHome } from "../src/home.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

/** Files in memory, counting writes. */
function memoryFs() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const fs: AutostartFs = {
    exists: (p) => files.has(p),
    read: (p) => files.get(p)!,
    write: (p, c) => {
      writes.push(p);
      files.set(p, c);
    },
    remove: (p) => void files.delete(p),
  };
  return { fs, files, writes };
}

const home = factoryHome("/factory/home");
const base = (platform: NodeJS.Platform, extra: Partial<AutostartDeps> = {}) => {
  const mem = memoryFs();
  const calls: string[][] = [];
  const deps: AutostartDeps = { fs: mem.fs, run: (bin, args) => void calls.push([bin, ...args]), platform, env: { APPDATA: "C:\\Users\\vos\\AppData\\Roaming" }, userHome: "/home/vos", node: "/usr/bin/node", cli: "/opt/zero/dist/cli.js", ...extra };
  return { ...mem, calls, deps };
};

describe("login autostart entry", () => {
  it("writes one .cmd in the Windows Startup folder that starts this factory", () => {
    const { deps, files } = base("win32");
    const result = syncAutostart(home, true, deps);
    expect(result.status).toBe("created");
    expect([...files.keys()]).toHaveLength(1);
    const [path, content] = [...files.entries()][0]!;
    expect(path).toBe(join("C:\\Users\\vos\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${autostartName(home)}.cmd`));
    expect(path).toMatch(/zero-[0-9a-f]{8}\.cmd$/);
    expect(content).toContain("/usr/bin/node");
    expect(content).toContain("/opt/zero/dist/cli.js");
    expect(content).toContain("start --detach");
    expect(content).toContain(`ZERO_HOME=${home.root}`);
    expect(result.message).toContain(path);
  });

  it("names each home's entry apart", () => {
    expect(autostartName(home)).not.toBe(autostartName(factoryHome("/other/home")));
  });

  it("writes nothing new the second time", () => {
    const { deps, writes, calls } = base("linux");
    syncAutostart(home, true, deps);
    const again = syncAutostart(home, true, deps);
    expect(again.status).toBe("already");
    expect(writes).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("writes a LaunchAgent that runs at load on macOS", () => {
    const { deps, files } = base("darwin");
    const result = syncAutostart(home, true, deps);
    expect(result.path).toBe(join("/home/vos", "Library", "LaunchAgents", `${autostartName(home)}.plist`));
    const plist = files.get(result.path!)!;
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<string>--detach</string>");
    expect(plist).toContain(`<string>${home.root}</string>`);
  });

  it("enables a systemd user unit on Linux", () => {
    const { deps, files, calls } = base("linux");
    const result = syncAutostart(home, true, deps);
    const unit = `${autostartName(home)}.service`;
    expect(result.path).toBe(join("/home/vos", ".config", "systemd", "user", unit));
    expect(files.get(result.path!)).toContain("start --detach");
    expect(calls).toEqual([["systemctl", "--user", "enable", unit]]);
  });

  for (const platform of ["win32", "darwin", "linux"] as const) {
    it(`removes the entry on ${platform}`, () => {
      const { deps, files, calls } = base(platform);
      syncAutostart(home, true, deps);
      calls.length = 0;
      const removing = vi.fn(deps.fs!.remove);
      const result = syncAutostart(home, false, { ...deps, fs: { ...deps.fs!, remove: (p) => (calls.push(["remove", p]), removing(p)) } });
      expect(result.status).toBe("removed");
      expect(files.size).toBe(0);
      if (platform === "linux") expect(calls).toEqual([["systemctl", "--user", "disable", `${autostartName(home)}.service`], ["remove", result.path!]]);
      else expect(calls).toEqual([["remove", result.path!]]);
      expect(syncAutostart(home, false, deps).status).toBe("already");
    });
  }

  it("does nothing in a container, where compose restarts the factory", () => {
    const { deps, files, calls } = base("linux", { env: { ZERO_CONTAINER: "1" } });
    const result = syncAutostart(home, true, deps);
    expect(result.status).toBe("container");
    expect(result.message).toContain("compose");
    expect(files.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("zero autostart", () => {
  const factory = () => testFactory({ level: "L2", isolation: "worktree", lines: [] });

  it("writes the option to the file and makes the entry follow it", async () => {
    const ctx = factory();
    const { deps, files } = base("win32");
    const on = await setAutostart(ctx, true, deps);
    expect(readFileSync(ctx.home.config, "utf8")).toContain("autostart: true");
    expect(ctx.config.autostart).toBe(true);
    expect(on.status).toBe("created");
    expect(files.has(on.path!)).toBe(true);

    const off = await setAutostart(ctx, false, deps);
    expect(readFileSync(ctx.home.config, "utf8")).toContain("autostart: false");
    expect(off.status).toBe("removed");
    expect(files.size).toBe(0);
  });
});

describe("daemon and autostart", () => {
  it("syncs the entry at start and when the reloaded file changes it, and survives a failure", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [] }] });
    const seen: boolean[] = [];
    const autostart = (_: unknown, enabled: boolean) => {
      seen.push(enabled);
      throw new Error("sin carpeta de inicio");
    };
    const running = runDaemon(ctx, { pollMs: 10, panel: false, scout: false, unjam: false, research: false, packages: false, packageUpdates: false, agentRunner: () => fakeAgents({}).runner, autostart });
    await new Promise((r) => setTimeout(r, 100));
    await editFactory(ctx.home.config, (doc) => doc.set("autostart", true));
    await vi.waitFor(() => expect(seen).toEqual([false, true]), { timeout: 5_000 });
    ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
    await running;
    expect(seen).toEqual([false, true]);
  });
});
