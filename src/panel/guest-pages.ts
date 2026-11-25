import type { PackageTabLink, PackageTabView } from "../app.js";
import type { GuestAnswer, GuestRunState, GuestStation } from "./guest-actions.js";
import type { GuestAccess } from "./guests.js";
import { esc, icon, LOGO, menu, packageTabBody, page, tabLinks } from "./html.js";

/**
 * What a guest sees, always under their own menu with only the tabs they were
 * given: never the menu of the person in charge nor the mark of every tab.
 */

export interface GuestMenu {
  tabs: PackageTabLink[];
  /** The address of the tab being shown. */
  active?: string;
}

const EXIT_ICON = `<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>`;

const SIGN_OUT = `<li><form method="post" action="/logout"><button title="Salir">${icon(EXIT_ICON)}<span class="lb">Salir</span></button></form></li>`;

const guestMenu = (m: GuestMenu) => menu(tabLinks(m.tabs, m.active) + SIGN_OUT, `<a class="brand" href="/" title="Inicio">${LOGO}</a>`);

const guestPage = (title: string, body: string, m: GuestMenu, nonce: string, flash?: string) => page(title, body, { nonce, flash, menu: guestMenu(m) });

/** All a guest reads of how a request went: never why the factory refused it. */
const NOTICES: Record<Exclude<GuestAnswer, "cut">, string> = {
  asked: "Pedido anotado: corre en cuanto se pueda.",
  uploaded: "Archivo recibido: se procesa en cuanto se pueda.",
  refused: "Eso no se puede pedir ahora. Probá de nuevo más tarde.",
  choose: "Elegí para cuál lo pedís.",
  file: "El archivo no se aceptó: revisá que esté, su tipo y su tamaño.",
};

/** The text of a notice by its name in the address; anything else says nothing. */
export const guestNotice = (name: string | null): string | undefined => (name !== null && Object.hasOwn(NOTICES, name) ? NOTICES[name as keyof typeof NOTICES] : undefined);

const RUN_STATE: Record<GuestRunState, string> = { waiting: "en espera", running: "en curso", ended: "terminó", failed: "falló" };

/** A station the guest may ask something of: the state of their own run and the forms granted. */
function stationForms(a: GuestAccess, s: GuestStation): string {
  const ref = esc(`${a.package}/${s.name}`);
  const choose = (id: string) =>
    a.scope && a.values && a.values.length > 1
      ? `<label for="${id}-${ref}">${esc(a.scope.title)}</label><select id="${id}-${ref}" name="alcance" required><option value="">Elegí</option>${a.values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>`
      : "";
  const text = (id: string) => `<label for="${id}-${ref}">Pedido (opcional)</label><textarea id="${id}-${ref}" name="pedido" maxlength="4000"></textarea>`;
  const state = s.state ? `<p class="${s.state === "failed" ? "bad" : "muted"}">Tu último pedido: ${RUN_STATE[s.state]}</p>` : "";
  const run = s.run ? `<form method="post" action="/packages/run"><input type="hidden" name="station" value="${ref}">${choose("a")}${text("p")}<button class="primary">Pedir ahora</button></form>` : "";
  const upload = s.upload
    ? `<form method="post" action="/packages/upload?station=${esc(encodeURIComponent(`${a.package}/${s.name}`))}" enctype="multipart/form-data">${choose("b")}<label for="f-${ref}">Archivo (${esc(s.upload.extensions.join(", "))}, hasta ${esc(String(s.upload.maxMb))} MB)</label><input id="f-${ref}" type="file" name="file" accept="${esc(s.upload.extensions.join(","))}" required>${text("u")}<button class="primary">Subir archivo</button></form>`
    : "";
  return `<h3>${esc(s.name)}</h3>${state}${run}${upload}`;
}

/** What the guest was given, package by package, with the scope values they are limited to. */
export function guestHomePage(v: { menu: GuestMenu; name: string; access: (GuestAccess & { stations: GuestStation[] })[]; notice?: string }, nonce: string): string {
  const parts = v.access
    .map((a) => {
      const tabs = v.menu.tabs.filter((t) => t.package === a.package);
      const scope = a.scope && a.values ? `<p class="muted">${esc(a.scope.title)}: ${a.values.map(esc).join(", ")}</p>` : "";
      const links = tabs.length ? `<ul class="jobs">${tabs.map((t) => `<li><a href="${esc(t.href)}">${esc(t.title)}</a></li>`).join("")}</ul>` : "";
      return `<div class="card"><h2>${esc(a.package)}</h2>${scope}${links}${a.stations.map((s) => stationForms(a, s)).join("")}</div>`;
    })
    .join("");
  return guestPage("Inicio", `<div class="card"><h1>Hola, ${esc(v.name)}</h1></div>${parts || `<div class="card muted">No hay nada para mostrar por ahora.</div>`}`, v.menu, nonce, v.notice);
}

export const guestTabPage = (view: PackageTabView, m: GuestMenu, nonce: string): string => guestPage(view.title, packageTabBody(view), m, nonce);

/** The same for what does not exist and for what is not theirs. */
export const guestNotFoundPage = (m: GuestMenu, nonce: string): string => guestPage("No existe", `<div class="card">Esa página no existe. <a href="/">Volver</a></div>`, m, nonce);

export const guestTooLargePage = (m: GuestMenu, nonce: string): string => guestPage("Archivo demasiado grande", `<div class="card bad">El archivo pasa del máximo. <a href="/">Volver</a></div>`, m, nonce);
