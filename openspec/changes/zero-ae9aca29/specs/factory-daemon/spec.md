# Spec Delta

## ADDED Requirements

### Requirement: A switch result applies only to its own switch
`importSwitchResult` MUST change the state's status, `to`, `dir` and problem only when the result's `to` equals the state's `to` and the state is `switching`. Any other result SHALL only be added to the history, and the state and the current target's prepared folder SHALL stay as they are.

#### Scenario: Late result of an earlier switch
- **WHEN** the state is `switching` to commit B with `dir` `<home>/self-update/<B12>` (which exists), and result.json holds an `updated` result from A1 to A
- **THEN** the history gets the A entry, the state is still `switching` to B with the same `dir`, the B folder still exists and result.json is gone

#### Scenario: Result of the current switch
- **WHEN** the state is `switching` to B and result.json holds a `rolled-back` result for B
- **THEN** the state goes back to `idle` with B in `failed` (the current behaviour)

### Requirement: Only the result's own prepared folder is removed
After importing a result, `importSwitchResult` SHALL remove only the prepared folder of that result's target (`<home>/self-update/<to, first 12>`, or the state's `dir` when the result is for the state's target). It MUST NOT remove the prepared folder of any other commit.

#### Scenario: Late result removes its own folder
- **WHEN** the state is `switching` to B, folders for A and B exist under `<home>/self-update`, and an A result is imported
- **THEN** the A folder is removed and the B folder still exists

### Requirement: An update that went through is never left as failed
When an imported result for commit X says `updated`, X SHALL be removed from the state's `failed` list and from any pending machine retry, whether or not the result matched the current switch.

#### Scenario: Late success after a stale verdict
- **WHEN** the state is `idle` with `failed: [A]` and an `updated` result for A is imported
- **THEN** the state's `failed` no longer contains A and the history has the `updated` entry

### Requirement: Machine failures are retried later instead of failed forever
A preparation or switch failure caused by the machine MUST NOT add the commit to `failed`. That covers an error whose code or message is EPERM, EBUSY, EACCES or ENOTEMPTY, a switch result marked `machine: true`, and a stale switch that left no result. The state SHALL instead record a retry for that commit (`retry: { commit, at, tries }`), with `at` 1 hour after the failure and doubling with each consecutive machine failure of the same commit, up to 24 hours. `selfUpdateCheck` SHALL skip that commit before `at` and prepare it again once `at` has passed, even when the daily check is not due. Any other failure (for example a build that fails with no machine code) SHALL keep the current permanent marking in `failed`.

#### Scenario: Switch result marked as a machine failure
- **WHEN** the state is `switching` to B and a `failed` result for B with `machine: true` and reason `no pude poner …: falta dist en la versión preparada` is imported
- **THEN** the state is `idle`, `failed` does not contain B, `retry.commit` is B and `retry.at` is 1 hour after the import time

#### Scenario: Preparation fails on a locked file
- **WHEN** `selfUpdateCheck` prepares tip B and the fake npm throws an error whose message contains `EPERM`
- **THEN** `failed` does not contain B, `retry.commit` is B, and the history entry is `failed`

#### Scenario: No retry before its time, retry after it
- **WHEN** the state has `retry: { commit: B, at: T, tries: 1 }` with `checkedAt` 10 minutes ago, the remote tip is B, and `selfUpdateCheck` runs once before T and once after T
- **THEN** the run before T calls no npm, and the run after T runs `npm ci` and the build for B in a fresh folder

#### Scenario: Growing wait
- **WHEN** commit B fails for the machine a second time in a row
- **THEN** `retry.tries` is 2 and `retry.at` is 2 hours after the second failure

#### Scenario: A real build failure is still permanent
- **WHEN** `npm run build` fails with a message with no machine code
- **THEN** B is added to `failed` and no `retry` is recorded (the existing test keeps passing)

### Requirement: A switch still running is never taken for dead or doubled
The switch process SHALL hold an operating-system lock of its own (`<home>/self-update/switch.lock`, built with Node built-ins only, released when the process dies) from its start until its result.json is written. While that lock is held, `importSwitchResult` MUST NOT declare the switch stale, `selfUpdateCheck` MUST NOT prepare, and the daemon MUST NOT launch another switch. A switch that cannot take the lock SHALL end without touching the install folder.

