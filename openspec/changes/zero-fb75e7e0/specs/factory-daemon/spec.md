# Spec Delta

## ADDED Requirements

### Requirement: Idle passes run one at a time
The daemon MUST run the idle-time passes (scoutPass and researchPass) through a single shared idle promise: it SHALL NOT start a research pass while a scout pass is in progress, nor a scout pass while a research pass is in progress, and it SHALL NOT start a new idle run while the previous one has not settled.

#### Scenario: Research waits for scout
- **WHEN** the daemon runs with scout and research enabled, one line with a research skill, and the fake scout agent stays blocked until the test releases it
- **THEN** the research agent is not called while the scout call is blocked, and it is called only after the scout call is released

#### Scenario: No overlapping idle runs
- **WHEN** the daemon keeps ticking (pollMs 10) while a scout call is blocked
- **THEN** the scout agent has been called exactly once until the call is released

### Requirement: Scout first, then research
Within one idle run the daemon SHALL run scoutPass first (when scout is enabled and nightShift is not off) and then researchPass (when research is enabled and research is not off). A failure or rejection in scoutPass MUST be logged and MUST NOT prevent researchPass from running in the same idle run.

#### Scenario: Research still runs when scout throws
- **WHEN** a `once` daemon runs with scout and research enabled and scoutPass rejects (for example, the scout agent throws on every line)
- **THEN** the research agent is still called and the line gets its research note

#### Scenario: Only research enabled
- **WHEN** a `once` daemon runs with scout:false and research:true on an idle factory
- **THEN** the line's research note is stored, as before the change

### Requirement: Shared night cap is respected across both stations
On per-use billing, the combined cost that scout and research record in one period MUST NOT exceed limits.usdPerNight when both run from the daemon. The second pass SHALL compute what is left after the first pass's spans are recorded.

#### Scenario: Total night spend stays under the cap
- **WHEN** a `once` daemon runs on per-use billing with limits.usdPerNight 1, both stations enabled, and one line with a research skill, and each fake agent spends its whole maxBudgetUsd (costUsd = maxBudgetUsd)
- **THEN** the sum of zero.cost.usd over scout and research agent spans since the start of the day (scoutSpent) is at most 1

#### Scenario: Research gets only what scout left
- **WHEN** a `once` daemon runs on per-use billing with usdPerNight 1, the fake scout costs 0.4 and both stations are enabled
- **THEN** the research call's maxBudgetUsd is close to 0.6

### Requirement: Idle passes still step aside and finish on shutdown
The daemon SHALL start an idle run only when the andon is off, no job is startable and no job is running, as before. On exit it MUST await the shared idle promise, and on shutdown it SHALL still abort research through its stop signal.

#### Scenario: Owner job starts while scout is running
- **WHEN** a scout call is blocked inside the daemon and the owner requests work on the line
- **THEN** the owner's job leaves the queue (the existing test 'starts the owner's job while a scout pass is still running' keeps passing) and the scout agent was called once

#### Scenario: Daemon exit waits for the idle run
- **WHEN** a `once` daemon starts an idle run with scout and research
- **THEN** runDaemon resolves only after both passes have finished (the research note is stored when it resolves)
