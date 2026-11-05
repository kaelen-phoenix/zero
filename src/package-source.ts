/** Where a package's repository is, and the tag or branch asked for; no `ref` means the remote's default branch. */
export interface GitSource {
  url: string;
  ref?: string;
}

const REF = /^[A-Za-z0-9._/-]+$/;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const SCP_USER = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const REPO_PATH = /^[A-Za-z0-9._~%+/-]+$/;
const GITHUB = /^github:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i;
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;

/**
 * Whether a source is meant as git, valid or not, so it is judged here and never
 * as a folder: a folder's error would repeat the text, and it may carry a token.
 * Anything with a scheme or the `user@host:` form; a drive letter (`C:\x`) or a
 * scoped npm name (`@a/b`) never match.
 */
export function isGitSource(source: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(source) || /^[^/\\\s]*@[^/\\\s]*:/.test(source);
}

function parseRef(ref: string): { ref: string } | { error: string } {
  if (!REF.test(ref) || ref.startsWith("-") || ref.startsWith("/") || ref.includes("..")) return { error: "la referencia solo admite letras, dígitos y . _ / -, sin empezar con - ni llevar .." };
  return { ref };
}

function parseUrl(url: string): { error: string } | undefined {
  const scp = /^([^@/\\]*)@([^:/\\]*):(.*)$/.exec(url);
  if (!url.includes("://") && scp) {
    if (!SCP_USER.test(scp[1]!)) return { error: "la URL lleva credenciales o un usuario que no es válido; zero usa las credenciales de git que ya tenés" };
    if (!HOST.test(scp[2]!) || !REPO_PATH.test(scp[3]!) || scp[3]!.startsWith("-")) return { error: "la URL ssh tiene que tener la forma git@servidor:ruta" };
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "no es una URL git válida" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") return { error: "solo se aceptan los protocolos https y ssh" };
  if (parsed.password || (parsed.protocol === "https:" && parsed.username)) return { error: "la URL lleva credenciales: zero usa las credenciales de git que ya tenés, sacalas de la URL" };
  if (parsed.search) return { error: "la URL no puede llevar parámetros, que podrían traer credenciales" };
  if (!HOST.test(parsed.hostname) || parsed.username.startsWith("-")) return { error: "el servidor de la URL no es válido" };
  if (parsed.pathname.length < 2 || !REPO_PATH.test(parsed.pathname)) return { error: "la ruta de la URL no es válida" };
  return undefined;
}

/**
 * A git source as the URL and reference to hand to git, or why not. Errors never
 * repeat the source, which may hold a credential.
 */
export function parseGitSource(source: string): GitSource | { error: string } {
  if (source.startsWith("-") || CONTROL_OR_SPACE.test(source)) return { error: "la fuente git no puede empezar con - ni llevar espacios" };
  const hash = source.indexOf("#");
  const base = hash < 0 ? source : source.slice(0, hash);
  const parsedRef = hash < 0 ? undefined : parseRef(source.slice(hash + 1));
  if (parsedRef && "error" in parsedRef) return parsedRef;
  const ref = parsedRef?.ref;
  if (/^github:/i.test(base)) {
    const m = GITHUB.exec(base);
    if (!m || m[2] === "." || m[2] === "..") return { error: "la forma corta es github:cuenta/repositorio, con #tag-o-rama opcional" };
    return { url: `https://github.com/${m[1]}/${m[2]}.git`, ...(ref && { ref }) };
  }
  const problem = parseUrl(base);
  return problem ?? { url: base, ...(ref && { ref }) };
}
