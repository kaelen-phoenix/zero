import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { LoadedPackages, PackageTab } from "../config.js";
import { log } from "../log.js";
import { hashSecret } from "../mcp/oauth.js";
import { cleanText } from "../package-install.js";
import { newId, type GuestEvent, type Store } from "../state/store.js";
import { sessionFor } from "./key.js";

/**
 * Panel access for other people, each limited to what some packages offer to
 * guests. One kv record per guest, with only hashes of the key and the session;
 * it is read on every request, so removing it cuts the access at once.
 */

const GUEST = "panel-guest:";
export const MAX_GUEST_NAME = 60;
export const MAX_SCOPE_VALUE = 100;
/** How often a guest's last use is written. */
const USED_EVERY_MS = 60_000;
/** Longest target kept of an event, such as a denied path. */
const MAX_TARGET = 300;
const MAX_TEXT = 4000;

const GuestGrantSchema = z.object({
  package: z.string(),
  tabs: z.array(z.string()),
  run: z.array(z.string()),
  upload: z.array(z.string()),
  /** The package's scope at the invitation: its name, and the values the guest is limited to or every one. */
  scope: z.object({ name: z.string(), values: z.union([z.literal("all"), z.array(z.string()).min(1)]) }).optional(),
});
/** What an invitation gave of one package: names, never "everything it offers", so nothing is added to it later. */
export type GuestGrant = z.output<typeof GuestGrantSchema>;

const GuestSchema = z.object({
  id: z.string(),
  name: z.string(),
  grants: z.array(GuestGrantSchema),
  keyHash: z.string(),
  sessionHash: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
});
export type Guest = z.output<typeof GuestSchema>;

/** A guest's name on one line, without control or invisible characters. */
export const guestLabel = (name: string): string => cleanText(name).replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim().normalize("NFC");

