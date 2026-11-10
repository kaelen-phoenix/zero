# Spec Delta

## Purpose

Every job gets a priority: baja (low), media (medium, the default), alta (high) or urgente (urgent). The factory always starts the highest-priority job first and, within the same level, the oldest. A low job only starts when nothing else is queued or running, the way the night shift's and packages' jobs work today (and those keep low as their default). A high job goes ahead of everything in the queue but does not stop what is already running. An urgent job goes first of all, only you can mark one (terminal or chat), and only one urgent job runs at a time. So low jobs are not forgotten, a job that has waited a long time goes up one level per day of waiting, but never past high. You pick the priority when asking (`zero request --prioridad alta`, or in the chat with zero_request). You can change it while the job has not finished with `zero priority <id> <nivel>`. It shows in `zero status` and in the chat, and README.md and README.es.md explain it. This first part does not yet pause running jobs to make room for an urgent one, read priorities from GitHub labels, add priority to the panel, or put it in the briefing. Those are listed as next steps.

## ADDED Requirements

### Requirement: Job priority levels and defaults
Every job MUST have a priority among `baja`, `media`, `alta` and `urgente`, stored with the job. When none is given, it SHALL be `baja` for jobs the night shift opened on its own (source `night-shift` with `autonomy`) and for jobs requested by a package's station (source `package`), and `media` for every other job. Jobs stored before this change, with no priority recorded, SHALL be read with that same default.

#### Scenario: owner request defaults to media
- **WHEN** `requestWork` is called with a text and no priority and no source
- **THEN** the created job has priority `media`

#### Scenario: package job defaults to baja
- **WHEN** `requestWork` is called with source `{kind: 'package', ...}` and no priority
- **THEN** the created job has priority `baja`

#### Scenario: legacy row
- **WHEN** a jobs row exists from before the priority column (column added by migration, value NULL) and its source is an autonomous night-shift source
- **THEN** `getJob` returns it with priority `baja`, and a legacy row with no source returns `media`

### Requirement: Scheduling order by effective priority then age
The daemon SHALL consider queued jobs ordered by effective priority (urgente, then alta, then media, then baja) and, within the same effective priority, by `createdAt` ascending. The sort MUST be stable, keeping input order on ties.

#### Scenario: high goes ahead of older medium
- **WHEN** the order function (`ownerFirst`, exported from src/daemon.ts) receives a `media` job created at 10:00 and an `alta` job created at 11:00, at a `now` of 11:05
- **THEN** the `alta` job comes first

#### Scenario: same level keeps age order
- **WHEN** it receives two `media` jobs created at 10:00 and 10:30
- **THEN** the 10:00 job comes first

#### Scenario: existing ordering preserved
- **WHEN** it receives [autonomous night-shift job, owner-approved night-shift job, owner job], all with no createdAt and no priority
- **THEN** the order is [owner-approved night-shift, owner, autonomous night-shift], as before

### Requirement: Low priority waits for an idle factory
A queued job whose effective priority is `baja` SHALL start only when no job is running and no queued job has a higher effective priority, the rule autonomous night-shift and package jobs follow today.

#### Scenario: low waits for medium
- **WHEN** a daemon pass (`runDaemon` with `once`) finds a queued `baja` job on line A and a queued `media` job on line B, with concurrency 2
- **THEN** only the `media` job starts in that pass and the `baja` job stays queued

#### Scenario: low runs when alone
- **WHEN** the only queued job is `baja` and nothing is running
- **THEN** the daemon starts it

### Requirement: Aging raises waiting jobs up to alta
A queued job's effective priority SHALL be its stored priority raised one level for each full 24 hours since its `createdAt` (`PRIORITY_AGING_MS`), never above `alta`. A job stored as `urgente` SHALL stay `urgente`, and aging MUST NOT change the stored priority.

#### Scenario: low becomes medium after a day
- **WHEN** `effectivePriority` is evaluated for a `baja` job created 25 hours before `now`
- **THEN** it returns `media`

