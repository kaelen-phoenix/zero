# Spec Delta

## Purpose

Vas a poder darle a otra persona (un cliente, alguien de tu equipo) un link propio al panel que solo le muestra lo que le corresponde. Lo creás con `zero panel invitar <nombre> --solo <paquete o paquete/pestaña>` o desde la nueva sección "Invitados" de tu panel. La lista, el registro de lo que hizo cada invitado y la revocación están en los dos lugares. El invitado entra con su clave, distinta de la tuya, también desde el celular por el túnel. Ve un panel aparte, con un menú que solo tiene sus pestañas y sus formularios. No puede ver las líneas, el estado de la fábrica, los ajustes ni los secretos, y no puede fusionar, detener, aprobar ni cambiar las salidas a internet. Lo que no esté en su lista le responde "esa página no existe". Cada paquete declara qué pestañas y acciones se pueden ofrecer a invitados y si se reparten por un alcance (por ejemplo, una marca). Quién ve y pide qué lo controla zero en el servidor: un invitado limitado a un valor solo ve los elementos y archivos marcados con ese valor, y solo puede pedir trabajo para ese valor. Revocarlo corta su acceso desde el pedido siguiente. El link se muestra una sola vez, porque zero guarda solo una huella de la clave. Si se pierde, revocás y volvés a invitar.

## ADDED Requirements

### Requirement: Packages declare what guests may be offered
A package's manifest MAY carry `guests` with `tabs` (names of its tabs), `run` (names of its stations with `onDemand: true`), `upload` (names of its stations with `uploads`) and an optional `scope: { name, title }`; zero MUST leave the whole package out, with a problem saying why, when `guests` names a tab or station that does not exist, one that does not accept that action, repeats a name, offers nothing or has an unknown key, and a package without `guests` MUST offer nothing to guests.

#### Scenario: Valid declaration
- **WHEN** a manifest declares tabs `novedades` and `interno`, an onDemand station `nota`, and `guests: { scope: { name: cuenta, title: Cuenta }, tabs: [novedades], run: [nota] }`
- **THEN** the package loads without problems and its loaded record carries that declaration

#### Scenario: Invalid declaration
- **WHEN** `guests.run` names a station without `onDemand: true`, `guests.upload` names one without `uploads`, or `guests.tabs` names a tab that does not exist
- **THEN** the package stays out and `loadedPackages.problems` names the offending tab or station

#### Scenario: No declaration
- **WHEN** the owner tries to invite someone to a package without `guests`
- **THEN** the invitation is refused saying that the package offers nothing to guests and no record is written

