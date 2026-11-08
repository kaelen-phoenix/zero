# Spec Delta

## ADDED Requirements

### Requirement: Saldo de API agotado en el resultado de Claude
When a Claude SDK result is an error (`is_error: true` on a success subtype, or a non-success subtype) and its result text or any of its `errors` contains `Credit balance is too low`, `claudeResult` MUST return `ok: false` with `quota` equal to `{ billing: "api", windows: [], limited: true }`, replacing any other quota passed in.

#### Scenario: Resultado con is_error y saldo agotado
- **WHEN** `claudeResult` receives a result with subtype `success`, `is_error: true` and `result: "Credit balance is too low"`
- **THEN** the returned value has `ok: false` and `quota` equal to `{ billing: "api", windows: [], limited: true }`

#### Scenario: Resultado con errors y saldo agotado
- **WHEN** `claudeResult` receives a result with subtype `error_during_execution` and `errors: ["Credit balance is too low · Add funds"]`
- **THEN** the returned value has `ok: false` and `quota.limited` is `true` with `billing: "api"`

#### Scenario: Otro error no marca saldo
- **WHEN** `claudeResult` receives a result with `is_error: true` and `result: "something else broke"` and no quota
- **THEN** the returned value has `ok: false` and no `quota` with `limited: true`

### Requirement: Saldo de API agotado como excepción de Claude
When the Claude SDK query throws an error whose message contains `Credit balance is too low` (and the call was neither cancelled nor timed out), the claude engine MUST return `ok: false` with the error text and `quota` equal to `{ billing: "api", windows: [], limited: true }`; other thrown errors SHALL keep returning no `limited` quota.

#### Scenario: Excepción con saldo agotado
- **WHEN** the function that turns a thrown SDK error into an EngineResult receives `new Error("Credit balance is too low")`
- **THEN** the result has `ok: false`, `text` containing `Credit balance is too low` and `quota` equal to `{ billing: "api", windows: [], limited: true }`

#### Scenario: Otra excepción
- **WHEN** the same function receives `new Error("socket hang up")`
- **THEN** the result has `ok: false` and no `quota.limited`

### Requirement: Pausa del motor por uso sin saldo
`engineBudget` in src/budget.ts MUST pause an engine whose latest reading has billing `api` and `limited: true` until `UNKNOWN_RESET_MS` (15 minutes) after that reading, with `billing: "api"`, `paused: true`, `until` at that time and the reason `la clave de API se quedó sin saldo`. After that time it SHALL fall back to the existing daily dollar cap check.

#### Scenario: Recién rechazada
- **WHEN** an agent span for engine claude is recorded at 15:00 with `quotaAttrs({ billing: "api", windows: [], limited: true })` and `budgetState` is computed at 15:05 with no other spend
- **THEN** the result has `reached: true`, `until` equal to 15:15 of that day (ISO) and a reason containing `la clave de API se quedó sin saldo`

#### Scenario: Pasada la pausa
- **WHEN** the same reading and `budgetState` is computed at 15:16
- **THEN** `reached` is `false`

#### Scenario: Tope diario intacto
- **WHEN** readings with `billing: "api"` without `limited` add up to `limits.usdPerDay`
- **THEN** the engine is still paused with the reason `se alcanzó el límite de gasto del día`

#### Scenario: El respaldo toma la estación
- **WHEN** claude's latest reading is `{ billing: "api", windows: [], limited: true }` five minutes ago and the factory has `fallback: [codex]` with codex unpaused
- **THEN** `budgetState` is not reached and reports the replacement `{ engine: "claude", with: "codex" }`, and `pickEngine` for a station on claude returns codex

### Requirement: El intento no se gasta por saldo agotado
When the build call of a job returns a Claude result marked as out of API credit (`quota.limited: true`) and no replacement engine is available, the runner MUST interrupt the job for quota (the existing `quotaStop`) instead of counting a failed attempt, so the job resumes from the same station later.

#### Scenario: Build sin saldo
- **WHEN** runJob runs with a fake build agent that returns `ok: false`, text `Credit balance is too low` and `quota: { billing: "api", windows: [], limited: true }`, with no fallback engine
- **THEN** the job is not finished as failed, its attempts count stays at 0 and it is left to resume (quota interruption), as the existing test for a subscription refusal shows
