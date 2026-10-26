import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** node:sqlite is still flagged experimental; load it without printing that warning on every command. */
function loadSqlite(): typeof import("node:sqlite") {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes("SQLite")) return;
    (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}

const { DatabaseSync: Database } = loadSqlite();

export const JOB_STATUSES = ["queued", "running", "waiting", "delivered", "failed", "stopped"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const FINAL_STATUSES: readonly JobStatus[] = ["delivered", "failed", "stopped"];

/** Last station completed; the runner resumes after it. */
export type Checkpoint = "none" | "spec" | "review" | "delivered";
export type Station = "spec" | "build" | "verify" | "review" | "integrate";

export type QuestionKind = "spec-ready" | "before-integrate" | "protected-path" | "budget-exceeded" | "integration-blocked";

export interface Question {
  kind: QuestionKind;
  /** Plain-language question for the owner. */
  text: string;
  askedAt: string;
  expiresAt: string;
  onTimeout: "approve" | "reject";
  /** Data the runner needs when the answer arrives, e.g. the protected paths in question. */
  data?: Record<string, unknown>;
}

/** What the owner has already allowed for this job. */
export interface Approvals {
  spec?: boolean;
  integrate?: boolean;
  protectedPaths?: string[];
  extraBudgetUsd?: number;
  retryIntegration?: boolean;
}

export interface Delivery {
  mode: "merge" | "branch" | "pull-request";
  branch: string;
  url?: string;
  commit?: string;
}

export interface Job {
  id: string;
  line: string;
  kind: "request" | "spec";
  request: string;
  status: JobStatus;
  station?: Station;
  checkpoint: Checkpoint;
  attempt: number;
  title?: string;
  spec?: unknown;
  branch?: string;
  worktree?: string;
  /** Where the job runs, fixed when it starts: a job started in the box finishes in the box. */
  isolation?: "worktree" | "container";
  feedback?: string;
  costUsd: number;
  budgetUsd: number;
  question?: Question;
  approvals: Approvals;
  delivery?: Delivery;
  reason?: string;
  stopRequested: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface SpanRow {
  id: string;
  jobId?: string;
  parentId?: string;
  name: string;
  start: string;
  end?: string;
  status?: "ok" | "error";
  attrs: Record<string, unknown>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  line TEXT NOT NULL,
  kind TEXT NOT NULL,
  request TEXT NOT NULL,
  status TEXT NOT NULL,
  station TEXT,
  checkpoint TEXT NOT NULL DEFAULT 'none',
  attempt INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  spec TEXT,
  branch TEXT,
  worktree TEXT,
  feedback TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL,
  question TEXT,
  approvals TEXT NOT NULL DEFAULT '{}',
  delivery TEXT,
  reason TEXT,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  parent_id TEXT,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT,
  status TEXT,
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS spans_job ON spans(job_id, start);
CREATE INDEX IF NOT EXISTS spans_name ON spans(name, start);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

type Row = Record<string, unknown>;
const json = <T>(v: unknown): T | undefined => (typeof v === "string" ? (JSON.parse(v) as T) : undefined);
const str = (v: unknown) => (v == null ? undefined : String(v));

function toJob(r: Row): Job {
  return {
    id: String(r.id),
    line: String(r.line),
    kind: r.kind as Job["kind"],
    request: String(r.request),
    status: r.status as JobStatus,
    station: str(r.station) as Station | undefined,
    checkpoint: r.checkpoint as Checkpoint,
    attempt: Number(r.attempt),
    title: str(r.title),
    spec: json(r.spec),
    branch: str(r.branch),
    worktree: str(r.worktree),
    isolation: str(r.isolation) as Job["isolation"],
    feedback: str(r.feedback),
    costUsd: Number(r.cost_usd),
    budgetUsd: Number(r.budget_usd),
    question: json<Question>(r.question),
    approvals: json<Approvals>(r.approvals) ?? {},
    delivery: json<Delivery>(r.delivery),
    reason: str(r.reason),
    stopRequested: Number(r.stop_requested) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    finishedAt: str(r.finished_at),
  };
}

function toSpan(r: Row): SpanRow {
  return {
    id: String(r.id),
    jobId: str(r.job_id),
    parentId: str(r.parent_id),
    name: String(r.name),
    start: String(r.start),
    end: str(r.end),
    status: str(r.status) as SpanRow["status"],
    attrs: json<Record<string, unknown>>(r.attrs) ?? {},
  };
}

const COLUMNS: Record<string, string> = {
  status: "status", station: "station", checkpoint: "checkpoint", attempt: "attempt", title: "title",
  spec: "spec", branch: "branch", worktree: "worktree", isolation: "isolation", feedback: "feedback", costUsd: "cost_usd",
  budgetUsd: "budget_usd", question: "question", approvals: "approvals", delivery: "delivery",
  reason: "reason", stopRequested: "stop_requested", finishedAt: "finished_at",
};
const JSON_FIELDS = new Set(["spec", "question", "approvals", "delivery"]);

export type JobPatch = Partial<Omit<Job, "id" | "line" | "kind" | "request" | "createdAt" | "updatedAt">>;

export const newId = () => randomBytes(4).toString("hex");

/**
 * The factory's durable state, shared by the daemon, the CLI and the MCP
 * server through one SQLite file (WAL, so readers never block the writer).
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(path: string, private now: () => Date = () => new Date()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Columns added after the first release, for factories created before them. */
  private migrate() {
    const columns = new Set((this.db.prepare("PRAGMA table_info(jobs)").all() as Row[]).map((c) => String(c.name)));
    if (!columns.has("isolation")) this.db.exec("ALTER TABLE jobs ADD COLUMN isolation TEXT");
  }

  close() {
    this.db.close();
  }

  private stamp() {
    return this.now().toISOString();
  }

  createJob(input: { line: string; kind: Job["kind"]; request: string; budgetUsd: number }): Job {
    const at = this.stamp();
    const id = newId();
    this.db
      .prepare("INSERT INTO jobs (id, line, kind, request, status, budget_usd, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)")
      .run(id, input.line, input.kind, input.request, input.budgetUsd, at, at);
    return this.getJob(id)!;
  }

  getJob(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row && toJob(row);
  }

  /** Updates the given fields; `null` clears a field. */
  updateJob(id: string, patch: { [K in keyof JobPatch]: JobPatch[K] | null }): Job {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key];
      if (!column) throw new Error(`unknown job field ${key}`);
      sets.push(`${column} = ?`);
      if (value == null) values.push(null);
      else if (JSON_FIELDS.has(key)) values.push(JSON.stringify(value));
      else if (typeof value === "boolean") values.push(value ? 1 : 0);
      else values.push(value as string | number);
    }
    sets.push("updated_at = ?");
    values.push(this.stamp(), id);
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    const job = this.getJob(id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }

  /** Moves a job to a final status, stamping when it finished. */
  finishJob(id: string, status: "delivered" | "failed" | "stopped", patch: JobPatch = {}): Job {
    return this.updateJob(id, { ...patch, status, question: null, finishedAt: this.stamp() });
  }

  listJobs(filter: { status?: JobStatus[]; line?: string; limit?: number } = {}): Job[] {
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => "?").join(", ")})`);
      values.push(...filter.status);
    }
    if (filter.line) {
      where.push("line = ?");
      values.push(filter.line);
    }
    const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at ASC, rowid ASC LIMIT ?`;
    return (this.db.prepare(sql).all(...values, filter.limit ?? 1000) as Row[]).map(toJob);
  }

  /** Jobs that finished since `since`. */
  finishedSince(since: Date): Job[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE finished_at >= ? ORDER BY finished_at").all(since.toISOString()) as Row[]).map(toJob);
  }

  insertSpan(span: SpanRow) {
    this.db
      .prepare("INSERT INTO spans (id, job_id, parent_id, name, start, end, status, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(span.id, span.jobId ?? null, span.parentId ?? null, span.name, span.start, span.end ?? null, span.status ?? null, JSON.stringify(span.attrs));
  }

  endSpan(id: string, end: string, status: "ok" | "error", attrs: Record<string, unknown>) {
    const row = this.db.prepare("SELECT attrs FROM spans WHERE id = ?").get(id) as Row | undefined;
    const merged = { ...(json<Record<string, unknown>>(row?.attrs) ?? {}), ...attrs };
    this.db.prepare("UPDATE spans SET end = ?, status = ?, attrs = ? WHERE id = ?").run(end, status, JSON.stringify(merged), id);
  }

  spansForJob(jobId: string): SpanRow[] {
    return (this.db.prepare("SELECT * FROM spans WHERE job_id = ? ORDER BY start, rowid").all(jobId) as Row[]).map(toSpan);
  }

  spansSince(name: string, since: Date): SpanRow[] {
    return (this.db.prepare("SELECT * FROM spans WHERE name = ? AND start >= ? ORDER BY start").all(name, since.toISOString()) as Row[]).map(toSpan);
  }

  getKv(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
    return str(row?.value);
  }

  setKv(key: string, value: string) {
    this.db
      .prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, value, this.stamp());
  }

  deleteKv(key: string) {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
}
