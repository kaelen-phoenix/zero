# Spec Delta

## Purpose

Vas a poder decidir las propuestas del turno nocturno desde GitHub, sin abrir la fábrica. En una línea en modo `propose`, si alguien con permiso de escritura le pone la etiqueta `zero` a un issue `zero:propuesta`, la propuesta queda aprobada y se convierte en trabajo. Si alguien con permiso de escritura cierra el issue sin esa etiqueta, la propuesta queda rechazada y el rechazo se anota en el townhall. En las líneas en `build` o `auto`, el issue es solo un registro: la etiqueta y el cierre no deciden nada, y el issue se cierra cuando se entrega el trabajo. Para pull requests ya lo hace el "Closes #n". Para entregas locales (merge o rama), lo cierra la fábrica como completado. Además, cada nota de investigación se publica como issue en el repo de su línea, con la etiqueta `zero:investigacion` (la fábrica la crea si falta) y nunca con `zero`. Antes de publicar se tapan secretos y rutas de tu PC, y se desactivan las menciones (@usuario). El README explica todo esto. Quedan para el próximo trabajo: que `scout` lea los issues sin etiqueta, que aprenda de lo que revertís y la pestaña "Investigación" del panel.

## ADDED Requirements

### Requirement: Aprobar una propuesta desde su issue
For a pending proposal whose effective autonomy (proposalAutonomy) is `propose` and that has a GitHub issue, the proposal sync SHALL approve it through approveProposal when the issue carries the line's work label (line.issues?.label ?? "zero") and the last person who applied that label has write access (TRUSTED permission). The proposal SHALL end with status approved, a jobId and decidedBy 'owner', and the issue SHALL be told once that it was approved from GitHub.

#### Scenario: Etiqueta puesta por alguien con escritura
- **WHEN** a pending proposal on a `propose` line has issue #5, the fake IssueApi reports #5 open with labels [zero:propuesta, zero], and lastLabeled(5,'zero') returns an actor whose permission is 'admin'; syncProposalIssues runs
- **THEN** the proposal is approved with a jobId, the job has source {kind:'night-shift', proposal:<id>}, and exactly one comment is posted on #5

#### Scenario: Una segunda pasada no abre otro trabajo
- **WHEN** syncProposalIssues runs again after the approval above
- **THEN** no new job is created and no further comment is posted on #5

### Requirement: Rechazar una propuesta cerrando su issue
For a pending proposal whose effective autonomy is `propose`, when its issue is closed without the work label by a person with write access, the proposal sync SHALL reject it through rejectProposal with a note saying it was closed on GitHub (so the townhall gets the lesson), SHALL record issueTold 'rejected', and MUST NOT close the issue again.

#### Scenario: Cerrado por alguien con escritura
- **WHEN** the fake IssueApi reports the proposal's issue closed, without the work label, closed by a login with permission 'write'; syncProposalIssues runs
- **THEN** the proposal status is 'rejected' with a non-empty note, issueTold is 'rejected', a townhall lesson 'propuesta rechazada' is published, and the fake records no close() call for that issue

### Requirement: Solo deciden personas con permiso de escritura
The proposal sync MUST NOT approve or reject a proposal from GitHub when the person who applied the work label or closed the issue lacks write access. The proposal SHALL stay pending.

#### Scenario: Etiqueta puesta por un tercero
- **WHEN** the proposal's issue has the work label, applied by a login whose permission is 'read'; syncProposalIssues runs
- **THEN** the proposal stays 'pending' and no job is created

#### Scenario: Cerrado por un tercero
- **WHEN** the proposal's issue is closed without the label by a login whose permission is 'read'; syncProposalIssues runs
- **THEN** the proposal stays 'pending'

### Requirement: En build o auto el issue es un registro
For proposals whose effective autonomy is `build` or `auto`, labels and closing on GitHub MUST NOT decide the proposal. When the job a proposal became is delivered with a mode other than pull-request (merge or branch), the proposal sync SHALL close its issue once as completed. Pull-request deliveries keep closing it through 'Closes #n' in deliveryBody.

