# Spec Delta

## Purpose

Ahora vas a poder pedirle a una estación de paquete una corrida a demanda con un texto: `zero package run <paquete>/<estación> --pedido "..."`, o lo mismo desde el chat con `zero_package_run`. La estación recibe ese texto en su corrida como `run.request`. Antes de guardarlo, zero le quita los secretos de la estación, los tokens reconocibles y tus rutas locales, y lo corta a 4000 caracteres. La estación lo recibe marcado como un pedido tuyo. Solo vos podés pedirlo, desde la terminal o el chat: las estaciones, los paquetes y los terceros no tienen forma de escribir ese pedido. Funciona igual para cualquier paquete. El comando ya no solo deja el pedido anotado. Espera hasta 2 minutos a que la corrida empiece y te avisa cuando arrancó. Si la fábrica sigue ocupada, te dice que el pedido quedó pendiente y que lo mires en `zero status`. En `zero status` y en `zero package list` vas a ver tres cosas: la corrida pedida (pendiente, y si lleva texto), la corrida en curso y cómo terminó la última (terminó bien, falló y por qué, superó su tiempo o se interrumpió). README.md y README.es.md lo documentan. El botón "Pedir ahora" del panel queda para un segundo paso. El panel todavía no tiene una sección de paquetes donde ponerlo.

## ADDED Requirements

### Requirement: On-demand request text is cleaned and stored
`requestStationRun(ctx, ref, opts)` in src/app.ts SHALL accept an optional `request` text. When the run is accepted and `request` is given, it MUST store, in kv `stationOnDemandRequestKey(package, station)` (exported from src/line/packages.ts, distinct from every `ctx.state` key), the text with every value of the station's declared secrets replaced by REDACTED, then passed through `publicText` with the lines' repos, trimmed and cut to 4000 characters. The cleaning SHALL be shared with `ctx.requestJob` through one exported helper. A `request` that is empty after cleaning MUST be refused with a Spanish reason, and nothing is recorded (neither the pending key nor the request key). Without `request`, no request key is written. The accepted result SHALL also carry `at`, the request time in ISO 8601, equal to the stored pending value.

#### Scenario: text is cleaned and cut
- **WHEN** a loaded `onDemand: true` station `hello/nota` declares secret NOTA_TOKEN with value `s3cr3t-value`, and `requestStationRun(ctx, "hello/nota", { request: "usá s3cr3t-value " + "x".repeat(5000) })` is called
- **THEN** it returns `{ ok: true, at }`, and the kv request key holds a text of at most 4000 characters that does not contain `s3cr3t-value`

#### Scenario: blank request refused
- **WHEN** `requestStationRun(ctx, "hello/nota", { request: " " })` is called
- **THEN** it returns `{ ok: false, reason }`, and neither `stationOnDemandKey` nor `stationOnDemandRequestKey` is set

#### Scenario: no request, no key
- **WHEN** `requestStationRun(ctx, "hello/nota")` succeeds
- **THEN** `stationOnDemandRequestKey("hello", "nota")` is undefined in kv

### Requirement: Station receives the request as the person in charge's
When `packagesPass` runs a pending on-demand turn, it SHALL call the module's `pass(ctx, { onDemand: true, request })` with the stored cleaned text when a request key is present, and `pass(ctx, { onDemand: true })` with no `request` property otherwise. Right before the call it MUST delete both the pending key and the request key. When the module cannot run (import fails, no `pass`, `parseConfig` throws), it MUST delete both keys as well. The `StationHook` type and its comment in src/line/packages.ts SHALL describe `request` as text from the person in charge.

#### Scenario: request reaches pass
- **WHEN** a request with text `resumí lo de ayer` was accepted, and `packagesPass` runs
- **THEN** the module's second argument is `{ onDemand: true, request: "resumí lo de ayer" }`, and both kv keys are gone afterwards

#### Scenario: without request unchanged
- **WHEN** a request without text was accepted, and `packagesPass` runs
- **THEN** the module's second argument serializes to `{"onDemand":true}`

### Requirement: Only the person in charge can set the request
A station MUST NOT be able to create or change an on-demand request or its text through its `StationContext`. `ctx.state.set` writes only under its `:state:` keys, which SHALL never equal `stationOnDemandKey` or `stationOnDemandRequestKey`. `requestStationRun` SHALL be called only from the CLI and the MCP server, the owner's interfaces.

#### Scenario: station state cannot forge a request
- **WHEN** a station's pass calls `ctx.state.set("on-demand", "x")` and `ctx.state.set("on-demand:request", "x")`
- **THEN** after the pass, `stationOnDemandKey` and `stationOnDemandRequestKey` for that station are undefined, and the next `packagesPass` makes no on-demand call

