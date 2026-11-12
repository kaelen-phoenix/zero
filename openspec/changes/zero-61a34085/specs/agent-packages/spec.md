# Spec Delta

## ADDED Requirements

### Requirement: The owner's on-demand request text reaches the station (61a34085)
`requestStationRun(ctx, ref, now, request?)` in src/app.ts SHALL accept an optional `request` text from the person in charge, behind `zero package run <paquete>/<estación> --pedido "<texto>"` and the `request` parameter of the chat tool `zero_package_run`. The text MUST be cleaned through `stationText` (the station's secret values, `publicText`, at most 4000 characters) and stored in kv `stationOnDemandRequestKey`; a text empty after cleaning stores nothing, and the run keeps the old shape. The on-demand pass SHALL call `pass(ctx, { onDemand: true, request })` with the stored text and `pass(ctx, { onDemand: true })` without one, clearing the request key right before the call. A station's `ctx` MUST offer no way to ask for an on-demand run or write its text.

#### Scenario: cleaned text reaches pass
- **WHEN** an `onDemand: true` station declaring secret NOTA_TOKEN is asked for a run with a text containing that secret's value, a line's repository path and more than 4000 characters
- **THEN** the station's `pass` gets `{ onDemand: true, request }` with a `request` of at most 4000 characters that contains neither the secret nor the path

#### Scenario: no text keeps the old shape
- **WHEN** a run is asked for with a blank text
- **THEN** no request key is stored and `pass` gets exactly `{ onDemand: true }`

### Requirement: The owner sees the requested run start and end (61a34085)
After an accepted request, the CLI SHALL wait up to 2 minutes through `waitStationStart` for the run record (`stationRunKey`) with that `requestedAt` to carry a `startedAt`, then say that the run started or that it is still pending, exiting 0. `zero status` SHALL show pending runs with their text, recent runs and their outcome, and the panel's packages page SHALL offer "Pedir ahora" with an optional text field on onDemand stations.

#### Scenario: waiting sees the start
- **WHEN** `waitStationStart` is called with the accepted `requestedAt` while the packages pass runs the station
- **THEN** it answers started

#### Scenario: waiting gives up
- **WHEN** nothing runs within the limit
- **THEN** it answers that the run is still pending, without throwing
