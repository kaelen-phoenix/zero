import type { GuestInvitationResult, GuestsView } from "../app.js";
import { ageText, guestAccessText, guestEventText } from "../format.js";
import type { GuestView } from "./guests.js";
import { esc, page } from "./html.js";

/** The guests' section of the panel of the person in charge: inviting, the list, revoking and the log. */

const accessList = (g: GuestView) => `<ul>${guestAccessText(g).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;

const check = (name: string, value: string, label: string) => `<label><input type="checkbox" name="${name}" value="${esc(value)}" style="width:auto"> ${esc(label)}</label>`;

/** The form that invites, made from what the loaded packages offer. */
function inviteForm(offers: GuestsView["offers"]): string {
  if (!offers.length) return `<p class="muted">Ningún paquete instalado ofrece algo a invitados.</p>`;
  const parts = offers.map((o) => `<h3>${esc(o.package)}</h3>${o.parts.map((p) => check("solo", p.ref, p.allows)).join("")}`).join("");
  const scoped = offers.filter((o) => o.scope !== undefined);
  const scope = scoped.length
    ? `<h3>Alcance</h3><p class="muted">Para ${scoped.map((o) => `${esc(o.package)} (${esc(o.scope)})`).join(", ")}: indicá los valores a los que se limita el acceso, o marcá «Todo».</p>
<label for="g-alcance">Alcance, un valor por línea</label><textarea id="g-alcance" name="alcance"></textarea>${check("todo", "1", "Todo, sin límite")}`
    : "";
  return `<form method="post" action="/guests"><label for="g-nombre">Nombre</label><input id="g-nombre" type="text" name="nombre" maxlength="60" required autocomplete="off">${parts}${scope}<button class="primary">Invitar</button></form>`;
}

/** Who has access and to what, the form to invite and the log; never a key. */
export function guestsPage(v: GuestsView, nonce: string, flash?: string, now = new Date()): string {
  const guests = v.guests.length
    ? v.guests
        .map(
          (g) => `<div class="card"><h3>${esc(g.name)}</h3>${accessList(g)}
<p class="muted">Acceso creado ${esc(ageText(g.createdAt, now))} · ${g.lastUsedAt ? `último uso ${esc(ageText(g.lastUsedAt, now))}` : "sin uso todavía"}</p>
<form method="post" action="/guests/${esc(g.id)}/revoke"><button class="danger">Revocar</button></form></div>`,
        )
        .join("")
    : `<div class="card muted">No hay invitados al panel.</div>`;
  const log = v.log.length
    ? `<table><thead><tr><th>Hora (UTC)</th><th>Invitado</th><th>Qué pasó</th></tr></thead><tbody>${v.log
        .map((e) => `<tr><td>${esc(e.at.slice(0, 19).replace("T", " "))}</td><td>${esc(e.name)}</td><td>${esc(guestEventText(e))}</td></tr>`)
        .join("")}</tbody></table>${v.older !== undefined ? `<p><a href="/guests?antes=${v.older}">Ver anteriores</a></p>` : ""}`
    : `<p class="muted">No hay nada en el registro de invitados.</p>`;
  return page(
    "Invitados",
    `<div class="card"><h1>Invitados</h1><p class="muted">Personas con un acceso propio al panel, limitado a lo que marques. Cada una entra con su clave, distinta de la tuya.</p></div>
<h2>Con acceso</h2>${guests}
<div class="card"><h2>Invitar</h2>${inviteForm(v.offers)}</div>
<div class="card"><h2>Registro</h2>${log}</div>`,
    { nonce, flash, active: "/guests" },
  );
}

/** The answer to an invitation, the only place where its link is shown. */
export function guestInvitedPage(r: Extract<GuestInvitationResult, { ok: true }>, nonce: string): string {
  const { local, remote, remoteOn } = r.links;
  const outside = remote
    ? `<pre>${esc(remote)}</pre>`
    : `<p>${remoteOn ? "El túnel todavía no está abierto." : "Cerrado: se abre con <code>zero panel remote on</code>."} Su clave, para pegarla en la dirección de afuera cuando esté abierta:</p><pre>${esc(r.key)}</pre>`;
  // Text and not links: following one here would replace the session of the person in charge.
  return page(
    "Invitados",
    `<div class="card"><h1>Acceso creado para ${esc(r.guest.name)}</h1>${accessList(r.guest)}
<h3>Desde afuera</h3>${outside}
<h3>En esta PC</h3>${local ? `<pre>${esc(local)}</pre>` : `<p>El panel está desactivado (panel.port: 0).</p>`}
<p class="warn">El link se muestra una sola vez y lleva la clave del invitado: pasáselo solo a esa persona. Si se pierde, revocá el acceso e invitá de nuevo.</p>
${r.stable ? "" : `<p class="muted">La dirección de un túnel temporal cambia cada vez que se reinicia: en la nueva sirve la misma clave (lo que sigue a #k=). Con panel.tunnel.hostname queda fija.</p>`}
<p><a href="/guests">Volver</a></p></div>`,
    { nonce, active: "/guests" },
  );
}

/** The step before revoking a guest: their key and sessions stop working at once. */
export function confirmGuestRevokePage(g: GuestView, nonce: string): string {
  return page(
    "Confirmar",
    `<div class="card"><h1>¿Revocar el acceso de «${esc(g.name)}»?</h1><p>Su clave y sus sesiones dejan de servir en este mismo momento. Lo que ya pidió y se aceptó no se cancela, y su registro se conserva.</p>
<form method="post" action="/guests/${esc(g.id)}/revoke"><input type="hidden" name="confirm" value="1"><button class="danger">Sí, revocar</button></form>
<p><a href="/guests">Cancelar</a></p></div>`,
    { nonce, active: "/guests" },
  );
}
