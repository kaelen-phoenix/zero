# Spec Delta

## ADDED Requirements

### Requirement: Known duration of a verify command
src/line/pace.ts SHALL export a function that returns how long the slowest of the last 5 passing runs of a verify command took on a line in the last 30 days (zero.run_ms when present, else end minus start). It returns undefined when there is no such run. verifyTimeoutMs MUST use this function and its result MUST NOT change.

#### Scenario: With history
- **WHEN** the line's last passing runs of `npm test` took 10, 19 and 12 minutes, and there are also failed runs, runs of other commands and runs on other lines
- **THEN** the function returns 19 minutes in ms, and verifyTimeoutMs still returns 38 minutes, as before

#### Scenario: Without history
- **WHEN** the line has no passing run of the command
- **THEN** the function returns undefined, and verifyTimeoutMs returns the line's verifyTimeoutMinutes or 20 minutes

### Requirement: Build prompt shows verify durations
The build prompt SHALL list every verify command of the line. Each command with a known duration MUST show that duration in whole minutes (at least 1). A command without history MUST appear as it does today, and a line where no command has history MUST get the same verification line as today.

#### Scenario: No history
- **WHEN** a job is built on a line whose verify commands have never passed
- **THEN** the build prompt contains `Verification commands that must pass: <commands joined by ", ">.` exactly as today, with no durations and no advice

#### Scenario: Short command
- **WHEN** `npm test` has a past passing run of 2 minutes and the build station's timeoutMinutes is 45
- **THEN** the build prompt shows `npm test` with about 2 minutes and does not tell build to skip the full run

### Requirement: Advice for slow verify commands
When a verify command's known duration is more than a third of stations.build.timeoutMinutes, the build prompt SHALL tell build not to run that command in full. Build should instead run only the tests of the files it changes, because zero runs every verify command in full at the verify station. Verify MUST still run every configured command in full.

#### Scenario: Long command
- **WHEN** `npm test` has a past passing run of 25 minutes and stations.build.timeoutMinutes is 45
- **THEN** the build prompt shows `npm test` with about 25 minutes and says not to run it in full but to run only the tests of the touched files, since zero runs the full suite in verify

#### Scenario: Verify unchanged
- **WHEN** that job's build finishes
- **THEN** the verify station still runs `npm test` with the timeout given by verifyTimeoutMs

### Requirement: Engines report a timeout
EngineResult and AgentRun SHALL have an optional `timedOut` field. The Claude, CLI and ACP engines MUST set it to true when they end a call because the request's timeoutMs ran out, and MUST NOT set it for cancellation or other errors. The agent runner MUST copy it to AgentRun.

#### Scenario: CLI engine
- **WHEN** a CLI engine runs a process that outlives timeoutMs
- **THEN** the result is ok false, its text still says `<name> timed out after ...`, and timedOut is true

#### Scenario: ACP engine
- **WHEN** an ACP agent does not answer session/prompt before timeoutMs
- **THEN** the result is ok false and timedOut is true

#### Scenario: Claude engine
- **WHEN** the mocked SDK query is still running when timeoutMs expires and throws on abort
- **THEN** the result is ok false and timedOut is true, while a call cancelled through req.signal has no timedOut

#### Scenario: Runner passes it on
- **WHEN** the engine returns timedOut true
- **THEN** the AgentRun returned by createAgentRunner has timedOut true

### Requirement: Feedback when build hits its time limit
When a build run fails with timedOut, the attempt's feedback SHALL say that build reached its limit of N minutes (N = stations.build.timeoutMinutes), that what it did is still uncommitted in the work copy, and that the next attempt should continue from there. It MUST NOT say «Hacé cambios más chicos y enfocados». The attempt MUST count as it does today. Other abnormal ends MUST keep today's feedback.

#### Scenario: Timed out
- **WHEN** the fake build agent returns ok false with timedOut true on its first call and succeeds on the second
- **THEN** the second build prompt's feedback names the 45-minute limit, says the work is uncommitted in the copy and should be continued, and does not contain «Hacé cambios más chicos»; job.attempt is 2

#### Scenario: Other error
- **WHEN** the fake build agent returns ok false without timedOut
- **THEN** the feedback still says «terminó de forma anormal» and «Hacé cambios más chicos y enfocados»
