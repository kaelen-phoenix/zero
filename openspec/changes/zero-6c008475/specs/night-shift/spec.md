# Spec Delta

## Purpose

Hoy cada propuesta del turno nocturno espera tu decisión. Con este cambio la autonomía de cada línea se aplica de verdad: - En `propose` nada cambia: la propuesta espera tu decisión. - En `build`, la propuesta se convierte sola en un trabajo marcado como del turno nocturno. El trabajo pasa por todas las estaciones, pero se detiene antes de integrar y espera tu aprobación. Si no contestás, nunca se integra solo. Cuando aprobás la propuesta (`zero proposals approve <id>`, o desde el chat), se integra según la configuración de la línea. Si la rechazás, el trabajo se detiene y su rama queda guardada. - En `auto`, el trabajo se construye y se integra solo, según `integrate` y `autoMerge` de la línea. En `build` y en `auto` el trabajo sigue las reglas de siempre. Si toca algo protegido, se pasa del presupuesto o la verificación lo frena, espera al dueño como cualquier otro trabajo. Otras reglas: - **Tope diario.** Como mucho `nightShift.maxAutoJobsPerDay` trabajos automáticos por día (3 por defecto), sumando todas las líneas. Al llegar al tope, las propuestas que siguen esperan tu decisión. - **Tus pedidos van primero.** Los trabajos automáticos del turno nocturno nunca pasan delante de tus trabajos, y no arrancan mientras haya uno tuyo en la cola o en curso. - **Propuestas nacidas de una investigación.** Quedan marcadas con la nota de origen. Si agregan una dependencia, una skill de terceros, un servidor MCP o código de terceros, las regula `research.autonomy` (`propose` por defecto, o sea, esperan tu decisión aunque la línea esté en `auto`). zero lo revisa por su cuenta mirando los archivos de dependencias, sin confiar solo en lo que dice el agente. Escribir una skill propia o asignar una ya instalada sigue la autonomía de la línea. - **Informe.** La sección "Turno nocturno" separa qué se propuso, qué se construyó solo y qué se integró o desplegó solo. - **README.** Documenta el turno nocturno completo y `fallback`, que hoy no está. - **Panel.** Una pestaña "Propuestas" muestra las propuestas de cada línea (pendientes, construyéndose, entregadas y rechazadas) con su issue, la nota de origen, el motivo de rechazo y la autonomía de la línea, y deja aprobarlas (pidiendo confirmación) o rechazarlas.

## ADDED Requirements

### Requirement: Propose autonomy waits for the owner
When a line's effective night-shift autonomy (line `nightShift.autonomy`, else the global one) is `propose`, a proposal stored by scout SHALL stay `pending` and no job SHALL be created for it.

#### Scenario: propose line
- **WHEN** scoutLine stores a proposal on a line whose autonomy is `propose`
- **THEN** the proposal's status is `pending`, it has no jobId and no job with source kind `night-shift` exists

### Requirement: Build and auto autonomy open a job on their own
When the effective autonomy of a stored proposal is `build` or `auto` and the daily cap is not reached, zero MUST approve it on its own: it creates a normal job of the proposal's line with source `{kind: 'night-shift', proposal, autonomy}` and records on the proposal its jobId and that the night shift (not the owner) decided it.

#### Scenario: build line
- **WHEN** scoutLine stores a proposal on a line with `nightShift.autonomy: build`
- **THEN** the proposal is `approved`, has a jobId, is marked as decided by the night shift, and the job is `queued` with source autonomy `build`

#### Scenario: line overrides global
- **WHEN** global autonomy is `propose` and the line sets `auto`
- **THEN** the job is created with source autonomy `auto`

### Requirement: Build autonomy parks before integration
A night-shift job with autonomy `build` MUST NOT be integrated without the owner. After verify, review and security pass, the runner SHALL park it with a `before-integrate` question at every level, and that question's timeout answer MUST be `reject` whatever `approvals.onTimeout` says. The decision lives in `src/line/policy.ts`.