### Requirement: Inviting from the CLI
`zero panel invitar <nombre> --solo <paquete | paquete/nombre>... [--alcance <valor>]... [--todo]` SHALL create a guest access limited to what those packages offer to guests, with a random key of its own, and print exactly what it allows and its link (local, plus the tunnel's when it is open) with the key in the fragment.

#### Scenario: Whole package
- **WHEN** the owner runs it with `--solo hello` and the package offers one tab and one station
- **THEN** the guest's grant lists exactly that tab and that station, and the link is `<base>/#k=<key>` with a key different from the owner's

#### Scenario: Part of a package
- **WHEN** `--solo hello/novedades` is given
- **THEN** the grant has only that tab

#### Scenario: Refusals
- **WHEN** the name is empty, longer than 60 characters or already used by an active guest, `--solo` is missing, or it names an unknown package or a tab or station not offered to guests
- **THEN** it ends with code 1 and the reason, and no guest is created

### Requirement: A scoped package needs an explicit scope
When an invited package declares `guests.scope`, the invitation MUST carry either one or more `--alcance` values (trimmed, 1 to 100 characters) or `--todo`, never both nor neither, and `--alcance` or `--todo` MUST be refused when no invited package declares a scope.

#### Scenario: Neither given
- **WHEN** the owner invites to a scoped package without `--alcance` or `--todo`
- **THEN** it is refused with a text naming both options and the scope's title

#### Scenario: Both given or not applicable
- **WHEN** both options are given, or `--alcance` is given and the package declares no scope
- **THEN** it is refused with the reason

### Requirement: A grant never widens on its own
A guest's grant MUST be the explicit list of tabs and actions of the moment of the invitation, and on every request it MUST count only where the loaded manifest still offers that tab or action to guests and declares the same scope name (or none, as at the invitation).

#### Scenario: New offer
- **WHEN** the package later offers another tab to guests
- **THEN** an already invited guest still gets 404 for it

#### Scenario: Withdrawn offer
- **WHEN** the manifest stops offering the tab, or the package is removed
- **THEN** the guest gets 404 for it

#### Scenario: Scope changed
- **WHEN** the package adds, renames or removes `guests.scope` after the invitation
- **THEN** that package's tabs and actions stop being available to the guest until invited again

### Requirement: Only a hash of the key is kept
zero MUST store only SHA-256 hashes of a guest's key and session, in the factory's state, and the key MUST NOT appear in kv, the guest log, the daemon's log or any URL the server receives.

#### Scenario: State does not contain the key
- **WHEN** a guest is created and has signed in
- **THEN** no kv value and no guest event contains the key or the session cookie's token

### Requirement: Guest sign-in
`POST /login` with an active guest's key SHALL set an HttpOnly, SameSite=Strict session cookie (Secure when it came through https) that identifies that guest and replaces any previous panel session of that browser, and the owner's key and sessions MUST keep working as before.

#### Scenario: Guest signs in through the tunnel
- **WHEN** the guest's key is posted to /login with `x-forwarded-proto: https`
- **THEN** it answers 303 with a Secure, HttpOnly, SameSite=Strict cookie, and GET / with it answers 200 with the guest's home

#### Scenario: Independent keys
- **WHEN** the owner rotates the panel key
- **THEN** the guest's session keeps working, the owner's old session does not

#### Scenario: Unknown key
- **WHEN** a key that is neither the owner's nor an active guest's is posted
- **THEN** it answers 401

### Requirement: Deny by default for guests
With a guest session the server MUST serve only the guest home at `/`, the granted tabs, the files those tabs list, the granted run and upload forms and `/logout`; every other path or method MUST answer 404 with the same page as a path that does not exist, without running any action.

#### Scenario: Owner pages
- **WHEN** a guest asks for /line, /line/events, /requests, /job/<id>, /egress, /proposals, /research, /control-room, /control-room/events, /monitor, /report, /report/export, /briefing, /about, /agents, /packages, /remote-chat or /guests
- **THEN** each answers 404 and the body contains no line name, job, package list or owner menu entry

#### Scenario: Owner actions
- **WHEN** a guest posts to /request, /requests, /andon, /unjam, /research, /job/<id>/merge, /job/<id>/answer, /job/<id>/stop, /job/<id>/discard, /proposals/<id>/approve, /egress/rule, /egress/mode, /agents/catalog/add, /remote-chat/pending/<id>/confirm or /guests
- **THEN** each answers 404 and nothing changes in the store or the factory file

#### Scenario: Remote chat approval
- **WHEN** a guest session opens /oauth/authorize or posts its confirmation
- **THEN** it is treated as not signed in and no code is issued

#### Scenario: Same origin
- **WHEN** a guest's action comes with an Origin of another site
- **THEN** it answers 403 and nothing is done

### Requirement: The guest's panel shows only their part
Guest pages SHALL have their own menu with only the granted tabs and a sign-out form, and MUST NOT contain the owner's menu, other packages' tabs, the factory's state, budget, secrets or the raw text of internal refusals and errors.

#### Scenario: Menu
- **WHEN** a guest granted `hello/novedades` opens / and that tab
- **THEN** the pages link to that tab and to no owner section nor the tab `interno`

#### Scenario: Internal refusal
- **WHEN** a guest asks for a run while the andon is on, the budget is reached, a secret is missing or the station cannot run
- **THEN** the guest reads a generic text that it cannot be asked for now, without the cause

#### Scenario: Internal error
- **WHEN** handling a guest's request throws
- **THEN** the guest gets a generic page or message without the error's text, which goes to the daemon's log

### Requirement: Scope of the data
For a guest limited to scope values, zero MUST show in a granted tab only the items whose `scope` field is exactly one of those values, hide items without `scope`, derive the categories only from the visible items, and serve only files listed by visible items.

#### Scenario: Filtered items
- **WHEN** the tab's data has items with scope `norte`, `sur` and none, and the guest is limited to `norte`
- **THEN** the page shows only the `norte` item, and no category of the others appears even if the manifest declares it

#### Scenario: Another scope's file
- **WHEN** that guest asks for the download address of a file listed only by the `sur` item
- **THEN** it answers 404

#### Scenario: Everything or no scope
- **WHEN** the guest was invited with --todo, or the package declares no scope
- **THEN** every item of the granted tab is shown

#### Scenario: The owner's view
- **WHEN** the owner opens the same tab
- **THEN** every item is shown, as before

### Requirement: Scope of the actions
A guest's run or upload MUST be accepted only for a station granted for that action and, for a guest limited to values, only for one of those values (chosen in the form when there are several), and the station MUST receive it as `pass(ctx, { onDemand: true, request?, guest: { name, scope? } })` with the name and scope set by zero.

#### Scenario: Within scope
- **WHEN** a guest limited to `norte` asks for a run of the granted station with a text
- **THEN** one run is recorded and that pass receives `guest: { name, scope: 'norte' }` and the cleaned text

#### Scenario: Another value
- **WHEN** the same guest posts `alcance=sur`
- **THEN** it is refused, nothing is recorded as pending and the attempt is logged

#### Scenario: Several values
- **WHEN** a guest limited to `norte` and `sur` posts without a value
- **THEN** it is refused asking to choose one

#### Scenario: Station not granted
- **WHEN** a guest posts a run or upload for a station not granted for that action
- **THEN** it is refused with a generic text and no file is stored

#### Scenario: The owner's run
- **WHEN** the owner asks for a run of the same station
- **THEN** the pass receives exactly `{ onDemand: true }` or `{ onDemand: true, request }`, without `guest`

### Requirement: A run remembers who asked
The record of an on-demand run asked by a guest SHALL carry the guest's id and name, shown to the owner in the packages page and status, while a guest MUST see only the state (waiting, running, ended or failed) of the runs they asked for.

#### Scenario: Owner's view
- **WHEN** a guest's run is pending or recorded
- **THEN** the owner's packages page shows the guest's name, escaped

#### Scenario: Another's run
- **WHEN** the station's pending or last run was asked by the owner or another guest
- **THEN** the guest's page shows nothing of it, neither text nor error

### Requirement: Listing guests
`zero panel invitados` and the owner's `/guests` page SHALL list each active guest with name, what they may see and do, scope, when they were invited and last use, never a key.

#### Scenario: List
- **WHEN** there is an active guest that has signed in
- **THEN** both show the name, grant, scope and last use

#### Scenario: None
- **WHEN** there are no guests
- **THEN** both say so

### Requirement: Revoking cuts access at once
`zero panel revocar <nombre>` and the owner's `/guests` page (behind a `confirm=1` page) SHALL remove a guest's access, and from then on every request with their key or session MUST be treated as not signed in, including an upload still being received.

#### Scenario: Immediate
- **WHEN** a guest with an open session is revoked from another process
- **THEN** their next request answers 401 without waiting for any cache and their key no longer signs in; other guests and the owner are unaffected

#### Scenario: Upload under way
- **WHEN** the guest is revoked after the upload's body starts and before it is stored
- **THEN** no file is kept and no run is asked for

#### Scenario: Unknown name
- **WHEN** the name is not an active guest's
- **THEN** the CLI ends with code 1 and says so

#### Scenario: First press
- **WHEN** the owner presses Revocar without `confirm=1`
- **THEN** only a confirmation page is shown and the guest stays active

### Requirement: Managing guests from the owner's panel
The owner's panel SHALL have an "Invitados" section at `/guests` with a form to invite (name, offered tabs and actions, scope values or everything), the list with Revocar and the log, and after inviting it MUST show the link once in the answer to that POST, not in a redirect or address.

#### Scenario: Invite from the panel
- **WHEN** the owner submits the form with a name and an offered tab
- **THEN** the answer is 200 with the guest's link, the guest exists with that grant, and opening /guests afterwards does not show the key

#### Scenario: Refused form
- **WHEN** the form lacks a required scope or repeats a name
- **THEN** the owner returns to /guests with the reason and nothing is created

### Requirement: Log of what each guest does
zero SHALL record, with time and guest, each invitation, sign-in, tab view, download, run or upload asked (with scope, cleaned text and whether it was accepted), denied access and revocation, keep it after revocation, and show it in `zero panel registro [<nombre>]` and on `/guests`, newest first.

#### Scenario: Recorded
- **WHEN** a guest signs in, opens a tab, downloads a file, asks for a run and tries /egress
- **THEN** the log has those five events in order with the guest's name, and the last one as denied with the path only, without its query

#### Scenario: After revoking
- **WHEN** the guest is revoked
- **THEN** the log still shows their events plus the revocation

#### Scenario: Bounded
- **WHEN** a guest produces more than 500 sign-ins, views, downloads or denials
- **THEN** only the newest 500 of those are kept for that guest, and every invitation, accepted run or upload and revocation stays

#### Scenario: Log failure
- **WHEN** writing an event fails
- **THEN** the failure goes to the daemon's log and the guest's request does not fail because of it

### Requirement: Generic and out of the chat's reach
The guest access MUST be generic, with no mention of any particular package in the code, and MUST be managed only from the terminal and the owner's panel, with no MCP tool for it.

#### Scenario: Tools unchanged
- **WHEN** the chat's tools are listed
- **THEN** there is none to invite, list or revoke guests

#### Scenario: Generic code
- **WHEN** the files under src/ that implement guest access are read
- **THEN** they name no specific package
