# Spec Delta

## Purpose

El menú del panel suma dos pestañas nuevas. Las dos son solo para mirar: no se cambia nada desde ahí. Todo el texto está en español y se ve bien en el celular. "Qué es zero" explica con palabras simples qué es la fábrica: un programa que trabaja solo en tu PC y convierte tus pedidos en cambios terminados. Muestra: - Un diagrama con el recorrido de cada pedido, con una línea por paso: especificación → construcción → verificación → revisión → seguridad → integración. - Cuándo la fábrica te consulta según tu nivel de autonomía, y qué pasa si no respondés a tiempo (cuántas horas espera y si aprueba o rechaza sola). - Por dónde le llegan los pedidos: chat, terminal, panel e issues de GitHub con la etiqueta. - Los datos reales de tu configuración: nivel de autonomía configurado y efectivo (con el motivo si son distintos), motor, límites de gasto por día y por trabajo, si la caja de aislamiento está activa y cuántas líneas hay. "Agentes" muestra una tarjeta por cada agente de la fábrica: especificación, construcción, revisión y seguridad. Cada tarjeta dice qué hace y qué no puede hacer, qué motor y modelo usa, el máximo de turnos y de minutos, y si puede modificar el código o es de solo lectura. Un botón "ver instrucciones completas" despliega sus instrucciones originales, en inglés y tal cual. Abajo, la sección "Líneas" tiene una tarjeta por proyecto: repositorio, rama base, comandos de verificación, forma de entrega (merge local, rama o pull request), si se funde sola, etiqueta de issues y rutas protegidas. Nunca se muestran secretos ni claves. Aclaración: pediste también un agente "reply", pero hoy la fábrica no tiene ese agente. La pestaña muestra los agentes que existen de verdad. Si algún día se agrega uno, va a aparecer solo.

## ADDED Requirements

### Requirement: Menú con las pestañas nuevas
The panel navigation SHALL include links "Qué es zero" to `/about` and "Agentes" to `/agents`, next to the existing Resumen, Línea, Salidas and Informe links, on every page that shows the menu.

#### Scenario: Links en el menú
- **WHEN** GET / with a valid session
- **THEN** the HTML contains `<a href="/about">Qué es zero</a>` and `<a href="/agents">Agentes</a>`

### Requirement: Pestañas protegidas por sesión
GET /about and GET /agents MUST require the panel session like every other page: without a valid session they SHALL answer 401 with the sign-in page and no factory data.

#### Scenario: Sin sesión
- **WHEN** GET /about and GET /agents are requested without the session cookie
- **THEN** both answer 401, contain "Panel de tu fábrica" and do not contain the line name or the engine name

### Requirement: Solo lectura
The /about and /agents pages MUST NOT contain any `<form>`, `<textarea>`, `<input>` or `<select>`, and the panel MUST NOT accept any new POST route for them. A POST to /about or /agents SHALL change nothing and answer 404.

#### Scenario: Sin formularios
- **WHEN** GET /about and GET /agents with a session
- **THEN** neither body contains "<form", "<textarea", "<input" or "<select"

#### Scenario: POST rechazado
- **WHEN** POST /agents with a session and same origin
- **THEN** the status is 404 and the config file content is unchanged

### Requirement: Explicación simple de zero
The /about page SHALL show a plain-Spanish explanation of what zero is: a software factory that works by itself on the owner's PC and turns requests into finished changes.

#### Scenario: Texto explicativo
- **WHEN** GET /about with a session
- **THEN** the page has status 200 and contains "fábrica de software" and "pedidos"

### Requirement: Diagrama del recorrido
The /about page SHALL show the path of a request as an ordered diagram with exactly these steps in this order: especificación, construcción, verificación, revisión, seguridad, integración. Each step MUST have one line in Spanish describing what it does.

#### Scenario: Orden de los pasos
- **WHEN** GET /about with a session
- **THEN** the labels "especificación", "construcción", "verificación", "revisión", "seguridad" and "integración" appear in that order inside one ordered list, each followed by a non-empty description

### Requirement: Cuándo consulta y qué pasa sin respuesta
The /about page SHALL explain, from `decide()` in src/line/policy.ts at the effective level, in which situations the factory asks the owner. It SHALL also show the configured `approvals.timeoutHours` and what happens on timeout per `approvals.onTimeout` (approve or reject).

#### Scenario: Timeout y default
- **WHEN** the config has approvals.timeoutHours 6 and onTimeout approve, and GET /about is requested
- **THEN** the page contains "6" hours and says that the factory approves on its own when there is no answer in time

#### Scenario: Rechazo por defecto
- **WHEN** the config has approvals onTimeout reject
- **THEN** the page says that the job is rejected (stops) when there is no answer in time

