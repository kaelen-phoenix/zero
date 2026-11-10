# Spec Delta

## Purpose

Al pedir una corrida a demanda de una estación de paquete vas a poder sumarle un pedido en texto: `zero package run <paquete>/<estación> --pedido "..."`, el mismo campo en la herramienta de chat `zero_package_run` y un botón "Pedir ahora" con un campo de texto opcional en una nueva página "Paquetes" del panel. El texto llega a la estación como `request` en el segundo argumento de su `pass`. Llega limpio: sin rutas locales ni secretos de la estación, y cortado a 4000 caracteres. La estación lo recibe como un pedido tuyo. Solo vos podés pedirlo, desde la terminal, el chat o el panel con tu sesión. Las estaciones, issues y comentarios no tienen forma de hacerlo. El comando espera a que la corrida empiece y te lo avisa. Si la fábrica sigue ocupada después de un rato, te dice que el pedido sigue pendiente. `zero status` y el panel muestran la corrida pedida, la que está en curso y el resultado de la última (terminó, falló, se pasó de tiempo o se interrumpió). Sirve para cualquier paquete y queda documentado en README.md y README.es.md.

## ADDED Requirements

### Requirement: On-demand request text reaches the station
`requestStationRun` SHALL accept an optional request text. It MUST clean the text with `publicText` (the lines' repositories) after replacing the values of the station's declared secrets, trim it and cut it to 4000 characters. When an on-demand pass runs, the station's `pass` SHALL receive `{ onDemand: true, request }` with the cleaned text. With no text, or a text that is empty after cleaning, it SHALL receive exactly `{ onDemand: true }`.

#### Scenario: Text is passed cleaned
- **WHEN** the person in charge asks for a run of an onDemand station with a request containing a declared secret's value, a path inside a line repository and 5000 more characters, and the packages pass then runs
- **THEN** the module's pass receives a second argument whose `onDemand` is true and whose `request` does not contain the secret value or the repository path and is at most 4000 characters long

#### Scenario: No text keeps the old shape
- **WHEN** a run is asked for without a request text and the packages pass runs
- **THEN** JSON.stringify of pass's second argument equals JSON.stringify({ onDemand: true })

#### Scenario: Request text is cleared after the run
- **WHEN** an on-demand run with a request text has run
- **THEN** a later regular pass of the same station receives no second argument and the stored request text is gone

### Requirement: Only the person in charge can ask
An on-demand run with a request text MUST be possible only through `requestStationRun`, called from the CLI, the MCP chat tool and the panel's authenticated POST. `StationContext` and every other intake (issues, comments, Linear, Jira, packages' `requestJob`) SHALL NOT expose a way to ask for one.

#### Scenario: Station context has no way to ask
- **WHEN** a station's pass inspects the keys of the ctx it receives
- **THEN** no key of ctx requests a station run, and after the pass no on-demand request is pending for any station

#### Scenario: Panel needs a session
- **WHEN** POST /packages/run is sent without a valid session cookie
- **THEN** the response is not a redirect with success and no on-demand request is recorded

### Requirement: Each on-demand run leaves a record of its state and outcome
The daemon SHALL record each on-demand run in kv per station, with `requestedAt`, `request` when present, `startedAt`, state `running` while it runs, and on its end `finishedAt` and an outcome. The outcome MUST be `done` when pass resolved, `failed` when pass threw or the module could not run, `timeout` when it ran past `timeoutMinutes`, and `stopped` on shutdown. Error text MUST have the station's secrets replaced, go through `publicText` and be cut to 600 characters.

#### Scenario: Running state is visible during the pass
- **WHEN** an on-demand pass is still awaiting inside the module
- **THEN** the station's run record has state `running`, its requestedAt and startedAt

#### Scenario: Done outcome
- **WHEN** the on-demand pass resolves
- **THEN** the record has outcome `done` and a finishedAt

#### Scenario: Failure outcome without secrets
- **WHEN** the on-demand pass throws an Error whose message contains a declared secret's value
- **THEN** the record has outcome `failed` and its error does not contain the secret value

#### Scenario: Timeout outcome
- **WHEN** the on-demand pass never resolves and the station's timeoutMinutes elapse
- **THEN** the record has outcome `timeout`

### Requirement: CLI answers when the run started
`zero package run <paquete>/<estación> [--pedido "..."]` SHALL, after the request is accepted and the daemon is ensured, wait until the station's run record shows a run started for that request, then print that it started and exit 0. When the run has not started within the wait limit (2 minutes by default, injectable for tests), it MUST print that the run is still pending and will run when the factory is free, and exit 0. A refused request SHALL print the reason and exit 1, as it does today.

#### Scenario: Started
- **WHEN** the request is accepted and the run record gets a startedAt for that requestedAt before the wait limit
- **THEN** the shared wait function returns started and the CLI output says the run started

#### Scenario: Still pending
- **WHEN** no run starts before the wait limit
- **THEN** the wait function returns pending and the output says it is still pending

### Requirement: Chat tool takes a request text
The MCP tool `zero_package_run` SHALL accept an optional `request` string, pass it to `requestStationRun` and answer through the same wait function as the CLI, with a shorter wait limit of 30 seconds.

#### Scenario: Chat passes the request
- **WHEN** zero_package_run is called with station and request
- **THEN** the pending on-demand request stored for that station holds the cleaned request text

### Requirement: Panel packages page with Pedir ahora
The panel SHALL serve a `/packages` page, linked in the side menu, that lists each loaded package's stations with their on-demand state. Every station with `onDemand: true` MUST show a "Pedir ahora" form posting to `/packages/run` with the station and an optional `pedido` text field. The POST SHALL call `requestStationRun` and redirect to `/packages` with its message, and `returnTo` MUST map `/packages` paths to `/packages`.

#### Scenario: Button only on onDemand stations
- **WHEN** GET /packages with one onDemand station and one regular station loaded
- **THEN** the page holds exactly one form with action /packages/run, for the onDemand station, containing a field named pedido

#### Scenario: Post records the request
- **WHEN** an authenticated POST /packages/run with station and pedido is sent
- **THEN** the response is a 303 redirect to /packages and the station has a pending on-demand request with that text

#### Scenario: Errors return to the packages page
- **WHEN** an authenticated POST /packages/run names a station without onDemand
- **THEN** the response redirects to /packages with the refusal message

### Requirement: Status shows asked, running and last outcome
`factoryStatus` SHALL report each onDemand station's pending request (time and request text when present), its running run and its last outcome. `formatStatus` and the panel's `/packages` page MUST show them. The existing `onDemand` entries MUST keep the exact `{station, since}` shape when there is no request text.

#### Scenario: Pending shown with text
- **WHEN** a run is pending with request text "revisar precios"
- **THEN** formatStatus output contains the station name and "revisar precios"

#### Scenario: Running shown
- **WHEN** the station's run record has state running
- **THEN** formatStatus output contains a line naming the station as en curso

#### Scenario: Last outcome shown
- **WHEN** the last on-demand run ended with outcome failed
- **THEN** formatStatus output and the /packages page name the station with its failure
