# Spec Delta

## Purpose

Con este cambio: 1) Si revertís en la rama principal un cambio que el turno nocturno integró solo, la fábrica lo detecta. La propuesta queda en estado "revertida" y se anota en el townhall de la línea. Además, `scout` recibe las últimas 20 propuestas rechazadas o revertidas de la línea para no volver a proponerlas. 2) Si pasás una línea a `build` o `auto`, sus propuestas que estaban pendientes se toman solas en la siguiente pasada del turno nocturno, respetando `maxAutoJobsPerDay`. No se toman las que agregan algo de terceros (dependencias, MCP, código ajeno); esas siguen esperando tu decisión. 3) El panel tiene una pestaña nueva, "Investigación": muestra las notas de cada línea con sus fuentes y el enlace a su issue, y tiene un botón para pedir un trabajo a partir de una nota. Antes de abrir el trabajo, pide confirmación. 4) El README explica todo esto. Queda para el próximo trabajo: que `scout` lea los issues abiertos sin etiqueta de la línea y pueda proponer tomarlos.

## ADDED Requirements

### Requirement: Revert detection
The factory SHALL mark as `reverted` an approved proposal that the night shift took on its own (decidedBy 'night-shift') when its job was delivered with mode 'merge' and a recorded `delivery.commit`, the owner never granted the integration (job.approvals.integrate not true), and the line's base branch has a later commit whose message contains `This reverts commit <delivery.commit>`.

#### Scenario: Reverted autonomous merge
- **WHEN** A night-shift proposal's job delivered by merging commit X into the base branch, the owner runs `git revert -m 1 X` on that branch, and the revert detection runs
- **THEN** getProposal returns status 'reverted' with a decidedAt timestamp

#### Scenario: Not reverted
- **WHEN** The same delivery exists and the base branch has no commit that reverts X
- **THEN** The proposal stays 'approved'

#### Scenario: Owner-approved integration is ignored
- **WHEN** The job that was reverted had approvals.integrate = true (the owner approved it at before-integrate)
- **THEN** The proposal stays 'approved'

#### Scenario: Idempotent
- **WHEN** The detection runs twice after the revert
- **THEN** The proposal is reverted once and only one townhall post exists for it

### Requirement: Revert recorded in the townhall
When a proposal becomes `reverted`, the factory MUST publish one townhall post of kind 'lesson' on the proposal's line with topic 'propuesta revertida' and a body that names the proposal title; a townhall failure MUST be logged, not thrown.

#### Scenario: Townhall lesson
- **WHEN** Revert detection marks a proposal reverted
- **THEN** townhall.recall for the line returns a post with topic 'propuesta revertida' whose body contains the proposal title

### Requirement: Revert detection runs in the daemon
The daemon SHALL run revert detection periodically for every configured line, in the background, without blocking the loop and without overlapping passes, and failures (e.g. a missing branch or repo) MUST be logged without stopping the daemon.

#### Scenario: Daemon once
- **WHEN** runDaemon runs with once: true after an autonomous delivery was reverted on the base branch
- **THEN** The proposal is 'reverted' afterwards

