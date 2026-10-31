# Spec Delta

## Purpose

Ahora podés marcar una skill de investigación como "de negocio" en la configuración de la línea. Por ejemplo, para investigar-monetizacion: `lines[].stations.research.business: [investigar-monetizacion]`. Las notas de esa skill quedan marcadas como de negocio. Toda propuesta que scout saque de ellas espera tu decisión, aunque la línea esté en `auto` o `build`. Además, el turno nocturno nunca cambia solo la licencia ni agrega precios, cobros, pagos o textos legales. Si scout marca así una propuesta, o si la propuesta o el trabajo tocan LICENSE, archivos de licencia o textos legales (términos, privacidad, EULA, carpeta legal), te espera. Si el trabajo ya se construyó, no se integra sin vos. Cuando una línea tiene varias skills de investigación, research ahora escribe hasta `research.perLinePerDay` notas por cada skill, y no por línea. Si el presupuesto no alcanza para todas, se turnan: primero la que hace más tiempo que no investiga. Así la de negocio no le quita el día a la técnica. El informe y la pestaña Investigación del panel muestran por separado las notas de negocio y las técnicas. El README explica todo esto.

## ADDED Requirements

### Requirement: Business research skills in the line config
The line-level research station config SHALL accept an optional `business` list of skill names (`lines[].stations.research.business`, default empty). A research skill of the line whose exact name is in that list is a business skill. Names in `business` that are not among the line's research `skills` MUST be ignored, not rejected, so removing a skill with `zero skill remove` never breaks the config. The other stations' line config MUST still refuse a `business` key.

#### Scenario: business list parses
- **WHEN** a factory file has a line with `stations.research: { skills: [investigar-zero, investigar-monetizacion], business: [investigar-monetizacion] }`
- **THEN** loadConfig/FactorySchema accepts it and exposes `business: ['investigar-monetizacion']` on that line's research config

#### Scenario: default empty
- **WHEN** a line's research config has only `skills`
- **THEN** its `business` list is `[]`

#### Scenario: unknown business name tolerated
- **WHEN** `business` names a skill that is not in `skills`
- **THEN** the config parses and that name marks nothing as business

#### Scenario: other stations refuse it
- **WHEN** a line has `stations.scout: { skills: [x], business: [x] }`
- **THEN** config parsing fails

### Requirement: Notes record their skill and business kind
Every research note SHALL be stored with the research skill whose run produced it (`skill`) and a `business` boolean. `business` MUST be true exactly when that skill was a business skill of the line at write time. Notes stored before this change MUST read back with `business` false and no skill.

#### Scenario: business note
- **WHEN** researchPass runs the line's business skill and the fake agent returns one valid note
- **THEN** the stored note has `skill` equal to that skill name and `business: true`

#### Scenario: technical note
- **WHEN** researchPass runs a non-business skill and stores a note
- **THEN** the note has that `skill` and `business: false`

#### Scenario: old database
- **WHEN** a state.db whose research_notes table lacks the new columns is opened
- **THEN** the columns are added and existing notes read back with `business: false`

### Requirement: Research quota per skill, rotating
researchPass SHALL treat each (line, research skill) pair as its own unit. Each pair gets at most one run per local day and keeps at most `research.perLinePerDay` notes per local day of its own (counted by line and skill). Each run's prompt MUST name the single skill to follow. Pairs MUST run least recently researched first, tracked per pair, so a pass cut short by budget, owner work or andon starts the next day with the skills that were skipped.

#### Scenario: one quota per skill
- **WHEN** a line has two research skills, perLinePerDay is 1, and the fake agent returns 2 notes per run
- **THEN** after one pass the line has 2 notes for the day, one per skill, and the agent was called twice, each prompt naming a different skill

#### Scenario: same skill not rerun
- **WHEN** researchPass runs twice on the same day
- **THEN** the second pass makes no research calls

#### Scenario: rotation when the cap runs out
- **WHEN** on per-use billing, limits.usdPerNight covers only one research call (the fake agent spends its whole cap), and passes run on two consecutive days
- **THEN** the first day researches one skill and the second day researches the other skill first

### Requirement: Business-born proposals always wait for the owner
A proposal that scout links to a business research note SHALL be stored as business-born, and its `proposalAutonomy` MUST be `propose` whatever the line's autonomy or `research.autonomy`. scout MUST NOT approve it on its own, `promotePending` MUST NOT promote it, and it stays pending until the owner decides.

