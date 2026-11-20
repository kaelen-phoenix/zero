import type { Octokit } from "@octokit/rest";
import { CoordConflict, type CoordApi, type CoordRef } from "./protocol.js";

/**
 * CoordApi over git refs of the private coordination repository: each record is
 * the message of a commit on the empty tree, pointed at by `refs/heads/zero-coord/<name>`.
 * GitHub refuses with 422 to create a ref that exists or to move one without force
 * when the new commit does not descend from its tip, which is the compare-and-swap
 * the protocol needs. Only the git data endpoints are used, never GitHub Actions.
 */

export const COORD_PREFIX = "zero-coord/";

function status(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

export function githubCoord(octokit: Octokit, repository: string): CoordApi {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`repositorio de coordinación inválido: ${repository}`);
  const head = (name: string): string => `heads/${COORD_PREFIX}${name}`;
  let tree: Promise<string> | undefined;

  const emptyTree = (): Promise<string> => {
    tree ??= octokit.git.createTree({ owner, repo, tree: [] }).then((r) => r.data.sha);
    tree.catch(() => {
      tree = undefined;
    });
    return tree;
  };

  const commit = async (data: string, parents: string[]): Promise<string> => {
    const created = await octokit.git.createCommit({ owner, repo, message: data, tree: await emptyTree(), parents });
    return created.data.sha;
  };

  const dataOf = async (sha: string): Promise<string> => (await octokit.git.getCommit({ owner, repo, commit_sha: sha })).data.message;

  const create = async (name: string, data: string): Promise<string> => {
    const sha = await commit(data, []);
    try {
      await octokit.git.createRef({ owner, repo, ref: `refs/${head(name)}`, sha });
    } catch (err) {
      if (status(err) === 422) throw new CoordConflict(name);
      throw err;
    }
    return sha;
  };

  const move = async (name: string, sha: string, force: boolean): Promise<void> => {
    try {
      await octokit.git.updateRef({ owner, repo, ref: head(name), sha, force });
    } catch (err) {
      if (status(err) === 422) throw new CoordConflict(name);
      throw err;
    }
  };

  return {
    async read(name) {
      let sha: string;
      try {
        sha = (await octokit.git.getRef({ owner, repo, ref: head(name) })).data.object.sha;
      } catch (err) {
        if (status(err) === 404) return undefined;
        throw err;
      }
      return { name, sha, data: await dataOf(sha) };
    },
    async list(prefix) {
      let refs: { ref: string; object: { sha: string } }[];
      try {
        refs = (await octokit.git.listMatchingRefs({ owner, repo, ref: head(prefix) })).data;
      } catch (err) {
        if (status(err) === 404) return [];
        throw err;
      }
      const base = `refs/heads/${COORD_PREFIX}`;
      const out: CoordRef[] = [];
      for (const r of refs) {
        if (!r.ref.startsWith(base)) continue;
        out.push({ name: r.ref.slice(base.length), sha: r.object.sha, data: await dataOf(r.object.sha) });
      }
      return out;
    },
    create,
    async update(name, data, from) {
      // The new commit descends from `from`, so the move is a fast-forward only while the ref is still there.
      const sha = await commit(data, [from]);
      await move(name, sha, false);
      return sha;
    },
    async write(name, data) {
      const sha = await commit(data, []);
      try {
        await move(name, sha, true);
        return sha;
      } catch (err) {
        // A forced move only fails with 422 when the ref does not exist yet.
        if (!(err instanceof CoordConflict)) throw err;
      }
      try {
        await octokit.git.createRef({ owner, repo, ref: `refs/${head(name)}`, sha });
      } catch (err) {
        if (status(err) !== 422) throw err;
        await move(name, sha, true);
      }
      return sha;
    },
    async delete(name) {
      try {
        await octokit.git.deleteRef({ owner, repo, ref: head(name) });
      } catch (err) {
        if (status(err) !== 404 && status(err) !== 422) throw err;
      }
    },
  };
}
