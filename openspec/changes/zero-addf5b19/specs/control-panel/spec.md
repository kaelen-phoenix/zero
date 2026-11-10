# Spec Delta

## Purpose

El panel va a verse como un panel profesional moderno. A la izquierda va a haber un menú con un ícono para cada sección: resumen y pedidos, línea de producción, salidas, propuestas, investigación, informe, informe mensual, qué es zero y agentes. El menú se puede contraer para dejar solo los íconos, y en el celular se convierte en un menú desplegable que se abre con un botón. Va a tener los colores, el logo y las tipografías de la web de zero, y cambia solo entre modo claro y oscuro según cómo tengas configurado el equipo. La línea de producción pasa a ser un tablero: cada estación es una columna, más una columna final de salida, y cada trabajo es una tarjeta compacta en la columna donde está. Todo entra en el ancho de la pantalla sin desplazarse hacia los costados, y en el celular las columnas se apilan. Los estados usan siempre los mismos colores en todo el panel: en curso, esperándote, entregado, con error, detenido y en cola. No cambia nada de la seguridad: el panel sigue pidiendo la clave, rechaza pedidos de otros sitios, toda acción pasa por la fábrica igual que hoy, las confirmaciones siguen y no se carga nada de internet.

## ADDED Requirements

### Requirement: Menú lateral con íconos
Every page rendered by `page()` with navigation (every session page; the login page has none) MUST include a side menu `<nav class="side">` that holds the zero logo and one link for each section, in this order: `/` (Resumen), `/line` (Línea), `/egress` (Salidas), `/proposals` (Propuestas), `/research` (Investigación), `/briefing` (Informe), `/report` (Informe mensual), `/about` (Qué es zero), `/agents` (Agentes). Each link SHALL have its own inline `<svg>` icon with `aria-hidden="true"` and a visible text label, and the link of the current section SHALL carry `aria-current="page"`.

#### Scenario: Menú en cada página
- **WHEN** a session GETs `/`, `/line`, `/proposals`, `/research`, `/report`, `/about` and `/agents`
- **THEN** each HTML has one `<nav class="side">` with the nine hrefs in that order, each link containing an `<svg` and its label text

#### Scenario: Sección actual marcada
- **WHEN** a session GETs `/proposals`
- **THEN** the only element with `aria-current="page"` is the link with `href="/proposals"`

#### Scenario: Login sin menú
- **WHEN** a request without a session GETs `/`
- **THEN** the 401 login page has no `<nav class="side">`

### Requirement: Menú contraíble sin scripts
The side menu SHALL collapse to icons only and expand again through a CSS-only control: a checkbox `id="nav-toggle"` with a `<label for="nav-toggle">` that has an accessible name. The menu MUST NOT add any `<script>` element or any inline event handler attribute (`on…=`).

#### Scenario: Control de contraer
- **WHEN** a session GETs `/`
- **THEN** the HTML has `<input type="checkbox" id="nav-toggle"` and a `<label for="nav-toggle"` with an `aria-label` or visible text, and the CSS has a rule using `#nav-toggle:checked` that changes the side menu's width or hides the labels

#### Scenario: Sin scripts nuevos
- **WHEN** a session GETs `/about` and `/line`
- **THEN** `/about` has no `<script` element, every `<script>` on `/line` is the nonce'd line refresh (its body contains `fetch("/line?fragment=1"`), and no tag in either page has an `on[a-z]+=` attribute

### Requirement: Menú desplegable en el celular
On narrow screens the side menu MUST become a top bar with the logo and the toggle. The section links SHALL stay hidden until the toggle is checked, and SHALL then show as a vertical dropdown list. This is done in CSS under a `@media (max-width: Npx)` rule.

#### Scenario: Regla para pantallas angostas
- **WHEN** the panel's CSS is read from a page
- **THEN** it has an `@media (max-width: <N>px)` block whose rules hide the menu links by default and show them under `#nav-toggle:checked`

#### Scenario: Viewport para el celular
- **WHEN** a session GETs any page
- **THEN** the page has `<meta name="viewport" content="width=device-width, initial-scale=1">`

### Requirement: Marca de zero: paleta, logo y tipografías
The panel's CSS MUST use the palette of `site/styles.css` as custom properties: light `--bg:#fbfbf9`, `--fg:#111111`, `--accent:#a8360b`; dark `--bg:#0e0e0f`, `--fg:#ececea`, `--accent:#ff8a5c`. It SHALL use the site's font stacks (`--sans` starting with `system-ui`, `--mono` starting with `ui-monospace`). The logo SHALL be the site's symbol (favicon.svg: a ring with an orange dot) drawn as inline SVG, next to the word `zero` in the mono font.

