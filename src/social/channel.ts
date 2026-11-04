import type { FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import type { SocialKind } from "../state/store.js";

/** What zero hands a channel: the kind, the signed text and public image URLs, in order in a carousel. */
export type SocialItem = { kind: Exclude<SocialKind, "carousel">; text: string; imageUrl: string } | { kind: "carousel"; text: string; imageUrls: string[] };

export interface Published {
  id: string;
  /** Where to see it, when the channel gives a link. */
  url?: string;
}

/** A place zero publishes to. Adding one (LinkedIn, X, Bluesky) needs only a new adapter. */
export interface SocialChannel {
  name: string;
  publish(item: SocialItem): Promise<Published>;
}

/** Where images go so the channel can read them from a public URL. */
export interface MediaHost {
  upload(image: { name: string; data: Uint8Array; line: LineConfig }): Promise<string>;
}

export interface SocialAdapters {
  channel: SocialChannel;
  media: MediaHost;
}

/** Builds the adapters from the channel's token; only zero's own process ever sees it. */
export type SocialFactory = (token: string, ctx: FactoryContext) => SocialAdapters;
