import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Post, TownhallStore } from "./types.js";

/** Posts are sharded by month so files stay small: posts/2026-10.jsonl */
export const shardOf = (iso: string) => `posts/${iso.slice(0, 7)}.jsonl`;

export function shardsSince(since: Date, now = new Date()): string[] {
  const shards: string[] = [];
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
  while (cursor <= now) {
    shards.push(shardOf(cursor.toISOString()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return shards;
}

export function parseJsonl(text: string): Post[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Post);
}

/** JSONL files under the factory directory: plain text, versionable, no server. */
export function createLocalStore(dir: string): TownhallStore {
  return {
    async append(posts) {
      const groups = new Map<string, Post[]>();
      for (const post of posts) groups.set(shardOf(post.at), [...(groups.get(shardOf(post.at)) ?? []), post]);
      for (const [shard, group] of groups) {
        await mkdir(join(dir, "posts"), { recursive: true });
        await appendFile(join(dir, shard), group.map((p) => JSON.stringify(p)).join("\n") + "\n");
      }
    },
    async read(since) {
      const posts: Post[] = [];
      for (const shard of shardsSince(since)) {
        const text = await readFile(join(dir, shard), "utf8").catch(() => "");
        posts.push(...parseJsonl(text));
      }
      return posts.filter((p) => new Date(p.at) >= since);
    },
  };
}
