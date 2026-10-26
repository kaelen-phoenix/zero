import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
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

const toJsonl = (posts: Post[]) => posts.map((p) => JSON.stringify(p)).join("\n") + "\n";

function groupByShard(posts: Post[]): Map<string, Post[]> {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const shard = shardOf(post.at);
    groups.set(shard, [...(groups.get(shard) ?? []), post]);
  }
  return groups;
}

/** JSONL files on local disk, for running zero outside CI. */
export function createLocalStore(dir: string): TownhallStore {
  return {
    async append(posts) {
      for (const [shard, group] of groupByShard(posts)) {
        const path = join(dir, shard);
        await mkdir(join(path, ".."), { recursive: true });
        await appendFile(path, toJsonl(group));
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

/**
 * JSONL files on an orphan branch of the repository itself: free, versioned and
 * auditable, with no server to run. Writes are serialised by the workflows'
 * shared concurrency group.
 */
export function createGitHubStore(token: string, repository: string, branch: string): TownhallStore {
  const [owner, repo] = repository.split("/") as [string, string];
  const gh = new Octokit({ auth: token });

  async function getFile(path: string): Promise<{ text: string; sha?: string }> {
    try {
      const { data } = await gh.repos.getContent({ owner, repo, path, ref: branch });
      if (Array.isArray(data) || data.type !== "file") throw new Error(`${path} is not a file`);
      // The contents API inlines files up to 1 MB; monthly shards stay well below that.
      return { text: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
    } catch (e: any) {
      if (e.status === 404) return { text: "" };
      throw e;
    }
  }

  async function ensureBranch() {
    try {
      await gh.repos.getBranch({ owner, repo, branch });
    } catch (e: any) {
      if (e.status !== 404) throw e;
      const readme = "# zero townhall\n\nCollective memory of the agent network. Written by zero; one JSON post per line in `posts/`.\n";
      const tree = await gh.git.createTree({ owner, repo, tree: [{ path: "README.md", mode: "100644", type: "blob", content: readme }] });
      const commit = await gh.git.createCommit({ owner, repo, message: "townhall: init", tree: tree.data.sha, parents: [] });
      await gh.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
    }
  }

  return {
    async append(posts) {
      await ensureBranch();
      for (const [shard, group] of groupByShard(posts)) {
        const { text, sha } = await getFile(shard);
        await gh.repos.createOrUpdateFileContents({
          owner, repo, branch, path: shard, sha,
          message: `townhall: +${group.length} post(s)`,
          content: Buffer.from(text + toJsonl(group)).toString("base64"),
        });
      }
    },
    async read(since) {
      const posts: Post[] = [];
      for (const shard of shardsSince(since)) posts.push(...parseJsonl((await getFile(shard)).text));
      return posts.filter((p) => new Date(p.at) >= since);
    },
  };
}
