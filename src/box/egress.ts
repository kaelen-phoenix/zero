import { BlockList, isIP } from "node:net";
import { z } from "zod";
import type { FactoryConfig } from "../config.js";
import { resolveEngine } from "../engines/index.js";
import { stationEngines } from "./credentials.js";

/** What the gate enforces. The host writes it to `gate/policy.json`; the gate reloads it when it changes. */
export interface EgressPolicy {
  mode: FactoryConfig["egress"]["mode"];
  /** The owner's allowed sites plus the sites the configured engines need. */
  allow: string[];
  block: string[];
}

/**
 * Why a connection was refused. Only `suspicious` hints at a manipulated agent
 * or dependency; `listed` and `not-allowed` are the owner's own policy.
 */
export type EgressRule = "listed" | "suspicious" | "not-allowed" | "unauthenticated";

export type Refusal = { allowed: false; rule: EgressRule; reason: string };
export type Verdict = { allowed: true } | Refusal;

export interface Destination {
  host: string;
  port: number;
}

export const ALLOWED: Verdict = { allowed: true };

export const EgressEventSchema = z.object({
  id: z.string().min(1),
  /** When the connection started, by the gate's clock. */
  at: z.string(),
  job: z.string().optional(),
  station: z.string().optional(),
  host: z.string(),
  port: z.number().int(),
  allowed: z.boolean(),
  rule: z.enum(["listed", "suspicious", "not-allowed", "unauthenticated"]).optional(),
  reason: z.string().optional(),
  bytesUp: z.number().nonnegative(),
  bytesDown: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  /** Allowed, but it could not be made (name not found, refused, idle). */
  error: z.string().optional(),
});

/** One connection, as the gate records it: a JSON line in `gate/events-<day>.jsonl`. */
export type EgressEvent = z.infer<typeof EgressEventSchema>;

export function egressPolicy(config: Pick<FactoryConfig, "egress" | "engines" | "engine" | "stations">): EgressPolicy {
  const engineHosts = stationEngines(config).flatMap((name) => {
    try {
      return resolveEngine(name, config).hosts ?? [];
    } catch {
      return [];
    }
  });
  return { mode: config.egress.mode, allow: [...new Set([...config.egress.allow, ...engineHosts])], block: [...config.egress.block] };
}

/** Lowercase, without a trailing dot or IPv6 brackets. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

/** `example.com` covers its subdomains; `example.com:8443` only that port; an IP address matches exactly. */
export function matchesSite(site: string, dest: Destination): boolean {
  const [, name = site, port] = /^(.*?)(?::(\d+))?$/.exec(site) ?? [];
  if (port !== undefined && Number(port) !== dest.port) return false;
  const host = normalizeHost(dest.host);
  if (isIP(name) || isIP(host)) return name === host;
  return host === name || host.endsWith(`.${name}`);
}

/**
 * Services an agent has no reason to reach and that are routinely used to get
 * data out: each category reads as "<site> es un <category>".
 */
const EXFIL_SERVICES: Record<string, string[]> = {
  "servicio para pegar textos o compartir archivos": [
    "pastebin.com", "paste.ee", "hastebin.com", "dpaste.com", "dpaste.org", "privatebin.net", "rentry.co", "controlc.com",
    "termbin.com", "ix.io", "sprunge.us", "0x0.st", "transfer.sh", "file.io", "tmpfiles.org", "gofile.io", "catbox.moe",
    "temp.sh", "bashupload.com", "oshi.at", "filebin.net", "pixeldrain.com", "wetransfer.com", "anonfiles.com",
  ],
  "servicio para capturar peticiones": [
    "webhook.site", "requestbin.com", "requestcatcher.com", "pipedream.net", "beeceptor.com", "hookbin.com", "postb.in",
    "ptsv2.com", "ptsv3.com", "requestrepo.com", "interact.sh", "oast.fun", "oast.pro", "oast.live", "oast.site",
    "oast.online", "oast.me", "oastify.com", "burpcollaborator.net", "canarytokens.com", "dnslog.cn", "ceye.io",
  ],
  "túnel hacia otra computadora": [
    "ngrok.io", "ngrok.app", "ngrok-free.app", "ngrok.dev", "ngrok-free.dev", "trycloudflare.com", "loca.lt",
    "localtunnel.me", "serveo.net", "localhost.run", "lhr.life", "pinggy.io", "pinggy.link", "bore.pub", "playit.gg",
  ],
  "servicio de mensajería o webhooks": ["api.telegram.org", "discord.com", "discordapp.com", "hooks.slack.com"],
  "servicio de DNS dinámico": ["duckdns.org", "ddns.net", "no-ip.com", "hopto.org", "zapto.org", "sytes.net", "dynu.net", "afraid.org"],
};