#### Scenario: Paleta de la web
- **WHEN** the `<style>` of `/` is read
- **THEN** it contains `#fbfbf9`, `#111111`, `#a8360b`, `#0e0e0f`, `#ececea` and `#ff8a5c`, and declares `--sans` and `--mono` with `system-ui` and `ui-monospace`

#### Scenario: Logo en línea
- **WHEN** a session GETs `/` and the login page is rendered
- **THEN** both contain an inline `<svg` logo with a `<circle` and the color `#ff8a5c`, and no `<img` element

### Requirement: Modo claro y oscuro
The panel SHALL follow the system color scheme. It MUST declare `color-scheme: light dark` and define the dark tokens inside `@media (prefers-color-scheme: dark)`. Every color used by components SHALL come from custom properties, so both modes cover the whole panel.

#### Scenario: Tokens oscuros
- **WHEN** the panel's CSS is read
- **THEN** it contains `color-scheme` and an `@media (prefers-color-scheme: dark)` block that redefines `--bg`, `--fg`, `--accent` and the status tokens

### Requirement: Nada cargado de afuera
Panel pages MUST NOT reference external resources: no `<link rel="stylesheet">`, no `<img>`, no `@import`, no `url(http…)` and no `src=`/`href=` pointing to `http(s)://` for styles, scripts, fonts or icons. Links to delivered pull requests and other content links are excluded. The Content-Security-Policy header SHALL stay exactly as it is today.

#### Scenario: Sin recursos externos
- **WHEN** a session GETs `/`, `/line`, `/about` and `/agents` on a factory with no jobs
- **THEN** none of the pages contains `<link `, `<img`, `@import`, `url(http` or `src="http`

#### Scenario: Misma política
- **WHEN** the CSP header of `/line`, `/agents` and `/` is compared with the nonce removed
- **THEN** it is identical and still contains `default-src 'none'`, `script-src 'nonce-…'` and `frame-ancestors 'none'`

### Requirement: Colores de estado consistentes
Each job status (queued, running, waiting, delivered, failed, stopped) and each station state (pending, active, waiting, done, error) MUST map to one shared status token (`--st-queued`, `--st-active`, `--st-waiting`, `--st-ok`, `--st-bad`, `--st-stopped` or equivalent names declared once). Jobs listed in the overview (`/`) and in the production line SHALL show a status chip `<span class="chip" data-status="<job status>">` that holds the status text.

#### Scenario: Chip en el resumen
- **WHEN** a factory has one queued job and one delivered job and a session GETs `/`
- **THEN** the page has `class="chip" data-status="queued"` and `class="chip" data-status="delivered"`

#### Scenario: Chip en la línea
- **WHEN** `lineView(productionLine(ctx))` is rendered with a job waiting for an answer
- **THEN** that job's card contains `class="chip" data-status="waiting"`

#### Scenario: Un token por estado
- **WHEN** the panel's CSS is read
- **THEN** the rules for `[data-status="failed"]` and `[data-state="error"]` use the same custom property, and so do `[data-status="delivered"]` and `[data-state="done"]`

### Requirement: Línea de producción como tablero
`lineView` MUST render the jobs as a board `<div class="board" data-part="board">` with eight lanes in order: the seven stations (setup, spec, build, verify, review, security, integrate) and a final `out` lane (Salida). Each lane SHALL be `<section class="lane" data-lane="<name>" data-count="<n>">` with a header showing its icon, its Spanish label and its count. A job that has not finished SHALL appear in exactly one lane: the lane of its `at` station, or `setup` when it has none. A finished job (delivered, failed, stopped) SHALL appear only in `out`. The counters summary (`data-part="summary"`, `<b>n</b><span class="muted">label</span>`) and the empty message `La fábrica está libre` SHALL stay.

#### Scenario: Trabajo en su carril
- **WHEN** a job is running with station build and the line view is rendered
- **THEN** its `id="job-<id>"` card is inside `data-lane="build"`, appears once in the HTML, and that lane has `data-count="1"`

#### Scenario: Terminados en la salida
- **WHEN** one job is delivered and another failed
- **THEN** both cards are inside `data-lane="out"`, and no station lane contains them

#### Scenario: En espera donde preguntó
- **WHEN** a job asked `before-integrate`
- **THEN** its card is in `data-lane="integrate"` and its integrate station has `data-state="waiting"`

#### Scenario: Fábrica libre
- **WHEN** there are no jobs
- **THEN** the view still contains `La fábrica está libre` and no `data-state="active"`

