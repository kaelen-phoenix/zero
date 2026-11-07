# Spec Delta

## ADDED Requirements

### Requirement: Configuración de Jira por línea sin credenciales
A line MUST be able to declare `jira: { site, project, label }` in zero.factory.yaml (label defaults to "zero"; site MUST be an https URL with no credentials and no path; project MUST be a Jira project key). The block SHALL be strict, so any other key, such as a token, email or password, makes the file invalid.

#### Scenario: Bloque válido
- **WHEN** parseFactory reads a line with `jira: { site: "https://acme.atlassian.net", project: "ABC" }`
- **THEN** the line's jira config has label "zero", site "https://acme.atlassian.net" and project "ABC"

#### Scenario: Credencial en el archivo
- **WHEN** parseFactory reads a line whose jira block also has `token: "x"` (or `email`)
- **THEN** it throws a ConfigError naming the jira path

#### Scenario: Sitio inseguro
- **WHEN** the site is `http://acme.atlassian.net` or `https://user:pw@acme.atlassian.net`
- **THEN** parseFactory throws a ConfigError

### Requirement: Credenciales desde el almacén de secretos
The Jira intake MUST read its credentials only through the factory's SecretStore under the names JIRA_EMAIL and JIRA_API_TOKEN. When either one is missing it SHALL make no Jira request for that line and SHALL record a problem for the line that names both secrets and `zero secret set`, without the values.

#### Scenario: Faltan credenciales
- **WHEN** a Jira pass runs for a line with `jira` and the store has no JIRA_API_TOKEN
- **THEN** the injected API factory is not called for that line, and factoryStatus shows a Jira problem for the line mentioning JIRA_EMAIL, JIRA_API_TOKEN and `zero secret set`

#### Scenario: Credenciales presentes
- **WHEN** both secrets are in the store
- **THEN** the API factory receives the line's site and the stored email and token, and the problem is cleared after a successful pass

### Requirement: Issues etiquetados como pedidos
For each line with `jira`, every pass SHALL list the project's not-done issues carrying the label and SHALL turn each eligible one into a job through requestWork with source `{kind: "jira-issue", site, key, url}`. The request text SHALL start with `Issue <KEY> de Jira: <summary>`, followed by the description and capped like GitHub's. An issue SHALL have at most one unfinished job at a time, and after its job ends only a label applied later SHALL request it again.

#### Scenario: Toma un issue
- **WHEN** a fake Jira lists ABC-1, created and labeled by an account with edit permission
- **THEN** one job is queued on the line with source kind jira-issue and key ABC-1, its request starts with "Issue ABC-1 de Jira:", and the issue gets a comment naming the job id

#### Scenario: No duplica
- **WHEN** the pass runs again while that job is queued or running
- **THEN** no second job is created and no new 'taken' comment is posted

#### Scenario: Volver a pedir
- **WHEN** the job failed and the pass runs again with the same label time, and then with a later label time in the changelog
- **THEN** the first pass creates no job and the second creates a new one

### Requirement: Solo issues de personas con permiso (a06d29b4)
The Jira intake MUST take an issue only when its creator, the account that last applied the label and every account that changed its summary or description (according to the changelog) have the EDIT_ISSUES permission in the project. Otherwise it SHALL create no job, SHALL comment once that says who lacks permission and why, and SHALL record the label time so the same label is not judged again. An error while checking a permission MUST NOT count as a refusal: the pass fails for that line and records a problem.

#### Scenario: Autor sin permiso
- **WHEN** the creator lacks EDIT_ISSUES and the labeler has it
- **THEN** no job is created and one comment explains that the factory only takes issues created and labeled by people with permission

#### Scenario: Descripción editada por alguien sin permiso
- **WHEN** creator and labeler are trusted but the changelog shows a description change by an untrusted account
- **THEN** no job is created and a refusal comment is posted

#### Scenario: Falla la consulta de permisos
- **WHEN** the permission check throws
- **THEN** no job and no refusal comment are created, and the line's Jira problem is recorded

