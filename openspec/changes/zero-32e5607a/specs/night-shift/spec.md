# Spec Delta

## Purpose

Cuando el turno nocturno construye por su cuenta una propuesta y la deja esperando antes de integrarla, la pregunta que recibís va a dar el motivo real. Si la línea tiene autonomía `build`, lo sigue diciendo así. Si la línea tiene `auto` pero la propuesta nace de una nota de investigación y `research.autonomy` la limita a `build`, lo dice, para que sepas qué ajuste mirar. Lo mismo pasa con el comentario que la fábrica deja en el issue de la propuesta cuando el turno nocturno la toma: habla de la autonomía de la propuesta y, si no coincide con la de la línea, explica de dónde viene el límite. Nada cambia en lo que la fábrica decide: solo cambia lo que te muestra.

## ADDED Requirements

### Requirement: La espera del turno nocturno nombra la autonomía de la línea solo cuando es la de la línea
When `nightShiftHold` asks before integrating a night-shift job because its autonomy is `build` (the change touches neither legal texts nor, for a research-born proposal, a dependency manifest), the question MUST say `La línea tiene autonomía \`build\`` only when `lineAutonomy` of the job's line is `build`.

#### Scenario: Línea en build
- **WHEN** a line has `nightShift.autonomy: build`, a night-shift job with source autonomy `build` for a proposal without a research note builds and passes verify and review at L3, changing only `src/health.ts`
- **THEN** the job is `waiting` with a `before-integrate` question whose text contains `La línea tiene autonomía \`build\``

#### Scenario: Línea en auto, límite de investigación
- **WHEN** a line has `nightShift.autonomy: auto`, `research.autonomy` is `build`, and a night-shift job with source autonomy `build` for a proposal with a `researchNote` builds and passes, changing only `src/health.ts`
- **THEN** the job is `waiting` with a `before-integrate` question whose text does not contain `La línea tiene autonomía`, and does contain `nota de investigación` and `research.autonomy`

### Requirement: La espera explica el límite de investigación
When the line's autonomy is less strict than the job's `source.autonomy` of `build` and the proposal was born from a research note, the `nightShiftHold` question MUST say that the proposal was born from a research note and that `research.autonomy` limits it to `build`.

#### Scenario: Motivo de investigación
- **WHEN** line autonomy is `auto`, `research.autonomy` is `build`, and a research-born night-shift job with source autonomy `build` reaches integration without touching legal paths or manifests
- **THEN** the question text contains `nota de investigación`, `research.autonomy` and `build`, and still offers `zero proposals approve <id>` and `zero proposals reject <id>`

### Requirement: La espera sin nota de investigación nombra la autonomía de la propuesta
When the job's `source.autonomy` is `build`, the line's current autonomy differs from it and the proposal has no research note, the `nightShiftHold` question MUST state the proposal's autonomy (`build`) and the line's current autonomy instead of saying the line has autonomy `build`.

#### Scenario: La línea cambió después de tomar la propuesta
- **WHEN** a night-shift job with source autonomy `build` for a proposal without a research note runs on a line whose `nightShift.autonomy` is now `auto`
- **THEN** the question text does not contain `La línea tiene autonomía \`build\``, and contains both `build` and `auto`

### Requirement: Los demás motivos de espera no cambian
The legal and manifest reasons of `nightShiftHold` and every decision it takes (whether it asks, `onTimeout: reject`) MUST stay as they are.

#### Scenario: Licencia
- **WHEN** an `auto` night-shift job changes `LICENSE`
- **THEN** it waits at `before-integrate` with `onTimeout: reject` and its text matches `licencia o textos legales`

#### Scenario: Manifiesto
- **WHEN** an `auto` research-born night-shift job changes `package.json` while `research.autonomy` is `build`
- **THEN** it waits at `before-integrate` with `onTimeout: reject` and its text contains `agrega dependencias o servidores de terceros`

### Requirement: El comentario de aprobación habla de la autonomía de la propuesta
The comment `approvalText` posts on a proposal's issue when the night shift took it on its own MUST present the autonomy as the proposal's (`autonomía de la propuesta`) and MUST NOT say `autonomía de la línea`.

#### Scenario: Sin límite
- **WHEN** on a line with `nightShift.autonomy: build`, the night shift takes a proposal without a research note as a job with source autonomy `build`, and `syncProposalIssues` runs
- **THEN** the comment contains `autonomía de la propuesta`, `build`, the job id and `hasta que la persona responsable la apruebe`, does not contain `autonomía de la línea`, and does not mention `research.autonomy`

### Requirement: El comentario de aprobación aclara el límite
When the proposal's autonomy differs from `lineAutonomy` of its line, the `approvalText` comment MUST also state the line's autonomy and, when the proposal has a research note, that `research.autonomy` limits it.

#### Scenario: Con límite de investigación
- **WHEN** on a line with `nightShift.autonomy: auto` and `research.autonomy: build`, the night shift takes a research-born proposal as a job with source autonomy `build`, and `syncProposalIssues` runs
- **THEN** the comment contains `autonomía de la propuesta`, `build`, `auto`, `nota de investigación` and `research.autonomy`, and does not contain `autonomía de la línea`
