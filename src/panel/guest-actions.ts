import { requestStationRun, uploadName, uploadToStation, type FactoryContext, type StationAsker, type StationRunResult } from "../app.js";
import { readStationGuest, readStationRun, stationOnDemandKey, stationText } from "../line/packages.js";
import { log } from "../log.js";
import { publicText } from "../public-text.js";
import { getGuest, guestAccess, recordGuestEvent, withoutKey, type Guest, type GuestAccess } from "./guests.js";

/**
 * What a guest may ask of a station: only those granted for that action and only
 * for their scope values, both read again when they ask. They never read why the
 * factory refused: that goes to the daemon's log.
 */

/**
 * How a guest's request went. `choose`: one of their scope values is missing; `file`: the file itself is not accepted;
 * `cut`: their access ended meanwhile.
 */
export type GuestAnswer = "asked" | "uploaded" | "refused" | "choose" | "file" | "cut";

export interface GuestAsk {
  /** `<package>/<station>`, as the form sent it. */
  station: string;
  /** The scope value chosen in the form. */
  value?: string;
  request?: string;
}

type GuestAction = "run" | "upload";

/** The guest's access to that station for that action right now. */
function granted(ctx: FactoryContext, id: string, action: GuestAction, ref: string): GuestAccess | undefined {
  const guest = getGuest(ctx.store, id);
  return guest && guestAccess(guest, ctx.config.loadedPackages).find((a) => a[action].some((name) => `${a.package}/${name}` === ref));
}

/** The scope value the request is for: one of the guest's, or none when they are not limited. */
function scopeOf(access: GuestAccess, value: string | undefined): { scope?: string } | { answer: GuestAnswer } {
  const { values } = access;
  if (!values) return value ? { answer: "refused" } : {};
  if (!value) return values.length === 1 ? { scope: values[0]! } : { answer: "choose" };
  return values.includes(value) ? { scope: value } : { answer: "refused" };
}

async function askAs(ctx: FactoryContext, id: string, action: GuestAction, ask: GuestAsk, send: (guest: StationAsker, request: string | undefined, now: Date) => Promise<StationRunResult> | StationRunResult): Promise<GuestAnswer> {
  // Read again: the request's body took its time to arrive.
  const guest = getGuest(ctx.store, id);
  if (!guest) return "cut";
  const access = granted(ctx, id, action, ask.station);
  const station = access && ctx.config.loadedPackages?.stations.find((s) => `${s.package}/${s.name}` === ask.station);
  const chosen: ReturnType<typeof scopeOf> = access ? scopeOf(access, ask.value) : { answer: "refused" };
  const text = ask.request && (station ? stationText(ask.request, ctx, station) : publicText(ask.request, ctx.config.lines.map((l) => l.repo)).text);
  const request = text && withoutKey(text, guest);
  let result: StationRunResult | undefined;
  if (!("answer" in chosen)) {
    const { scope } = chosen;
    const allowed = () => {
      const now = granted(ctx, id, action, ask.station);
      return now !== undefined && (scope === undefined ? !now.values : (now.values?.includes(scope) ?? false));
    };
    // The person in charge's request may wait for a secret; a guest could not tell what it waits for.
    if (!station || station.secrets.some((s) => !ctx.secrets.has(s))) result = { ok: false, reason: "la estación no puede correr o le faltan secretos" };
    else result = await send({ id, name: guest.name, ...(scope !== undefined && { scope }), allowed }, request, ctx.now?.() ?? new Date());
    if (!result.ok && !getGuest(ctx.store, id)) return "cut";
    if (!result.ok) log.info("guest request refused", { guest: id, station: ask.station, reason: result.reason });
  }
  recordGuestEvent(ctx.store, guest, { kind: action, target: ask.station, scope: "scope" in chosen ? chosen.scope : ask.value || undefined, text: request || undefined, accepted: result?.ok ?? false });
  if ("answer" in chosen) return chosen.answer;
  if (result?.ok) return action === "run" ? "asked" : "uploaded";
  return result?.aboutFile ? "file" : "refused";
}

/** A guest asks for a run of a station granted to them. */
export const guestRun = (ctx: FactoryContext, guest: Pick<Guest, "id">, ask: GuestAsk): Promise<GuestAnswer> =>
  askAs(ctx, guest.id, "run", ask, (asker, request, now) => requestStationRun(ctx, ask.station, now, request, asker));

/** A guest sends a file to a station granted to them; without `file` (none came, or too large) it is refused and logged. */
export const guestUpload = (ctx: FactoryContext, guest: Guest, ask: GuestAsk & { file?: { name: string; content: Uint8Array } }): Promise<GuestAnswer> =>
  askAs(ctx, guest.id, "upload", ask, (asker, request, now) =>
    ask.file
      ? uploadToStation(ctx, ask.station, { name: withoutKey(uploadName(ask.file.name), guest), content: ask.file.content, request, guest: asker }, now)
      : { ok: false, reason: "no llegó un archivo o pasa del máximo", aboutFile: true },
  );

/** All a guest reads of a run they asked for. */
export type GuestRunState = "waiting" | "running" | "ended" | "failed";

/** A station granted to a guest, as their home offers it. */
export interface GuestStation {
  name: string;
  run: boolean;
  upload?: { maxMb: number; extensions: string[] };
  /** Of their own run; a run anyone else asked for shows nothing. */
  state?: GuestRunState;
}

function ownRun(ctx: FactoryContext, guest: Pick<Guest, "id">, pkg: string, name: string): GuestRunState | undefined {
  if (ctx.store.getKv(stationOnDemandKey(pkg, name)) !== undefined && readStationGuest(ctx, pkg, name)?.id === guest.id) return "waiting";
  const run = readStationRun(ctx, pkg, name);
  if (run?.guest?.id !== guest.id) return undefined;
  return run.state === "running" ? "running" : run.outcome === "done" ? "ended" : "failed";
}

/** The stations of one package a guest may ask something of. */
export function guestStations(ctx: FactoryContext, guest: Pick<Guest, "id">, access: GuestAccess): GuestStation[] {
  return [...new Set([...access.run, ...access.upload])].map((name) => {
    const uploads = access.upload.includes(name) ? ctx.config.loadedPackages?.stations.find((s) => s.package === access.package && s.name === name)?.uploads : undefined;
    const state = ownRun(ctx, guest, access.package, name);
    return { name, run: access.run.includes(name), ...(uploads && { upload: uploads }), ...(state && { state }) };
  });
}