### Requirement: El issue de Jira muestra su trabajo
The Jira intake SHALL post on the issue the same status updates as the GitHub intake (waiting for an answer, delivered, failed, stopped), once per status and once per question, reusing the shared report texts. Those texts SHALL NOT invite answering by commenting on the issue, since the factory does not read Jira comments. Each comment SHALL end with the line's signature text when the signature is on.

#### Scenario: Pregunta
- **WHEN** the job of ABC-1 is waiting with a question and the pass runs twice
- **THEN** exactly one comment with the question is posted, and it does not contain "comentando acá"

#### Scenario: Fallo
- **WHEN** the job fails
- **THEN** one comment with the reason is posted

#### Scenario: Firma
- **WHEN** the line's signature is on and the factory comments
- **THEN** the comment ends with the signature text

### Requirement: Cerrar al entregar
When a Jira-born job is delivered, the intake SHALL comment on the issue what was delivered and SHALL move the issue to a status in Jira's done category through one of its available transitions. When no such transition exists, the issue MUST stay as it is and a problem SHALL be recorded for the line, without stopping other issues or lines.

#### Scenario: Entrega
- **WHEN** the job of ABC-1 is delivered and the fake offers a transition to a done-category status
- **THEN** a delivery comment is posted and that transition is applied once

#### Scenario: Sin transición final
- **WHEN** no transition leads to the done category
- **THEN** no transition is applied, the delivery comment is still posted once, and factoryStatus shows a Jira problem for the line

### Requirement: Estado, informe y traza muestran Jira
factoryStatus MUST list each line with `jira` (site, project, label and any problem), and formatStatus and the panel summary SHALL show it as a line starting with `Issues de Jira:`. The monthly report's origin label SHALL say `Issue de Jira <KEY>`, and the job span SHALL carry `zero.source` with the issue URL.

#### Scenario: Estado
- **WHEN** a line has jira project ABC with label zero
- **THEN** formatStatus output contains a line starting with "Issues de Jira:" naming the line, ABC and "zero"

#### Scenario: Informe
- **WHEN** a delivered job with source jira-issue ABC-7 is in a monthly report
- **THEN** its origin reads "Issue de Jira ABC-7"

#### Scenario: Traza
- **WHEN** requestWork receives a jira-issue source
- **THEN** the zero.job span has attribute zero.source equal to the issue URL

### Requirement: Pasada propia del daemon
The daemon SHALL poll Jira in its own background pass, on the same interval as the GitHub intake and only when some line has `jira`. The pass MUST NOT overlap itself, MUST NOT use the GitHub meter, and SHALL be awaited before the daemon exits. One line's error MUST NOT stop the other lines.

#### Scenario: Una pasada en once
- **WHEN** runDaemon runs with once and an injected fake Jira API for a line with jira and a labeled trusted issue
- **THEN** the job is created and the daemon returns after the pass has finished

#### Scenario: Error aislado
- **WHEN** the fake throws for line A and works for line B
- **THEN** line B's issue becomes a job and line A has a recorded Jira problem

### Requirement: Documentación y web
README.md and README.es.md MUST each have a Jira issues section, with the same structure and code blocks in both, covering the jira block, the two secrets, the permission rule, the comments and closing on delivery. The next-steps lines SHALL keep Linear and no longer mention Jira. On the site, the roadmap item `next.intake` MUST say only Linear ("Pedidos desde Linear" / "Requests from Linear") and stay "en camino", and the workflow text `workflow.request` SHALL say in both languages that requests also come from GitHub and Jira issues.

#### Scenario: Web
- **WHEN** test/site.test.ts reads site/index.html and site/main.js
- **THEN** no line with class="soon" contains "Jira", the next.intake line still has class="soon" and says Linear, and both the Spanish and English workflow.request texts contain "Jira"

#### Scenario: README
- **WHEN** test/docs.test.ts compares README.md and README.es.md
- **THEN** both have a Jira section with the same code blocks, and the next-steps line of each mentions Linear and not Jira
