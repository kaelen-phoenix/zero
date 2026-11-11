# Spec Delta

## ADDED Requirements

### Requirement: Conflict resolution does not depend on build attempts
`takeBack` in src/line/automerge.ts MUST put back in the queue the job of a delivered autoMerge pull request with a base conflict even when `job.attempt >= line.maxAttempts`, as long as the pull request has used fewer than `MAX_RESOLUTIONS` (2) conflict resolutions in its life. All other existing conditions still apply: spec present, head not equal to `MergeState.resolving`, no pending cleanup, local branch at the head, base fetched. When the job goes back to the queue it SHALL be stored with `attempt = Math.min(job.attempt, line.maxAttempts - 1)`, so at least one build attempt is left.

#### Scenario: Exhausted job is taken back
- **WHEN** An autoMerge line with maxAttempts 3 has a delivered job at attempt 3, and the merges pass sees its pull request with mergeable false at a head never tried, and MergeState has no resolutions
- **THEN** The job is queued with checkpoint review, station integrate and attempt 2, MergeState.resolving is the head, MergeState.resolutions is 1, and prRefreshKey is written

#### Scenario: Exhausted job resolves its conflict
- **WHEN** That queued job runs and the base merge conflicts, and the fake build agent resolves it
- **THEN** The job ends delivered with attempt 3 and pushes the merge to the same pull request

#### Scenario: Attempts not exhausted are kept
- **WHEN** A job at attempt 1 of 3 is taken back
- **THEN** Its attempt stays 1

### Requirement: Lifetime limit on conflict resolutions
Each pull request SHALL count its conflict resolutions in a new `MergeState.resolutions` field. `takeBack` raises the count each time it re-queues the job, and `kept()` in `watch` keeps it through every later save. `takeBack` MUST refuse once `resolutions >= MAX_RESOLUTIONS`.

#### Scenario: Third conflict is not taken back
- **WHEN** A pull request with MergeState.resolutions 2 shows mergeable false at a new head
- **THEN** The job stays delivered, nothing is written to prRefreshKey, and MergeState is blocked

#### Scenario: Count survives other saves
- **WHEN** After a take-back, a later pass saves a waiting or blocked state
- **THEN** MergeState.resolutions keeps its value

### Requirement: Conflict decided before failed checks
`mergeDecision` MUST return the conflict decision (`kind: blocked`, key `conflict:<head>`, why `en conflicto con la rama base`, no `failed`) whenever the pull request is open, not merged and `mergeable === false`, even when some of its checks failed or are still running. It SHALL return this before any check-based outcome.

#### Scenario: Conflict wins over failed checks
- **WHEN** mergeDecision gets an open pull request with mergeable false and a failed check
- **THEN** It returns kind blocked with key conflict:<head>, why 'en conflicto con la rama base' and no failed list

#### Scenario: Checks still apply without a conflict
- **WHEN** mergeDecision gets a pull request with mergeable true and a failed check
- **THEN** It returns the existing 'fallaron los checks …' decision

### Requirement: No update-branch or rerun for a conflicted head
While a pull request's head is known to be in conflict, the merges pass MUST NOT call `MergeApi.updateBranch`, `MergeApi.rerun` or `MergeApi.behind` for it, and MUST NOT run the outage or billing handling for that head. A head is known to be in conflict when GitHub reports `mergeable: false`, or when an `updateBranch` call for it failed with a message matching /merge conflict/i. That second case is recorded as `MergeState.conflict = <head>`, kept by `kept()`. A head recorded this way SHALL be treated exactly like `mergeable: false`: take-back, then the conflict decision.

#### Scenario: mergeable false with failed checks
- **WHEN** A watched pull request has mergeable false and failed Actions checks, and takeBack refuses because no resolutions are left
- **THEN** No updateBranch, rerun or behind call is made, the pull request is commented on once and MergeState is blocked with a backoff

#### Scenario: updateBranch answers merge conflict
- **WHEN** behind is true, and updateBranch throws an error whose message contains 'merge conflict between base and head'
- **THEN** MergeState.conflict is the head. On the next pass after the backoff, with the same head, no updateBranch or rerun is called again, and the job is taken back if takeBack allows it

#### Scenario: New head clears the conflict record
- **WHEN** MergeState.conflict holds an old head and GitHub reports a different head with mergeable true and passing checks
- **THEN** The pull request is merged as usual

### Requirement: Status names the conflict and what is missing
For a pull request blocked by a conflict, `MergeState.why`, and so `zero status`, the panel summary and the briefing, MUST say `en conflicto con la rama base`. It MUST NOT say `fallaron los checks`. When takeBack refused because no resolutions are left, why SHALL add that the 2 automatic resolutions are used up and that someone has to resolve it by hand or run `zero reintentar <job>`. When it refused because the resolution of that same head already failed (`resolving === head`), why SHALL say that the automatic resolution of that head failed.

#### Scenario: Resolutions used up
- **WHEN** A pull request with mergeable false and resolutions 2 is processed by the merges pass, and formatStatus is called
- **THEN** The 'Fusión automática' line contains 'NO SE FUNDE: en conflicto con la rama base', mentions that the automatic resolutions are used up and names 'zero reintentar', and does not contain 'fallaron los checks'

#### Scenario: Same head already tried
- **WHEN** A pull request with mergeable false whose head equals MergeState.resolving is processed
- **THEN** MergeState.why starts with 'en conflicto con la rama base' and says the automatic resolution of that head failed

### Requirement: Owner retry restores the conflict allowance
`retryJob` in src/app.ts MUST remove `resolutions` and `conflict` from the MergeState of a delivered auto-merge pull request in conflict, along with `resolving` and `backoff`, which it already removes, so the next merges pass can take it back.

#### Scenario: Retry after limit
- **WHEN** retryJob is called on a delivered autoMerge job whose MergeState is blocked with backoff.mergeable false and resolutions 2
- **THEN** It returns kind pull-request, and the stored MergeState has no resolutions, conflict, resolving or backoff
