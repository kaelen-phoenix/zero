import type { FactoryContext } from "../app.js";
import { log } from "../log.js";
import { realGit, realNpmLatest, recordLookFailed, recordSeen, type GitRunner, type NpmLatest } from "../package-install.js";
import { parseGitSource } from "../package-source.js";
import { entryName } from "../packages.js";

const LAST_KEY = "package-updates:last";
const EVERY_MS = 24 * 60 * 60_000;

/** The commit a reference points to, from `git ls-remote`: a tag's peeled line first, in the order git itself reads a short name. */
export function remoteCommit(output: string, ref: string | undefined): string | undefined {
  const rows = output.split("\n").flatMap((line) => {
    const m = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line.trim());
    return m ? [{ sha: m[1]!, name: m[2]! }] : [];
  });
  if (ref && /^[0-9a-f]{40,64}$/.test(ref)) return ref;
  const wanted = ref ? [`refs/tags/${ref}^{}`, `refs/tags/${ref}`, `refs/heads/${ref}`, `${ref}^{}`, ref] : ["HEAD"];
  for (const name of wanted) {
    const row = rows.find((r) => r.name === name);
    if (row) return row.sha;
  }
  return rows.find((r) => r.name.endsWith("^{}"))?.sha ?? rows[0]?.sha;
}

/**
 * What each git and npm package's remote has now, at most once every 24 hours,
 * so `zero package list` can tell without using the network. It only asks: it
 * never touches a package's folder, and a remote that fails stays on record.
 */
export async function packageUpdatesPass(ctx: FactoryContext, now: Date, opts: { git?: GitRunner; latest?: NpmLatest } = {}): Promise<void> {
  const watched = ctx.config.packages.filter((p) => p.git || p.npm);
  if (!watched.length) return;
  const last = ctx.store.getKv(LAST_KEY);
  if (last && now.getTime() - Date.parse(last) < EVERY_MS) return;
  ctx.store.setKv(LAST_KEY, now.toISOString());
  const git = opts.git ?? realGit;
  const latest = opts.latest ?? realNpmLatest;
  for (const entry of watched) {
    const name = entryName(entry, ctx.home);
    try {
      if (entry.npm) {
        recordSeen(ctx.store, name, await latest(entry.npm), now);
        continue;
      }
      const source = parseGitSource(entry.git!);
      if ("error" in source) throw new Error(source.error);
      // Asked by name alone, git leaves out an annotated tag's peeled line and only the tag object's sha comes back.
      const output = await git(["ls-remote", "--", source.url, ...(source.ref ? [source.ref, `${source.ref}^{}`] : ["HEAD"])], { cwd: ctx.home.root });
      const seen = remoteCommit(output, source.ref);
      if (!seen) throw new Error(`el remoto no tiene ${source.ref ?? "HEAD"}`);
      recordSeen(ctx.store, name, seen, now);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      recordLookFailed(ctx.store, name, reason, now);
      log.warn("package update check failed", { package: name, error: reason });
    }
  }
}
