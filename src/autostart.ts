import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FactoryHome } from "./home.js";
import { inContainer } from "./home.js";

/** The files the login entry touches; tests inject an in-memory one. */
export interface AutostartFs {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
  remove(path: string): void;
}

export interface AutostartDeps {
  fs?: AutostartFs;
  /** Runs a program without a shell (only `systemctl --user` on Linux); throws when it fails. */
  run?: (bin: string, args: string[]) => void;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The user's folder, where LaunchAgents and systemd user units live. */
  userHome?: string;
  /** The node that runs zero. */
  node?: string;
  /** zero's own `dist/cli.js`. */
  cli?: string;
}

export interface AutostartResult {
  /** `created`/`removed`: the entry changed. `already`: it was as asked. `container`/`unsupported`: nothing to do here. */
  status: "created" | "removed" | "already" | "container" | "unsupported";
  /** The entry's file, when there is one on this platform. */
  path?: string;
  /** What to tell the person in charge, in Spanish. */
  message: string;
}

const realFs: AutostartFs = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  remove: (path) => rmSync(path, { force: true }),
};

const realRun = (bin: string, args: string[]) => {
  execFileSync(bin, args, { stdio: "ignore", cwd: homedir(), timeout: 30_000 });
};

/** One entry per factory: its name carries a short hash of the home's root, so two homes never share one. */
export const autostartName = (home: FactoryHome) => `zero-${createHash("sha256").update(home.root).digest("hex").slice(0, 8)}`;

interface Entry {
  path: string;
  content: string;
  /** systemd's unit name, which has to be enabled and disabled. */
  unit?: string;
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function entryFor(home: FactoryHome, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, userHome: string, node: string, cli: string): Entry | undefined {
  const name = autostartName(home);
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(userHome, "AppData", "Roaming");
    const content = ["@echo off", `set "ZERO_HOME=${home.root}"`, `"${node}" "${cli}" start --detach`, ""].join("\r\n");
    return { path: join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${name}.cmd`), content };
  }
  if (platform === "darwin") {
    const args = [node, cli, "start", "--detach"].map((a) => `    <string>${xml(a)}</string>`);
    const content = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "  <key>Label</key>",
      `  <string>${name}</string>`,
      "  <key>ProgramArguments</key>",
      "  <array>",
      ...args,
      "  </array>",
      "  <key>EnvironmentVariables</key>",
      "  <dict>",
      "    <key>ZERO_HOME</key>",
      `    <string>${xml(home.root)}</string>`,
      "  </dict>",
      "  <key>RunAtLoad</key>",
      "  <true/>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n");
    return { path: join(userHome, "Library", "LaunchAgents", `${name}.plist`), content };
  }
  if (platform === "linux") {
    const quote = (a: string) => `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const content = [
      "[Unit]",
      "Description=Fábrica zero",
      "",
      "[Service]",
      // `start --detach` leaves the daemon behind and exits; the unit stays active so systemd does not end it.
      "Type=oneshot",
      "RemainAfterExit=yes",
      `Environment=${quote(`ZERO_HOME=${home.root}`)}`,
      `ExecStart=${[node, cli].map(quote).join(" ")} start --detach`,
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    const unit = `${name}.service`;
    const configHome = env.XDG_CONFIG_HOME || join(userHome, ".config");
    return { path: join(configHome, "systemd", "user", unit), content, unit };
  }
  return undefined;
}

/**
 * Makes the user-level login entry that starts this factory exist exactly when `enabled`:
 * a `.cmd` in the Startup folder on Windows, a LaunchAgent on macOS, a systemd user unit on Linux.
 * Nothing needs administrator rights, and running it again changes nothing.
 */
export function syncAutostart(home: FactoryHome, enabled: boolean, deps: AutostartDeps = {}): AutostartResult {
  const env = deps.env ?? process.env;
  if (inContainer(env)) return { status: "container", message: "En el contenedor no hace falta: la política de reinicio de compose vuelve a levantar la fábrica." };
  const fs = deps.fs ?? realFs;
  const run = deps.run ?? realRun;
  const platform = deps.platform ?? process.platform;
  const entry = entryFor(home, platform, env, deps.userHome ?? homedir(), deps.node ?? process.execPath, deps.cli ?? fileURLToPath(new URL("./cli.js", import.meta.url)));
  if (!entry) return { status: "unsupported", message: `No sé registrar el arranque al iniciar sesión en ${platform}.` };

  const present = fs.exists(entry.path);
  if (enabled) {
    if (present && fs.read(entry.path) === entry.content) return { status: "already", path: entry.path, message: `El arranque al iniciar sesión ya estaba registrado en ${entry.path}.` };
    fs.write(entry.path, entry.content);
    if (entry.unit) run("systemctl", ["--user", "enable", entry.unit]);
    return { status: "created", path: entry.path, message: `Registré el arranque al iniciar sesión en ${entry.path}.` };
  }
  if (!present) return { status: "already", path: entry.path, message: "El arranque al iniciar sesión no estaba registrado." };
  if (entry.unit) run("systemctl", ["--user", "disable", entry.unit]);
  fs.remove(entry.path);
  return { status: "removed", path: entry.path, message: `Borré el arranque al iniciar sesión (${entry.path}).` };
}
