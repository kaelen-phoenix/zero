# Spec Delta

## Purpose

Vas a poder pedirle a la fábrica que corra ya una estación de un paquete, sin esperar su horario ni su período. Se pide con `zero package run <paquete>/<estación>` o desde el chat con la herramienta `zero_package_run`. La fábrica la corre una sola vez apenas pueda: cuando no tiene otro trabajo en cola ni en marcha, con el andon apagado y con presupuesto. Usa el mismo contexto de siempre y el mismo tope de `limits.usdPerNight`, y la estación recibe `{ onDemand: true }` para saber que se la pediste vos. Solo se puede pedir si la estación declara `onDemand: true` en su manifiesto; si no, o si ya hay un pedido pendiente para esa estación, la fábrica te responde con el motivo y no anota nada. Queda documentado en README.md y README.es.md.

## ADDED Requirements

### Requirement: Manifest declares on-demand runs
A station of a package manifest MUST accept an optional boolean `onDemand` (default false), which is carried to the loaded `PackageStation` as `onDemand`; any other type for it SHALL make the package fail to load with a problem, like any invalid manifest.

#### Scenario: Declared
- **WHEN** a package's manifest has a station with `onDemand: true` and the package loads with allowCode
- **THEN** the loaded station in `config.loadedPackages.stations` has `onDemand === true`

#### Scenario: Absent
- **WHEN** a station's manifest omits `onDemand`
- **THEN** the loaded station has `onDemand === false`

#### Scenario: Wrong type
- **WHEN** a station's manifest has `onDemand: "yes"`
- **THEN** the package is left out and `loadedPackages.problems` names it

### Requirement: Asking for an on-demand run
`requestStationRun(ctx, ref)` in src/app.ts, with `ref` written as `<package>/<station>`, SHALL record exactly one pending on-demand run for that station in kv (`stationOnDemandKey(package, station)` in src/line/packages.ts, value the request time in ISO 8601), and SHALL return a text saying it was accepted.

#### Scenario: Accepted
- **WHEN** a loaded station declares `onDemand: true`, the andon is off, the budget is not reached and nothing is pending for it, and `requestStationRun(ctx, "hello/nota")` is called
- **THEN** it returns `{ ok: true }` with a text, and kv `stationOnDemandKey("hello", "nota")` holds an ISO date

### Requirement: Refusals with a reason
`requestStationRun` MUST NOT record anything, and SHALL return `{ ok: false, reason }` in Spanish, when the reference is not `<package>/<station>`, the package or station is unknown, the station is not among the loaded stations (for example a package without allowCode), the station does not declare `onDemand: true`, a run is already pending for that station, the andon is on, or the budget is reached.

#### Scenario: Not declared
- **WHEN** a loaded station without `onDemand` is requested
- **THEN** the result is `{ ok: false }` with a reason that mentions `onDemand`, and its on-demand kv key stays unset

#### Scenario: Already pending
- **WHEN** the same station is requested twice before the daemon runs it
- **THEN** the second call returns `{ ok: false }` with a reason saying a run is already pending, and the kv value is still the first request's date

#### Scenario: Unknown station
- **WHEN** `requestStationRun(ctx, "hello/nada")` or `requestStationRun(ctx, "sinbarra")` is called
- **THEN** the result is `{ ok: false }` with a reason and no kv key is written

#### Scenario: Andon on
- **WHEN** kv `andon` is `on` and an `onDemand` station is requested
- **THEN** the result is `{ ok: false }` with a reason saying the factory is stopped, and nothing is recorded

#### Scenario: Budget reached
- **WHEN** `budgetState(...).reached` is true and an `onDemand` station is requested
- **THEN** the result is `{ ok: false }` and nothing is recorded

### Requirement: The daemon runs a pending request once
`packagesPass` SHALL run a station with a pending on-demand request by calling its module's `pass(ctx, { onDemand: true })` with the same `StationContext` as a regular pass, whether or not its `everyMinutes` are over. The pending request MUST be cleared right before the call. The on-demand run MUST NOT change the station's `stationLastKey`, and in that same pass the station SHALL NOT also run its regular turn.

