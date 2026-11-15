import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FactoryHome } from "../home.js";
import { log } from "../log.js";
import type { Store } from "../state/store.js";

/**
 * Remote access to the panel through a Cloudflare quick tunnel: no account, no
 * admin, a random https address. Off unless the owner turns it on; the daemon
 * keeps it up while it is on and closes it with itself.
 */

export const REMOTE_KEY = "panel.remote";
export const REMOTE_URL_KEY = "panel.remoteUrl";
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const binName = (platform = process.platform) => (platform === "win32" ? "cloudflared.exe" : "cloudflared");

/** cloudflared from the factory's own `bin/`, or one already installed on the machine. */
export function findCloudflared(home: FactoryHome, platform = process.platform): string | undefined {
  const own = join(home.bin, binName(platform));
  if (existsSync(own)) return own;
  const r = spawnSync(platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0]!.trim() || undefined : undefined;
}

/** Where the official release binary is, or what to do by hand where there is no single binary. */
export function downloadPlan(platform: NodeJS.Platform = process.platform, arch: string = process.arch): { url: string } | { manual: string } {
  const cpu = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : undefined;
  if (platform === "win32" && cpu === "amd64") return { url: `${RELEASES}/cloudflared-windows-amd64.exe` };
  if (platform === "linux" && cpu) return { url: `${RELEASES}/cloudflared-linux-${cpu}` };
  if (platform === "darwin") return { manual: "Instalá cloudflared con `brew install cloudflared` y volvé a correr `zero panel remote on`." };
  return { manual: "Instalá cloudflared desde https://github.com/cloudflare/cloudflared/releases y volvé a correr `zero panel remote on`." };
}

/** On Windows the binary must carry a valid Cloudflare signature before it ever runs. */
export function verifyWindowsSignature(file: string): { ok: boolean; detail: string } {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true });
  const [status = "", subject = ""] = r.stdout.trim().split("|");
  return { ok: status === "Valid" && /Cloudflare/i.test(subject), detail: `${status} ${subject}`.trim() };
}

export interface DownloadDeps {
  fetch?: typeof fetch;
  verify?: (file: string) => { ok: boolean; detail: string };
  platform?: NodeJS.Platform;
  arch?: string;
}