/** Two names that read the same are the same guest. */
export const guestNameKey = (name: string): string => guestLabel(name).toLowerCase();

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A record that does not read gives no access. */
function parseGuest(raw: string | undefined): Guest | undefined {
  if (!raw) return undefined;
  try {
    const parsed = GuestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const getGuest = (store: Store, id: string): Guest | undefined => parseGuest(store.getKv(GUEST + id));

/** The active guests, by name. */
export function listGuests(store: Store): Guest[] {
  return store
    .kvWithPrefix(GUEST)
    .flatMap(([, raw]) => parseGuest(raw) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** A new guest with their key, which is not kept anywhere; undefined when an active guest already has that name. */
export function createGuest(store: Store, input: { name: string; grants: GuestGrant[] }, now = new Date()): { guest: Guest; key: string } | undefined {
  const key = randomBytes(32).toString("base64url");
  return store.transaction(() => {
    if (listGuests(store).some((g) => guestNameKey(g.name) === guestNameKey(input.name))) return undefined;
    // The log outlives the access, so an id in it is not drawn again for someone else.
    const used = new Set(store.guestsWithEvents().map((g) => g.id));
    let id = newId();
    while (used.has(id) || store.getKv(GUEST + id) !== undefined) id = newId();
    const guest: Guest = { id, name: input.name, grants: input.grants, keyHash: hashSecret(key), sessionHash: hashSecret(sessionFor(key)), createdAt: now.toISOString() };
    store.setKv(GUEST + id, JSON.stringify(guest));
    return { guest, key };
  });
}

/** Ends a guest's access; false when there was none. */
export function removeGuest(store: Store, id: string): boolean {
  return store.transaction(() => {
    if (store.getKv(GUEST + id) === undefined) return false;
    store.deleteKv(GUEST + id);
    return true;
  });
}

/** The active guest with that key. */
export function findGuestByKey(store: Store, key: string): Guest | undefined {
  const hash = hashSecret(key);
  return listGuests(store).find((g) => sameHash(g.keyHash, hash));
}

/** The panel cookie of a guest's session: whose it is, and a token derived from the key, never the key. */
export const guestCookie = (guest: Pick<Guest, "id">, key: string): string => `g.${guest.id}.${sessionFor(key)}`;

/** The active guest a panel cookie identifies. */
export function findGuestByCookie(store: Store, cookie: string): Guest | undefined {
  const [, id, token] = /^g\.([0-9a-f]{8})\.([0-9a-f]{64})$/.exec(cookie) ?? [];
  const guest = id ? getGuest(store, id) : undefined;
  return guest && sameHash(guest.sessionHash, hashSecret(token!)) ? guest : undefined;
}

/** Notes that the guest used their access, at most once a minute; a guest revoked meanwhile stays revoked. It never throws. */
export function touchGuest(store: Store, guest: Pick<Guest, "id" | "lastUsedAt">, now = new Date()): void {
  const recent = (at?: string) => at !== undefined && Math.abs(now.getTime() - Date.parse(at)) < USED_EVERY_MS;
  if (recent(guest.lastUsedAt)) return;
  try {
    store.transaction(() => {
      const current = getGuest(store, guest.id);
      if (current && !recent(current.lastUsedAt)) store.setKv(GUEST + guest.id, JSON.stringify({ ...current, lastUsedAt: now.toISOString() }));
    });
  } catch (err) {
    log.warn("guest's last use not recorded", { guest: guest.id, error: String(err) });
  }
}

/** What a guest may see and ask for right now of one package. */
export interface GuestAccess {
  package: string;
  tabs: PackageTab[];
  run: string[];
  upload: string[];
  scope?: { name: string; title: string };
  /** The scope values the guest is limited to; absent: no limit. */
  values?: string[];
}

/** The part of a grant its package still offers, under the same scope as at the invitation. */
function grantAccess(grant: GuestGrant, loaded: LoadedPackages | undefined): GuestAccess | undefined {
  const pkg = loaded?.packages.find((p) => p.name === grant.package);
  const offer = pkg?.guests;
  if (!pkg || !offer || offer.scope?.name !== grant.scope?.name) return undefined;
  return {
    package: pkg.name,
    tabs: pkg.tabs.filter((t) => grant.tabs.includes(t.name) && offer.tabs.includes(t.name)),
    run: grant.run.filter((n) => offer.run.includes(n)),
    upload: grant.upload.filter((n) => offer.upload.includes(n)),
    ...(offer.scope && { scope: offer.scope }),
    ...(grant.scope && grant.scope.values !== "all" && { values: grant.scope.values }),
  };
}

/** What the guest may see and ask for, with the packages as they are loaded now. */
export function guestAccess(guest: Pick<Guest, "grants">, loaded: LoadedPackages | undefined): GuestAccess[] {
  return guest.grants.flatMap((g) => grantAccess(g, loaded) ?? []).filter((a) => a.tabs.length || a.run.length || a.upload.length);
}

/** Something granted; `offered` is false once the package no longer offers it. */
export interface GuestPart {
  name: string;
  offered: boolean;
}

/** A guest as the person in charge sees it, without hashes. */
export interface GuestView {
  id: string;
  name: string;
  grants: { package: string; tabs: GuestPart[]; run: GuestPart[]; upload: GuestPart[]; scope?: { title: string; values: string[] | "all" } }[];
  createdAt: string;
  lastUsedAt?: string;
}

export function guestView(guest: Guest, loaded: LoadedPackages | undefined): GuestView {
  return {
    id: guest.id,
    name: guest.name,
    grants: guest.grants.map((g) => {
      const now = grantAccess(g, loaded);
      const parts = (names: string[], offered: string[] = []) => names.map((name) => ({ name, offered: offered.includes(name) }));
      return {
        package: g.package,
        tabs: parts(g.tabs, now?.tabs.map((t) => t.name)),
        run: parts(g.run, now?.run),
        upload: parts(g.upload, now?.upload),
        ...(g.scope && { scope: { title: now?.scope?.title ?? g.scope.name, values: g.scope.values } }),
      };
    }),
    createdAt: guest.createdAt,
    ...(guest.lastUsedAt && { lastUsedAt: guest.lastUsedAt }),
  };
}

/** The text without the guest's own key or session token, wherever they typed or pasted it. */
export function withoutKey(text: string, guest: Pick<Guest, "keyHash" | "sessionHash">): string {
  const hide = (value: string, run: RegExp, size: number, hash: string) =>
    value.replace(run, (found) => {
      for (let i = 0; i + size <= found.length; i++) {
        const part = found.slice(i, i + size);
        if (hashSecret(part) === hash) return found.replaceAll(part, "[clave]");
      }
      return found;
    });
  return hide(hide(text, /[A-Za-z0-9_-]{43,}/g, 43, guest.keyHash), /[0-9a-f]{64,}/g, 64, guest.sessionHash);
}

/** Adds to the log of what a guest did. A failure to write goes to the daemon's log: the request goes on. */
export function recordGuestEvent(store: Store, guest: Pick<Guest, "id" | "name" | "keyHash" | "sessionHash">, event: Pick<GuestEvent, "kind" | "target" | "scope" | "text" | "accepted">): void {
  try {
    const clean = (text: string | undefined, max: number) => (text === undefined ? undefined : withoutKey(cleanText(text), guest).slice(0, max));
    // A denied address is kept without its query.
    const target = event.kind === "denied" ? event.target?.replace(/[?#].*$/s, "") : event.target;
    store.addGuestEvent({
      guest: guest.id,
      name: guest.name,
      kind: event.kind,
      target: clean(target, event.kind === "invited" ? MAX_TEXT : MAX_TARGET),
      scope: clean(event.scope, MAX_SCOPE_VALUE),
      text: clean(event.text, MAX_TEXT),
      accepted: event.accepted,
    });
  } catch (err) {
    log.warn("guest event not recorded", { guest: guest.id, kind: event.kind, error: String(err) });
  }
}
