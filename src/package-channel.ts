import type { GitRunner, SeenUpdate } from "./package-install.js";
import { compareVersions, listReleases, newestRelease, releaseTag, type Release } from "./releases.js";

export const NO_RELEASES = "el remoto no tiene versiones liberadas (etiquetas vX.Y.Z), y el canal estable solo toma esas";

/** A release's tag in full, so a branch with the same name is never taken for it. */
export const tagRef = (tag: string) => `refs/tags/${tag}`;

/** The releases of a package's remote and the newest of them; throws when it has none. */
export async function stableReleases(git: GitRunner, remote: string, cwd: string): Promise<{ releases: Release[]; newest: Release }> {
  const releases = await listReleases(git, remote, { cwd });
  const newest = newestRelease(releases);
  if (!newest) throw new Error(NO_RELEASES);
  return { releases, newest };
}

/** The released version of an installed commit, from what is on record. */
export function installedVersion(seen: SeenUpdate | undefined, installed: string): string | undefined {
  if (seen?.version && seen.seen === installed) return seen.version;
  return seen?.current?.commit === installed ? seen.current.version : undefined;
}

/** What a look at a package on the stable channel puts on record. */
export type StableLook = Required<Pick<SeenUpdate, "seen" | "version">> & Pick<SeenUpdate, "current" | "ahead">;

export interface ReleaseLook {
  remote: string;
  /** Where the remote is asked from. */
  cwd: string;
  /** The package's clone, only read: what it already has is enough to know whether it contains the release. */
  dir: string;
  installed: string;
  last: SeenUpdate | undefined;
}

/** The newest release of a package on the stable channel next to its installed commit, as it goes on record; nothing is fetched. */
export async function lookForRelease(git: GitRunner, look: ReleaseLook): Promise<StableLook> {
  const { installed } = look;
  const { releases, newest } = await stableReleases(git, look.remote, look.cwd);
  // A release withdrawn from the remote is still the version installed.
  const version = releases.findLast((r) => r.commit === installed)?.version ?? installedVersion(look.last, installed);
  const contains = () => git(["merge-base", "--is-ancestor", newest.commit, installed], { cwd: look.dir }).then(() => true, () => false);
  const ahead = newest.commit !== installed && ((version !== undefined && compareVersions(version, newest.version) > 0) || (await contains()));
  return { seen: newest.commit, version: newest.version, ...(version && { current: { commit: installed, version } }), ...(ahead && { ahead: installed }) };
}

/** Why a package cannot be pinned to a tag of its clone's remote; undefined when it can. */
export async function pinProblem(git: GitRunner, dir: string, tag: string): Promise<string | undefined> {
  const rows = (await git(["ls-remote", "--", "origin", tag], { cwd: dir })).split("\n");
  const names = new Set(rows.map((row) => row.trim().split(/\s+/)[1]));
  if (!names.has(tagRef(tag))) return `el remoto no tiene la etiqueta ${tag}`;
  // A source says the name alone, and git would read it as these before the tag.
  if (/^[0-9a-f]{40,64}$/.test(tag) || names.has(tag) || names.has(`refs/${tag}`)) return `${tag} no sirve para fijar el paquete: git lee ese nombre como otra cosa antes que como la etiqueta`;
  return undefined;
}

/** Why a package on the stable channel stays where it is although the newest release is another commit. */
export const aheadText = (version: string) => `lo instalado ya está más adelante que la última versión liberada (${releaseTag(version)}) y un paquete no vuelve atrás: espera a una versión posterior`;