/** Downloads cloudflared into the factory's `bin/`. Call only with the owner's consent. */
export async function downloadCloudflared(home: FactoryHome, deps: DownloadDeps = {}): Promise<{ path: string; sha256: string }> {
  const platform = deps.platform ?? process.platform;
  const plan = downloadPlan(platform, deps.arch ?? process.arch);
  if ("manual" in plan) throw new Error(plan.manual);
  const res = await (deps.fetch ?? fetch)(plan.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`No se pudo descargar cloudflared (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  mkdirSync(home.bin, { recursive: true });
  const path = join(home.bin, binName(platform));
  writeFileSync(path, data);
  if (platform === "win32") {
    const check = (deps.verify ?? verifyWindowsSignature)(path);
    if (!check.ok) {
      rmSync(path, { force: true });
      throw new Error(`La firma de cloudflared no es válida (${check.detail}); lo borré y no se usó.`);
    }
  } else chmodSync(path, 0o755);
  return { path, sha256: createHash("sha256").update(data).digest("hex") };
}

export type SpawnTunnel = (bin: string, args: string[], env?: NodeJS.ProcessEnv) => ChildProcess;
const spawnTunnel: SpawnTunnel = (bin, args, env) => spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });

/** The secret holding a Cloudflare named tunnel's token; it reaches cloudflared only as TUNNEL_TOKEN in its environment. */
export const TUNNEL_TOKEN_SECRET = "CLOUDFLARE_TUNNEL_TOKEN";
export const TUNNEL_STATE_KEY = "panel.tunnelState";
/** What cloudflared prints once a named tunnel's connection is up. */
const REGISTERED_PATTERN = /Registered tunnel connection/;

/** The tunnel's health, as kept in kv `panel.tunnelState`. */
export interface TunnelState {
  mode: "quick" | "named";
  /** Present while connected. */
  connectedSince?: string;
  /** Consecutive exits since the last connection. */
  failures: number;
  lastExitAt?: string;
  problem?: string;
}

export function readTunnelState(store: Store): TunnelState | undefined {
  const raw = store.getKv(TUNNEL_STATE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as TunnelState;
  } catch {
    return undefined;
  }
}

/**
 * Keeps the tunnel matching what the owner asked for: started when on, closed
 * when off, reopened (with growing waits) when it dies. Its address is kept in
 * `kv` so every interface can show it. With a fixed `hostname` and the token
 * secret it runs a named tunnel, whose address does not change; otherwise a
 * quick tunnel.
 */
export function tunnelKeeper(deps: {
  home: FactoryHome;
  store: Store;
  port: number;
  /** `panel.tunnel.hostname` from the factory file. */
  hostname?: string;
  /** Reads the named tunnel's token; absent or empty means a quick tunnel. */
  token?: () => string | undefined;
  spawn?: SpawnTunnel;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let child: ChildProcess | undefined;
  let failures = 0;
  let retryAt = 0;
  let lastExitAt: string | undefined;
  let tokenWarned = false;

  const save = (state: TunnelState) => deps.store.setKv(TUNNEL_STATE_KEY, JSON.stringify(state));
  const close = () => {
    child?.kill();
    child = undefined;
    deps.store.deleteKv(REMOTE_URL_KEY);
    deps.store.deleteKv(TUNNEL_STATE_KEY);
  };
  const readToken = () => {
    try {
      return deps.token?.() || undefined;
    } catch (err) {
      log.warn("tunnel token unreadable", { error: String(err) });
      return undefined;
    }
  };

  return {
    tick() {
      if (deps.store.getKv(REMOTE_KEY) !== "on" || deps.port <= 0) {
        if (child) close();
        else if (deps.store.getKv(TUNNEL_STATE_KEY) !== undefined) deps.store.deleteKv(TUNNEL_STATE_KEY);
        return;
      }
      if (child || now() < retryAt) return;
      const bin = findCloudflared(deps.home);
      if (!bin) {
        log.warn("remote panel is on but cloudflared is missing; run `zero panel remote on`");
        retryAt = now() + 60_000;
        return;
      }
      const token = deps.hostname ? readToken() : undefined;
      const mode: TunnelState["mode"] = deps.hostname && token ? "named" : "quick";
      let problem: string | undefined;
      if (deps.hostname && !token) {
        problem = `falta el secreto ${TUNNEL_TOKEN_SECRET}: corré \`zero secret set ${TUNNEL_TOKEN_SECRET}\`; mientras tanto va el túnel temporal`;
        if (!tokenWarned) log.warn(`panel.tunnel.hostname is set but the secret is missing; run \`zero secret set ${TUNNEL_TOKEN_SECRET}\`. Using a quick tunnel meanwhile`);
        tokenWarned = true;
      }
      const base = (): TunnelState => ({ mode, failures, ...(lastExitAt ? { lastExitAt } : {}), ...(problem ? { problem } : {}) });
      const proc =
        mode === "named"
          ? (deps.spawn ?? spawnTunnel)(bin, ["tunnel", "--no-autoupdate", "run"], { ...process.env, TUNNEL_TOKEN: token })
          : (deps.spawn ?? spawnTunnel)(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${deps.port}`]);
      child = proc;
      save(base());
      const connected = (url: string) => {
        deps.store.setKv(REMOTE_URL_KEY, url);
        failures = 0;
        save({ ...base(), connectedSince: new Date(now()).toISOString() });
        log.info("remote panel open", { url, mode });
      };
      const read = (chunk: Buffer) => {
        if (child !== proc) return;
        const text = String(chunk);
        if (mode === "named") {
          if (REGISTERED_PATTERN.test(text) && deps.store.getKv(REMOTE_URL_KEY) === undefined) connected(`https://${deps.hostname}`);
          return;
        }
        const url = URL_PATTERN.exec(text)?.[0];
        if (url) connected(url);
      };
      proc.stdout?.on("data", read);
      proc.stderr?.on("data", read);
      proc.on("error", (err) => log.warn("tunnel failed to start", { error: String(err) }));
      proc.on("exit", (code) => {
        if (child !== proc) return;
        child = undefined;
        deps.store.deleteKv(REMOTE_URL_KEY);
        failures++;
        lastExitAt = new Date(now()).toISOString();
        retryAt = now() + Math.min(failures * 15_000, 300_000);
        save(base());
        log.warn("tunnel closed; reopening", { code, mode, inMs: retryAt - now() });
      });
    },
    stop: close,
  };
}