#### Scenario: capped at alta
- **WHEN** it is evaluated for a `baja` job created 10 days before `now`
- **THEN** it returns `alta`, not `urgente`

#### Scenario: aged low no longer waits for idle
- **WHEN** a `baja` job created 25 hours ago and a `media` job created 1 hour ago are queued on different lines with concurrency 2
- **THEN** the order function puts the aged job first and the daemon may start both in the same pass

### Requirement: Only one urgent job runs at a time
The daemon MUST NOT start a job whose effective priority is `urgente` while another `urgente` job is running. The waiting urgent job SHALL stay queued and SHALL NOT keep lower jobs on other lines from starting.

#### Scenario: second urgent waits
- **WHEN** an `urgente` job is running on line A and another `urgente` job is queued on line B, with free concurrency
- **THEN** the queued urgent job stays queued in that pass

### Requirement: Only the owner marks urgent
`requestWork` MUST refuse a priority of `urgente` when the request has a `source` (GitHub, Linear, night shift, research or package), and MUST refuse any priority name outside the four levels, throwing a Spanish error without creating a job.

#### Scenario: package cannot ask urgent
- **WHEN** `requestWork` is called with priority `urgente` and source `{kind: 'package', ...}`
- **THEN** it throws and no job is created

#### Scenario: unknown level
- **WHEN** `requestWork` is called with priority `altísima`
- **THEN** it throws an error naming the valid levels (baja, media, alta, urgente) and no job is created

#### Scenario: owner can ask urgent
- **WHEN** `requestWork` is called with priority `urgente` and no source
- **THEN** the job is created with priority `urgente`

### Requirement: Choosing priority when requesting
`zero request` SHALL accept `--prioridad <baja|media|alta|urgente>`, and the `zero_request` chat tool SHALL accept an optional `priority` with the same four values. Both pass it to `requestWork`, and the confirmation text SHALL name the priority when it is not `media`.

#### Scenario: chat tool passes priority
- **WHEN** `zero_request` is called with `priority: 'alta'`
- **THEN** the created job has priority `alta` and the returned text mentions `prioridad alta`

### Requirement: Changing priority of an unfinished job
`setPriority(ctx, id, level)` in src/app.ts, behind `zero priority <id> <nivel>`, SHALL store the new priority for a job that is queued, running or waiting, and MUST refuse with a Spanish error for a finished job (delivered, failed or stopped), an unknown job or an unknown level.

#### Scenario: change queued job
- **WHEN** `setPriority` is called with `alta` on a queued `media` job
- **THEN** the stored priority becomes `alta` and the job stays queued

#### Scenario: finished job refused
- **WHEN** `setPriority` is called on a delivered job
- **THEN** it throws and the stored priority is unchanged

### Requirement: Priority shown in status and chat
`formatJob` SHALL include a `Prioridad: <nivel>` line, and `formatStatus` SHALL add `· prioridad <nivel>` to each queued, running and waiting job whose effective priority is not `media`. When aging raised it, the text SHALL say `(subió por la espera)`. `zero status` and the chat's zero_status render through these functions.

#### Scenario: status marks high job
- **WHEN** `formatStatus` renders a status whose queue holds an `alta` job and a `media` job
- **THEN** the `alta` job's line contains `prioridad alta` and the `media` job's line contains no `prioridad`

#### Scenario: aged job explained
- **WHEN** it renders a queued `baja` job created 25 hours before `now`
- **THEN** the line contains `prioridad media (subió por la espera)`

#### Scenario: job detail
- **WHEN** `formatJob` renders an `urgente` job
- **THEN** the output contains `Prioridad: urgente`

### Requirement: Documented in both READMEs
README.md and README.es.md MUST document the four priority levels, aging capped at high, the one-urgent-at-a-time rule, `zero request --prioridad` and `zero priority <id> <nivel>`, with the same headings and code blocks in both, and the CLI usage text SHALL list both.

#### Scenario: docs parity
- **WHEN** `npm test` runs test/docs.test.ts and test/wording.test.ts
- **THEN** both pass, and both READMEs contain `--prioridad` and `zero priority`
