# Spec Delta

## ADDED Requirements

### Requirement: Configuración de Linear por línea sin claves
A line MUST accept an optional `linear: { team, label }` block in zero.factory.yaml (`team` is the Linear team key and is required; `label` defaults to `zero`), and the block MUST be strict, so a key such as `apiKey` or `token` inside it SHALL make the factory file invalid.

#### Scenario: Bloque válido
- **WHEN** a line has `linear: { team: ENG }` and the file is parsed
- **THEN** the line's config has `linear.team` equal to `ENG` and `linear.label` equal to `zero`

#### Scenario: Clave en el archivo
- **WHEN** a line has `linear: { team: ENG, apiKey: lin_api_x }` and the file is parsed
- **THEN** parseFactory throws a ConfigError

### Requirement: La clave de Linear sale del almacén de secretos
The Linear intake SHALL read its key only as the secret `LINEAR_API_KEY` through `SecretStore.get` (environment, Docker secret or store). When there is no key it MUST NOT call Linear for that line and SHALL record a problem for that line that names `zero secret set LINEAR_API_KEY`.

#### Scenario: Sin clave
- **WHEN** a line has `linear` configured, no LINEAR_API_KEY is available, and the Linear pass runs with the real-adapter factory
- **THEN** no job is created and the line's Linear problem text in factoryStatus contains `zero secret set LINEAR_API_KEY`

### Requirement: Toma de issues de Linear de personas con permiso
For each line with `linear`, an open issue of the configured team that carries the label SHALL become one job with source `{kind: 'linear-issue', team, id, identifier, url}`, whose request text starts with `Issue <identifier> de Linear: <title>`, only when both the issue's creator and the person who last applied the label are active, non-guest members of that team. An issue that does not meet this MUST NOT become a job; it SHALL get one explanatory comment per labeling instead.

#### Scenario: Issue de un miembro
- **WHEN** the fake Linear API lists issue ENG-7, labeled `zero` and created and labeled by an active non-guest team member, and the Linear pass runs
- **THEN** one job exists with source kind `linear-issue` and identifier `ENG-7`, its request starts with `Issue ENG-7 de Linear:`, and the issue got one comment that names the job id

#### Scenario: Issue de un invitado
- **WHEN** the issue's creator is a guest, or the person who labeled it is not a team member, and the pass runs twice
- **THEN** no job is created and exactly one comment explaining the refusal was posted

#### Scenario: Un trabajo por etiqueta
- **WHEN** the pass runs again while the job is still queued, or after it ended without the label being applied again
- **THEN** no second job is created for that issue

#### Scenario: Volver a pedir
- **WHEN** the job ended and the label was applied again later (a newer label time)
- **THEN** the next pass creates a new job for the issue

### Requirement: El issue de Linear se entera de cómo va
The Linear issue SHALL get a comment once per status of its job: taken, waiting (once per question, with the job id, the expiry and how to answer from the panel or with `zero approve`), failed, stopped and delivered. Every factory comment MUST end with the line's signature (`lineSignature`, through `signText`) when the signature is on.

#### Scenario: Pregunta
- **WHEN** the issue's job is parked waiting on a question and the pass runs twice
- **THEN** exactly one new comment containing the job id and `zero approve` is posted

#### Scenario: Falla
- **WHEN** the job ends failed and the pass runs
- **THEN** one comment containing the job's reason is posted

#### Scenario: Firma
- **WHEN** the factory comments on a Linear issue with the default signature
- **THEN** the comment body ends with the default signature text

### Requirement: Cerrar el issue al entregar
When an issue's job is delivered, the Linear intake SHALL comment the delivery and move the issue to one of its team's workflow states of type `completed`. A failure to move it MUST be retried on later passes without repeating the delivery comment.

#### Scenario: Entrega
- **WHEN** the issue's job reaches `delivered` and the pass runs
- **THEN** the fake API recorded one delivery comment and one call that completes that issue

#### Scenario: Reintento del cierre
- **WHEN** completing the issue throws on the first pass and succeeds on the second
- **THEN** the delivery comment was posted once and the issue was completed on the second pass

### Requirement: Un problema de Linear no frena nada
An error from Linear on one line MUST NOT stop the pass for other lines or the daemon. It SHALL be recorded as that line's Linear problem, and that problem SHALL be cleared after the line's next successful pass.

#### Scenario: Error en una línea
- **WHEN** two lines use Linear, the first line's fake API throws when listing, and the pass runs
- **THEN** the second line's issue becomes a job and factoryStatus shows a problem for the first line only

### Requirement: Estado visible de la entrada de Linear
factoryStatus MUST list every line with `linear` together with its team, label and current problem, and both `formatStatus` and the panel's summary SHALL show a line starting with `Issues de Linear:` for each of them.

#### Scenario: zero status
- **WHEN** a line has `linear: { team: ENG }` and formatStatus runs
- **THEN** the output contains `Issues de Linear:`, the line name, `ENG` and `zero`

### Requirement: El daemon revisa Linear
The daemon SHALL run the Linear intake in the background on the intake interval whenever some line has `linear`, never overlapping two runs, outside the GitHub quota meter and its pauses, and it MUST wait for a running pass before it exits. Tests SHALL be able to inject the Linear adapter through `DaemonOptions`.

#### Scenario: Pasada única
- **WHEN** runDaemon runs with `once` and an injected fake Linear adapter that lists a labeled member issue
- **THEN** a job with source kind `linear-issue` exists after it returns

### Requirement: Documentación y web
README.md and README.es.md MUST each document the Linear intake in a section with the same structure (configuration, the `LINEAR_API_KEY` secret, who counts as having permission, comments and completion on delivery), and the roadmap paragraph MUST mention only Jira, not Linear. In site/index.html, the 'Próximas etapas' item for Linear MUST NOT carry class="soon" and SHALL be marked as available ('disponible'/'available'), while a Jira item SHALL still carry class="soon".

#### Scenario: README en ambos idiomas
- **WHEN** test/docs.test.ts reads both READMEs
- **THEN** both contain `LINEAR_API_KEY` and a `linear:` configuration example, and neither roadmap line mentions Linear

#### Scenario: Web
- **WHEN** test/site.test.ts reads index.html and main.js
- **THEN** no line with class="soon" mentions Linear, a line with class="soon" mentions Jira, the Linear item carries a 'disponible' mark whose EN translation is 'available'
