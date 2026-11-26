# Spec Delta

## Purpose

Vas a tener un revisor de rendimiento para las apps que construye la fábrica, y funciona con cualquier motor: 1) Zero trae su propia skill `zero:performance`: una lista de controles armada desde fuentes oficiales (web.dev, Next.js, PostgreSQL, Django, Rails, Express, entre otras). Cada control dice cómo detectarlo en el código, cómo arreglarlo y de qué fuente sale: consultas sin paginar o sin índice, N+1, falta de caché, estáticos sin CDN, imágenes sin optimizar, un solo paquete de JavaScript, trabajo pesado dentro de la respuesta en vez de en una cola, y otros. 2) La estación build tiene una regla nueva para no introducir esos problemas. En las líneas con el revisor activado, además recibe la skill. 3) Se activa por línea con `performance: true`. Desde ahí, un revisor de solo lectura mira cada cambio después de review y security. Solo frena los problemas graves de los que está seguro (high o critical, con confianza 8 o más). Lo demás va como una sección «Rendimiento» en el pull request, con el archivo, la línea y el arreglo concreto. 4) Una auditoría a demanda por línea (`zero rendimiento <línea>`) revisa el código actual con la misma lista y deja propuestas ordenadas por impacto. Esas propuestas siempre esperan tu aprobación: no se construye nada sin que vos digas que sí.

## ADDED Requirements

### Requirement: Built-in performance skill
Zero SHALL ship a skill at `skills/performance/SKILL.md` of its own installation, available to every engine as `zero:performance` alongside the owner's personal, plugin and package skills.

#### Scenario: listed among available skills
- **WHEN** availableSkills is called with no personal, plugin or package skills
- **THEN** the result contains a skill with fullName `zero:performance`, source `zero` and a non-empty description

#### Scenario: resolves by full name
- **WHEN** resolveSkill('zero:performance', availableSkills(config)) is called
- **THEN** it returns that skill and no problem

#### Scenario: reaches engines without native skills
- **WHEN** an agent run assigned `zero:performance` uses an engine without nativeSkills
- **THEN** the instructions the engine receives contain the text of the skill's SKILL.md after the station's instructions

### Requirement: Checklist content
The performance skill MUST list each control with an identifier, how to detect it in code, how to fix it and at least one https source on an official documentation domain, and MUST cover at least: unpaginated queries, missing indexes, N+1 queries, missing caching, static assets without a CDN or cache headers, unoptimized images, a single JavaScript bundle without code splitting, and heavy work inside the request instead of a background queue.

#### Scenario: every control complete
- **WHEN** a test parses skills/performance/SKILL.md into its controls
- **THEN** every control has a non-empty detection, fix and at least one https source

#### Scenario: required controls present
- **WHEN** a test looks for the required topics in the skill
- **THEN** each of the eight required topics appears as a control

#### Scenario: official sources only
- **WHEN** a test collects the source URLs of the skill
- **THEN** every host is on an allowlist of official documentation domains (e.g. web.dev, developer.mozilla.org, nextjs.org, react.dev, www.postgresql.org, docs.djangoproject.com, guides.rubyonrails.org, expressjs.com, nodejs.org, vite.dev, developer.chrome.com)

### Requirement: Build rule
The build station's instructions (`agents/build.md`) SHALL include a rule telling it not to introduce the known performance problems (unpaginated or unindexed queries, N+1, heavy work in the request, unoptimized assets, single bundle) when it writes application code.

#### Scenario: rule present
- **WHEN** a test reads agents/build.md
- **THEN** it contains a rule naming pagination, N+1 queries and background work

### Requirement: Build gets the skill on performance lines
On a line with `performance: true`, the build station MUST receive the `zero:performance` skill in addition to its assigned skills, and on other lines it MUST NOT.

#### Scenario: performance line
- **WHEN** assignedSkills(config, 'build', line) is called for a line with performance: true
- **THEN** the list contains `zero:performance` once, after the configured skills

#### Scenario: other line
- **WHEN** assignedSkills(config, 'build', line) is called for a line without performance
- **THEN** the list does not contain `zero:performance`

### Requirement: Line option
The factory file SHALL accept an optional boolean `performance` per line; absent means off, and a custom agent named `performance` MUST be refused on a line that has it on, or globally when any line has it on.

#### Scenario: parses
- **WHEN** parseFactory reads a line with `performance: true`
- **THEN** the line config has performance true and other lines leave it undefined