#### Scenario: Consultas según nivel
- **WHEN** the config is level L1, isolation worktree
- **THEN** the page lists approving the specification as a moment when the factory asks; at L3 with a ready box it says that the factory never asks and stops instead

### Requirement: Canales de pedidos
The /about page SHALL list the four ways requests arrive: chat, terminal, panel and GitHub issues carrying the line's label. For GitHub it SHALL name each line's label when issue intake is on.

#### Scenario: Cuatro canales
- **WHEN** a line has issues.label "zero" and GET /about is requested
- **THEN** the page contains "chat", "terminal", "panel", "GitHub" and the label "zero"

### Requirement: Datos reales de la configuración
The /about page SHALL show the real configuration values: the configured level and the effective level from `currentLevel(ctx)` (with its reason when they differ), the factory engine, `limits.usdPerDay` and `limits.usdPerJob` in dollars, whether the isolation box is active (isolation container and box ready), and the number of lines.

#### Scenario: Valores mostrados
- **WHEN** the config is level L3, isolation worktree, engine claude, usdPerDay 10, usdPerJob 3, with one line
- **THEN** the page shows configured L3, effective L2 with the reason, "claude", "$10.00", "$3.00", that the box is not active, and 1 line

### Requirement: Tarjeta por agente
The /agents page SHALL show one card per agent station in `AGENT_STATIONS` (spec, build, review, security), in that order, and SHALL NOT invent stations that do not exist in the code. Each card MUST show a short Spanish summary of what the station does and what it cannot do; the engine (station engine, or the factory engine); the model (or a note that the engine's default is used); maxTurns; timeoutMinutes; and whether it may modify the code (build) or is read-only (spec, review, security), taken from the station access map.

#### Scenario: Datos de cada tarjeta
- **WHEN** the config sets stations.security to engine "codex", model "gpt-x", timeoutMinutes 20, maxTurns 30, and GET /agents is requested
- **THEN** there are 4 agent cards in order spec, build, review, security; the security card shows "codex", "gpt-x", 30 and 20; the spec card shows the factory engine and the default-model note

#### Scenario: Acceso
- **WHEN** GET /agents with a session
- **THEN** the build card says that it can modify the code, and the spec, review and security cards say "solo lectura"

### Requirement: Instrucciones completas desplegables
Each agent card SHALL include a collapsible element labelled "ver instrucciones completas" (a `<details>`/`<summary>`, no script needed) that contains the full original text of `agents/<station>.md`, HTML-escaped and otherwise unchanged.

#### Scenario: Texto original
- **WHEN** GET /agents with a session
- **THEN** each card contains `<summary>ver instrucciones completas</summary>` and the escaped content of the matching agents/<station>.md file, e.g. "# Station: build — Kaelen zero"

### Requirement: Sección Líneas
Below the agents, the /agents page SHALL show a "Líneas" section with one card per configured line. Each card MUST show: name, repository, base branch, verify commands, delivery mode in Spanish (merge local, rama or pull request), whether it auto-merges, the issue label or that issue intake is off, and the protected paths (`limits.protectedPaths`). With no lines it SHALL say that there are none.

#### Scenario: Tarjeta de línea
- **WHEN** a line "tienda" has baseBranch "main", verify ["npm test"], integrate pull-request, autoMerge true, issues.label "zero"
- **THEN** the Líneas section shows "tienda", its repo path, "main", "npm test", "pull request", that it merges on its own, the label "zero" and ".github/**"

#### Scenario: Sin líneas
- **WHEN** the config has no lines
- **THEN** the Líneas section shows a message that there are no lines yet

### Requirement: Nunca mostrar secretos
The /about and /agents pages MUST NOT include the panel key, the session value, secret values from the secret store, or the `secrets` and `command` fields of custom engines.

#### Scenario: Sin claves
- **WHEN** the config defines a custom engine with secrets ["MY_API_TOKEN"], a secret is stored, and both pages are requested
- **THEN** neither body contains the panel key, sessionFor(key), the stored secret value or "MY_API_TOKEN"

### Requirement: Celular y seguridad del panel
The new pages SHALL use the shared `page()` layout (viewport meta, existing CSP with no external resources and no inline handlers). The request-path diagram MUST stack vertically on narrow screens through a CSS `@media (max-width: …)` rule, and long values (paths, commands) MUST wrap without horizontal page overflow.

#### Scenario: Layout móvil
- **WHEN** GET /about with a session
- **THEN** the HTML contains the viewport meta, the CSS has a max-width media rule for the diagram, and no attribute matches / on[a-z]+=/

#### Scenario: CSP intacta
- **WHEN** GET /agents with a session
- **THEN** the Content-Security-Policy header equals the one on GET /
