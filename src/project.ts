import { Octokit } from "@octokit/rest";
import { spawnGit } from "./shell.js";

/** `nombre` or `cuenta/nombre`, with the characters GitHub allows in account and repository names. */
const REPOSITORY_NAME = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/)?[A-Za-z0-9._-]{1,100}$/;

/** Whether `name` can be created on GitHub: `nombre` or `cuenta/nombre`. */
export function validRepositoryName(name: string): boolean {
  if (!REPOSITORY_NAME.test(name)) return false;
  const repo = name.split("/").pop()!;
  return repo !== "." && repo !== "..";
}

/** What GitHub says about a repository it just created. */
export interface CreatedRepository {
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
}

/** Creates a repository on GitHub; throws with GitHub's `status` when it refuses. Tests inject a fake. */
export type RepoCreator = (input: { name: string; private: boolean }) => Promise<CreatedRepository>;

/** Clones `url` into `dir`; throws when git fails. Tests inject a fake. */
export type RepoCloner = (url: string, dir: string) => Promise<void>;

/**
 * The real creator, with the factory's GitHub token. `auto_init` gives the
 * repository a first commit, so its default branch exists for the clone and
 * the coordination adapter (which GitHub refuses on an empty repository).
 */
export const githubCreator =
  (token: string): RepoCreator =>
  async ({ name, private: isPrivate }) => {
    const octokit = new Octokit({ auth: token });
    const [owner, repo] = name.includes("/") ? name.split("/") : [undefined, name];
    const body = { name: repo!, private: isPrivate, auto_init: true };
    let data;
    if (owner) {
      const { data: me } = await octokit.users.getAuthenticated();
      data = me.login.toLowerCase() === owner.toLowerCase() ? (await octokit.repos.createForAuthenticatedUser(body)).data : (await octokit.repos.createInOrg({ org: owner, ...body })).data;
    } else {
      data = (await octokit.repos.createForAuthenticatedUser(body)).data;
    }
    return { fullName: data.full_name, cloneUrl: data.clone_url, htmlUrl: data.html_url, defaultBranch: data.default_branch || "main", private: data.private };
  };

/** The real cloner: git over https with this machine's git credentials; the token never goes in argv. */
export const gitCloner: RepoCloner = async (url, dir) => {
  const r = spawnGit(["clone", url, dir], process.cwd(), { timeout: 5 * 60_000 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "git clone falló").trim());
};

/** A clear Spanish text for GitHub refusing the creation, telling the causes apart. */
export function creationErrorText(name: string, err: unknown): string {
  const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  if (status === 401) return `No creé ${name}: GitHub dice que el token de GitHub es inválido o está vencido. Renovalo con \`zero setup\` (o \`gh auth login\`).`;
  if (status === 403 || status === 404) {
    return [
      `No creé ${name}: el token de GitHub no tiene permiso para crear repositorios.`,
      "Le falta el permiso Administration (escritura) si es un token fine-grained, o el scope `repo` si es un token clásico.",
      name.includes("/") ? `Para crearlo en ${name.split("/")[0]}, además tu cuenta tiene que ser miembro de esa organización con permiso para crear repositorios.` : "",
      `GitHub respondió: ${raw}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (status === 422) return `No creé ${name}: ya existe un repositorio con ese nombre en GitHub. Elegí otro nombre.`;
  return `No pude crear ${name} en GitHub: ${raw}`;
}
