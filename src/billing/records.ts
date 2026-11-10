import type { LineConfig } from "../config.js";

/**
 * What the external services a line's app uses cost in a month. A daemon pass
 * reads each service at most once per local day and keeps the result in kv;
 * the monthly report reads only those records, never an API.
 */

export type BillingService = "github" | "vercel" | "supabase";

/** Why a service has no figure. Chosen by code, never copied from an answer. */
export type MissingReason = "sin-token" | "sin-respuesta" | "respuesta-invalida" | "sin-costo" | "sin-repositorio";

export interface BillingFigure {
  label: string;
  value: string;
}

export interface BillingRecord {
  service: BillingService;
  /** AAAA-MM. */
  month: string;
  /** Where the figures come from, in words. */
  source: string;
  /** ISO time of the read. */
  readAt: string;
  status: "ok" | "sin-dato";
  /** What the month cost in USD; absent when the service does not give it. */
  costUsd?: number;
  figures: BillingFigure[];
  reason?: MissingReason;
}

export interface ReadInput {
  line: LineConfig;
  month: string;
  now: Date;
}

/** One service's read-only adapter: it answers a record and never throws. */
export interface BillingReader {
  service: BillingService;
  read(input: ReadInput): Promise<BillingRecord>;
}

export interface ServiceInfo {
  /** As the report names it. */
  label: string;
  /** The default source, shown while there is no record. */
  source: string;
  /** The secrets it reads, first found wins. */
  secrets: string[];
}

/** Every known service, in the report's order. Adding one means an entry here, a key in `services` and a reader. */
export const BILLING_SERVICES: Record<BillingService, ServiceInfo> = {
  github: { label: "GitHub Actions", source: "API de facturación de GitHub", secrets: ["GITHUB_BILLING_TOKEN", "GH_TOKEN"] },
  vercel: { label: "Vercel", source: "API de Vercel", secrets: ["VERCEL_TOKEN"] },
  supabase: { label: "Supabase", source: "Management API de Supabase", secrets: ["SUPABASE_ACCESS_TOKEN"] },
};

export const MISSING_TEXT: Record<MissingReason, string> = {
  "sin-token": "falta el token",
  "sin-respuesta": "el servicio no respondió",
  "respuesta-invalida": "la respuesta no se pudo leer",
  "sin-costo": "la API no da el costo",
  "sin-repositorio": "no se sabe el repositorio",
};

/** The services a line declares, in the report's order. */
export function lineServices(line: LineConfig | undefined): BillingService[] {
  const declared = line?.services ?? {};
  return (Object.keys(BILLING_SERVICES) as BillingService[]).filter((s) => declared[s] !== undefined);
}

/** The record of a line's service for a month. */
export const billingKey = (line: string, service: BillingService, month: string) => `billing:${line}:${service}:${month}`;
/** The local day a line's service was last read (marked before the call). */
export const billingDayKey = (line: string, service: BillingService) => `billing-day:${line}:${service}`;

const isFigure = (f: unknown): f is BillingFigure =>
  !!f && typeof f === "object" && typeof (f as BillingFigure).label === "string" && typeof (f as BillingFigure).value === "string";

/** A stored record, or undefined when it is missing or does not read as one. */
export function parseBillingRecord(raw: string | undefined, service: BillingService, month: string): BillingRecord | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const r = value as Partial<BillingRecord>;
  if (r.service !== service || r.month !== month || typeof r.readAt !== "string" || Number.isNaN(Date.parse(r.readAt))) return undefined;
  if (r.status !== "ok" && r.status !== "sin-dato") return undefined;
  const cost = r.status === "ok" && typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : undefined;
  return {
    service,
    month,
    source: typeof r.source === "string" && r.source ? r.source : BILLING_SERVICES[service].source,
    readAt: r.readAt,
    status: r.status,
    ...(cost === undefined ? {} : { costUsd: cost }),
    figures: r.status === "ok" && Array.isArray(r.figures) ? r.figures.filter(isFigure) : [],
    ...(r.reason && r.reason in MISSING_TEXT ? { reason: r.reason } : {}),
  };
}

/** A record saying the service has no figure, for a reason chosen by code. */
export const missingRecord = (service: BillingService, month: string, now: Date, reason: MissingReason): BillingRecord => ({
  service,
  month,
  source: BILLING_SERVICES[service].source,
  readAt: now.toISOString(),
  status: "sin-dato",
  figures: [],
  reason,
});