#### Scenario: Not stale while the lock is held
- **WHEN** the state has been `switching` for longer than `SWITCH_STALE_MS`, there is no result.json, and the switch lock is held by a test
- **THEN** `importSwitchResult` leaves the state `switching` and records no history entry

#### Scenario: Stale once the lock is free
- **WHEN** the same situation but the lock is not held
- **THEN** the state goes `idle` with a `failed` history entry (`el cambio de versión no dejó resultado`) and a `retry` for the target, not an entry in `failed`

#### Scenario: No second switch
- **WHEN** the state is `ready`, no job runs, and the switch lock is held
- **THEN** a `once` daemon run with an injected `launchSwitch` does not call it and the state stays `ready`

#### Scenario: No preparation while a switch runs
- **WHEN** the state is `idle`, a new tip is on the remote, and the switch lock is held
- **THEN** `selfUpdateCheck` runs no npm and creates no prepared folder

### Requirement: The switch marks machine failures in its result
`runSwitch` SHALL set `machine: true` on a `failed` result caused by any of these: a missing part in the prepared folder, a staged copy that came out incomplete, a rename or removal refused with EPERM, EBUSY, EACCES or ENOTEMPTY (the code kept through `renameRetrying`'s error), the factory not stopping in time, or not getting the switch lock. A failure of the `--version` check, of `merge --ff-only` or of the new daemon taking the lock MUST NOT be marked `machine`.

#### Scenario: Prepared folder without dist
- **WHEN** `runSwitch` runs with a prepared folder holding only `node_modules`
- **THEN** the result is `failed`, its reason contains `falta dist` and `machine` is true

#### Scenario: Locked install part
- **WHEN** renaming the install's `node_modules` keeps failing with EPERM
- **THEN** the result is `failed` with `machine: true`

#### Scenario: New version does not run
- **WHEN** the injected `check` rejects
- **THEN** the result is `failed` without `machine`

### Requirement: The switch writes its result before slow cleanup
`runSwitch` SHALL write result.json before removing anything under `<install>/.zero-switch`, and SHALL release the switch lock right after. It MUST NOT remove the leftovers of an earlier switch before staging (it picks fresh names instead). Its final cleanup SHALL remove only named folders under `.zero-switch` (its own run's, and the leftovers it listed while holding the lock), never the `.zero-switch` root as a whole, and a failed removal is only logged.

#### Scenario: Result first
- **WHEN** `runSwitch` runs to an `updated` outcome with a fake fs that records the order of calls
- **THEN** the `writeFile` of result.json comes before any `remove` of a path under `.zero-switch`

#### Scenario: Leftovers are not removed before staging
- **WHEN** `<install>/.zero-switch/old/node_modules/x` exists before the switch starts
- **THEN** no `remove` call targets `.zero-switch` or `.zero-switch/old` before the parts are swapped, and the new build is staged under a suffixed name (`new-1`)

#### Scenario: Root is never removed whole
- **WHEN** a switch ends with any outcome
- **THEN** no `remove` call targets the `.zero-switch` root itself

### Requirement: A hand-installed tip leaves the state clean
When `selfUpdateCheck` finds the install folder's HEAD equal to the fetched tip, it SHALL save the state as exactly `{ status: 'idle', checkedAt, head }`, with no `failed`, `problem` or `retry`. The check SHALL also be due, whatever the daily interval, when the install folder's HEAD differs from the `head` recorded at the last check. A `ready` state whose `to` equals the install's HEAD SHALL go back to that clean idle state, and its prepared folder SHALL be removed.

#### Scenario: Installed by hand after failures
- **WHEN** the state is `idle` with `failed: [A, B]`, a `problem` and `head` A recorded 1 hour ago, and the fake git now answers HEAD = B and FETCH_HEAD = B
- **THEN** after `selfUpdateCheck` the state equals `{ status: 'idle', checkedAt: <now>, head: B }`

#### Scenario: Same HEAD is not due before a day
- **WHEN** the recorded `head` equals the current HEAD and the last check was 1 hour ago with no retry pending
- **THEN** `selfUpdateCheck` fetches nothing

#### Scenario: Ready for what is already installed
- **WHEN** the state is `ready` to B with an existing `dir`, and the install's HEAD is B
- **THEN** the state becomes the clean idle state and the `dir` folder is removed
