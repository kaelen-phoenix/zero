import { Octokit } from "@octokit/rest";
import type { LineConfig } from "../config.js";
import type { MediaHost } from "./channel.js";

/** The release that holds the images; a prerelease, so it never shows as the repository's latest version. */
export const MEDIA_TAG = "zero-social-media";

/** The part of GitHub the image host uses; tests inject a fake. */
export interface ReleaseApi {
  isPrivate(repository: string): Promise<boolean>;
  releaseId(repository: string, tag: string): Promise<number | undefined>;
  createPrerelease(repository: string, tag: string): Promise<number>;
  /** Uploads a JPEG; returns its public URL. */
  uploadJpeg(repository: string, release: number, name: string, data: Uint8Array): Promise<string>;
}

/** Images as assets of a public prerelease of `repositoryOf(line)`. A private repository is refused: its assets are not public, and the channel could not read them. */
export function githubMedia(api: ReleaseApi | undefined, repositoryOf: (line: LineConfig) => string | undefined): MediaHost {
  const releases = new Map<string, number>();
  return {
    async upload({ name, data, line }) {
      if (!api) throw new Error("No hay acceso a GitHub para subir la imagen: iniciá sesión con `gh auth login` (o definí GH_TOKEN).");
      const repository = repositoryOf(line);
      if (!repository) throw new Error(`No sé dónde subir la imagen: la línea ${line.name} no tiene un remoto de GitHub. Indicá un repositorio público en \`social.media.repository\`.`);
      if (await api.isPrivate(repository)) throw new Error(`El repositorio ${repository} es privado y las imágenes tienen que ser públicas: indicá uno público en \`social.media.repository\`. No subí nada.`);
      let release = releases.get(repository) ?? (await api.releaseId(repository, MEDIA_TAG));
      release ??= await api.createPrerelease(repository, MEDIA_TAG);
      releases.set(repository, release);
      return api.uploadJpeg(repository, release, name, data);
    },
  };
}

/** The real GitHub, with the same quiet Octokit as the issue intake. */
export function octokitReleases(token: string): ReleaseApi {
  const gh = new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
  const at = (repository: string) => {
    const [owner, repo] = repository.split("/");
    return { owner: owner!, repo: repo! };
  };
  return {
    isPrivate: async (repository) => (await gh.repos.get(at(repository))).data.private,
    async releaseId(repository, tag) {
      try {
        return (await gh.repos.getReleaseByTag({ ...at(repository), tag })).data.id;
      } catch (err) {
        if ((err as { status?: number }).status === 404) return undefined;
        throw err;
      }
    },
    createPrerelease: async (repository, tag) =>
      (await gh.repos.createRelease({ ...at(repository), tag_name: tag, name: "Imágenes de las publicaciones de zero", body: "Las imágenes que la fábrica publica en sus redes. No es una versión.", prerelease: true, make_latest: "false" })).data.id,
    async uploadJpeg(repository, release, name, data) {
      const response = await gh.repos.uploadReleaseAsset({
        ...at(repository),
        release_id: release,
        name,
        // Octokit sends the bytes as they are; its type only knows strings.
        data: Buffer.from(data) as unknown as string,
        headers: { "content-type": "image/jpeg", "content-length": data.length },
      });
      return response.data.browser_download_url;
    },
  };
}