### Requirement: On-demand run record
Each on-demand turn SHALL keep a record in kv `stationOnDemandRunKey(package, station)`: JSON `{ requestedAt, request: boolean, startedAt?, finishedAt?, outcome, error? }`. `outcome` is one of `running`, `done`, `failed`, `timeout`, `interrupted`. It MUST be written as `running`, with `startedAt`, at the moment the pending key is consumed right before calling `pass`. It is then overwritten when the turn ends: `done` when `pass` resolves, `failed` with `error` when it throws, `timeout` when it exceeds `timeoutMinutes`, `interrupted` when the outer signal aborts. When the module cannot run, it is written as `failed` with the reason and no `startedAt`. A later write of the timeout `mark` MUST NOT turn an ended record back to `running`. `error` MUST NOT contain the station's secret values and is cut to 300 characters.

#### Scenario: done
- **WHEN** an accepted request runs, and the module's pass resolves
- **THEN** the run record has outcome `done`, `startedAt`, `finishedAt` and `requestedAt` equal to the accepted `at`

#### Scenario: failed
- **WHEN** the module's pass throws `Error("boom")`
- **THEN** the run record has outcome `failed` and an `error` containing `boom`

#### Scenario: cannot run
- **WHEN** the module exports no `pass`
- **THEN** the run record has outcome `failed`, an `error`, and no `startedAt`

### Requirement: CLI takes --pedido and waits for the start
`zero package run <package>/<station>` SHALL accept `--pedido <texto>` and pass it as `request`. After an accepted request and `ensureDaemon`, it MUST wait, through `waitStationRunStart(ctx, pkgStation, at, { timeoutMs, pollMs })` in src/app.ts, until the run record for that `requestedAt` has a `startedAt` or a final outcome. It waits at most 2 minutes. Then it prints that the run started (with the time), that it could not run (with the reason), or that it is still pending and can be followed in `zero status`. It exits 0 in all three cases and 1 on refusal. The usage text SHALL show `--pedido`.

#### Scenario: wait sees the start
- **WHEN** `waitStationRunStart` is called with the accepted `at` while a `packagesPass` runs the station
- **THEN** it resolves with the run record with `startedAt` set

#### Scenario: wait times out
- **WHEN** `waitStationRunStart` is called with `timeoutMs: 50` and nothing runs
- **THEN** it resolves as still pending, without throwing

#### Scenario: usage
- **WHEN** `zero help` runs
- **THEN** the output contains `zero package run <paquete>/<estación>` and `--pedido`

### Requirement: Chat tool takes the request
The MCP tool `zero_package_run` SHALL accept an optional `request` string, pass it to `requestStationRun`, and return its text or reason without waiting for the start.

#### Scenario: chat request stored
- **WHEN** `zero_package_run` is called with `{ station: "hello/nota", request: "hola" }` for an `onDemand: true` station
- **THEN** the kv request key holds `hola`

### Requirement: Status shows requested, running and last result
`factoryStatus(ctx).onDemand` entries SHALL add `request: true` only when a request text is pending, so entries without one stay `{ station, since }`. `FactoryStatus.onDemandRuns` SHALL list `{ station, outcome, startedAt?, finishedAt?, error? }` for loaded `onDemand` stations whose run record is `running`, or ended within the last 24 hours. `formatStatus` MUST add ` con pedido` inside the pending entry's parentheses when `request` is true. It MUST add one line `Corrida a demanda en curso: <station> (desde HH:MM)` per running record. When any ended records exist, it MUST add one line starting `Últimas corridas a demanda: `, naming each one with `terminó bien`, `falló: <error>`, `superó su tiempo` or `se interrumpió`, plus the time. `packageList` station views SHALL carry `onDemandLastRun` (the record), and `formatPackages` SHALL append ` · última corrida a demanda: <state>` to that station's line.

#### Scenario: running in status
- **WHEN** a run record with outcome `running` and `startedAt` at 10:05 exists, and `formatStatus(status, now)` is called at 12:00 the same day
- **THEN** the output has a line `Corrida a demanda en curso: hello/nota (desde 10:05)`

#### Scenario: finished in status
- **WHEN** a record with outcome `failed`, error `boom` and `finishedAt` 1 hour ago exists
- **THEN** the output has a line starting `Últimas corridas a demanda: ` that contains `hello/nota` and `boom`

#### Scenario: pending with request
- **WHEN** a request with text was accepted at 10:05
- **THEN** `factoryStatus(ctx).onDemand` is `[{ station: "hello/nota", since, request: true }]`, and the pending line contains `hello/nota (desde 10:05, con pedido)`

#### Scenario: old result hidden
- **WHEN** the only record ended 2 days ago
- **THEN** `onDemandRuns` is empty, and `formatStatus` has no `Últimas corridas a demanda` line

### Requirement: Documentation
README.md and README.es.md SHALL document `--pedido`, the `request` property of `pass`'s second argument (cleaned, at most 4000 characters, from the person in charge), the `request` parameter of `zero_package_run`, the CLI's wait of up to 2 minutes, and the status lines. Both files keep the same structure and code blocks, using 'vos'/'you' wording. AGENTS.md's packages bullet SHALL mention the request and the run record.

#### Scenario: docs tests pass
- **WHEN** `npx vitest run test/docs.test.ts test/wording.test.ts` runs
- **THEN** they pass, and both READMEs contain `--pedido`
