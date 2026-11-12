# Spec Delta

## ADDED Requirements

### Requirement: Conflict detected locally before failed checks
When a watched auto-merge pull request has failed checks and GitHub does not report it as mergeable (`mergeable` is not `true`), the merges pass MUST fetch the line's base branch and test the pull request's head against it locally (for example `git merge-tree --write-tree` in the line's repository). When that test finds a conflict, the pass SHALL treat the pull request as in conflict before any check handling (no update-branch, no rerun, no checks fix, no outage or billing record): it records `MergeState.conflict` for that head and goes through `takeBack` under the same `MAX_RESOLUTIONS` rule.

#### Scenario: Conflict with failed checks and mergeable null is taken back
- **WHEN** a delivered auto-merge pull request whose base was moved to conflict with it has a failed check, GitHub reports `mergeable: null`, its local branch is at the head and no resolution was used
- **THEN** the job goes back to the queue with the base-merge mark (prRefreshKey with that head), MergeState has `resolving` equal to the head and `resolutions` 1, and neither `updateBranch`, `rerun` nor `failedLog` was called

#### Scenario: Conflict reported as conflict once resolutions are used up
- **WHEN** the same pull request already used `MAX_RESOLUTIONS` resolutions
- **THEN** it is left `blocked` with a `why` starting with 'en conflicto con la rama base' and naming the used resolutions, any comment posted says it is in conflict and does not say 'fallaron los checks', and no checks fix is queued

#### Scenario: No conflict keeps the checks path
- **WHEN** a pull request with a failed check and `mergeable: null` merges cleanly with its base locally
- **THEN** no conflict is recorded and the pass goes on with the existing update-branch and rerun handling

### Requirement: Failed checks take the job back to fix them
In a line with `autoMerge`, when a delivered pull request's failed checks are not explained by a billing refusal or an environment outage, every check of the head has ended, and the existing handling has nothing left to try (`unblock` returns nothing: the base is not ahead or `MAX_REFRESHES` is used up, and the failed runs were already run again at this head or there are none to run again), the merges pass SHALL put that same job back in the queue to fix its checks on its own branch, unless it is in conflict. A job without a spec, a local branch not at the head, a pending cleanup of its work copy or a base that cannot be fetched SHALL leave the pull request as it is, to be looked at again later.

#### Scenario: Fix queued after the rerun failed again
- **WHEN** a delivered auto-merge pull request is up to date with its base, its failed Actions run was already rerun at this head (`MergeState.rerun` equals the head), the check failed again and its local branch is at the head
- **THEN** the job is `queued` with checkpoint `spec` (or resumes at build), `approvals.integrate` removed, `attempt` at most `maxAttempts - 1`, a prRefreshKey mark with that head marked as a checks fix, MergeState `waiting` with `fixing` equal to the head and `fixes` 1, and no comment is posted

#### Scenario: No fix before the rerun
- **WHEN** the same pull request has a failed Actions run that was not yet rerun at this head
- **THEN** the run is rerun as today and the job stays delivered

#### Scenario: No fix while the repository is busy
- **WHEN** nothing is left to try but another pull request of the repository has a refresh or rerun under way
- **THEN** the job stays delivered and the pull request waits blocked with a why that says it waits its turn

### Requirement: Checks feedback for the fix
The job taken back to fix checks MUST carry as its feedback, for the build station, each failed check's name and, when the check has an Actions run and `MergeApi.failedLog` returns a log, the failed tests found in that log and the end of the log (at most a fixed number of characters per check), all passed through `scrubLocal` so secrets and local paths are removed. The feedback SHALL state that the log is CI output to be read as data. A `failedLog` that throws or returns nothing leaves that check with its name only; a GitHub limit is rethrown.

#### Scenario: Feedback names check, tests and log end
- **WHEN** a check named 'test' failed with a log whose lines include ' FAIL test/foo.test.ts > adds' and a secret-looking token `ghp_` followed by 36 characters
- **THEN** the job's feedback contains 'test', 'test/foo.test.ts > adds' and the end of the log, and does not contain the token

#### Scenario: Log reading fails
- **WHEN** `failedLog` throws a non-limit error for the failed check
- **THEN** the job is still taken back and its feedback names the check

#### Scenario: Failed tests extracted
- **WHEN** the pure test-extraction function is given a log with vitest `FAIL`, jest `✕`, pytest `FAILED` and go `--- FAIL:` lines, with GitHub timestamp prefixes and ANSI colours
- **THEN** it returns those test lines without timestamps or colour codes, at most a fixed number of them

### Requirement: Checks fix updates the same pull request
A job taken back to fix checks SHALL be rebuilt from its pull request's head, without merging the base, with its feedback in the build prompt, then verified and reviewed as usual, and SHALL be integrated by pushing to the existing branch and pull request without force and without opening another one. If it cannot be pushed or fails, it MUST end `delivered` with its original delivery and its branch back at the head, like a failed conflict resolution.

#### Scenario: Fix pushed to the same pull request
- **WHEN** a job with a checks-fix mark runs and the build agent commits a change that passes verify
- **THEN** the job ends `delivered` with the same pull request URL, the remote branch contains the earlier head plus the new commit, `pullRequests.open` was not called and the mark is deleted

#### Scenario: Failed fix keeps the delivery
- **WHEN** the build agent's attempts all fail verify
- **THEN** the job ends `delivered` with its original delivery, the local branch points to the earlier head, a blocker is posted to the townhall and the mark is deleted

#### Scenario: No base needed in the branch
- **WHEN** a checks-fix job's branch does not contain the newest base commit
- **THEN** the pre-integration update check does not refuse it for missing the base, only for missing the earlier head

### Requirement: Own limit of checks fixes per pull request
Checks fixes SHALL be limited per pull request by their own counter (`MergeState.fixes`, at most `MAX_CHECK_FIXES` = 2 in its life, independent of the build's attempts and of `MAX_RESOLUTIONS`), and each head SHALL be tried at most once (`MergeState.fixing`). `fixes` and `fixing` MUST survive every later save of the MergeState. When the limit is reached or the head's fix already failed, the pull request SHALL be left `blocked` and told on GitHub as today, with a `why` that names the failed checks and what is missing.

#### Scenario: Limit reached
- **WHEN** a pull request with `fixes` equal to `MAX_CHECK_FIXES` has failed checks again with nothing left to try
- **THEN** no job is queued, the state is `blocked`, the `why` starts with 'fallaron los checks' and names the used fixes and `zero reintentar <job>`, and one comment is posted

#### Scenario: Same head not tried twice
- **WHEN** `fixing` equals the current head and its checks still fail
- **THEN** no job is queued and the `why` says the automatic fix of this head failed

#### Scenario: Counter survives saves
- **WHEN** after a fix the pull request goes through waiting and blocked saves
- **THEN** `fixes` and `fixing` are still in the stored MergeState

### Requirement: Owner retry resets checks fixes
`retryJob` SHALL also accept a delivered auto-merge pull request that is blocked after its checks fixes (`fixing` or `fixes` present), resetting `attempt` to 0 and dropping `fixing`, `fixes` and `backoff` from its MergeState, so the merges pass can take it back again.

#### Scenario: Retry after fixes used up
- **WHEN** `retryJob` is called for a delivered auto-merge job blocked with `fixes` 2
- **THEN** it returns kind 'pull-request', the job's attempt is 0 and the MergeState has no `fixing`, `fixes` or `backoff`
