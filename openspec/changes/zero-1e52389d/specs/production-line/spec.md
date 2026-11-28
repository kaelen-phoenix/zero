# Spec Delta

## ADDED Requirements

### Requirement: discardResolved reports each job it closed
`discardResolved` MUST accept an optional callback that it SHALL call once for each failed job it closes, with the job's line name and id, and it SHALL keep returning the number of jobs closed. Callers that pass no callback MUST see no change.

#### Scenario: Callback per closed job
- **WHEN** a line `demo` with a remote has two failed jobs whose branches were merged into the remote base, and `discardResolved` is called with a callback
- **THEN** it returns 2, and the callback was called twice, with `{ line: 'demo', job: <id> }` for each of the two jobs

#### Scenario: No closure, no call
- **WHEN** the only failed job's work is not in the base, and `discardResolved` is called with a callback
- **THEN** it returns 0 and the callback is never called

#### Scenario: Without callback
- **WHEN** `discardResolved(ctx, now)` is called without a callback and one failed job is resolved
- **THEN** it returns 1 and the job is `stopped`, as before

### Requirement: On-demand run records what it closed
`unjamOnDemandPass` MUST store in its final `UnjamRunRecord` an optional `closed` field: the list of `{ line, job }` for every job that the run's `discardResolved` closed, across all lines that are not packages, even when the request named a single line. The field SHALL be absent when nothing was closed.

#### Scenario: One job closed
- **WHEN** an on-demand run is asked for line `demo` while one failed job of `demo` has its branch merged into the remote base
- **THEN** `readUnjamRun` returns `outcome: 'ok'` and `closed: [{ line: 'demo', job: <id> }]`

#### Scenario: Several jobs closed, on another line too
- **WHEN** an on-demand run is asked for line `demo` in a factory with two lines with remotes, `demo` and `blog`, each with a resolved failed job
- **THEN** the record's `closed` has both entries, each with its own line name

#### Scenario: Nothing closed
- **WHEN** an on-demand run finds no resolved failed job
- **THEN** the stored record has no `closed` field

### Requirement: Closures recorded when the run is cut or fails afterwards
Jobs closed before an on-demand run is cut (outcome `stopped`) or fails with an exception MUST still appear in the final record's `closed`.

#### Scenario: Cut after closing
- **WHEN** a resolved failed job exists and the run is cut after `discardResolved`, because a line still has jams and the budget is reached, or the abort signal fires before the first line
- **THEN** the record has `outcome: 'stopped'` and `closed` names the closed job

### Requirement: Old records still read
`readUnjamRun` SHALL accept a record without `closed` as before, and `describeUnjamRun` MUST ignore a `closed` that is missing or not an array.

#### Scenario: Record without the field
- **WHEN** kv `unjam-demand-last` holds a record written before this change, without `closed`
- **THEN** `readUnjamRun` returns it and `describeUnjamRun` gives exactly the same text as before this change

### Requirement: Text of the closures
`describeUnjamRun` MUST add, when `closed` has entries, a ` · `-separated segment right after the run's state and before the per-line segments: 'cerró 1 trabajo que ya estaba resuelto (<línea>: <id>)' or 'cerró N trabajos que ya estaban resueltos (<línea>: <id>, <id>; <línea>: <id>)', with the ids grouped by line in order of first appearance. It SHALL show at most 5 ids and SHALL end the list with 'y M más' when there are more. Without closures the text MUST stay unchanged.

#### Scenario: Singular
- **WHEN** a record ending ok at 13:07 for line `tienda` has `closed: [{ line: 'tienda', job: 'a1b2c3d4' }]` and lines `[{ line: 'tienda', jams: 0, causes: 0 }]`
- **THEN** the text is 'pedida para tienda 13:00, empezó 13:05, terminó bien (13:07) · cerró 1 trabajo que ya estaba resuelto (tienda: a1b2c3d4) · tienda: sin trabas'

#### Scenario: Plural over two lines
- **WHEN** `closed` holds `tienda:a1b2c3d4`, `tienda:e5f6a7b8`, `blog:12345678`
- **THEN** the text contains 'cerró 3 trabajos que ya estaban resueltos (tienda: a1b2c3d4, e5f6a7b8; blog: 12345678)'

#### Scenario: Bounded list
- **WHEN** `closed` holds 7 entries of line `tienda`
- **THEN** the text says 'cerró 7 trabajos que ya estaban resueltos' and lists only the first 5 ids followed by 'y 2 más'

#### Scenario: Stopped run
- **WHEN** a stopped record with reason 'se alcanzó el presupuesto' has one closed job
- **THEN** the text contains 'se cortó (13:07): se alcanzó el presupuesto · cerró 1 trabajo que ya estaba resuelto'

### Requirement: Status and panel show it
`zero status` (formatStatus) and the panel's overview MUST show the closure segment of the last on-demand run through `describeUnjamRun`.

#### Scenario: Status line
- **WHEN** the stored last run has one closed job and `formatStatus(factoryStatus(ctx))` is rendered
- **THEN** the 'Última corrida a demanda del destrabador:' line contains 'cerró 1 trabajo que ya estaba resuelto'

#### Scenario: Panel
- **WHEN** the panel overview is rendered with a stored run that has closed jobs
- **THEN** the HTML contains the escaped `describeUnjamRun` text, including 'cerró'
