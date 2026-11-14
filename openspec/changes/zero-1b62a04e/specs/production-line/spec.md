# Spec Delta

## ADDED Requirements

### Requirement: Automatic merge watches every live delivered job
`watchedJobs` in src/line/automerge.ts SHALL return every delivered job with `delivery.autoMerge` and a `delivery.url` whose `automerge:<job>` record is absent or not in a final status (merged, closed, expired), however many delivered jobs the store holds and however old they are.

#### Scenario: More delivered jobs than the old cap
- **WHEN** the store holds 250 delivered auto-merge jobs with pull request urls, the first 240 created have a `merged` automerge record, and the last 10 created have no record
- **THEN** watchedJobs returns exactly the 10 newest jobs

#### Scenario: Newest job past the cap is polled
- **WHEN** there are 201 or more delivered auto-merge jobs and only the newest one has no final automerge record, and pollMerges runs with a fake MergeApi
- **THEN** the fake MergeApi is asked about the newest job's pull request and kv `automerge:<newest job>` gets written

### Requirement: Merge on request finds any delivered pull request by url
Resolving a pull request url for `mergePullRequest` (`zero fusionar <url>`) MUST find the delivered job that delivered that url even when more than 1000 delivered jobs were created before it.

#### Scenario: Url of a job past the old cap
- **WHEN** 1001 delivered jobs exist and the newest one delivered https://github.com/kaelen/demo/pull/N, and mergePullRequest is called with that url
- **THEN** the newest job is resolved and merged instead of the call refusing with 'La fábrica no entregó el pull request'

### Requirement: Recent-job readers are not capped by old history
Every reader that uses `listJobs` with ascending order to find live or recent jobs (the self-update `due` check, the briefing's night-shift and package job lists, `scoutDigest` and `collectJams`) SHALL read without a row cap, so jobs created after the first N rows of the history are included.

#### Scenario: Self-update sees a recent merge past 1000 delivered jobs
- **WHEN** more than 1000 delivered jobs exist on the install line and only the newest one has a `merged` automerge record updated after the last check
- **THEN** the self-update due check reports due

#### Scenario: Unjam sees a recent failure behind a long history
- **WHEN** a line has more than 10,000 older jobs and a job created last that failed within the failed-jobs window
- **THEN** collectJams includes a failed-job jam for that newest job
