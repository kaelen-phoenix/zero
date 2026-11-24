# Tasks

## 1. Etapa 1: Declaración en el paquete y alcance de los datos

- [x] 1.1 Write the OpenSpec change for capability control-panel with these requirements.
- [x] 1.2 src/packages.ts: optional strict `guests` in ManifestSchema (`scope: {name (NAME), title}`, `tabs`, `run`, `upload`, at least one offered); refuse unknown or repeated names, `run` without onDemand and `upload` without uploads; add `guests?` to LoadedPackage in src/config.ts, set only when declared.
- [x] 1.3 src/package-tabs.ts: optional item `scope`; tabFile takes an optional list of allowed scope values. app.ts: packageTabView and packageTabFile take the same optional limit (exact match, items without scope hidden, categories only from visible items when limited); without it nothing changes.
- [x] 1.4 Tests: new test/panel-guests-manifest.test.ts; run test/packages.test.ts and test/panel-package-tabs.test.ts.

## 2. Etapa 2: Accesos, registro y comandos

- [ ] 2.1 src/state/store.ts: table for guest events (CREATE TABLE IF NOT EXISTS) with append, list by guest and pruning to the newest 500 prunable events per guest, keeping invitations, accepted runs and uploads and revocations.
- [ ] 2.2 src/panel/guests.ts: records in kv `panel-guest:<id>` (name, explicit grants per package with scope name and values or all, sha256 of key and of session token, createdAt, lastUsedAt written at most once a minute), create, list, revoke, find by key, find by cookie, resolve grants against ctx.config.loadedPackages; event writing that never throws.
- [ ] 2.3 app.ts: inviteGuest, guestList, revokeGuest, guestLog, guest links built as panelLink with the open tunnel's address; refusals with reason.
- [ ] 2.4 src/cli.ts: options `solo`, `alcance` (multiple) and `todo`; `zero panel invitar|invitados|revocar|registro`, USAGE and formatters in src/format.ts; invitar does not start the factory, it says how when it is off, and warns that a quick tunnel's address changes. No MCP tool.
- [ ] 2.5 Tests: new test/panel-guests.test.ts (refusals, hashes only, log, pruning, CLI list and revoke).

## 3. Etapa 3: Sesión de invitado y panel de solo lectura

- [ ] 3.1 src/panel/server.ts: POST /login also accepts a guest's key (same cookie name, a value that identifies the guest; owner's key compared first); read the guest record on every request with no cache; pass `authed: false` to the remote MCP for guests.
- [ ] 3.2 Separate handleGuest with an allow list (home, granted tabs, listed files, logout), 404 identical to a missing page for the rest, same-origin check on POST, its own error handling with generic texts, before every owner route and stream.
- [ ] 3.3 New src/panel/guest-pages.ts with the guest layout, reusing `page()` with its own menu and without NAV or TABS_MARK, usable on a phone; make the tab page renderer reusable.
- [ ] 3.4 Record sign-in, view, download and denial events.
- [ ] 3.5 Tests: new test/panel-guests-session.test.ts covering every owner GET and POST route, scope filtering, files, https cookie, owner rotation and immediate revocation; run the existing panel and remote-chat tests.

## 4. Etapa 4: Acciones del invitado

- [ ] 4.1 src/line/packages.ts: `stationOnDemandGuestKey`, written by askStationRun with the request, cleared with it, kept in StationRunRecord as guest id and name, and passed as `guest: {name, scope?}` in the pass call; the owner's call stays exactly as it is.
- [ ] 4.2 app.ts: requestStationRun and uploadToStation accept an optional trusted guest; scope value checked by zero.
- [ ] 4.3 Guest router: POST /packages/run and POST /packages/upload for granted stations, generic refusals, the upload limited to that station's own size, guest and grant checked again after reading the body; forms with the scope selector and the state of their own runs in the guest home; events.
- [ ] 4.4 Owner: guest's name in the packages page and in describeStationRun.
- [ ] 4.5 Tests: new test/panel-guests-actions.test.ts; run test/package-on-demand.test.ts and test/panel-packages.test.ts.

## 5. Etapa 5: Sección Invitados y documentación

- [ ] 5.1 Owner's `/guests` in NAV: form built from what loaded packages offer, list, revoke behind confirm=1, log; the invitation's answer is a 200 page with the link once; add /guests to returnTo.
- [ ] 5.2 Tests: new test/panel-guests-owner.test.ts; update the menu list in test/panel-guide.test.ts if it needs it.
- [ ] 5.3 Document in docs/agents/panel.md (guests) and docs/agents/packages.md (`guests`, item `scope`, `guest` in pass), README.md and README.es.md with the same structure and code blocks, saying that with a quick tunnel the address changes and that revoking does not cancel what was already accepted.
- [ ] 5.4 Run npm run typecheck, npm test and npx openspec validate --all.
