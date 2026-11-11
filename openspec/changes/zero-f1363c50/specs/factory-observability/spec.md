# Spec Delta

## ADDED Requirements

### Requirement: Servicios por línea en el archivo de la fábrica
Each line in the factory file MUST accept an optional, strict `services` section with optional entries `github` (`account`, `type` user|organization defaulting to user, `repository` owner/repo; all optional, with account and repository derived from the line's GitHub remote when absent), `vercel` (`project` required, `team` optional) and `supabase` (`project` ref required, `organization` slug optional). Any other key, such as a token, SHALL be rejected by the schema.

#### Scenario: Servicios válidos
- **WHEN** a line declares `services: { github: {}, vercel: { project: prj_1, team: team_1 }, supabase: { project: abcd } }`
- **THEN** the factory file loads and the line's config exposes those three services

#### Scenario: Token en el archivo
- **WHEN** a line declares `services: { vercel: { project: prj_1, token: x } }` or an unknown service key
- **THEN** loading the factory file fails with a schema error

#### Scenario: Sin sección
- **WHEN** a line has no `services` key
- **THEN** the file loads exactly as before and the line has no services

### Requirement: Lectura diaria de facturación y guardado en el store
The daemon SHALL run a background billing pass on the intake interval. For each line and configured service, the pass SHALL read the service's usage at most once per local day (kv mark set before the call), for the current month and, while its record is missing or was read before the current month began, for the previous month. It SHALL store each result in kv as a JSON record keyed by line, service and month, with source, read date, status, optional cost in USD and figures. It MUST NOT run in `once` runs unless a billing reader is injected.

#### Scenario: Una vez por día
- **WHEN** the pass runs twice on the same local day with a fake reader for a line with `vercel` configured
- **THEN** the fake reader is called once and the record for the current month is stored with its `readAt`

#### Scenario: Día siguiente
- **WHEN** the pass runs again on the next local day
- **THEN** the reader is called again and the record is replaced

#### Scenario: Cierre del mes anterior
- **WHEN** the stored record for the previous month was read before the current month began
- **THEN** the pass reads the previous month as well, and does not read it again once a record read in the current month exists

### Requirement: Sin dato en vez de error
When a service's token is missing, the service fails or times out (10 s per request), answers non-2xx, or its answer does not give the cost, the pass MUST store that service as `sin dato` with a fixed reason chosen by code. The pass and the report SHALL never throw because of it, never invent a number, and never put the token or the raw response in the record or the logs.

#### Scenario: Falta el token
- **WHEN** `VERCEL_TOKEN` is not in the SecretStore and the pass runs
- **THEN** the stored record has status `sin-dato`, no cost, and the report shows Vercel as "sin dato"

#### Scenario: Servicio caído
- **WHEN** the fake fetch answers 500 or rejects
- **THEN** the record is `sin-dato`, the pass continues with the next service and the log line contains no token value

#### Scenario: Sin costo por proyecto
- **WHEN** the Vercel charges answer has no records attributed to any project
- **THEN** the record has no cost and the report shows its cost as "sin dato"

### Requirement: GitHub Actions por repositorio
The GitHub adapter SHALL read GitHub's billing usage API (`/users/{account}/settings/billing/usage` or `/organizations/{account}/settings/billing/usage` with year and month) using the secret `GITHUB_BILLING_TOKEN` or, when absent, the factory's GitHub token. It SHALL keep only Actions items whose `repositoryName` matches the line's repository (case-insensitive) and MUST report gross minutes, gross USD, USD covered by included usage (discount) and billed USD (net, used as the cost).

#### Scenario: Filtrado por repositorio
- **WHEN** the fake API returns Actions items for `acme/tienda` (gross 10, discount 8, net 2, 500 minutes) and for `acme/otro`
- **THEN** the record shows 500 minutes, $10.00 gross, $8.00 covered by the plan, $2.00 billed, and cost 2

#### Scenario: Organización
- **WHEN** the line declares `github: { account: acme, type: organization }`
- **THEN** the adapter requests the organizations billing usage path

### Requirement: Vercel y Supabase
The Vercel adapter SHALL read the project's charges for the month from Vercel's API with `VERCEL_TOKEN` (and `teamId` when configured), summing the billed cost of the records attributed to the configured project. The Supabase adapter SHALL read the project and its organization's plan, plus any usage the Management API gives, with `SUPABASE_ACCESS_TOKEN`. When the API does not give a cost, Supabase's cost MUST stay absent ("sin dato").

#### Scenario: Vercel con costo
- **WHEN** the fake charges answer has two records for project `prj_1` with billed costs 3.5 and 1.25 and one for another project
- **THEN** the record's cost is 4.75

#### Scenario: Supabase plan sin costo
- **WHEN** the fake Management API answers the project and an organization with plan `pro`
- **THEN** the record shows the plan `pro` as a figure and has no cost

### Requirement: Sección de servicios en el informe
For a line with configured services, `buildLineReport` SHALL add a "Servicios" section, in Markdown, HTML, the panel and the chat. It SHALL list each service with its figures, its source, its read date (AAAA-MM-DD, local) and "sin dato" when there is no record or cost. It SHALL also add a "Total del mes (fábrica + servicios)" row that adds the factory's month cost and the known service costs, naming the services left out as "sin dato". The report MUST read only stored data: no API calls, no model calls, no writes. Every stored text MUST pass through `reportText`. Lines without services SHALL render exactly as before.

#### Scenario: Total con todos los datos
- **WHEN** a line's month has factory cost $5.00 and stored records GitHub Actions $2.00 and Vercel $4.75
- **THEN** the report shows each service with its source and date, and the total $11.75

#### Scenario: Total parcial
- **WHEN** Supabase is configured but its record has no cost
- **THEN** the total adds only known costs and says Supabase is "sin dato"

#### Scenario: Sin registro todavía
- **WHEN** a service is configured but no record exists for the month
- **THEN** that service shows "sin dato" and the report does not throw

#### Scenario: Línea sin servicios
- **WHEN** a line has no `services`
- **THEN** reportMarkdown output is identical to the current output (no Servicios section, no total row)

#### Scenario: Solo lectura
- **WHEN** monthlyReport is called with a fake fetch that fails the test if called
- **THEN** the report is produced and fetch is never called and the kv is unchanged

### Requirement: Documentación en los dos idiomas (f1363c50)
README.md and README.es.md MUST document the `services` section, the secrets per service, the daily read and "sin dato", with the same structure and code blocks.

#### Scenario: Tests de documentación
- **WHEN** test/docs.test.ts and test/wording.test.ts run
- **THEN** they pass
