# Spec Delta

## Purpose

When you ask for an on-demand run of a package station (`zero package run <paquete>/<estación>`), the request waits until the factory is idle. Today you can't see that it is still waiting. With this change, `zero package list` shows "corrida a demanda pendiente desde HH:MM" next to each station with a pending request. `zero status` (and the chat's status) adds one line listing the pending on-demand runs and when each was requested. Nothing changes in how or when the run happens, and the panel stays as it is.

## ADDED Requirements

### Requirement: Package list carries the pending on-demand request time
`packageList(ctx)` in src/app.ts SHALL set `onDemandPendingSince` on a station's `PackageStationView` to the value stored in kv `stationOnDemandKey(package, station)` when the loaded station declares `onDemand: true` and that key is present, and SHALL leave it absent otherwise. It SHALL only read the kv and never write or delete it.

#### Scenario: Pending request is listed
- **WHEN** a package `hello` with an `onDemand: true` station `nota` is loaded and `requestStationRun(ctx, "hello/nota", new Date(2026, 10, 7, 10, 5))` succeeded
- **THEN** `packageList(ctx).packages[0].stations[0].onDemandPendingSince` equals kv `stationOnDemandKey("hello", "nota")` (an ISO date), and the kv value is unchanged after the call

#### Scenario: No request, no field
- **WHEN** the same station has no kv `stationOnDemandKey("hello", "nota")`
- **THEN** `onDemandPendingSince` is undefined on that station's view

#### Scenario: Station without onDemand ignores a stray key
- **WHEN** the station does not declare `onDemand` and kv `stationOnDemandKey("hello", "nota")` is set by hand
- **THEN** `onDemandPendingSince` is undefined

### Requirement: zero package list shows the pending run
`formatPackages` in src/format.ts SHALL append ` · corrida a demanda pendiente desde <time>` to the line `- estación <name>: <state>` of every station with `onDemandPendingSince`, where `<time>` is `resetTime(onDemandPendingSince, now)` (HH:MM on the same day, weekday plus HH:MM otherwise), and SHALL leave the lines of other stations unchanged.

#### Scenario: Same-day request shows HH:MM
- **WHEN** `formatPackages(list, now)` is called with a station whose `onDemandPendingSince` is `new Date(2026, 10, 7, 10, 5).toISOString()` and `now` is `new Date(2026, 10, 7, 12, 0)`
- **THEN** the station's line contains `corrida a demanda pendiente desde 10:05`

#### Scenario: Stations without a request stay as before
- **WHEN** `formatPackages` is called with a station without `onDemandPendingSince`
- **THEN** its line does not contain `corrida a demanda`

### Requirement: zero status lists pending on-demand runs
`factoryStatus(ctx)` SHALL include `onDemand`, a list of `{ station: "<package>/<station>", since }` for every loaded `onDemand: true` station whose `stationOnDemandKey` is present in kv (empty when there are none), read without changing the kv. `formatStatus` SHALL then add exactly one line starting with `Corridas a demanda pendientes: ` that names each station with `(desde <resetTime(since, now)>)` when the list is not empty, and no such line when it is empty.

#### Scenario: Pending run shows in status
- **WHEN** an `onDemand: true` station `hello/nota` has a pending request made at `new Date(2026, 10, 7, 10, 5)` and `formatStatus(factoryStatus(ctx), new Date(2026, 10, 7, 12, 0))` is called
- **THEN** `factoryStatus(ctx).onDemand` equals `[{ station: "hello/nota", since: <kv value> }]` and the output has one line starting with `Corridas a demanda pendientes: ` that contains `hello/nota (desde 10:05)`

#### Scenario: Nothing pending, no line
- **WHEN** no on-demand request is pending
- **THEN** `factoryStatus(ctx).onDemand` is `[]` and the output of `formatStatus` does not contain `Corridas a demanda pendientes`

#### Scenario: Box status filter leaves it out
- **WHEN** `formatStatus` output contains the pending line
- **THEN** that line does not start with `Caja`, `Fábrica` or two spaces, so `zero box status`'s prefix filter does not show it