#### Scenario: name clash refused
- **WHEN** parseFactory reads a line with performance: true and a line agent named `performance`
- **THEN** parsing fails with an issue on that agent's name

### Requirement: Performance reviewer runs on activated lines
On a line with `performance: true`, lineAgents SHALL include a built-in read-only review agent named `performance`, blocking, with the `zero:performance` skill, whose instructions zero reads from `agents/performance.md` of its own installation (never from the work copy). It runs after security and before the other custom review agents.

#### Scenario: included and ordered
- **WHEN** lineAgents is called for a line with performance: true and one custom reviewer
- **THEN** the `performance` agent (type review, access read, blocking, origin zero, skills ['zero:performance']) comes before the custom reviewer

#### Scenario: not included elsewhere
- **WHEN** lineAgents is called for a line without performance
- **THEN** no agent named `performance` is returned

#### Scenario: runs in the job
- **WHEN** runJob runs a job on a performance line with fake agents
- **THEN** a review call with custom name `performance`, access read and the instructions of agents/performance.md is made after security

### Requirement: Only serious problems block
The performance reviewer's findings MUST block the change only when zero's existing rule says so (verified citation, severity high or critical and confidence 8 or more). Every other verified finding MUST NOT reject the attempt.

#### Scenario: serious blocks
- **WHEN** the fake performance reviewer returns a verified critical finding with confidence 9
- **THEN** the attempt fails with feedback naming `performance`, the file and line and the fix

#### Scenario: minor passes
- **WHEN** it returns only a verified medium finding, or a high finding with confidence 6
- **THEN** the job goes on to integration without another attempt

### Requirement: Non-blocking findings in the pull request
When a job on a pull-request line is delivered, the pull request body SHALL contain a `## Rendimiento` section listing each verified non-blocking finding of the performance reviewer's last passing run as severity, `file:line`, problem and fix, cleaned like other published text; without such findings the section MUST be absent.

#### Scenario: section present
- **WHEN** the passing performance review returned a verified medium finding on src/db.ts line 3 and the job is delivered as a pull request
- **THEN** the body passed to openPullRequest contains `## Rendimiento` and `src/db.ts:3` with the problem and the fix

#### Scenario: invalid citations dropped
- **WHEN** a finding cites a file that does not exist
- **THEN** it is not in the body

#### Scenario: no findings
- **WHEN** the performance reviewer returned no findings, or the line has no performance option
- **THEN** the body has no `## Rendimiento` section

### Requirement: On-demand audit request
Zero SHALL let the person in charge ask for a performance audit of one line (`requestPerformanceAudit`, behind `zero rendimiento <línea>`), refusing with a reason and writing nothing when one is already pending, the andon is on, the budget is reached, or the line is unknown or a package's; at most one pending in the factory.

#### Scenario: accepted
- **WHEN** requestPerformanceAudit(ctx, 'web') is called with nothing pending
- **THEN** it returns ok with requestedAt and a kv request naming the line is stored

#### Scenario: refused
- **WHEN** it is called again while the first is pending, or with the andon on, or for an unknown line
- **THEN** it returns ok false with a Spanish reason and the kv is unchanged

### Requirement: Audit leaves proposals ordered by impact
The daemon's audit pass MUST run one read-only agent on the line's repository with the `zero:performance` skill and store what it finds as pending proposals with origin `performance`, sorted from high to low impact, at most a fixed number per audit, skipping titles already taken and protected paths, each with the impact, the control, the files and the concrete fix.

#### Scenario: sorted proposals
- **WHEN** the fake audit agent returns proposals with impacts low, high, medium
- **THEN** the line's new proposals are stored in the order high, medium, low with origin performance and status pending, and each `why` names its impact

#### Scenario: duplicates and protected paths dropped
- **WHEN** one returned proposal repeats an existing title and another touches a protected path
- **THEN** neither is stored

#### Scenario: request cleared and recorded
- **WHEN** the pass runs a pending request
- **THEN** the kv request is removed and a run record with startedAt, endedAt, outcome and number of proposals is stored

#### Scenario: read-only
- **WHEN** the fake audit agent writes a file in the repository
- **THEN** the agent call is made with access read, like other read-only calls

### Requirement: Audit never builds without approval
Proposals with origin `performance` MUST always wait for the person in charge: proposalAutonomy SHALL return `propose` for them whatever the line's autonomy, so takeOnItsOwn never opens a job from them.

#### Scenario: auto line still waits
- **WHEN** an audit stores a proposal on a line whose night-shift autonomy is auto
- **THEN** the proposal stays pending and no job is created
