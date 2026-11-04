import { describe, expect, it } from "vitest";
import { githubMedia, MEDIA_TAG, type ReleaseApi } from "../src/social/github-media.js";
import { instagramChannel } from "../src/social/instagram.js";
import type { LineConfig } from "../src/config.js";

const TOKEN = `IGAA${"t".repeat(36)}`;
const image = { kind: "post" as const, text: "Hola", imageUrl: "https://img.example/a.jpg" };
const carousel = { kind: "carousel" as const, text: "Hola", imageUrls: ["https://img.example/1.jpg", "https://img.example/2.jpg", "https://img.example/3.jpg"] };

interface Call {
  url: string;
  method: string;
  body?: Record<string, string | boolean>;
  auth?: string;
}

/** Instagram as a table of replies: status codes of the container in order, and overrides by path. */
function fakeInstagram(opts: { statuses?: string[]; replies?: (call: Call) => Response | undefined; accountId?: string } = {}) {
  const calls: Call[] = [];
  const statuses = [...(opts.statuses ?? ["FINISHED"])];
  const send = (async (url: string, init: RequestInit) => {
    const call: Call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).authorization };
    calls.push(call);
    const own = opts.replies?.(call);
    if (own) return own;
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes("/me?")) return json({ user_id: "77" });
    if (url.endsWith("/77/media")) return json({ id: "c1" });
    if (url.includes("c1?fields=status_code")) return json({ status_code: statuses.shift() ?? "FINISHED" });
    if (url.endsWith("/77/media_publish")) return json({ id: "m1" });
    if (url.includes("m1?fields=permalink")) return json({ permalink: "https://www.instagram.com/p/abc/" });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const channel = instagramChannel({ token: TOKEN, fetch: send, sleep: async () => {}, maxPolls: 3, accountId: opts.accountId });
  return { channel, calls };
}

/** Each container created gets its own id, in order; `failing` never gets ready. */
function fakeCarousel(opts: { accountId?: string; failing?: string } = {}) {
  let containers = 0;
  return fakeInstagram({
    accountId: opts.accountId,
    replies: (c) => {
      const json = (value: unknown) => new Response(JSON.stringify(value));
      if (c.url.endsWith("/77/media")) return json({ id: `k${++containers}` });
      const status = /(k\d+)\?fields=status_code/.exec(c.url);
      if (status) return json({ status_code: status[1] === opts.failing ? "ERROR" : "FINISHED" });
      return undefined;
    },
  });
}

