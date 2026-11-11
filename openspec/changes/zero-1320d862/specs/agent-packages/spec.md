# Spec Delta

## Purpose

When you ask for a demand run of a package station (for example `zero package run plus/community`), it will start within about a minute, even while the factory has jobs running or queued. It won't wait for the factory to be idle, or for scout or research to finish. The same safeguards still apply: it won't run with the andon on, with the budget used up, past the nightly spending cap (`limits.usdPerNight`), or while a secret it needs is missing. It never takes a job's slot or delays your jobs, and a station never runs twice at the same time. `zero status`, the panel's summary page and the briefing will show whether the run is still pending, is running, or already ran, and how it ended.

## ADDED Requirements

### Requirement: Demand runs do not wait for the queue
A pending on-demand run of a station SHALL be run by its own pass (`onDemandPass` in src/line/packages.ts), whether or not jobs are queued or running, and calling the station's `pass(ctx, { onDemand: true })` with the same context as today.

#### Scenario: Runs with a queued job
- **WHEN** a station with `onDemand: true` has a pending request and the store has a queued job, and `onDemandPass` runs
- **THEN** the module's `pass` is called once with `{ onDemand: true }` and the pending kv `stationOnDemandKey` is removed

#### Scenario: Runs with a running job
- **WHEN** a job is in status `running` in the store and a demand run is pending, and `onDemandPass` runs
- **THEN** the station's `pass` is called with `{ onDemand: true }`

#### Scenario: No pending request, no call
- **WHEN** `onDemandPass` runs and no station has a pending request
- **THEN** no station module is called and the stations' `:last` keys are unchanged

### Requirement: Same gates as before
The on-demand pass MUST keep the request pending, without calling the station, while the andon is on, while `budgetState` is reached, or while one of the station's declared secrets is missing. Inside the run, `ctx.runAgent` MUST keep the `limits.usdPerNight` cap.

#### Scenario: Andon
- **WHEN** the andon is on and a demand run is pending, and `onDemandPass` runs
- **THEN** `pass` is not called and the pending key remains; after the andon is turned off, the next `onDemandPass` calls it

#### Scenario: Budget
- **WHEN** the daily budget is reached and a demand run is pending, and `onDemandPass` runs
- **THEN** `pass` is not called and the pending key remains

#### Scenario: Missing secret
- **WHEN** the station declares a secret that is not stored, and `onDemandPass` runs
- **THEN** `pass` is not called and the pending key remains

#### Scenario: Night cap
- **WHEN** the scout/package spend already equals `limits.usdPerNight` and the demand run calls `ctx.runAgent`
- **THEN** the agent runner is never called and `runAgent` answers ok false with a text containing `limits.usdPerNight`

### Requirement: Idle pass no longer runs demand runs
`packagesPass` SHALL run only the stations' regular turns. It MUST skip the regular turn of a station that has a pending demand run, so that station does not also run its regular turn in that pass, and the daemon's idle passes MUST NOT skip their `INTAKE_MS` throttle because of a pending demand run.

#### Scenario: Idle pass leaves the request alone
- **WHEN** a demand run is pending and `packagesPass` runs with nothing queued
- **THEN** `pass` is not called, the pending key remains, and the station's `:last` key is not written

#### Scenario: Regular turn after the demand run
- **WHEN** `onDemandPass` ran the pending request and then `packagesPass` runs
- **THEN** the regular `pass` is called with no second argument, and the `:last` key is written

### Requirement: Own daemon pass
The daemon SHALL run `onDemandPass` as a background pass of its own (like `runSchedules`), outside `idlePasses`, at most one at a time, with at most one start per `INTAKE_MS` (no throttle in `once` runs). It MUST be enabled under the same switch as the package stations (`opts.packages ?? !opts.once`), MUST be awaited on exit and cut short on shutdown, and MUST NOT add to the running jobs or change which jobs start.

#### Scenario: Daemon picks it up
- **WHEN** `runDaemon` runs with `{ once: true, packages: true }` and a demand run is pending
- **THEN** the station's `pass` is called with `{ onDemand: true }`

#### Scenario: Not waiting for scout or research
- **WHEN** `runDaemon` runs once with `packages: true`, `scout: false` and `research: false`, a demand run is pending, and a queued job of priority `baja` must wait its turn behind a running/higher job
- **THEN** the demand run is still called

### Requirement: One turn per station at a time
A station MUST NOT run two turns at once (regular, on-demand or scheduled) in the same process. A turn that finds its station busy SHALL return without calling the module and without marking or clearing anything.

