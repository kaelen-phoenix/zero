# Spec Delta

## Purpose

Una estación de paquete va a poder declarar en su manifiesto `whenBusy: true`. Con eso, su pasada regular corre cada `everyMinutes` aunque haya trabajos en cola o corriendo, y también mientras la autoactualización espera para cambiar de versión. Ya no queda días sin correr porque la cola nunca se vacía. La siguen frenando el andon, el presupuesto (incluido `limits.usdPerNight` para sus agentes), los secretos que falten y el hecho de que la estación ya esté corriendo. No ocupa un lugar de trabajo, no usa la caja de aislamiento ni el repositorio de una línea. Sin la opción, todo funciona igual que hoy. `zero status` y `zero package list` muestran qué estaciones tienen la opción.

## ADDED Requirements

### Requirement: Manifest option whenBusy
A station of a package manifest SHALL accept an optional boolean `whenBusy`, default false, and the loaded PackageStation MUST carry its value. A non-boolean value MUST leave the package out as a problem, like any other invalid manifest field.

#### Scenario: true is carried
- **WHEN** a package with allowCode: true declares a station with `whenBusy: true` and the factory config is loaded
- **THEN** the station in config.loadedPackages.stations has whenBusy === true

#### Scenario: absent is false
- **WHEN** the station's manifest does not mention whenBusy
- **THEN** the loaded station has whenBusy === false

#### Scenario: wrong type refused
- **WHEN** the station declares `whenBusy: "yes"`
- **THEN** the package is not loaded and loadedPackages.problems names the manifest as invalid

### Requirement: Regular pass runs with jobs queued or running
A station with `whenBusy: true` MUST have its regular `pass` run at most once per `everyMinutes` even while jobs are queued or running, through a background pass that takes no job slot and does not wait for the box or a line's repository.

#### Scenario: runs with a queued job
- **WHEN** a whenBusy station has never run, a job is queued, and the busy-time pass (e.g. `busyPass`) runs
- **THEN** the station's pass is called once and its stationLastKey is set

#### Scenario: runs with a running job
- **WHEN** a job is in status running and the busy-time pass runs for a whenBusy station whose period is over
- **THEN** the station's pass is called

#### Scenario: respects everyMinutes
- **WHEN** a whenBusy station ran less than everyMinutes ago and the busy-time pass runs again
- **THEN** the pass is not called

#### Scenario: daemon runs it while a job runs
- **WHEN** runDaemon runs with packages enabled, a whenBusy station is loaded and a job is queued or running
- **THEN** the station's pass is called without waiting for the queue to empty

### Requirement: Runs while self-update waits to switch
The daemon MUST run the regular pass of a whenBusy station while a prepared self-update is waiting to switch versions (self-update status ready), just as it does with jobs present.

#### Scenario: self-update ready
- **WHEN** self-update is enabled and its state is `ready`, a job is still running so the switch waits, and a whenBusy station's period is over
- **THEN** the daemon calls the station's pass

### Requirement: Still held back by andon, budget, secrets and a turn under way
The busy-time pass MUST NOT run a whenBusy station while the andon is on, while budgetState reports the budget reached, while one of its declared secrets is missing, or while the station already has a turn under way (busyStations). Its ctx.runAgent MUST keep the limits.usdPerNight cap. A station with a pending on-demand request MUST be left to onDemandPass.

#### Scenario: andon
- **WHEN** the andon is on and the busy-time pass runs
- **THEN** no pass is called and stationLastKey is not set

#### Scenario: budget reached
- **WHEN** budgetState(...).reached is true
- **THEN** no pass is called

#### Scenario: missing secret
- **WHEN** the station declares a secret that is not saved
- **THEN** its pass is not called and stationLastKey is not set

#### Scenario: night cap on ctx.runAgent
- **WHEN** limits.usdPerNight is already spent and a whenBusy station's pass calls ctx.runAgent while a job is queued
- **THEN** ctx.runAgent is refused the same way it is in the idle pass

#### Scenario: turn under way
- **WHEN** the station's regular turn is still running and the busy-time pass is called again
- **THEN** the pass is not called a second time

#### Scenario: pending on-demand request
- **WHEN** a whenBusy station has a pending on-demand request
- **THEN** the busy-time pass skips it and runs no regular turn of it

### Requirement: Without the option nothing changes
A station without `whenBusy: true` MUST keep today's behaviour: its regular pass runs only in the idle pass (packagesPass), never while jobs are queued or running, and the busy-time pass MUST NOT run it.

#### Scenario: plain station waits for idle
- **WHEN** a station without whenBusy is loaded, a job is queued, and both the busy-time pass and packagesPass run
- **THEN** its pass is not called

#### Scenario: one turn per period across both passes
- **WHEN** a whenBusy station runs in the busy-time pass and then packagesPass runs within its everyMinutes
- **THEN** its pass was called exactly once

### Requirement: zero package list shows the option
packageList MUST expose whether each station declares whenBusy, and `zero package list` (formatPackages) MUST show it on the station's line in Spanish.

#### Scenario: list shows it
- **WHEN** a loaded station declares whenBusy: true and formatPackages(packageList(ctx)) is rendered
- **THEN** that station's line contains `corre aunque la fábrica esté ocupada`

#### Scenario: list omits it
- **WHEN** a station without whenBusy is rendered
- **THEN** its line does not contain that text

### Requirement: zero status shows the option
factoryStatus MUST list the loaded stations with whenBusy as `<package>/<station>`, and `zero status` (formatStatus) MUST print one Spanish line naming them when there is at least one.

#### Scenario: status names them
- **WHEN** one loaded station hello/note declares whenBusy: true and formatStatus(factoryStatus(ctx)) is rendered
- **THEN** the output has a line starting `Estaciones que corren aunque la fábrica esté ocupada:` that contains `hello/note`

#### Scenario: no line without them
- **WHEN** no loaded station declares whenBusy
- **THEN** the output has no such line
