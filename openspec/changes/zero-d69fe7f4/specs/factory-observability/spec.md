# Spec Delta

## ADDED Requirements

### Requirement: Exportación OTLP opcional y apagada por defecto
zero SHALL export traces over OTLP/HTTP only when `telemetry.otlp.endpoint` (an http or https URL) is set in zero.factory.yaml. When it is absent, zero MUST NOT send any network request for telemetry.

#### Scenario: Sin configuración no se exporta
- **WHEN** the factory file has no `telemetry` section and a job finishes, then the export pass runs
- **THEN** no HTTP request is made, and `loadFactory` gives a config whose `telemetry.otlp` is undefined

#### Scenario: Endpoint inválido
- **WHEN** `telemetry.otlp.endpoint` is `ftp://x` or a URL with user and password (`https://user:pass@host/v1/traces`)
- **THEN** loading the factory file fails with a Spanish validation error on that path

### Requirement: Credenciales del colector fuera del archivo
Collector headers SHALL be configured as `telemetry.otlp.headers: { <header>: <SECRET_NAME> }`, where each value is a secret name (SECRET_NAME pattern) that is resolved through SecretStore (environment variable first, then the OS keychain). Header values MUST NOT appear in the factory file, argv, logs or state.db.

#### Scenario: Encabezado desde el entorno
- **WHEN** headers is `{ x-honeycomb-team: HONEYCOMB_API_KEY }`, the env var HONEYCOMB_API_KEY is `abc123`, and a job finishes
- **THEN** the fake collector receives a request whose `x-honeycomb-team` header is `abc123`

#### Scenario: Valor literal rechazado
- **WHEN** a header value is not a valid secret name (for example `abc 123` or lowercase `my-key`)
- **THEN** loading the factory file fails with a validation error that tells the owner to store it with the secret command

#### Scenario: Secreto faltante
- **WHEN** the named secret is not in the environment or the keychain
- **THEN** no request is sent, a warning names the missing secret (never a value), and production continues

### Requirement: Trazas OTLP/JSON con jerarquía e IDs válidos
For each finished job, the exporter SHALL POST to the endpoint an OTLP/HTTP JSON body (`Content-Type: application/json`, `resourceSpans` → `scopeSpans` → `spans`) with resource attribute `service.name` = `zero`. It holds every ended span of that job with: a 32-hex `traceId` derived deterministically from the job id and shared by all its spans; a 16-hex non-zero `spanId` derived deterministically from the stored span id (the `job-<id>` root included); `parentSpanId` derived the same way from the stored parent; `name`; `startTimeUnixNano`/`endTimeUnixNano` as decimal strings; status code 1 for ok and 2 for error; and the span's attributes as OTLP key/values (stringValue, intValue as string, doubleValue, boolValue).

#### Scenario: Jerarquía preservada
- **WHEN** a job with a job span, a station span and an agent span finishes and the export pass runs against the fake collector
- **THEN** the received body has 3 spans with one traceId matching /^[0-9a-f]{32}$/, spanIds matching /^[0-9a-f]{16}$/, the station's parentSpanId equals the job span's spanId and the agent's parentSpanId equals the station's spanId

#### Scenario: IDs estables
- **WHEN** the OTLP body is built twice for the same job
- **THEN** traceId and spanIds are identical both times

#### Scenario: Atributos GenAI
- **WHEN** an agent span has `gen_ai.agent.name`=`build`, `zero.cost.usd`=0.25 and status error
- **THEN** the exported span carries those attributes with stringValue and doubleValue, and status.code 2

### Requirement: Sin secretos ni rutas locales en lo exportado
Before export, every string attribute value and the error message MUST be scrubbed: secrets redacted with `redact`, and the line's repository path, the owner's home directory and other local absolute paths replaced, the same way `scrubLocal` does for published notes.

#### Scenario: Secreto y ruta en atributos
- **WHEN** a span's `error.message` contains `sk-ant-` followed by 30 characters and `process.command_line` contains the line's repo path and the home directory
- **THEN** the exported body contains neither the key nor the repo path nor the home directory, and it contains `[REDACTED]`

### Requirement: Exportar nunca frena ni rompe la producción
Export SHALL run in the daemon as its own background pass. Passes never overlap. Each request has a timeout of 10 seconds or less. Every error is logged and swallowed. A failed batch is retried at most 5 times with growing delays and then skipped with a warning. Pending work is read from state.db through a cursor stored in kv (finished jobs after the cursor, at most a fixed number of jobs per request), so memory does not grow with the collector's downtime. When export is first enabled, the cursor starts at that moment: past jobs are not backfilled.

#### Scenario: Colector caído
- **WHEN** the endpoint points to a closed port, or the fake collector answers 500, and the export pass runs
- **THEN** the pass resolves without throwing, a warning is logged, the cursor does not advance and the job's spans are still in state.db

#### Scenario: Recuperación
- **WHEN** the collector answered 500 once and then answers 200 on the next pass after the backoff
- **THEN** the job is exported once and the cursor advances past it

#### Scenario: Reintento acotado
- **WHEN** the collector fails 5 consecutive times for the same batch
- **THEN** the cursor advances past that batch, a warning is logged and the next batch is attempted on later passes

#### Scenario: Colector lento
- **WHEN** the fake collector never answers
- **THEN** the request is aborted at the timeout and the pass resolves

#### Scenario: Sin reenvío
- **WHEN** a job was exported successfully and the pass runs again
- **THEN** the collector receives no second request for that job

### Requirement: Documentación y sitio
README.md and README.es.md SHALL document how to enable OTLP export (a YAML example with endpoint and headers as secret names, behaviour on failure, scrubbing), with the same structure and identical code blocks, and SHALL drop OTLP from 'Next steps'/'Próximas etapas'. The site MUST NOT list 'Exportación de trazas por OTLP' as 'en camino' and SHALL mention OTLP export as available in Spanish (markup) and English (main.js EN).

#### Scenario: README bilingüe
- **WHEN** test/docs.test.ts runs
- **THEN** it passes, both READMEs mention `telemetry` and `otlp` in the observability section, and neither next-steps line contains 'OTLP'

#### Scenario: Sitio actualizado
- **WHEN** test/site.test.ts runs
- **THEN** no line of site/index.html with `class="soon"` contains 'OTLP', the key `next.otlp` is gone, and the `workflow.trace` text mentions OTLP both in index.html and in EN of main.js
