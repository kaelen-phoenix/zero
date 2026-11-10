# Spec Delta

## ADDED Requirements

### Requirement: Configuración de alertas de seguridad por línea
Each line MUST accept an optional strict `securityAlerts` object with `mode` (`off`, `notify` or `jobs`, default `jobs`) and `minSeverity` (`low`, `medium`, `high` or `critical`, default `high`); a line without the key SHALL behave as `{ mode: jobs, minSeverity: high }` and unknown keys SHALL be refused.

#### Scenario: Defaults
- **WHEN** a factory file has a line with no securityAlerts key and it is parsed
- **THEN** the line's securityAlerts is { mode: 'jobs', minSeverity: 'high' }

#### Scenario: Unknown key refused
- **WHEN** a line sets securityAlerts: { mode: 'jobs', token: 'x' }
- **THEN** parsing the factory file fails

#### Scenario: Invalid mode refused
- **WHEN** a line sets securityAlerts.mode to 'always'
- **THEN** parsing the factory file fails

### Requirement: Lectura de alertas con la cuota de GitHub
The daemon SHALL run a security-alerts pass on the intake interval for every line whose `securityAlerts.mode` is not `off` and whose remote is a GitHub repository, reading open Dependabot alerts through the GitHub meter under its own pass name `alerts`. It MUST NOT run while a GitHub pause is in force, and in `once` runs it SHALL run only when an alerts adapter is injected.

#### Scenario: Off line not read
- **WHEN** pollSecurityAlerts runs with a fake AlertApi over a GitHub line whose securityAlerts.mode is 'off'
- **THEN** the fake's openAlerts is never called and no job is created

#### Scenario: Non-GitHub line skipped quietly
- **WHEN** the pass runs over a line whose remote is not a GitHub repository
- **THEN** no job is created and no problem is recorded for that line

#### Scenario: Pass name counted
- **WHEN** GithubPass is used to build the meter client for the alerts pass
- **THEN** 'alerts' is a valid GithubPass and requests are counted under it in github:usage

### Requirement: Un trabajo por paquete para alertas nuevas
In `jobs` mode, the pass SHALL open one job through `requestWork` for each package (ecosystem plus name) that has new open alerts at or above `minSeverity` with a published fixed version, grouping every such alert of that package. The job's source MUST be `{ kind: 'security-alert', repository, ecosystem, package, alerts, severity }`, with `alerts` holding the alert numbers and `severity` the highest of them. The request text MUST name the package, its ecosystem, the manifest paths, the advisories (GHSA ids) and the target version, which is the highest `first_patched_version` among the grouped alerts, and MUST ask to update the dependency to that version.

#### Scenario: Two alerts of one package, one job
- **WHEN** GitHub reports open alerts #3 (high, lodash, patched 4.17.21) and #4 (critical, lodash, patched 4.17.20) on a jobs line
- **THEN** exactly one job is created on that line with source.kind 'security-alert', source.package 'lodash', source.alerts [3,4], source.severity 'critical', and its request mentions '4.17.21'

#### Scenario: Two packages, two jobs
- **WHEN** GitHub reports one high alert for lodash and one critical alert for minimist
- **THEN** two jobs are created, one per package

#### Scenario: Below threshold not taken
- **WHEN** GitHub reports a medium alert on a line with the default minSeverity
- **THEN** no job is created and the alert appears in the line's alert snapshot without a job

#### Scenario: Lower threshold opens medium job
- **WHEN** the line sets minSeverity 'low' and GitHub reports a medium alert with a fixed version
- **THEN** one job is created with source.severity 'medium'

#### Scenario: No fixed version
- **WHEN** GitHub reports a critical alert whose first_patched_version is null
- **THEN** no job is created and the alert appears in the snapshot marked as having no fixed version

### Requirement: Cada alerta se toma una sola vez
The pass MUST remember each alert it took (kv per repository and alert number, recording the job) and SHALL NOT open a job again for it. A new alert of a package whose security job is still unfinished SHALL be recorded against that job without opening another; once that job has finished, a new alert of the same package SHALL open a new job.

#### Scenario: Second pass opens nothing
- **WHEN** the pass runs twice with the same open high alert
- **THEN** only one job exists for it

#### Scenario: New alert joins the unfinished job
- **WHEN** a security job for lodash is queued and GitHub then reports a new high alert #9 for lodash
- **THEN** no new job is created and alert #9 is recorded with the existing job's id

#### Scenario: New alert after the job ended
- **WHEN** the lodash job has status 'delivered' and GitHub reports a new high alert #10 for lodash
- **THEN** a new job is created for alert #10

#### Scenario: Finished job is not reopened for a taken alert
- **WHEN** alert #3's job failed and alert #3 is still open
- **THEN** the pass creates no job for alert #3