#### Scenario: parked at L3
- **WHEN** a night-shift job with autonomy `build` reaches integration at level L3 on a `merge` line
- **THEN** the job is `waiting` with question kind `before-integrate`, the base branch is unchanged and question.onTimeout is `reject`

#### Scenario: timeout never integrates
- **WHEN** config approvals.onTimeout is `approve` and that question expires
- **THEN** the job ends `stopped` and nothing is merged

### Requirement: Approving a built proposal integrates it
`approveProposal` on a proposal whose night-shift job is waiting at `before-integrate` SHALL answer that job with approve, so it resumes and integrates per the line's `integrate` and `autoMerge`. `rejectProposal` on such a proposal SHALL stop the job, keep its branch, and mark the proposal `rejected` with the owner's note.

#### Scenario: approve integrates
- **WHEN** the owner approves a proposal whose build job is parked at before-integrate and the job runs again
- **THEN** the job is `delivered` with the line's delivery mode

#### Scenario: reject stops
- **WHEN** the owner rejects that proposal with a note
- **THEN** the job is `stopped`, the proposal is `rejected` with that note, and the rejection lesson is published to the townhall

### Requirement: Auto autonomy integrates without asking
A night-shift job with autonomy `auto` SHALL integrate exactly like any other job of its line, still subject to the level policy, protected paths, the budget, the verify gate, review, security and the egress stop.

#### Scenario: auto at L3
- **WHEN** a night-shift job with autonomy `auto` passes every station at L3 on a `merge` line
- **THEN** it is `delivered` and merged into the base branch without any question

#### Scenario: auto still stops on protected paths
- **WHEN** that job touches a protected path at L2
- **THEN** it waits with a `protected-path` question like any other job

### Requirement: Daily cap on autonomous jobs
zero MUST NOT open more than `nightShift.maxAutoJobsPerDay` autonomous night-shift jobs per local day, counted across all lines. Proposals stored after the cap is reached SHALL stay `pending` for the owner. A cap of 0 means none are opened.

#### Scenario: cap reached
- **WHEN** maxAutoJobsPerDay is 1, two `build` lines each get a proposal on the same day
- **THEN** exactly one proposal has an autonomous job and the other is `pending`

#### Scenario: new day
- **WHEN** the cap was reached yesterday and a proposal arrives today
- **THEN** it opens an autonomous job

### Requirement: Owner work goes first
The daemon SHALL NOT start a queued autonomous night-shift job (source autonomy `build` or `auto`) while any other job is queued or running, and SHALL consider owner jobs before autonomous night-shift jobs when picking queued work.

#### Scenario: owner job queued
- **WHEN** an autonomous night-shift job was queued first and an owner job is queued later on another line
- **THEN** the daemon starts the owner job and leaves the night-shift job queued

#### Scenario: alone
- **WHEN** only the autonomous night-shift job is queued
- **THEN** the daemon starts it

### Requirement: Research-born proposals carry their note
Scout output SHALL include, for each proposal, `researchNote` (the id of the note it came from, or null) and `thirdParty` (true when it adds a dependency, a third-party skill, an MCP server or third-party code). zero SHALL store the note id only when it is one of the line's notes given to scout, and SHALL show it on the proposal.

#### Scenario: known note
- **WHEN** scout returns a proposal citing a note id of that line shown in its prompt
- **THEN** the stored proposal has that researchNote

#### Scenario: unknown note
- **WHEN** scout cites an id that is not one of that line's notes
- **THEN** the stored proposal has no researchNote

