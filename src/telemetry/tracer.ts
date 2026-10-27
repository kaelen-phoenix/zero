import { newId, type SpanRow, type Store } from "../state/store.js";

export type Attrs = Record<string, string | number | boolean | undefined>;

export interface Span {
  id: string;
  set(attrs: Attrs): void;
  end(status?: "ok" | "error", attrs?: Attrs): void;
}

/**
 * Spans follow the OpenTelemetry GenAI conventions where one exists
 * (`gen_ai.invoke_agent`, `gen_ai.agent.name`...) so they can be exported
 * over OTLP later without renaming anything.
 */
export class Tracer {
  constructor(private store: Store, private now: () => Date = () => new Date()) {}

  /** The root span of a job. Its id is derived from the job so it survives daemon restarts. */
  jobSpanId(jobId: string) {
    return `job-${jobId}`;
  }

  start(name: string, opts: { jobId?: string; parentId?: string; id?: string; attrs?: Attrs } = {}): Span {
    const id = opts.id ?? newId() + newId();
    const pending: Attrs = { ...opts.attrs };
    this.store.insertSpan({ id, jobId: opts.jobId, parentId: opts.parentId, name, start: this.now().toISOString(), attrs: clean(pending) });
    let ended = false;
    return {
      id,
      set: (attrs) => Object.assign(pending, attrs),
      end: (status = "ok", attrs = {}) => {
        if (ended) return;
        ended = true;
        this.store.endSpan(id, this.now().toISOString(), status, clean({ ...pending, ...attrs }));
      },
    };
  }

  /** Runs `fn` inside a span, ending it as error if `fn` throws. */
  async within<T>(name: string, opts: Parameters<Tracer["start"]>[1], fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.start(name, opts);
    try {
      const result = await fn(span);
      span.end("ok");
      return result;
    } catch (err) {
      span.end("error", { "error.message": err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}

function clean(attrs: Attrs): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
}

const durationMs = (s: SpanRow) => (s.end ? Date.parse(s.end) - Date.parse(s.start) : undefined);

/** How long a span took, as `zero trace` shows it. */
export function spanTime(s: SpanRow): string {
  const ms = durationMs(s);
  return ms === undefined ? "en curso" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A cost as `zero trace` shows it. */
export const traceUsd = (n: number) => `$${n.toFixed(3)}`;

/** The engine an agent span ran on, with its model when known. */
export const spanEngine = (a: Record<string, unknown>) => `${a["zero.engine"]}${a["gen_ai.request.model"] ? ` (${a["gen_ai.request.model"]})` : ""}`;

/** A job's trace as an indented tree, for `zero trace`. */
export function renderTrace(spans: SpanRow[]): string {
  const children = new Map<string | undefined, SpanRow[]>();
  const ids = new Set(spans.map((s) => s.id));
  for (const s of spans) {
    const parent = s.parentId && ids.has(s.parentId) ? s.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  const lines: string[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const s of children.get(parent) ?? []) {
      const time = spanTime(s);
      const mark = s.status === "error" ? "✗" : s.end ? "✓" : "…";
      const details = describe(s);
      lines.push(`${"  ".repeat(depth)}${mark} ${s.name}  ${time}${details ? `  ${details}` : ""}`);
      walk(s.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return lines.join("\n");
}

function describe(s: SpanRow): string {
  const a = s.attrs;
  const parts: string[] = [];
  if (a["zero.attempt"] !== undefined) parts.push(`intento ${a["zero.attempt"]}`);
  if (a["gen_ai.agent.name"]) parts.push(`${a["gen_ai.agent.name"]} vía ${spanEngine(a)}`);
  if (typeof a["zero.cost.usd"] === "number") parts.push(a["zero.cost.source"] === "unknown" ? "costo desconocido" : traceUsd(a["zero.cost.usd"] as number));
  if (a["process.command_line"]) parts.push(`\`${a["process.command_line"]}\` → ${a["process.exit.code"]}`);
  if (a["zero.outcome"]) parts.push(String(a["zero.outcome"]));
  if (a["error.message"]) parts.push(`error: ${a["error.message"]}`);
  return parts.join(" · ");
}
