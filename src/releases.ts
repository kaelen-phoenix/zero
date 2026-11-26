import { cleanError, cleanText, type GitRunner } from "./package-install.js";

/** A released version: a tag named exactly like this on the remote. Any other tag is not one. */
export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface Release {
  /** Without the `v` of its tag. */
  version: string;
  /** The commit it points to, peeled when the tag is annotated. */
  commit: string;
}

const COMMIT = /^[0-9a-f]{7,64}$/i;
const FIRST_VERSION = "0.1.0";

export const releaseTag = (version: string) => `v${version}`;

/** A version as a person writes it (`1.2.0` or `v1.2.0`), without the `v`; undefined when it is not one. */
export function parseVersion(text: string): string | undefined {
  const version = text.replace(/^v/, "");
  return RELEASE_TAG.test(releaseTag(version)) ? version : undefined;
}

// Versions have no upper limit, so their numbers are compared whole.
const numbers = (version: string) => version.split(".").map(BigInt);

export function compareVersions(a: string, b: string): number {
  const [x, y] = [numbers(a), numbers(b)];
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

export function nextPatch(version: string): string {
  const [major, minor, patch] = numbers(version);
  return `${major}.${minor}.${patch! + 1n}`;
}

/** The releases in the output of `git ls-remote --tags`, oldest version first. */
export function parseReleases(output: string): Release[] {
  const commits = new Map<string, string>();
  for (const line of output.split("\n")) {
    const m = /^([0-9a-f]{40,64})\s+refs\/tags\/(\S+?)(\^\{\})?$/.exec(line.trim());
    if (!m || !RELEASE_TAG.test(m[2]!)) continue;
    const version = m[2]!.slice(1);
    // An annotated tag comes twice: its own object and, peeled, the commit it points to.
    if (m[3] || !commits.has(version)) commits.set(version, m[1]!);
  }
  return [...commits].map(([version, commit]) => ({ version, commit })).sort((a, b) => compareVersions(a.version, b.version));
}

/** The releases a remote has, oldest version first. */
export async function listReleases(git: GitRunner, remote: string, opts: { cwd?: string } = {}): Promise<Release[]> {
  return parseReleases(await git(["ls-remote", "--tags", "--", remote], opts));
}

/** The newest of a list ordered as `parseReleases` gives it. */
export const newestRelease = (releases: Release[]): Release | undefined => releases.at(-1);

/** What `zero liberar` was asked to release. */
export interface ReleaseRequest {
  commit?: string;
  version?: string;
}

/** The commit and the version among the arguments, in any order; throws when they are not at most one of each. */
export function parseReleaseRequest(args: string[]): ReleaseRequest {
  const request: ReleaseRequest = {};
  for (const arg of args) {
    const version = parseVersion(arg);
    if (!version && !COMMIT.test(arg)) throw new Error(`"${cleanText(arg)}" no es un commit (entre 7 y 64 caracteres hexadecimales) ni una versión (X.Y.Z).`);
    if (version ? request.version : request.commit) throw new Error("Indicá como mucho un commit y una versión: zero liberar [<commit>] [<versión>]");
    if (version) request.version = version;
    else request.commit = arg.toLowerCase();
  }
  if (!request.commit && !request.version) throw new Error("Indicá qué liberar: zero liberar [<commit>] [<versión>]");
  return request;
}

/** The repository a release is published from, and where to. */
export interface ReleaseTarget {
  repo: string;
  remote: string;
  branch: string;
}

export interface ReleaseOptions {
  git: GitRunner;
  confirm: (question: string) => Promise<boolean>;
  /** What the person in charge reads before answering. */
  say: (text: string) => void;
}

export interface ReleaseResult {
  released: boolean;
  text: string;
}

const short = (sha: string) => sha.slice(0, 12);

class Refused extends Error {}

/** A step that has to work: what failed goes first in the reason of the refusal. */
async function step<T>(what: string, run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (err) {
    throw new Refused(`${what}: ${cleanError(err instanceof Error ? err.message : String(err))}`);
  }
}

/**
 * Publishes a release: pushes a new version tag for a commit of the remote's base branch, once confirmed. It never
 * forces nor moves a tag, and nothing of the local repository changes: the tag exists only on the remote.
 */
export async function publishRelease(target: ReleaseTarget, request: ReleaseRequest, opts: ReleaseOptions): Promise<ReleaseResult> {
  try {
    return await release(target, request, opts);
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    return { released: false, text: `No publiqué nada: ${err.message}` };
  }
}

async function release({ repo, remote, branch }: ReleaseTarget, request: ReleaseRequest, opts: ReleaseOptions): Promise<ReleaseResult> {
  const git = (args: string[]) => opts.git(args, { cwd: repo });
  const isAncestor = (a: string, b: string) => git(["merge-base", "--is-ancestor", a, b]).then(() => true, () => false);
  const releases = () => step(`no pude leer las versiones de ${remote}`, listReleases(opts.git, remote, { cwd: repo }));

  const remotes = await step(`no pude leer el repositorio de ${repo}`, git(["remote"]));
  if (!remotes.split(/\r?\n/).includes(remote)) throw new Refused(`${repo} no tiene un remoto ${remote}.`);
  const published = await releases();
  const newest = newestRelease(published);
  const wanted = request.version;
  if (wanted && published.some((r) => r.version === wanted)) throw new Refused(`la versión ${releaseTag(wanted)} ya existe en ${remote}, y una versión liberada no se mueve.`);
  if (wanted && newest && compareVersions(wanted, newest.version) < 0) throw new Refused(`${releaseTag(wanted)} no es mayor que la última versión liberada (${releaseTag(newest.version)}).`);

  const heads = await step(`no pude mirar ${remote}`, git(["ls-remote", "--", remote, `refs/heads/${branch}`]));
  const tip = heads.split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name === `refs/heads/${branch}`)?.[0];
  if (!tip) throw new Refused(`${remote} no tiene la rama ${branch}.`);
  // Only its objects: no tag, no remote-tracking branch and no FETCH_HEAD, which the daemon may be reading.
  await step(`no pude traer ${branch} de ${remote}`, git(["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--refmap=", remote, `refs/heads/${branch}`]));
  const asked = request.commit ?? tip;
  const sha = await git(["rev-parse", "--verify", "--quiet", `${asked}^{commit}`]).catch(() => undefined);
  // git prefers a branch or a tag named like the short commit, hence the check of what came out.
  if (!sha?.startsWith(asked)) throw new Refused(`no encontré el commit ${short(asked)} en ${branch} de ${remote}, o hay más de uno que empieza así.`);
  if (!(await isAncestor(sha, tip))) throw new Refused(`el commit ${short(sha)} no está en ${branch} de ${remote}: solo se libera lo que ya entró ahí.`);
  if (newest?.commit === sha) throw new Refused(`el commit ${short(sha)} ya es la última versión liberada (${releaseTag(newest.version)}).`);
  // A commit the fetch did not bring is in no history of the branch, so this says no for it too.
  if (newest && !(await isAncestor(newest.commit, sha))) throw new Refused(`el commit ${short(sha)} no es posterior a la última versión liberada (${releaseTag(newest.version)}, ${short(newest.commit)}): las instalaciones solo avanzan.`);

  const version = wanted ?? (newest ? nextPatch(newest.version) : await declaredVersion(git, sha));
  const tag = releaseTag(version);
  const subject = cleanText(await step(`no pude leer el commit ${short(sha)}`, git(["log", "-1", "--format=%s", sha])));
  const url = cleanError(await git(["remote", "get-url", "--push", remote]).catch(() => ""));
  opts.say(`Versión: ${tag} (${newest ? `la última liberada es ${releaseTag(newest.version)}` : "la primera que se libera"})\nCommit: ${short(sha)} ${subject}\nRama: ${branch}\nRemoto: ${remote}${url ? ` (${url})` : ""}`);
  if (!(await opts.confirm(`¿Publico la versión ${tag}?`))) return { released: false, text: "No publiqué nada: hace falta tu confirmación en la terminal (o --yes)." };
  // The answer may have taken a while.
  const now = newestRelease(await releases());
  if (now?.version !== newest?.version || now?.commit !== newest?.commit) throw new Refused(`las versiones de ${remote} cambiaron mientras confirmabas. Volvé a pedirlo.`);
  await step(`${remote} no aceptó la etiqueta ${tag}`, git(["push", "--quiet", "--no-verify", "--no-follow-tags", "--no-recurse-submodules", remote, `${sha}:refs/tags/${tag}`]));
  return { released: true, text: `Versión ${tag} liberada en ${remote}: commit ${short(sha)}.` };
}

/** The version of the first release: the one in the commit's package.json when it has the form of a release. */
async function declaredVersion(git: (args: string[]) => Promise<string>, sha: string): Promise<string> {
  try {
    const { version } = JSON.parse(await git(["show", `${sha}:package.json`])) as { version?: unknown };
    return typeof version === "string" && RELEASE_TAG.test(releaseTag(version)) ? version : FIRST_VERSION;
  } catch {
    return FIRST_VERSION;
  }
}
