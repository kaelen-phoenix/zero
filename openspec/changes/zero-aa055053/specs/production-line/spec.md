# Spec Delta

## ADDED Requirements

### Requirement: Ask for an on-demand unjam run
The shared operation requestUnjam(ctx, line?, now) MUST store one pending on-demand unjam request with the time it was asked and, when given, its line (no line means every non-package line), and return that time with a Spanish text.

#### Scenario: one line
- **WHEN** requestUnjam is called with line 'tienda' at a given time and nothing is pending
- **THEN** it returns ok with requestedAt equal to that time, and factoryStatus shows a pending unjam run for 'tienda' since that time

#### Scenario: every line
- **WHEN** requestUnjam is called without a line
- **THEN** it returns ok and the pending run has no line

### Requirement: Requests that are refused
requestUnjam MUST refuse, with a Spanish reason and without writing anything, when a request is already pending, the andon is on, the budget is reached, `unjam: off` is set, the line is unknown, or the line belongs to a package.

#### Scenario: already pending
- **WHEN** a request for 'tienda' is pending and requestUnjam is called again, for any line or for all
- **THEN** it returns not ok, the reason says one is already pending since the first time, and the stored request is unchanged

#### Scenario: andon
- **WHEN** the andon is on and requestUnjam is called
- **THEN** it returns not ok with a reason mentioning andon and nothing is pending

#### Scenario: budget
- **WHEN** the budget is reached and requestUnjam is called
- **THEN** it returns not ok with a reason mentioning the budget and nothing is pending

#### Scenario: unjam off
- **WHEN** the factory file has `unjam: off` and requestUnjam is called
- **THEN** it returns not ok and nothing is pending

#### Scenario: unknown or package line
- **WHEN** requestUnjam is called with a line that does not exist or that has `package`
- **THEN** it is refused and nothing is pending

### Requirement: Runs whatever the factory is doing
A pending on-demand request SHALL run unjamPass for its line, or for every non-package line, with jobs queued or running, outside nightShift.hours, with nightShift off and even when the line was already diagnosed in the period.

#### Scenario: busy factory outside the hours
- **WHEN** a line has a failed job, another job is running, a third is queued, nightShift.hours is 22:00-06:00 and a request is pending at 14:00
- **THEN** the unjam agent is called once for that line and its diagnosis is stored

#### Scenario: already diagnosed this period
- **WHEN** unjamPass already diagnosed the line in this period and an on-demand request for it runs
- **THEN** the unjam agent is called again for that line

#### Scenario: only the line asked for
- **WHEN** two lines have jams and the request names the second
- **THEN** only the second line is diagnosed

### Requirement: The scheduled turn stays as it was
An on-demand run MUST NOT read or write the line's period mark (`unjam-pass:<line>`) nor its daytime mark (`unjam-urgent:<line>`), so the regular passes keep their own turn.

#### Scenario: regular pass still runs
- **WHEN** an on-demand run diagnoses a line and unjamPass then runs in an idle factory within the same period, with the line not yet diagnosed by the regular pass
- **THEN** the regular pass diagnoses the line

### Requirement: Same logic and limits as the regular pass
An on-demand run MUST go through unjamPass and unjamLine, so it keeps unjam.maxJobsPerDay, nightShift.maxAutoJobsPerDay, the title dedupe, each job's single retry, the line's autonomy, protected paths, check logs, lessons and the deletion of a line's old diagnosis when it has no jams.

#### Scenario: daily cap
- **WHEN** unjam.maxJobsPerDay is 1, one unjam job was already opened today on an auto line, and an on-demand run returns a new fix cause
- **THEN** the proposal is created pending and no job is opened

#### Scenario: no repeated title
- **WHEN** an on-demand run returns a fix cause whose normalized title an unjam proposal of the line still holds
- **THEN** no new proposal is created

#### Scenario: no jams
- **WHEN** the line has no jams but has a stored diagnosis and an on-demand run looks at it
- **THEN** no agent is called, the stored diagnosis is deleted and the run ends well saying the line has no jams