### Requirement: Tarjeta compacta de trabajo
Each job card SHALL be `<article class="card job…" id="job-<id>" data-status="<status>" data-sig="<hash>">`. It holds the title linking to `/job/<id>`, the id, the line, the origin when there is one, the status chip, `intento N de M` plus the retry error when the attempt is above 1, and the delivery (link and merge state) or the failure reason when finished. It SHALL also show a compact station progress: one item per station with `data-station`, `data-state` and `<span class="tx">` (the state text), whose `<details>` keeps the time, cost, engine and error, and whose `class="why"` keeps the failure reason. All values MUST be escaped.

#### Scenario: Contenido de la tarjeta
- **WHEN** a job is on attempt 2 of 3 in build after `falló verify`
- **THEN** its card contains `intento 2 de 3`, `falló verify`, `href="/job/<id>"`, and states spec `lista`, build `activa`, verify `pendiente`

#### Scenario: Detalle de estación
- **WHEN** the spec station ran 2 s for $0.250 on claude
- **THEN** the card's `data-station="spec"` item contains `<details>`, `2.0 s`, `$0.250` and `claude`

#### Scenario: Entregado con pull request
- **WHEN** a job is delivered as a pull request
- **THEN** its card contains `entregado`, the pull request's `href` and `sin fundir todavía`

#### Scenario: Escapado
- **WHEN** a job's title is `<script>x</script>`
- **THEN** the view contains `&lt;script&gt;x&lt;/script&gt;` and not the raw tag

### Requirement: Tablero sin desplazamiento horizontal
The board MUST fit the screen's width without horizontal scrolling. On wide screens it SHALL be a CSS grid of eight `minmax(0, 1fr)` columns. Each lane SHALL scroll vertically inside its own height when it has many cards, and the board MUST NOT set `overflow-x: auto` or a fixed minimum width. On narrow screens (an `@media (max-width: Npx)` rule) the lanes SHALL stack in one column and empty lanes (`data-count="0"`) SHALL be hidden.

#### Scenario: Grilla adaptable
- **WHEN** the CSS of `/line` is read
- **THEN** a `.board` rule has `grid-template-columns: repeat(8, minmax(0, 1fr))` (whitespace-insensitive), no rule for `.board` or `.lane` has `overflow-x: auto` or `min-width` above 0, and `.lane` has `overflow-y: auto`

#### Scenario: Celular apilado
- **WHEN** the CSS of `/line` is read
- **THEN** an `@media (max-width: <N>px)` block sets the board to one column and hides `.lane[data-count="0"]`

### Requirement: Actualización en vivo del tablero
The `/line` page MUST keep refreshing without a reload through its single nonce'd script: it listens on `/line/events`, and while the stream is not open it polls `/line?fragment=1` every 5000 ms. When the fragment arrives it SHALL replace the summary, patch only the cards whose `data-sig` changed, move each card to the lane its fragment puts it in, remove cards that are gone and update every lane's count, keeping open `<details>` open. The fragment and the stream SHALL serve the same `lineView` HTML.

#### Scenario: Script único y con nonce
- **WHEN** a session GETs `/line`
- **THEN** every `<script>` has exactly the CSP nonce, contains `fetch("/line?fragment=1"`, `EventSource`, `data-lane` and `setInterval(…, 5000)`, and has no `eval(` or `new Function`

#### Scenario: El fragmento mueve la tarjeta
- **WHEN** a job goes from station build to verify between two `/line?fragment=1` requests
- **THEN** the first fragment has its card in `data-lane="build"` and the second in `data-lane="verify"`

### Requirement: Animaciones del tablero
Animations in the board SHALL be CSS only. Infinite animations MUST target only selectors for active or waiting states, and `@media (prefers-reduced-motion: reduce)` MUST set `animation: none` and `transition: none` for every element.

#### Scenario: Solo lo activo se mueve
- **WHEN** the CSS of `/line` is read
- **THEN** every rule whose declarations include `infinite` has a selector containing `active` or `waiting`, and the reduced-motion block contains `animation: none` and `transition: none`

### Requirement: Garantías del panel intactas
The redesign MUST NOT change the panel's routes, its session check (every page except login answers 401 without the cookie), its Origin and Sec-Fetch-Site checks on POST, its actions, which go only through `app.ts` operations, or its confirmation pages for approving proposals and requesting from research notes.

#### Scenario: Sesión requerida
- **WHEN** `/line`, `/line?fragment=1`, `/about` and `/proposals` are requested without a cookie
- **THEN** each answers 401 with the login page and no job data

#### Scenario: Origen ajeno rechazado
- **WHEN** POST `/request` is sent with a session but `Origin: https://evil.example`
- **THEN** the answer is 403 and no job is created

#### Scenario: Confirmación conservada
- **WHEN** POST `/proposals/<id>/approve` is sent without `confirm=1`
- **THEN** the confirmation page is shown and no job is opened