#### Scenario: auto line still waits
- **WHEN** a line with nightShift autonomy `auto` (and research.autonomy `auto`) gets a scout proposal whose researchNote is a business note of that line
- **THEN** the proposal stays `pending`, no job is opened, and proposalAutonomy returns `propose`

#### Scenario: technical note unaffected
- **WHEN** the same proposal cites a non-business note and adds nothing third-party
- **THEN** the night shift takes it on its own as before

#### Scenario: not promoted
- **WHEN** a pending business-born proposal exists and the line's autonomy is raised to `build`
- **THEN** promotePending leaves it pending

### Requirement: License, pricing, payments and legal text always wait for the owner
scout's output SHALL carry a `commercial` boolean (default false) meaning the change alters the license or adds pricing, charges, payments or legal text. zero SHALL also recognise license and legal files by path on its own (`touchesLegal` in policy.ts): LICENSE/LICENCE/COPYING/NOTICE files, any file name containing `license` or `licence`, TERMS, PRIVACY and EULA files, `terms-of-service`/`privacy-policy` files, and anything under a `legal/` directory, case-insensitively. A proposal flagged `commercial`, or whose paths match `touchesLegal`, MUST get autonomy `propose`. An autonomous night-shift job whose changed files match `touchesLegal` MUST be held at before-integrate with onTimeout `reject`, whatever its autonomy, and the question MUST say it touches the license or legal texts.

#### Scenario: scout flag
- **WHEN** an `auto` line gets a scout proposal with `commercial: true`
- **THEN** it stays pending and no job is opened

#### Scenario: license path
- **WHEN** an `auto` line gets a proposal whose paths include `LICENSE`
- **THEN** it stays pending

#### Scenario: legal paths recognised
- **WHEN** touchesLegal is called with each of `LICENSE.md`, `docs/legal/terms.md`, `PRIVACY.md`, `src/licenses.ts`, `COPYING`
- **THEN** it returns true for each, and false for `src/app.ts` and `README.md`

#### Scenario: runner hold on changed files
- **WHEN** an `auto` night-shift job whose proposal listed only `src/x.ts` ends up changing `LICENSE`, and verify and review pass
- **THEN** the job waits for the owner at before-integrate with onTimeout `reject`, the branch is not integrated, and the question text mentions the license or legal texts

### Requirement: Scout sees which notes are business
scout's prompt SHALL mark each business research note as business and SHALL explain that proposals born from it, and any proposal that changes the license or adds pricing, charges, payments or legal text, wait for the owner. The prompt MUST also explain when to set `commercial`.

#### Scenario: prompt marks business notes
- **WHEN** scoutLine runs on a line with one business note and one technical note
- **THEN** the captured prompt labels the business note as business and the technical one not, and mentions the `commercial` flag

### Requirement: Briefing separates business and technical research
The briefing's "Investigación de hoy" section SHALL list business notes and technical notes under separate subheadings ("Negocio" and "Técnica"), each only when it has notes.

#### Scenario: both kinds
- **WHEN** the day has one business note and one technical note
- **THEN** the briefing text has a "Negocio" subheading followed by the business note's topic and a "Técnica" subheading followed by the technical note's topic

#### Scenario: only technical
- **WHEN** the day has only technical notes
- **THEN** there is no "Negocio" subheading

### Requirement: Panel research tab separates business and technical notes
The panel's Investigación tab SHALL show, within each line, business notes and technical notes in separate groups titled "Negocio" and "Técnica". Each note card MUST name the skill that produced it when known.

#### Scenario: grouped
- **WHEN** GET /research is requested with one business and one technical note on a line
- **THEN** the HTML has a "Negocio" group containing the business note's topic and a "Técnica" group containing the technical note's topic, and each card shows its skill name

### Requirement: README documents it
README.md (the only README, in Spanish) MUST document the `business` list of the line's research config, the per-skill note quota with rotation, that business-born proposals and license/pricing/payments/legal changes always wait for the owner, and the business/technical split in the briefing and the Investigación tab.

#### Scenario: readme text
- **WHEN** README.md is read in a test
- **THEN** it contains `business:` inside the research config example, the words "por cada skill", and "de negocio"
