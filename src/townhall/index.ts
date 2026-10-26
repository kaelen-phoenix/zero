import { randomUUID } from "node:crypto";
import { log } from "../log.js";
import { redact } from "../secrets.js";
import type { NewPost, Post, RecallFilter, TownhallStore } from "./types.js";

export * from "./types.js";

const DAY = 86_400_000;

/** The agent network's shared space: agents publish what they learn and recall what others learned. */
export interface Townhall {
  publish(posts: NewPost[]): Promise<void>;
  recall(filter?: RecallFilter): Promise<Post[]>;
}

const identity = (p: Pick<Post, "kind" | "line" | "topic" | "body">) => `${p.kind}\u0000${p.line}\u0000${p.topic}\u0000${p.body}`;

/**
 * Notes are cleaned before they are stored: recognisable secrets are redacted
 * and a note identical to one already stored is dropped.
 */
export function createTownhall(store: TownhallStore, now: () => Date = () => new Date()): Townhall {
  return {
    async publish(posts) {
      if (!posts.length) return;
      const at = now().toISOString();
      const seen = new Set((await store.read(new Date(now().getTime() - 365 * DAY))).map(identity));
      const fresh: Post[] = [];
      for (const p of posts) {
        // The cast restores the union that spreading over NewPost widens.
        const post = { ...p, topic: redact(p.topic), body: redact(p.body), source: redact(p.source), id: randomUUID(), at } as Post;
        if (post.kind !== "run" && seen.has(identity(post))) continue;
        seen.add(identity(post));
        fresh.push(post);
      }
      if (fresh.length) await store.append(fresh);
    },
    async recall({ line, kinds, since, limit = 30 } = {}) {
      const posts = await store.read(since ?? new Date(now().getTime() - 90 * DAY));
      return posts.filter((p) => (!line || p.line === line) && (!kinds || kinds.includes(p.kind))).slice(-limit);
    },
  };
}

/** A townhall that remembers nothing. */
export const silentTownhall: Townhall = {
  publish: async () => {},
  recall: async () => [],
};

/**
 * The townhall is never allowed to break production: failures to read or
 * write collective memory are logged and the line keeps running.
 */
export function resilient(townhall: Townhall): Townhall {
  return {
    publish: (posts) =>
      townhall.publish(posts).catch((e) => log.warn("townhall publish failed", { error: String(e) })),
    recall: (filter) =>
      townhall.recall(filter).catch((e) => {
        log.warn("townhall recall failed", { error: String(e) });
        return [];
      }),
  };
}

/** Collective memory rendered as prompt context. */
export function memoryBlock(posts: Post[]): string {
  if (!posts.length) return "";
  const lines = posts.map((p) => `- [${p.kind}] ${p.topic}: ${p.body}${p.source ? ` (${p.source})` : ""}`);
  return `## Townhall: what the network already knows\nPrevious runs left these notes. Use them; they may be outdated, the code wins.\n${lines.join("\n")}`;
}