### Requirement: Night spending cap
Each call of an on-demand run on an engine billed per use MUST carry what is left of limits.usdPerNight in the current period as its cap, and with nothing left the run MUST call no model and end as stopped with a reason naming the night limit.

#### Scenario: cap left
- **WHEN** limits.usdPerNight is 1, 0.4 was already spent in the period by idle-time stations and an on-demand run starts on an engine that is not a subscription
- **THEN** the agent call has maxBudgetUsd 0.6

#### Scenario: cap spent
- **WHEN** the period already spent limits.usdPerNight, the line has jams and an on-demand run starts
- **THEN** no agent is called and the run's record has outcome stopped with a reason mentioning usdPerNight

### Requirement: Andon and budget hold a pending request
A pending request SHALL stay pending, with no agent call and no record of a start, while the andon is on or the budget is reached, and MUST run once neither holds.

#### Scenario: andon after asking
- **WHEN** a request is pending, the andon is turned on and the on-demand pass runs, then the andon is lifted and the pass runs again
- **THEN** the first pass leaves it pending without calling an agent and the second runs it and clears it

### Requirement: Cut halfway
When the andon, the budget, the night cap, a missing engine or a shutdown cuts an on-demand run before all its lines were looked at, the record MUST end as stopped with a Spanish reason and keep the result of the lines already looked at.

#### Scenario: andon between lines
- **WHEN** two lines have jams and the andon is turned on while the first is being diagnosed
- **THEN** the second line is not diagnosed and the record has outcome stopped, a reason mentioning andon and the first line's result

### Requirement: Record of the run
zero MUST clear the pending request right before the run starts, keep the last on-demand unjam run with when it was asked, when it started, when it ended, its outcome (ok, failed, stopped or not-run), its reason and, for each line looked at, the number of jams and causes, and SHALL write it at the start and again at the end.

#### Scenario: ends well
- **WHEN** an on-demand run diagnoses a line with 2 jams into 1 cause
- **THEN** nothing is pending and the record has asked, startedAt, endedAt, outcome ok and that line with 2 jams and 1 cause

#### Scenario: while running
- **WHEN** the record is read while the agent call is under way
- **THEN** it has startedAt and no endedAt, and nothing is pending

#### Scenario: failed diagnosis
- **WHEN** the agent returns no valid output for the line
- **THEN** the record has outcome failed and names the line

#### Scenario: line gone after asking
- **WHEN** the requested line is removed from the factory file, or unjam is turned off, before the run starts
- **THEN** the request is cleared and the record has outcome not-run with a reason

### Requirement: Interrupted run closed on daemon start
When the daemon starts and finds an on-demand unjam record that started and never ended, it MUST end it as stopped.

#### Scenario: crashed daemon
- **WHEN** the store has a record with startedAt and no endedAt, and runDaemon starts
- **THEN** the record has endedAt and outcome stopped

### Requirement: The daemon runs it, never two diagnoses at once
The daemon MUST run a pending on-demand unjam in its own background pass, without taking a job slot or holding the loop, and SHALL NOT run it while another unjam pass is at work nor overlap a step of the idle run. A request that arrives during the idle run MUST go before its next step.

#### Scenario: daemon picks it up
- **WHEN** a request is pending, a line has jams, and runDaemon runs once with the on-demand unjam option on and the regular and urgent unjam off
- **THEN** the unjam agent is called once and the record ends ok

#### Scenario: during the idle run
- **WHEN** the idle run is in its scout step when a request arrives
- **THEN** the on-demand unjam runs after the scout step ends and before the next idle step starts, and at no time are two unjam calls under way

#### Scenario: a running job is not displaced
- **WHEN** concurrency is 1, a job is running and a request is pending
- **THEN** the on-demand unjam runs and the job is neither stopped nor sent back to the queue

### Requirement: Coordination with the cleanup of resolved jobs
An on-demand run MUST enter through unjamPass and collect each line's jams only once the run has started, after whatever unjamPass does ahead of its lines, so a job closed by then counts as no jam.