describe("Instagram carousels", () => {
  it("creates one container per image, one holding them, and publishes that one last", async () => {
    const { channel, calls } = fakeCarousel();
    await expect(channel.publish(carousel)).resolves.toEqual({ id: "m1", url: "https://www.instagram.com/p/abc/" });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.body)).toEqual([
      { image_url: carousel.imageUrls[0], is_carousel_item: true },
      { image_url: carousel.imageUrls[1], is_carousel_item: true },
      { image_url: carousel.imageUrls[2], is_carousel_item: true },
      { media_type: "CAROUSEL", children: "k1,k2,k3", caption: "Hola" },
      { creation_id: "k4" },
    ]);
    expect(posts.at(-1)!.url.endsWith("/media_publish")).toBe(true);
  });

  it("waits for each container to be ready, the one holding them too", async () => {
    const { channel, calls } = fakeCarousel();
    await channel.publish(carousel);
    const order = calls.map((c) => c.url);
    const ready = (id: string) => order.findIndex((u) => u.includes(`${id}?fields=status_code`));
    expect(ready("k3")).toBeGreaterThan(ready("k2"));
    expect(ready("k3")).toBeLessThan(calls.findIndex((c) => c.body?.media_type === "CAROUSEL"));
    expect(ready("k4")).toBeGreaterThan(calls.findIndex((c) => c.body?.media_type === "CAROUSEL"));
    expect(ready("k4")).toBeLessThan(order.findIndex((u) => u.endsWith("/media_publish")));
  });

  it.each(["k1", "k2", "k3", "k4"])("rejects and never publishes when container %s fails", async (failing) => {
    const { channel, calls } = fakeCarousel({ failing });
    await expect(channel.publish(carousel)).rejects.toThrow("ERROR");
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
  });

  it("goes through the Graph API with a Facebook Page token, and never asks who it is", async () => {
    const { channel, calls } = fakeCarousel({ accountId: "77" });
    await channel.publish(carousel);
    expect(calls.every((c) => c.url.startsWith("https://graph.facebook.com/"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/me?"))).toBe(false);
  });
});

describe("Instagram adapter", () => {
  it("publishes in two steps with the container's id", async () => {
    const { channel, calls } = fakeInstagram({ statuses: ["IN_PROGRESS", "FINISHED"] });
    await expect(channel.publish(image)).resolves.toEqual({ id: "m1", url: "https://www.instagram.com/p/abc/" });
    const creation = calls.find((c) => c.url.endsWith("/media"))!;
    expect(creation.url.startsWith("https://graph.instagram.com/")).toBe(true);
    expect(creation.body).toEqual({ image_url: image.imageUrl, caption: "Hola" });
    expect(calls.find((c) => c.url.endsWith("/media_publish"))!.body).toEqual({ creation_id: "c1" });
    const order = calls.map((c) => c.url);
    expect(order.findIndex((u) => u.includes("status_code"))).toBeLessThan(order.findIndex((u) => u.endsWith("media_publish")));
    expect(calls.filter((c) => c.url.includes("status_code"))).toHaveLength(2);
  });

  it("goes through the Graph API with a Facebook Page token and the linked account", async () => {
    const { channel, calls } = fakeInstagram({ accountId: "77" });
    await expect(channel.publish(image)).resolves.toEqual({ id: "m1", url: "https://www.instagram.com/p/abc/" });
    expect(calls.every((c) => c.url.startsWith("https://graph.facebook.com/v21.0/"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/me?"))).toBe(false);
  });

  it("sends a story without a caption", async () => {
    const { channel, calls } = fakeInstagram();
    await channel.publish({ ...image, kind: "story" });
    expect(calls.find((c) => c.url.endsWith("/media"))!.body).toEqual({ image_url: image.imageUrl, media_type: "STORIES" });
  });

  it.each(["ERROR", "EXPIRED"])("does not publish a container in state %s", async (status) => {
    const { channel, calls } = fakeInstagram({ statuses: [status] });
    await expect(channel.publish(image)).rejects.toThrow(status);
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
  });

  it("gives up on a container that never gets ready", async () => {
    const { channel, calls } = fakeInstagram({ statuses: ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"] });
    await expect(channel.publish(image)).rejects.toThrow("tardó");
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
  });

  it("keeps the token only in the header, and out of API errors", async () => {
    const { channel, calls } = fakeInstagram({ replies: (c) => (c.url.endsWith("/media") ? new Response(`{"error":"token ${TOKEN} inválido"}`, { status: 400 }) : undefined) });
    const error: Error = await channel.publish(image).catch((e) => e);
    expect(error.message).toContain("400");
    expect(error.message).not.toContain(TOKEN);
    for (const call of calls) {
      expect(call.url).not.toContain(TOKEN);
      expect(JSON.stringify(call.body ?? {})).not.toContain(TOKEN);
      expect(call.auth).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("keeps the token out of network errors", async () => {
    const channel = instagramChannel({ token: TOKEN, fetch: (async () => { throw new Error(`falló con ${TOKEN}`); }) as unknown as typeof fetch });
    const error: Error = await channel.publish(image).catch((e) => e);
    expect(error.message).not.toContain(TOKEN);
  });

  it("does not fail what is already out when the link cannot be read", async () => {
    const { channel } = fakeInstagram({ replies: (c) => (c.url.includes("permalink") ? new Response("{}", { status: 500 }) : undefined) });
    await expect(channel.publish(image)).resolves.toEqual({ id: "m1", url: undefined });
  });
});

function fakeReleases(over: Partial<ReleaseApi> = {}) {
  const created: string[] = [];
  const uploads: { repository: string; release: number; name: string; size: number }[] = [];
  let existing: number | undefined;
  const api: ReleaseApi = {
    isPrivate: async () => false,
    releaseId: async () => existing,
    createPrerelease: async (repository, tag) => {
      created.push(`${repository}#${tag}`);
      existing = 9;
      return 9;
    },
    uploadJpeg: async (repository, release, name, data) => {
      uploads.push({ repository, release, name, size: data.length });
      return `https://github.com/${repository}/releases/download/${MEDIA_TAG}/${name}`;
    },
    ...over,
  };
  return { api, created, uploads };
}

const line = { name: "zero" } as LineConfig;
const jpegFile = { name: "a.jpg", data: new Uint8Array([1, 2, 3]), line };

describe("GitHub image host", () => {
  it("creates its prerelease once and returns the asset's public URL", async () => {
    const { api, created, uploads } = fakeReleases();
    const host = githubMedia(api, () => "o/r");
    await expect(host.upload(jpegFile)).resolves.toBe(`https://github.com/o/r/releases/download/${MEDIA_TAG}/a.jpg`);
    await host.upload({ ...jpegFile, name: "b.jpg" });
    expect(created).toEqual([`o/r#${MEDIA_TAG}`]);
    expect(uploads.map((u) => u.name)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("uses a release that already exists", async () => {
    const { api, created, uploads } = fakeReleases({ releaseId: async () => 4 });
    await githubMedia(api, () => "o/r").upload(jpegFile);
    expect(created).toEqual([]);
    expect(uploads[0]!.release).toBe(4);
  });

  it("refuses a private repository in Spanish, without uploading", async () => {
    const { api, created, uploads } = fakeReleases({ isPrivate: async () => true });
    await expect(githubMedia(api, () => "o/r").upload(jpegFile)).rejects.toThrow("es privado");
    expect(created).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("says what is missing without a repository or access", async () => {
    await expect(githubMedia(fakeReleases().api, () => undefined).upload(jpegFile)).rejects.toThrow("social.media.repository");
    await expect(githubMedia(undefined, () => "o/r").upload(jpegFile)).rejects.toThrow("gh auth login");
  });
});
