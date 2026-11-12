# Spec Delta

## ADDED Requirements

### Requirement: Clean base merge at attempt 0 resumes at verify
When a job is at station `verify`, its `prRefreshKey` mark has `resolved: true` and `job.attempt` is 0, `buildLoop` in src/line/runner.ts SHALL treat it as resuming. It MUST NOT call the build station or the line's writing (`type: build`) agents. It MUST run verify and then the reviewers (review, security, the line's review agents). It MUST NOT increase the job's stored `attempt` before verify.

#### Scenario: Retried pull request with a clean merge
- **WHEN** A delivered autoMerge pull-request job is in conflict (MergeState blocked with `backoff.mergeable: false`) and `retryJob` resets it to attempt 0. The base moves only in a file the job did not touch, the merges pass takes it back, and `runJob` runs again.
- **THEN** The job ends `delivered` with its original delivery. The fake build agent's call count is unchanged, review was called once more, the verify command ran once more, and the remote branch tip contains both the earlier head and the new base commit.

#### Scenario: Stored attempt is not spent
- **WHEN** That same retried job with a clean merge reaches delivered
- **THEN** The job's stored `attempt` is 0, not 1

### Requirement: Attempt span number is at least 1
When `buildLoop` resumes at verify with `job.attempt` 0 because of a resolved base merge, the `zero.attempt` span it opens SHALL record a `zero.attempt` attribute of at least 1.

#### Scenario: Span after a clean merge at attempt 0
- **WHEN** The retried job with a clean merge runs verify and the reviews
- **THEN** The `zero.attempt` span opened for that run has `zero.attempt` equal to 1

### Requirement: Other attempt-0 jobs still build
A job at attempt 0 whose station is not `verify`, or that has no `prRefreshKey` mark, or whose mark lacks `resolved: true`, MUST still go through the build station as before and spend an attempt.

#### Scenario: Conflicted merge at attempt 0 still builds
- **WHEN** A retried job at attempt 0 is taken back and its base merge conflicts, so the mark has `paths` and no `resolved`
- **THEN** The fake build agent is called with the merge in progress, and the job ends delivered with attempt 1

#### Scenario: Fresh job builds
- **WHEN** A new job with no prRefreshKey mark runs
- **THEN** Build is called and the job ends with attempt 1