#### Scenario: Demand run while the regular pass is running
- **WHEN** a station's regular `pass` is in progress (module awaits a promise the test controls) and `onDemandPass` runs with a pending request
- **THEN** the module is not called again, the pending key remains, and once the regular pass ends a later `onDemandPass` runs it

### Requirement: Outcome is recorded
Each on-demand turn SHALL record its last run in kv `stationOnDemandLastKey(pkg, station)` as JSON with `asked` (the request time), `startedAt` (written when the call starts, at the same moment the pending key is cleared) and, when it ends, `endedAt` and `outcome`: `ok` (pass returned), `failed` (pass threw), `timeout` (over `timeoutMinutes`), `stopped` (cut by shutdown), or `not-run` (module could not be imported, had no `pass` or its `parseConfig` threw; then `startedAt` is absent and the pending key is cleared as today). Nothing is recorded while the request is held by a gate.

#### Scenario: Ended fine
- **WHEN** a pending demand run is run and `pass` resolves
- **THEN** the record has `asked` equal to the old pending value, `startedAt`, `endedAt` and `outcome: "ok"`

#### Scenario: Threw
- **WHEN** the module's `pass` throws
- **THEN** the record's `outcome` is `failed`

#### Scenario: Could not run
- **WHEN** the module has no `pass` export
- **THEN** the record's `outcome` is `not-run`, it has no `startedAt`, and the pending key is gone

#### Scenario: Held by gate
- **WHEN** the andon is on during `onDemandPass`
- **THEN** no record key is written

### Requirement: Status shows pending and finished runs
`factoryStatus` SHALL keep `onDemand` (pending runs) unchanged and SHALL add `onDemandRuns`, the recorded last run of each loaded `onDemand` station whose `startedAt` or `endedAt` is within the last 24 hours (or that is still running). `formatStatus` MUST show them in one line starting `Corridas a demanda recientes: ` with, per station, the request time and either `corriendo desde HH:MM` or the end time with `terminó bien`, `falló`, `superó su tiempo`, `se cortó al apagar la fábrica` or `no pudo correr`. A run with no `endedAt` whose `startedAt` is older than the station's `timeoutMinutes` MUST show as `sin resultado`. With none, there is no such line.

#### Scenario: Finished run in status
- **WHEN** a record with outcome `ok` ended 10 minutes ago, and `formatStatus(factoryStatus(ctx), now)` is called
- **THEN** one line starts with `Corridas a demanda recientes: ` and contains the station `hello/nota` and `terminó bien`

#### Scenario: Running
- **WHEN** a record has `startedAt` 1 minute ago and no `endedAt`
- **THEN** the line contains `corriendo desde`

#### Scenario: Old record hidden
- **WHEN** the only record ended 2 days ago
- **THEN** `onDemandRuns` is empty and no `Corridas a demanda recientes` line is shown

#### Scenario: Pending unchanged
- **WHEN** a request is pending
- **THEN** `factoryStatus(ctx).onDemand` still equals `[{ station, since }]` and the `Corridas a demanda pendientes:` line remains

### Requirement: Panel summary shows them
The panel's summary page (`overviewPage`) SHALL show each pending demand run (station and request time) and each entry of `onDemandRuns` with the same states as the CLI, every text escaped, and show nothing about demand runs when both lists are empty.

#### Scenario: Pending in panel
- **WHEN** `overviewPage(factoryStatus(ctx), ...)` is rendered with a pending request for `hello/nota`
- **THEN** the HTML contains `hello/nota` and `pendiente`

#### Scenario: Finished in panel
- **WHEN** rendered with a recent record with outcome `failed`
- **THEN** the HTML contains `hello/nota` and `falló`

#### Scenario: Nothing
- **WHEN** rendered with no pending request and no record
- **THEN** the HTML does not contain `a demanda`

### Requirement: Briefing shows them
The briefing SHALL include a `## Corridas a demanda` section listing the pending demand runs and the recorded runs that started or ended within the briefing's period, with the same state texts; `renderBriefing` takes it as a new trailing optional argument, and the section is absent when empty.

#### Scenario: Run in the briefing
- **WHEN** a record ended within the last day and `briefing(ctx, 1)` is built
- **THEN** the briefing text contains `## Corridas a demanda`, `hello/nota` and `terminó bien`

#### Scenario: Pending in the briefing
- **WHEN** a request is pending and `briefing(ctx, 1)` is built
- **THEN** the section lists `hello/nota` as pending

#### Scenario: Empty
- **WHEN** no pending request and no record in the period
- **THEN** the briefing has no `Corridas a demanda` section