#### Scenario: La etiqueta no decide en build
- **WHEN** a pending proposal on a line with nightShift.autonomy 'build' has an issue carrying the work label applied by an admin; syncProposalIssues runs
- **THEN** the proposal stays 'pending'

#### Scenario: Entrega local cierra el issue
- **WHEN** an approved proposal with issue #5 has a job with status 'delivered' and delivery mode 'merge'; syncProposalIssues runs twice
- **THEN** close(5, 'completed') is called exactly once

### Requirement: La entrada de issues no toma issues de propuestas
The issue intake (pollIssues / takeIssues) MUST NOT open a job for an issue that carries the `zero:propuesta` label. Those issues SHALL be decided only by the proposal sync.

#### Scenario: Línea con issues y propuesta etiquetada
- **WHEN** a line with `issues` configured has an open issue labeled both 'zero:propuesta' and 'zero', written and labeled by an admin; pollIssues runs
- **THEN** no job with source kind 'github-issue' is created for that issue

### Requirement: El texto del issue de propuesta explica cómo decidir
The proposal issue body SHALL tell readers how to decide from GitHub on `propose` lines (add the work label to approve, close it without the label to reject). On `build`/`auto` lines it SHALL say that the issue is a record and closes with the delivery.

#### Scenario: Cuerpo en propose
- **WHEN** proposalIssueBody is built for a proposal on a `propose` line
- **THEN** the body mentions the work label `zero` and closing the issue

#### Scenario: Cuerpo en build
- **WHEN** proposalIssueBody is built for a proposal on a `build` line
- **THEN** the body says the issue is a record that closes with the delivery

### Requirement: Cada nota de investigación se publica como issue
For every line whose remote is on GitHub, each research note without an issue SHALL be published once as a GitHub issue labeled only `zero:investigacion`, never with the work label. The factory SHALL create that label first with ensureLabel when there are notes to publish, and SHALL store the issue's number and URL on the note.

#### Scenario: Publica una vez
- **WHEN** a line with a GitHub remote has one research note and syncResearchIssues runs twice
- **THEN** createIssue is called once with labels ['zero:investigacion'], ensureLabel is called with 'zero:investigacion', and getResearchNote returns issueNumber and issueUrl

#### Scenario: Línea sin GitHub
- **WHEN** the line's remote is not GitHub
- **THEN** the api factory is never asked and the note keeps no issue

#### Scenario: Falla de GitHub se reintenta
- **WHEN** createIssue throws on the first pass and succeeds on the second
- **THEN** after the second pass the note has an issueNumber and no exception escaped the first pass

### Requirement: El issue de investigación no expone datos del dueño
The research issue title and body MUST be scrubbed with scrubLocal: secrets redacted, the line's repository path, the owner's home folder and other local paths (Windows drives, /home|/Users, MSYS /c/..., file://) removed. @mentions MUST be broken so they notify nobody. The body SHALL include the findings, what the note serves, its maturity, its http(s) sources, the note id, and how to request work from it (`zero research request <id>`).

#### Scenario: Rutas, secretos y menciones
- **WHEN** a note's findings contain the owner's home path, 'C:\\Users\\x\\secret.txt', a token matched by redact, and '@someone'; the issue is published
- **THEN** the created body contains none of those paths nor the token, and contains no '@someone' substring that GitHub would treat as a mention

#### Scenario: Contenido completo
- **WHEN** a note with two sources is published
- **THEN** the body contains both source URLs, the note id and 'zero research request <id>'

### Requirement: README actualizado
README.md MUST document deciding night-shift proposals from GitHub (label `zero` to approve and close to reject on `propose` lines, issue as record on `build`/`auto`) and the publication of research notes as `zero:investigacion` issues.

#### Scenario: README menciona ambos
- **WHEN** README.md is read
- **THEN** it contains 'zero:propuesta' with an explanation of approving by label and rejecting by closing, and contains 'zero:investigacion'
