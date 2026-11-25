import type { PackageTabLink, PackageTabView } from "../app.js";
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

const guestPage = (title: string, body: string, m: GuestMenu, nonce: string) => page(title, body, { nonce, menu: guestMenu(m) });

/** What the guest was given, package by package, with the scope values they are limited to. */
export function guestHomePage(v: { menu: GuestMenu; name: string; access: GuestAccess[] }, nonce: string): string {
  const parts = v.access
    .map((a) => {
      const tabs = v.menu.tabs.filter((t) => t.package === a.package);
      if (!tabs.length) return "";
      const scope = a.scope && a.values ? `<p class="muted">${esc(a.scope.title)}: ${a.values.map(esc).join(", ")}</p>` : "";
      return `<div class="card"><h2>${esc(a.package)}</h2>${scope}<ul class="jobs">${tabs.map((t) => `<li><a href="${esc(t.href)}">${esc(t.title)}</a></li>`).join("")}</ul></div>`;
    })
    .join("");
  return guestPage("Inicio", `<div class="card"><h1>Hola, ${esc(v.name)}</h1></div>${parts || `<div class="card muted">No hay nada para mostrar por ahora.</div>`}`, v.menu, nonce);
}

export const guestTabPage = (view: PackageTabView, m: GuestMenu, nonce: string): string => guestPage(view.title, packageTabBody(view), m, nonce);

/** The same for what does not exist and for what is not theirs. */
export const guestNotFoundPage = (m: GuestMenu, nonce: string): string => guestPage("No existe", `<div class="card">Esa página no existe. <a href="/">Volver</a></div>`, m, nonce);