#### Scenario: job closed between the request and the run
- **WHEN** a request is asked while the line has one failed job, that job becomes stopped before the run starts, and the run starts
- **THEN** no agent is called and the record ends ok saying the line has no jams

### Requirement: CLI command
`zero destrabar [línea]` MUST ask for the run, start the factory when it is off, wait up to the same time as `zero package run` and say in Spanish whether it started or is still pending. A refusal MUST print the reason and exit with 1, and the usage text SHALL list the command.

#### Scenario: help
- **WHEN** the CLI usage text is printed
- **THEN** it contains `zero destrabar [línea]`

#### Scenario: refused
- **WHEN** `zero destrabar` runs with the andon on
- **THEN** it prints the reason and the exit code is 1

#### Scenario: waiting for the start
- **WHEN** waitUnjamStart polls until the record for that requestedAt has a startedAt, or the limit passes
- **THEN** it returns started true with the start time in the first case, and started false with a text saying it is still pending in the second

### Requirement: Chat tool
The MCP server MUST offer a `zero_unjam` tool with an optional line that asks for the run the same way as the CLI, and a remote chat with only the read scope SHALL NOT be offered it.

#### Scenario: listed and works
- **WHEN** a chat on this machine lists the tools and calls zero_unjam with line 'tienda'
- **THEN** zero_unjam is in the list, the answer says the run was asked for, and it is pending in the store

#### Scenario: refused
- **WHEN** zero_unjam is called with a request already pending
- **THEN** the answer is the refusal reason and nothing changes

#### Scenario: read-only remote chat
- **WHEN** a remote chat with only zero:read lists the tools
- **THEN** zero_unjam is not in the list

### Requirement: Status and briefing show it
`zero status` MUST show the pending on-demand unjam run and the last one with when it was asked, when it started and how it ended, and the briefing SHALL include them when pending or when the run started or ended in its period.

#### Scenario: pending
- **WHEN** a request for 'tienda' is pending and formatStatus is rendered
- **THEN** it contains a line that says the destrabador is pending for tienda and since when

#### Scenario: running
- **WHEN** the last record started and has not ended
- **THEN** formatStatus says it is running and since when

#### Scenario: ended
- **WHEN** the last record ended ok with a line of 2 jams and 1 cause
- **THEN** formatStatus says it ended well and when, with that line's 2 jams and 1 cause

#### Scenario: briefing
- **WHEN** an on-demand unjam run ended within the briefing's period
- **THEN** the briefing's 'Corridas a demanda' section lists it with its outcome

### Requirement: Panel button
The panel's summary MUST show, unless `unjam: off`, a 'Destrabar ahora' form that posts to /unjam with a choice of all lines or one non-package line, plus the pending request and the last run's start and end. POST /unjam SHALL require the session and the same origin, as the other actions do.

#### Scenario: button shown
- **WHEN** overviewPage is rendered with unjam on and a package line configured
- **THEN** it contains 'Destrabar ahora' and action="/unjam", and the package line is not among the form's options

#### Scenario: button hidden
- **WHEN** overviewPage is rendered with `unjam: off`
- **THEN** it does not contain 'Destrabar ahora'

#### Scenario: post
- **WHEN** the panel receives POST /unjam with a valid session and line 'tienda'
- **THEN** a request for tienda is pending and it redirects to / with the operation's text

#### Scenario: post without session or from another site
- **WHEN** POST /unjam arrives without a session, or from another origin
- **THEN** it answers 401 or 403 and nothing is pending

#### Scenario: last run
- **WHEN** the last record ended as failed
- **THEN** the summary shows when it started and that it failed

### Requirement: Documentation
README.md and README.es.md MUST describe the on-demand unjam (command, chat tool, panel button and limits) in their unjam sections with the same structure and code blocks, and docs/agents/night-shift.md SHALL describe its behaviour.

#### Scenario: both READMEs
- **WHEN** the unjam sections of both READMEs are read
- **THEN** both contain `zero destrabar` and test/docs.test.ts passes