### Requirement: Scout remembers rejected and reverted
Scout's prompt SHALL list the line's last 20 proposals that are either rejected or reverted, most recently decided first, each marked as rejected (with the owner's reason) or reverted, and reverted titles MUST count as taken titles that filterProposals never accepts again.

#### Scenario: Reverted in prompt
- **WHEN** A line has one rejected and one reverted proposal and scoutLine runs with a fake agent
- **THEN** The prompt contains both titles, and the reverted one is labelled as reverted by the owner

#### Scenario: Limit 20
- **WHEN** A line has 25 rejected or reverted proposals
- **THEN** The prompt lists exactly the 20 most recently decided

#### Scenario: No repeat
- **WHEN** The fake scout returns a proposal whose title matches a reverted proposal
- **THEN** No new proposal is stored for it

### Requirement: Reverted stage in the proposals view
proposalsView MUST give reverted proposals the stage 'reverted', and the panel's "Propuestas" tab MUST show them in their own group titled "Revertidas".

#### Scenario: Panel shows reverted
- **WHEN** A proposal is reverted and GET /proposals is requested
- **THEN** The page contains "Revertidas" and the proposal title, and proposalsView gives that proposal stage 'reverted'

### Requirement: Promotion of pending proposals
On each scoutPass that runs (night shift on, inside its hours, andon off), before scouting, the night shift SHALL take on its own every pending proposal, oldest first, whose line autonomy (lineAutonomy) is 'build' or 'auto', exactly as takeOnItsOwn does for new proposals, i.e. a job with source {kind:'night-shift', proposal, autonomy}, status 'approved' and decidedBy 'night-shift', while maxAutoJobsPerDay across lines is not reached. This applies even if the line was already scouted this period.

#### Scenario: Promoted after autonomy change
- **WHEN** A pending proposal was created while the line was 'propose', the config changes the line to 'build', and scoutPass runs
- **THEN** The proposal is 'approved' with decidedBy 'night-shift' and a queued job whose source.autonomy is 'build'

#### Scenario: Cap respected
- **WHEN** maxAutoJobsPerDay is 1 and two such pending proposals exist
- **THEN** Only the older one is promoted and the other stays pending

#### Scenario: Propose lines untouched
- **WHEN** The line's autonomy is 'propose'
- **THEN** Pending proposals stay pending

#### Scenario: Night shift off
- **WHEN** nightShift is off, or now is outside nightShift.hours, or the andon is on
- **THEN** No pending proposal is promoted

### Requirement: Third-party proposals are never promoted
Promotion MUST skip pending proposals that were born from something third-party, i.e. thirdParty is true or touchesManifest(paths) is true, whatever the line or research autonomy.

#### Scenario: Third-party stays pending
- **WHEN** A line is 'auto', research.autonomy is 'auto', and a pending proposal has thirdParty true (or paths including package.json)
- **THEN** After scoutPass it is still 'pending' and no job was opened for it

### Requirement: Research tab lists notes
The panel SHALL serve a read-only page at GET /research, linked as "Investigación" in the navigation, that lists the research notes of each line (last 30 days, newest first) with topic, findings, serves, maturity, every source as a link, and a link to the note's GitHub issue when it has one; all text MUST be HTML-escaped.

#### Scenario: Notes shown
- **WHEN** A line has a research note with two sources and issueUrl set, and GET /research is requested with a valid session
- **THEN** The response is 200 and contains the topic, both source URLs and the issue URL, and the nav contains a link to /research

#### Scenario: Escaped
- **WHEN** A note's findings contain '<script>'
- **THEN** The page contains '&lt;script&gt;' and no raw '<script>' from the note

#### Scenario: No session
- **WHEN** GET /research without a session cookie
- **THEN** The request is refused like the other panel pages

### Requirement: Request work from a note with confirmation
POST /research/<id>/request SHALL respond with a confirmation page and open no job unless the form carries confirm=1. With confirm=1 it MUST open the job through requestFromResearchNote and redirect back to /research with a flash naming the job id. An unknown note id MUST open no job.

#### Scenario: First press confirms
- **WHEN** POST /research/<id>/request without confirm
- **THEN** Status 200 with a page containing a form with confirm=1, and no job exists

#### Scenario: Confirmed
- **WHEN** POST /research/<id>/request with confirm=1
- **THEN** A redirect to /research and one job on the note's line with source {kind:'research', note:<id>}

#### Scenario: Unknown note
- **WHEN** POST /research/ffffffff/request with confirm=1
- **THEN** No job is created and the panel reports the error

### Requirement: README documents part 2c
README.md MUST document revert detection (the 'revertida' status, the townhall note and scout's last 20 rejected or reverted), the promotion of pending proposals when a line moves to build or auto (third-party ones excluded, maxAutoJobsPerDay respected), and the panel's "Investigación" tab.

#### Scenario: README mentions
- **WHEN** README.md is read
- **THEN** It contains 'revertida', 'Investigación' as a panel tab, and mentions promoting pending proposals with maxAutoJobsPerDay