/** Addresses that are not the public internet: the owner's network, this machine, cloud metadata, reserved ranges. */
const INTERNAL = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) INTERNAL.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) {
  INTERNAL.addSubnet(net, prefix, "ipv6");
}

/** Labels this long rarely name a real site; they are how data is smuggled out in a name. */
const MAX_LABEL = 48;
const MAX_NAME = 150;

function exfilService(host: string): { site: string; kind: string } | undefined {
  for (const [kind, sites] of Object.entries(EXFIL_SERVICES)) {
    const site = sites.find((s) => host === s || host.endsWith(`.${s}`));
    if (site) return { site, kind };
  }
  return undefined;
}

/** Why an address must not be reached, or undefined for a public one. IPv4-mapped IPv6 addresses are checked as IPv4. */
export function internalAddress(address: string): string | undefined {
  return INTERNAL.check(address, isIP(address) === 6 ? "ipv6" : "ipv4") ? `apunta a tu red local o a una dirección interna (${address})` : undefined;
}

/** Suspicions that need only the name and port. */
function suspiciousName({ host, port }: Destination): string | undefined {
  if (isIP(host)) return internalAddress(host) ?? `es una dirección IP sin nombre de sitio (${host})`;
  if (port !== 80 && port !== 443) return `usa un puerto poco común (${port})`;
  const service = exfilService(host);
  if (service) return `${service.site} es un ${service.kind}, muy usado para sacar datos`;
  if (host.length > MAX_NAME || host.split(".").some((label) => label.length > MAX_LABEL)) return "el nombre del sitio es tan largo que parece llevar datos escondidos";
  return undefined;
}

const block = (rule: EgressRule, reason: string): Refusal => ({ allowed: false, rule, reason });

/**
 * The name-based rules, in order: the owner's block list, the owner's allow
 * list and the engines' sites, suspicions, and the mode. Returns a final
 * verdict, or undefined when the name passed and the gate must resolve it
 * and call `judgeAddresses` (allowlist mode never resolves an unlisted name).
 */
export function judgeName(dest: Destination, policy: EgressPolicy): Verdict | undefined {
  const d = { host: normalizeHost(dest.host), port: dest.port };
  if (policy.block.some((s) => matchesSite(s, d))) return block("listed", "está en tu lista de sitios bloqueados");
  if (policy.allow.some((s) => matchesSite(s, d))) return ALLOWED;
  const suspicion = suspiciousName(d);
  if (suspicion) return block("suspicious", suspicion);
  if (policy.mode === "allowlist") return block("not-allowed", "no está en tu lista de sitios permitidos");
  return undefined;
}

/** After resolving: every address must be public, or a name could point the box at the owner's network. */
export function judgeAddresses(addresses: string[]): Verdict {
  for (const address of addresses) {
    const problem = internalAddress(address);
    if (problem) return block("suspicious", problem);
  }
  return ALLOWED;
}

export const UNAUTHENTICATED: Refusal = block("unauthenticated", "la conexión no traía un pase válido de la caja");
