import type { FactoryContext } from "../app.js";
import { log } from "../log.js";
import { billingDayKey, billingKey, lineServices, parseBillingRecord, type BillingReader, type BillingService } from "./records.js";

const two = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const monthOf = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}`;

/**
 * The months a service must be read for now: the current one, plus the previous one while its
 * record is missing or was read before the current month began (so the closed month gets its final figures).
 */
function monthsToRead(ctx: FactoryContext, line: string, service: BillingService, now: Date): string[] {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const previous = monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const record = parseBillingRecord(ctx.store.getKv(billingKey(line, service, previous)), service, previous);
  const closed = record !== undefined && Date.parse(record.readAt) >= start.getTime();
  return closed ? [monthOf(now)] : [monthOf(now), previous];
}

/**
 * Reads what each line's services cost, at most once per local day per service (the mark is set
 * before the call), and keeps every answer in kv for the monthly report. Readers never throw; a
 * store failure is logged and the pass goes on with the next service.
 */
export async function billingPass(ctx: FactoryContext, readers: Partial<Record<BillingService, BillingReader>>, now: Date): Promise<void> {
  const today = localDay(now);
  for (const line of ctx.config.lines) {
    for (const service of lineServices(line)) {
      const reader = readers[service];
      if (!reader) continue;
      try {
        const mark = billingDayKey(line.name, service);
        if (ctx.store.getKv(mark) === today) continue;
        ctx.store.setKv(mark, today);
        for (const month of monthsToRead(ctx, line.name, service, now)) {
          const record = await reader.read({ line, month, now });
          ctx.store.setKv(billingKey(line.name, service, month), JSON.stringify(record));
        }
      } catch (err) {
        log.warn("billing pass failed", { line: line.name, service, error: err instanceof Error ? err.name : "error" });
      }
    }
  }
}
