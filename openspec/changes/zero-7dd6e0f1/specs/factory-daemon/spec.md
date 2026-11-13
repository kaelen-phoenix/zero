# Spec Delta

## ADDED Requirements

### Requirement: Self-update is off unless the person in charge turns it on
The factory file SHALL accept a strict `selfUpdate` object (`enabled` default false, `remote` default `origin`, `branch` optional, defaulting to the install folder's checked-out branch, `startTimeoutSeconds` default 120) and the daemon MUST NOT check, prepare or switch anything while `selfUpdate.enabled` is not true; no MCP chat tool SHALL be able to change it.

#### Scenario: Absent means off
- **WHEN** the factory file has no `selfUpdate` and the self-update pass runs with fake git
- **THEN** no git command is run and no self-update record is written

#### Scenario: Unknown keys refused
- **WHEN** `selfUpdate: { enabled: true, token: x }` is parsed
- **THEN** the config fails validation

#### Scenario: Chat cannot touch it
- **WHEN** the MCP server's tool list and handlers are inspected
- **THEN** no tool writes `selfUpdate`

### Requirement: Only clean fast-forwards are taken
When enabled, the self-update check MUST fetch the configured remote branch into the install folder's repository and SHALL only plan an update when the install folder is the root of its own git repository, has no local changes in tracked files, is on the configured branch, and its HEAD is an ancestor of the fetched commit; otherwise it MUST record a problem, warn once per distinct problem and change nothing.

#### Scenario: Local changes
- **WHEN** fake git reports `status --porcelain --untracked-files=no` output for the install folder
- **THEN** no preparation starts, a `cambios locales` problem is recorded, and a second pass does not log again

#### Scenario: Diverged history
- **WHEN** `merge-base --is-ancestor HEAD <remote tip>` fails
- **THEN** no preparation starts and a problem saying it is not a fast-forward is recorded

#### Scenario: Up to date
- **WHEN** the remote tip equals HEAD
- **THEN** nothing is prepared and the last check time is recorded

### Requirement: Checks after own merges and once a day
The daemon SHALL run the self-update check at most once every 24 hours, and also on its next intake pass after a job of a line whose repository is the install folder's reaches MergeState `merged`.

#### Scenario: Daily
- **WHEN** the pass runs twice within 24 hours with no merge in between
- **THEN** git fetch runs only once

#### Scenario: After a zero line merge
- **WHEN** a job of the line whose repo resolves to the install folder gets `automerge:<job>` status `merged` after the last check
- **THEN** the next pass fetches again even within 24 hours

### Requirement: The new version is prepared off to the side
The self-update SHALL prepare the target commit in its own folder under `<ZERO_HOME>/self-update/` without modifying the install folder's files, MUST refuse a target whose `package-lock.json` or `npm-shrinkwrap.json` fails the packages' lock rules (`lockProblemAt`), and SHALL run `npm ci --ignore-scripts`, `npm run build`, `node dist/cli.js --version` and a factory-file load in that folder; any failure MUST leave the current version running, record the failure for that commit, warn once, and MUST NOT prepare that same commit again.

#### Scenario: Build fails
- **WHEN** the fake npm fails `run build` for target commit T
- **THEN** the state records T as failed, the install folder is untouched, no switch starts, and a later pass with the same remote tip does not prepare T again

#### Scenario: Bad lock
- **WHEN** the target's package-lock.json resolves a git dependency
- **THEN** npm is never called and the failure names the lock problem

#### Scenario: Ready
- **WHEN** every fake step succeeds
- **THEN** the state becomes `ready` with `from`, `to` and the prepared folder

### Requirement: Switch waits for a free factory
While a prepared update is `ready`, the daemon MUST NOT start new jobs, and once no job is running it SHALL launch the detached switch process and then stop itself through the normal shutdown, so queued and interrupted jobs resume from their checkpoint in the next daemon.

#### Scenario: Jobs running
- **WHEN** an update is ready while a job is running
- **THEN** no switch process is launched and queued jobs are not started

#### Scenario: Free
- **WHEN** an update is ready and nothing is running
- **THEN** the injected launcher is called once with the switch plan and the daemon's shutdown key is set

### Requirement: The switch survives the shutdown and verifies the new daemon
The switch process SHALL use only Node built-in modules, wait for the old daemon's lock to be released, put the prepared build and dependencies in the install folder, fast-forward its branch to the target, and start the daemon detached like `zero start --detach`; if the new daemon has not taken the daemon lock within `startTimeoutSeconds`, it MUST stop the process tree it started, restore the previous build and commit, start the previous version and record a rollback.

#### Scenario: Success
- **WHEN** the switch runs with fake fs, git and a fake launcher whose daemon takes the lock
- **THEN** the result records `from`, `to`, the time and outcome `updated`

#### Scenario: Rollback
- **WHEN** the started fake daemon never takes the lock before the timeout
- **THEN** the started process is killed, the previous build and commit are put back, the previous version is launched and the result says `rolled-back`

### Requirement: Every update is recorded and shown
The daemon SHALL import the switch's result on startup into a kv history of self-updates (from, to, at, outcome `updated`, `rolled-back` or `failed`, and a reason), and `factoryStatus` MUST expose the last outcome and any current problem so that `zero status`, the panel summary and the briefing show a warning after a rollback or a failed preparation.

#### Scenario: Rollback visible
- **WHEN** a result file with outcome `rolled-back` exists at daemon start
- **THEN** the history holds it, the result file is removed, and `formatStatus`, `overviewPage` and the briefing each contain a line saying it went back to the previous version

#### Scenario: Nothing to tell
- **WHEN** self-update is off and no history exists
- **THEN** no self-update line appears in status

### Requirement: zero reports its version
`zero --version` SHALL print the package version and the install folder's commit when available, and exit 0 without opening the factory.

#### Scenario: Version
- **WHEN** the CLI runs with `--version`
- **THEN** stdout contains the package.json version and the exit code is 0