#### Scenario: Runs before its period
- **WHEN** a station's `stationLastKey` was set a minute ago with `everyMinutes: 1440`, a request is pending, and `packagesPass` runs with nothing queued or running
- **THEN** the module's `pass` is called exactly once with a second argument deep-equal to `{ onDemand: true }`, the on-demand key is cleared and `stationLastKey` keeps its previous value

#### Scenario: Only once
- **WHEN** `packagesPass` runs twice after a single accepted request
- **THEN** the second pass does not call `pass` again because of the request

#### Scenario: Regular pass unchanged
- **WHEN** a station without a pending request is due and `packagesPass` runs
- **THEN** its `pass` is called with no second argument (`undefined`), as before

### Requirement: On-demand runs respect the factory's gates
A pending on-demand run MUST NOT start while the andon is on, the budget is reached, jobs are queued or running, or one of the station's declared secrets is missing; it SHALL stay pending until a later pass meets those conditions. Its `ctx.runAgent` SHALL keep enforcing `limits.usdPerNight` exactly as in a regular pass.

#### Scenario: Waits for the andon
- **WHEN** a request is pending and kv `andon` is `on` when `packagesPass` runs
- **THEN** `pass` is not called and the on-demand key is still set; once the andon is off, the next pass runs it

#### Scenario: Waits for jobs
- **WHEN** a request is pending and a job is queued
- **THEN** `packagesPass` does not call `pass` and the request stays pending

#### Scenario: Night cap
- **WHEN** an on-demand run calls `ctx.runAgent` on per-use billing after `limits.usdPerNight` is already spent
- **THEN** `ctx.runAgent` returns `ok: false` with the `limits.usdPerNight` reason and no engine is called

### Requirement: Stations that cannot run clear their request
When an on-demand run is attempted and the module cannot be imported, does not export `pass`, or its `parseConfig` throws, the pending request MUST be cleared and the reason logged once, so it never stays pending forever.

#### Scenario: No pass export
- **WHEN** a station with `onDemand: true` whose module exports only `scheduled` has a pending request and `packagesPass` runs
- **THEN** no hook is called, the on-demand key is cleared and a warning is logged

### Requirement: Daemon picks pending requests up promptly
The daemon's idle run SHALL include the packages pass whenever some loaded station has a pending on-demand request, even if the `INTAKE_MS` throttle between packages passes has not elapsed.

#### Scenario: Within the throttle
- **WHEN** `runDaemon` with `once: true` and `packages: true` runs on an idle factory with a pending request for an `onDemand` station
- **THEN** the station's `pass` is called with `{ onDemand: true }`

### Requirement: CLI command
`zero package run <package>/<station>` MUST call `requestStationRun`, print its text or reason, and exit 0 when accepted (starting the daemon through `ensureDaemon` if it was off) or 1 when refused; without an argument it SHALL fail with a message showing the usage. The command SHALL appear in the CLI usage text.

#### Scenario: Refused exits 1
- **WHEN** `zero package run hello/nota` runs for a station without `onDemand`
- **THEN** the process exits 1 and prints the reason

#### Scenario: Usage listed
- **WHEN** the CLI usage text is printed
- **THEN** it contains `zero package run <paquete>/<estación>`

### Requirement: Chat tool
The MCP server MUST expose a `zero_package_run` tool taking `station` (`<package>/<station>`) that calls `requestStationRun` and returns its text or reason, starting the daemon when the request is accepted.

#### Scenario: Listed
- **WHEN** an MCP client lists the tools
- **THEN** the names include `zero_package_run`, alongside the existing ones

#### Scenario: Refusal text
- **WHEN** `zero_package_run` is called for a station without `onDemand`
- **THEN** the tool's text contains the refusal reason

### Requirement: Documented in both READMEs
README.md and README.es.md SHALL document the `onDemand` manifest key, the `{ onDemand: true }` argument to `pass`, `zero package run` and `zero_package_run`, their refusals, the single pending run per station and the gates (andon, budget, idle factory, `limits.usdPerNight`), with the same structure and code blocks in both files.

#### Scenario: Docs tests
- **WHEN** `npm test` runs test/docs.test.ts and test/wording.test.ts
- **THEN** they pass, and both READMEs mention `zero package run` and `onDemand`