### Requirement: Third-party research proposals follow research.autonomy
For a proposal with a researchNote that is third party (scout's `thirdParty` flag, or proposal paths that match a dependency or MCP manifest zero recognizes, such as package.json, lockfiles, requirements*.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile, .mcp.json), the effective autonomy MUST be the more restrictive of the line's autonomy and `research.autonomy` (`propose` when research is `off`). Before integrating an autonomous research-born job whose changed files touch such a manifest, the runner MUST apply the same rule and park the job when the result is not `auto`. Other research-born proposals follow the line's autonomy.

#### Scenario: auto line, default research autonomy
- **WHEN** a line is `auto`, research.autonomy is the default and scout returns a research-born proposal with thirdParty true
- **THEN** the proposal stays `pending` and no job is created

#### Scenario: manifest path overrides flag
- **WHEN** thirdParty is false but paths include package.json, on an `auto` line with research.autonomy `propose`
- **THEN** the proposal stays `pending`

#### Scenario: own skill follows line
- **WHEN** a research-born proposal with thirdParty false touches no manifest on an `auto` line
- **THEN** an autonomous job with autonomy `auto` is created

#### Scenario: diff check
- **WHEN** an autonomous `auto` research-born job's changes touch package.json and research.autonomy is `propose`
- **THEN** the job parks at `before-integrate` instead of integrating

### Requirement: Briefing reports autonomous work
The `Turno nocturno` section of the briefing SHALL list separately the proposals left for the owner, the jobs the night shift opened on its own that are built and waiting for approval, and the jobs it integrated or deployed on its own.

#### Scenario: three groups
- **WHEN** in the period there is one pending proposal, one `build` job waiting at before-integrate and one `auto` job delivered
- **THEN** the briefing body shows each under its own heading (propuesto / construido solo / integrado solo)

### Requirement: Panel proposals tab
The control panel SHALL have a "Propuestas" page at `/proposals`, linked from its navigation, that shows each line's night-shift autonomy and its proposals grouped by stage: pending, being built (approved with a job not finished), delivered, ended without delivery, and rejected. Each proposal SHALL show its issue link when published, its research note when it has one, and the owner's reason when rejected. Pending proposals and proposals whose night-shift job waits at `before-integrate` SHALL have approve and reject buttons, which act through `approveProposal` and `rejectProposal`. Approving MUST ask for confirmation first: the first press only shows a confirmation page, and nothing is decided until the owner confirms.

#### Scenario: grouped tab
- **WHEN** a line has a pending proposal with an issue and a research note, a built proposal waiting at before-integrate, a delivered one, and another line has a rejected one with a note
- **THEN** `/proposals` shows each under its stage heading with the issue link, the note id, the rejection reason and each line's autonomy, and only the pending and parked ones have approve buttons

#### Scenario: confirm before approving
- **WHEN** the owner presses approve on a pending proposal
- **THEN** a confirmation page is shown and the proposal stays `pending` with no job, and only after confirming is the proposal `approved` with a job

#### Scenario: reject from the panel
- **WHEN** the owner rejects a built proposal from the panel with a reason
- **THEN** the proposal is `rejected` with that reason and its job is `stopped`

### Requirement: Proposal issues tell who approved
When a proposal mirrored as an issue was approved by the night shift and not by the owner, the issue comment MUST NOT say the owner approved it. It SHALL say the night shift took it on its own and give the line's autonomy.

#### Scenario: autonomous approval comment
- **WHEN** syncProposalIssues tells the issue of an autonomously approved proposal
- **THEN** the comment text does not contain 'El dueño aprobó' and mentions the turno nocturno

### Requirement: README documents the night shift and fallback
README.md SHALL replace 'Turno nocturno (en camino)' with documentation of `nightShift` (`off`, `hours`, global and per-line `autonomy` with propose/build/auto, `maxAutoJobsPerDay`), `research.autonomy`, `zero proposals` and its approve/reject subcommands. It SHALL also document `fallback` (global and per station, engine names or `{engine, model}`).

#### Scenario: readme content
- **WHEN** README.md is read
- **THEN** it contains `maxAutoJobsPerDay`, `autonomy`, `zero proposals` and `fallback`, and does not contain 'Turno nocturno (en camino)'
