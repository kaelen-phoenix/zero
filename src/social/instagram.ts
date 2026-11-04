import { redact, REDACTED } from "../secrets.js";
import type { Published, SocialChannel, SocialItem } from "./channel.js";

export const INSTAGRAM_TOKEN = "INSTAGRAM_ACCESS_TOKEN";

// No version in the path: the API then answers with its oldest supported one, so this never expires on its own.
const API = "https://graph.instagram.com";
const CALL_TIMEOUT_MS = 30_000;

interface InstagramOptions {
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxPolls?: number;
}

/** The Instagram API with Instagram login: a container from a public image URL, then `media_publish` once it is ready. */
export function instagramChannel(opts: InstagramOptions): SocialChannel {
  const { token } = opts;
  const send = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clean = (text: string) => redact(text.replaceAll(token, REDACTED)).slice(0, 500);

  // The token only ever travels in a header, so it is in no URL an error could quote.
  async function call(path: string, body?: Record<string, string>): Promise<Record<string, any>> {
    let response: Response;
    try {
      response = await send(`${API}/${path}`, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}`, ...(body && { "content-type": "application/json" }) },
        ...(body && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Instagram no respondió: ${clean(err instanceof Error ? err.message : String(err))}`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`Instagram respondió ${response.status}: ${clean(text)}`);
    try {
      return JSON.parse(text) as Record<string, any>;
    } catch {
      throw new Error(`Instagram respondió algo que no se entiende: ${clean(text)}`);
    }
  }

  async function waitUntilReady(container: string) {
    const polls = opts.maxPolls ?? 30;
    for (let i = 0; i < polls; i++) {
      const status = String((await call(`${container}?fields=status_code`)).status_code ?? "");
      if (status === "FINISHED") return;
      if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram no pudo procesar la imagen (estado ${status}).`);
      await sleep(opts.pollMs ?? 2_000);
    }
    throw new Error("Instagram tardó demasiado en procesar la imagen.");
  }

  return {
    name: "instagram",
    async publish(item: SocialItem): Promise<Published> {
      const me = await call("me?fields=user_id");
      const account = String(me.user_id ?? me.id ?? "");
      if (!account) throw new Error("Instagram no dijo de qué cuenta es el token.");
      // A story takes no caption: its text is on the image.
      const content: Record<string, string> = item.kind === "story" ? { image_url: item.imageUrl, media_type: "STORIES" } : { image_url: item.imageUrl, caption: item.text };
      const container = String((await call(`${account}/media`, content)).id ?? "");
      if (!container) throw new Error("Instagram no devolvió el contenedor.");
      await waitUntilReady(container);
      const id = String((await call(`${account}/media_publish`, { creation_id: container })).id ?? "");
      if (!id) throw new Error("Instagram no devolvió la publicación.");
      // It is already out: a missing link must not make it look failed.
      let url: string | undefined;
      try {
        const link = (await call(`${id}?fields=permalink`)).permalink;
        if (typeof link === "string" && link) url = link;
      } catch {
        // published, without a link
      }
      return { id, url };
    },
  };
}
