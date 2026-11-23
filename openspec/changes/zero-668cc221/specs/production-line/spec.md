# Spec Delta

## ADDED Requirements

### Requirement: Box jam is a single machine jam
collectJams MUST report a not-ready isolation box (with `isolation: container`) as a jam of only one line per pass: the first configured line without `package`. No other line SHALL get a `box` jam.

#### Scenario: three lines, box not ready
- **WHEN** the config has three non-package lines, `isolation: container` and a box whose availability is not ready
- **THEN** collectJams returns a jam with kind `box` for the first non-package line only, and no `box` jam for the other two

#### Scenario: package line first
- **WHEN** the first configured line is a package line and the second is a normal line, with the box not ready
- **THEN** the `box` jam belongs to the second line

### Requirement: Declared no-box machine has no box jam
With `isolation: worktree` in the factory file, collectJams SHALL NOT return a `box` jam for any line, and `zero status` MUST say the box is turned off (isolation: worktree) instead of saying it is not ready.

#### Scenario: worktree isolation without Docker
- **WHEN** `isolation: worktree`, no box status recorded, and collectJams runs for every line
- **THEN** no jam of kind `box` is returned, and formatted status contains 'Caja de aislamiento: desactivada (isolation: worktree)' and no 'no lista'

### Requirement: Stale jam views of other lines are hidden
jamViews MUST NOT show a stored cause whose title and kind `machine` duplicate a cause already shown for an earlier line, so one machine problem diagnosed on several lines SHALL count once in the status.

#### Scenario: same machine cause on two lines
- **WHEN** the stored diagnoses of lines A and B both have a cause titled 'La caja de aislamiento no está lista' with kind machine
- **THEN** jamViews returns that cause once (for line A)

### Requirement: Build put in place by the self-update is not stale
The install freshness check MUST report `staleBuild: false` when HEAD of the install equals the `to` commit of the last self-update history entry with outcome `updated`, and `git status --porcelain -- src` in the install is empty, even if files under src/ are newer than dist/cli.js.

#### Scenario: after a self-update
- **WHEN** the store's self-update history ends with {outcome: updated, to: <HEAD>} and src files have mtimes newer than dist/cli.js, with a clean working tree
- **THEN** checkInstall records staleBuild false and installBehind returns false

#### Scenario: manual edit after the update
- **WHEN** same as above but a tracked file under src/ has an uncommitted change and is newer than dist/cli.js
- **THEN** checkInstall records staleBuild true

#### Scenario: no self-update
- **WHEN** there is no self-update history and a src file is newer than dist/cli.js
- **THEN** staleBuild is true, as before

### Requirement: Freshness is rechecked after an update
checkInstall MUST look at the installation again, ignoring the one-hour throttle, when the last self-update entry with outcome `updated` is later than the stored record's `checkedAt`.

#### Scenario: record older than the update
- **WHEN** the stored record has checkedAt 10:00 with behind 3, a self-update entry `updated` at 10:20, and checkInstall runs at 10:30
- **THEN** checkInstall returns a new record (it does not return undefined)

### Requirement: Install jam tells the real self-update setting
The `install` jam text MUST say whether `selfUpdate.enabled` is true or false in the factory file and, when enabled, the outcome of the last self-update entry, so the unjam agent SHALL NOT be told selfUpdate is off when it is on.

#### Scenario: selfUpdate on
- **WHEN** selfUpdate.enabled is true, the record has behind 2 and the install repository equals the line's repository
- **THEN** the install jam text contains 'selfUpdate is enabled'

#### Scenario: selfUpdate off
- **WHEN** selfUpdate.enabled is false and the record has behind 2
- **THEN** the install jam text contains 'selfUpdate is off'

### Requirement: Discard a job
A discard operation (`discardJob(ctx, id, { reason, via, api })`) MUST end a failed, queued or waiting job, or a delivered job whose pull request is still open and unmerged, through finalizeJob with final status `stopped` and the reason 'Lo descartaste vos: <motivo>' (or 'Lo descartaste vos.' without a motivo). It SHALL refuse a running job (asking to stop it first with `zero stop`), an already stopped job, and a delivered job with no open pull request.

#### Scenario: failed job
- **WHEN** discardJob is called on a failed job with reason 'ya está en main'
- **THEN** the job's status is `stopped`, its reason is 'Lo descartaste vos: ya está en main', and a townhall post of kind `run` exists for the job

#### Scenario: running job
- **WHEN** discardJob is called on a running job
- **THEN** it throws an error in Spanish that mentions `zero stop`, and the job is unchanged

#### Scenario: unknown job
- **WHEN** discardJob is called with an id that does not exist
- **THEN** it throws 'No existe el trabajo <id>.'

