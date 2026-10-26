import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { factoryHome, type FactoryHome } from "./home.js";
import { onPath } from "./shell.js";

/** The built CLI the clients launch as `node <cli> mcp`. */
export function cliEntry(): string {
  return fileURLToPath(new URL("../dist/cli.js", import.meta.url));
}

export interface ServerCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function serverCommand(home: FactoryHome, entry = cliEntry()): ServerCommand {
  // Only pin ZERO_HOME when it is not the default, so the registration stays portable.
  const env: Record<string, string> = home.root === factoryHome(join(homedir(), ".zero")).root ? {} : { ZERO_HOME: home.root };
  return { command: process.execPath, args: [entry, "mcp"], env };
}

export type InstallStatus = "installed" | "already" | "failed" | "manual";

export interface InstallReport {
  client: string;
  status: InstallStatus;
  detail: string;
}

type Run = (bin: string, args: string[]) => { status: number | null; output: string };

const run: Run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: "utf8", windowsHide: true });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

/** Claude Code has a CLI to manage MCP servers, so registration is automatic and verifiable. */
export function installClaude(cmd: ServerCommand, exec: Run = run): InstallReport {
  if (exec("claude", ["mcp", "get", "zero"]).status === 0) return { client: "Claude Code", status: "already", detail: "zero ya estaba registrado." };
  const env = Object.entries(cmd.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const r = exec("claude", ["mcp", "add", "--scope", "user", ...env, "zero", "--", cmd.command, ...cmd.args]);
  return r.status === 0
    ? { client: "Claude Code", status: "installed", detail: "Registrado como servidor MCP de usuario. Abrí una sesión nueva y pedile cosas a zero." }
    : { client: "Claude Code", status: "failed", detail: r.output || "claude mcp add falló." };
}

const toml = (s: string) => JSON.stringify(s);

/** Codex and OpenCode configuration formats are not verified on this machine yet, so zero prints them instead of editing files. */
export function manualInstructions(cmd: ServerCommand): InstallReport[] {
  const envToml = Object.keys(cmd.env).length ? `\nenv = { ${Object.entries(cmd.env).map(([k, v]) => `${k} = ${toml(v)}`).join(", ")} }` : "";
  const codex = `Agregá a ~/.codex/config.toml:\n\n[mcp_servers.zero]\ncommand = ${toml(cmd.command)}\nargs = [${cmd.args.map(toml).join(", ")}]${envToml}`;
  const opencode = `Agregá a tu opencode.json:\n\n${JSON.stringify({ mcp: { zero: { type: "local", command: [cmd.command, ...cmd.args], enabled: true, ...(Object.keys(cmd.env).length && { environment: cmd.env }) } } }, null, 2)}`;
  return [
    { client: "Codex", status: "manual", detail: codex },
    { client: "OpenCode", status: "manual", detail: opencode },
  ];
}

export function install(home: FactoryHome, opts: { isAvailable?: (bin: string) => boolean; exec?: Run; entry?: string } = {}): InstallReport[] {
  const entry = opts.entry ?? cliEntry();
  if (!existsSync(entry)) return [{ client: "zero", status: "failed", detail: `No existe ${entry}. Compilá zero primero con \`npm run build\`.` }];
  const cmd = serverCommand(home, entry);
  const available = opts.isAvailable ?? onPath;
  const reports: InstallReport[] = [];
  reports.push(available("claude") ? installClaude(cmd, opts.exec) : { client: "Claude Code", status: "manual", detail: "No encontré `claude`; cuando lo instales, corré `zero install` otra vez." });
  return [...reports, ...manualInstructions(cmd)];
}