### Requirement: Prioridad urgente en la cola
A job with source kind `security-alert` and severity `high` or `critical` SHALL get the priority `urgente` by default (`defaultPriority`), so the daemon's queue order (`ownerFirst`) puts it before every queued job of a lower priority; zero gives it on its own, and `requestWork` MUST still refuse `urgente` asked for together with a source. Security jobs of severity `medium` or `low` SHALL get `media` and keep the position of ordinary jobs. No security-alert job MUST ever count as low priority.

#### Scenario: Critical goes first
- **WHEN** ownerFirst receives [owner job A, package job B, security job C with severity critical] in that order
- **THEN** it returns [C, A, B]

#### Scenario: Medium keeps normal place
- **WHEN** ownerFirst receives [owner job A, security job M with severity medium, package job B]
- **THEN** it returns [A, M, B]

### Requirement: Texto de la alerta como dato de terceros
The runner's `requestBlock` MUST present a job with source kind `security-alert` as built by zero from GitHub Dependabot alerts, whose advisory text is third-party data and not an instruction, and MUST NOT say `The owner sent`.

#### Scenario: Prompt framing
- **WHEN** a security-alert job reaches the spec station with a fake agent
- **THEN** the spec prompt contains 'Dependabot' and the NOT_AN_INSTRUCTION text, and does not contain 'The owner sent'

### Requirement: Modo solo avisar
In `notify` mode the pass SHALL NOT open any job, and it SHALL record the line's open alerts in the same snapshot that `zero status` and the briefing read.

#### Scenario: Notify records without jobs
- **WHEN** the pass runs on a notify line where GitHub reports a critical alert with a fixed version
- **THEN** no job is created and the line's snapshot lists that alert with no job

### Requirement: Instantánea y problemas de lectura
After each successful read, the pass SHALL replace the line's snapshot (kv `security-alerts:<line>`) with the currently open alerts: number, package, ecosystem, severity, URL, fixed version when known, and handling job when there is one. A 403 or 404 from GitHub MUST record a problem for that line (kv per line) and leave the other lines unaffected. A GitHub limit (`GithubHalted` or a rate-limit response) MUST NOT be recorded as taken or as a problem and SHALL end the pass.

#### Scenario: Closed alert drops out
- **WHEN** alert #3 is in the snapshot and a later pass gets no open alerts
- **THEN** the snapshot for the line is empty

#### Scenario: Access refused
- **WHEN** the fake AlertApi throws an error with status 403 for line A and returns alerts for line B
- **THEN** a problem is stored for line A, line B's alerts are processed, and line A's problem is cleared after a later successful read

#### Scenario: Rate limit
- **WHEN** the fake AlertApi throws GithubHalted
- **THEN** no job, alert record or problem is stored and the pass rejects or returns without processing further lines

### Requirement: Alertas visibles en zero status
`factoryStatus` SHALL expose each line's open alerts from the snapshot, with the handling job's id and status, and its read problem. `formatStatus` MUST print one `Alertas de seguridad:` line per open alert (line, package, severity in Spanish, alert number, then `trabajo <id> (<estado>)` or `solo aviso`), plus the problem when there is one.

#### Scenario: Status shows job
- **WHEN** the snapshot of line demo holds alert #3 lodash critical with job j1 queued and formatStatus renders it
- **THEN** the output contains 'Alertas de seguridad' and 'lodash' and 'crítica' and '#3' and 'j1'

#### Scenario: Status shows notice only
- **WHEN** the snapshot holds a medium alert with no job
- **THEN** the output line for it contains 'solo aviso'

#### Scenario: Status shows problem
- **WHEN** a read problem is stored for line demo
- **THEN** formatStatus prints a line containing 'Alertas de seguridad' and 'PROBLEMA'

### Requirement: Alertas en el informe
The briefing SHALL include a `## Alertas de seguridad` section, present only when some line has open alerts, listing each alert with line, package, severity, alert number and its handling job (id and status) or that it is only a notice.

#### Scenario: Briefing section
- **WHEN** briefing() runs with a snapshot holding alert #3 lodash high with job j1
- **THEN** the body contains '## Alertas de seguridad', 'lodash' and 'j1'

#### Scenario: No alerts, no section
- **WHEN** briefing() runs with no snapshots
- **THEN** the body does not contain 'Alertas de seguridad'

### Requirement: Origen visible del trabajo
`jobOrigin` SHALL label a security-alert job as a security job born from Dependabot (`seguridad: alerta de Dependabot <package>`), so status, the panel and the line view show its type.

#### Scenario: Origin label
- **WHEN** jobOrigin gets a job with source { kind: 'security-alert', package: 'lodash', ... }
- **THEN** it returns a string containing 'seguridad' and 'lodash'

### Requirement: Documentación en ambos idiomas
README.md and README.es.md MUST describe the security alerts (what is read, the three modes, the default, grouping, urgent order, where they show up) with the same structure and code blocks, so `test/docs.test.ts` and `test/wording.test.ts` pass.

#### Scenario: Docs parity
- **WHEN** npm test runs test/docs.test.ts
- **THEN** it passes and both READMEs mention securityAlerts