### Requirement: Discard closes the PR and removes the branch
When the discarded job has a GitHub pull request in `delivery.url` that is open, discard MUST post a comment saying the factory discarded it (with the motivo) and close it. It MUST delete the job's branch (delivery.branch, else `zero/<id>`) in the line's repository when it is not checked out, and on GitHub through the MergeApi. It SHALL NOT delete the line's base branch or a branch that does not start with `zero/`. GitHub failures SHALL NOT stop the job from being discarded and MUST be reported in the result.

#### Scenario: open PR
- **WHEN** a delivered job with an open PR #7 and branch zero/abc12345 is discarded with a fake MergeApi
- **THEN** the fake records comment(7, …) and close(7), deleteBranch('zero/abc12345') is called, the local branch zero/abc12345 no longer exists, and the job is `stopped`

#### Scenario: GitHub fails
- **WHEN** the fake MergeApi's close throws
- **THEN** the job is still `stopped` and the outcome lists a problem about the pull request

#### Scenario: branch is the base
- **WHEN** a job whose delivery.branch equals the line's baseBranch is discarded
- **THEN** the base branch still exists after discard

### Requirement: Discard from the CLI
`zero descartar <trabajo> [--motivo "<texto>"]` MUST call the discard operation and print in Spanish the job's final status, whether its pull request was closed and whether its branch was deleted. Without a job, it SHALL fail with a message showing the usage.

#### Scenario: usage
- **WHEN** the CLI is run as `zero descartar` with no job
- **THEN** it fails with a message that contains 'zero descartar <trabajo>'

#### Scenario: help
- **WHEN** the CLI usage text is printed
- **THEN** it contains a line for `zero descartar <trabajo>`

### Requirement: Discard from the chat and the panel
The MCP server MUST offer a `zero_discard` tool (job, optional reason) that goes through `delicate`, so the remote chat holds it as a RemoteAction until confirmed. The panel MUST accept POST /job/<id>/discard with an optional `motivo` field and show a 'Descartar' form on the job page of a job that can be discarded.

#### Scenario: remote chat holds it
- **WHEN** zero_discard is called over the remote server
- **THEN** a pending remote action with tool `zero_discard` is stored and the job is unchanged until it is confirmed

#### Scenario: panel
- **WHEN** the panel receives POST /job/<id>/discard with a valid key for a failed job
- **THEN** the job ends `stopped` with a reason starting 'Lo descartaste vos'

### Requirement: Factory discards already resolved failed jobs on its own
A pass `discardResolved(ctx, now, merges?)` MUST end through finalizeJob, with status `stopped` and a reason that starts 'Descartado por la fábrica:' and says why, every failed job of a non-package line whose pull request (delivery.url) GitHub reports as merged, or whose branch (delivery.branch, else `zero/<id>`) exists in the line's repository and is an ancestor of `<remote>/<baseBranch>`, or whose changes since the merge-base with that ref are already identical in it (non-empty set of changed paths with no diff). It SHALL leave every other failed job as it is, and it MUST never ask the person in charge anything.

#### Scenario: branch already merged
- **WHEN** a temp repo has a failed job whose branch zero/<id> was merged into origin/main
- **THEN** after discardResolved the job is `stopped`, its reason starts 'Descartado por la fábrica:', and a townhall `run` post exists

#### Scenario: same content cherry-picked
- **WHEN** the failed job's branch changes file a.txt and the same content of a.txt was committed separately on origin/main
- **THEN** the job is discarded

#### Scenario: PR merged
- **WHEN** a failed job has delivery.url of PR #9 and the fake MergeApi reports it merged
- **THEN** the job is discarded

#### Scenario: real failure
- **WHEN** a failed job's branch has changes not in origin/main, or there is no branch and no PR
- **THEN** the job stays `failed`

### Requirement: The resolved-jobs pass runs before unjam and in the daemon
unjamPass and urgentUnjamPass MUST run discardResolved before collecting the jams, and the daemon MUST run it at most once per INTAKE_MS with a single in-flight promise, so unjam SHALL NOT diagnose a failed job whose work is already in the base branch.

#### Scenario: unjam skips resolved work
- **WHEN** unjamPass runs for a line whose only failed job's branch is already in origin/main
- **THEN** no agent is called for that line, no diagnosis is stored, and the job is `stopped`

### Requirement: Causes of closed jobs are not shown
jamViews MUST drop a stored cause when every jam id it groups is `job:<id>` or `pr:<id>` of a job that is now `stopped` or `delivered` without a blocked merge, so a discarded job's jam SHALL disappear from the status before the next unjam pass.

#### Scenario: after discard
- **WHEN** a stored diagnosis has a cause with jams ['job:abc12345'] and job abc12345 is discarded
- **THEN** jamViews no longer includes that cause

#### Scenario: mixed cause
- **WHEN** a cause groups ['job:abc12345', 'job:def67890'] and only abc12345 is discarded
- **THEN** the cause is still shown
