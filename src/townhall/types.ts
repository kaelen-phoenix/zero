import { z } from "zod";

/**
 * What agents may contribute to the townhall from a run. The spec and review
 * stations return these as part of their structured output.
 */
export const LearningSchema = z.object({
  kind: z.enum(["finding", "lesson"]).describe("finding = a fact about this codebase; lesson = what worked or failed and should change future runs."),
  topic: z.string().describe("Short key, e.g. 'tests', 'build', 'src/tracker.ts'."),
  body: z.string(),
  source: z.string().describe("Where this comes from, as 'path' or 'path:line'. Empty if it is not about a file."),
});

export type Learning = z.infer<typeof LearningSchema>;

export interface RunData {
  status: "delivered" | "failed" | "stopped";
  attempts: number;
  costUsd: number;
  durationMs: number;
  engines: string;
  delivery?: string;
}

interface PostBase {
  id: string;
  /** ISO timestamp. */
  at: string;
  line: string;
  job?: string;
  source: string;
  topic: string;
  body: string;
}

/**
 * One entry in the network's collective memory.
 * - run: the outcome of a job
 * - finding / lesson: knowledge agents want future runs to have
 * - blocker: something the network could not resolve, which needs the owner
 * - proposal: work an agent discovered that nobody asked for yet
 */
export type Post =
  | (PostBase & { kind: "run"; data: RunData })
  | (PostBase & { kind: "finding" | "lesson" | "blocker" | "proposal" });

export type PostKind = Post["kind"];

/** Distributes Omit over the union so each variant keeps its own fields. */
export type NewPost = Post extends infer P ? (P extends Post ? Omit<P, "id" | "at"> : never) : never;

export interface RecallFilter {
  line?: string;
  kinds?: PostKind[];
  since?: Date;
  limit?: number;
}

export interface TownhallStore {
  append(posts: Post[]): Promise<void>;
  /** All posts in the given window, oldest first. */
  read(since: Date): Promise<Post[]>;
}
