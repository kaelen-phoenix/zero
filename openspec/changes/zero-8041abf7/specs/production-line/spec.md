# Spec Delta

## ADDED Requirements

### Requirement: discardResolved reports each job it closes
discardResolved(ctx, now, merges?, onClosed?) MUST call the optional onClosed callback once for each failed job it closes, with that job's line name and job id, right after the job is finalized as stopped; its numeric return value and its behaviour without the callback SHALL stay unchanged.

#### Scenario: one closed job is reported
- **WHEN** a line 'demo' has one failed job whose branch was merged into origin/main and discardResolved is called with an onClosed callback
- **THEN** it returns 1 and the callback was called exactly once with { line: 'demo', job: <that job's id> }

#### Scenario: nothing closed, nothing reported
- **WHEN** discardResolved is called with an onClosed callback and no failed job is resolved
- **THEN** it returns 0 and the callback was never called

#### Scenario: existing callers unaffected
- **WHEN** discardResolved is called without a callback on a line with a resolved failed job
- **THEN** it returns 1 and the job is stopped, as before

### Requirement: On-demand run records the jobs it closed
unjamOnDemandPass MUST store, in the optional `closed` field of its UnjamRunRecord (an array of { line, job }), every job that the discardResolved of its unjamPass closed, from every line, even when the request names a single line. When nothing was closed, the field SHALL be absent.

#### Scenario: run that closes one job
- **WHEN** a failed job of line 'demo' is already merged into origin/main, requestUnjam(ctx, 'demo') is called, and then unjamOnDemandPass runs
- **THEN** readUnjamRun returns outcome 'ok', reason 'la línea demo no tiene trabas', lines [{ line: 'demo', jams: 0, causes: 0 }] and closed [{ line: 'demo', job: <id> }], and no agent was called

#### Scenario: run that closes several jobs
- **WHEN** two failed jobs of 'demo' are already merged and an on-demand run executes
- **THEN** the record's closed lists both job ids with line 'demo', in the order in which they were closed

#### Scenario: a single-line request still records the other lines' closures
- **WHEN** the factory has lines 'demo' and 'blog', a resolved failed job exists on 'blog', and the on-demand run was asked only for 'demo'
- **THEN** the record's closed contains { line: 'blog', job: <id> }

#### Scenario: run without closures
- **WHEN** an on-demand run executes and no failed job is resolved
- **THEN** the record has no closed property (toEqual against a record without it passes)

### Requirement: Closures survive a cut or a crash
The closures MUST appear in the record even when the run is cut after discardResolved (andon, budget, night cap, missing engine, shutdown), when unjamPass throws, or when the daemon crashes before the end: the record SHALL be rewritten with `closed` as each closure is reported, and the final write and closeInterruptedUnjam SHALL keep it.

#### Scenario: run stopped after closing
- **WHEN** a resolved failed job exists, another line still has a real failed job, and the andon is turned on (or the engine is unavailable) after discardResolved so unjamPass returns a cut
- **THEN** readUnjamRun returns outcome 'stopped' with the cut reason and closed contains the closed job

#### Scenario: crash after closing
- **WHEN** the on-demand run has closed a job and the record is left without endedAt, and then closeInterruptedUnjam is called
- **THEN** the record ends as 'stopped' and still has closed with that job

### Requirement: Old records stay readable
readUnjamRun MUST still accept a record without the `closed` field, and describeUnjamRun SHALL treat a missing or non-array `closed` as no closures.

#### Scenario: old record
- **WHEN** kv unjam-demand-last holds a JSON record of the previous shape, without closed
- **THEN** readUnjamRun returns it unchanged, and describeUnjamRun gives exactly the same text as before this change

#### Scenario: malformed field
- **WHEN** the stored record has closed set to a string
- **THEN** describeUnjamRun does not throw and adds no closure text

### Requirement: Text of the closures
describeUnjamRun MUST add, when the record has closures, a ' · ' segment right after the status segment and before the line segments, saying 'cerró 1 trabajo que ya estaba resuelto (<line>: <id>)' or 'cerró N trabajos que ya estaban resueltos (<line>: <id>, <id>; <line>: <id>)', grouped by line in first-seen order, with at most 5 ids shown and ', y M más' for the rest. Without closures the text SHALL be identical to today's.

#### Scenario: singular
- **WHEN** describeUnjamRun is given an ended ok record with closed [{ line: 'demo', job: 'a1b2c3d4' }] and lines [{ line: 'demo', jams: 0, causes: 0 }]
- **THEN** the text contains 'terminó bien (13:07) · cerró 1 trabajo que ya estaba resuelto (demo: a1b2c3d4) · demo: sin trabas'

#### Scenario: plural across lines
- **WHEN** closed is [{demo,a1b2c3d4},{demo,e5f6a7b8},{blog,c9d0e1f2}]
- **THEN** the text contains 'cerró 3 trabajos que ya estaban resueltos (demo: a1b2c3d4, e5f6a7b8; blog: c9d0e1f2)'

#### Scenario: bounded ids
- **WHEN** closed has 7 jobs of line 'demo'
- **THEN** the text names only the first 5 ids and ends the group with ', y 2 más)'

#### Scenario: shown by zero status, panel and briefing
- **WHEN** a stored run record has one closure and formatStatus, the panel overview page and the briefing are rendered
- **THEN** the 'Última corrida a demanda del destrabador' status line, the panel's 'Última corrida a demanda' paragraph (HTML-escaped) and the briefing's '- destrabador:' line all contain 'cerró 1 trabajo que ya estaba resuelto'

#### Scenario: unchanged without closures
- **WHEN** describeUnjamRun is given the existing test record without closed
- **THEN** the text equals 'pedida para tienda 13:00, empezó 13:05, terminó bien (13:07) · tienda: 2 trabas, 1 causa'
