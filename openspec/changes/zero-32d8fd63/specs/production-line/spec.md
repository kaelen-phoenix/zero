# Spec Delta

## ADDED Requirements

### Requirement: Saldo de API de OpenAI agotado en una llamada de Codex
When a codex call fails (`ok: false`) and its stderr or the message of its last `error`/`turn.failed` JSONL event contains `insufficient_quota` or `You exceeded your current quota` (case-insensitive), and the session is not known to be a subscription (`codexSession` answered `api` or nothing), the quota reported by the codex engine MUST be `{ billing: "api", windows: [], limited: true }`.

#### Scenario: Evento turn.failed con insufficient_quota
- **WHEN** the exported pure codex quota function receives session `api`, ok `false`, stdout with a `turn.failed` event whose `error.message` is `stream error: insufficient_quota: You exceeded your current quota, please check your plan and billing details` and empty stderr
- **THEN** it returns `{ billing: "api", windows: [], limited: true }`

#### Scenario: Mensaje en stderr
- **WHEN** the function receives session `api`, ok `false`, stdout with no JSON events and stderr `ERROR: You exceeded your current quota, please check your plan and billing details.`
- **THEN** it returns `{ billing: "api", windows: [], limited: true }`

#### Scenario: Evento error de nivel superior
- **WHEN** the function receives session undefined, ok `false`, stdout with an `{"type":"error","message":"insufficient_quota"}` event
- **THEN** it returns `{ billing: "api", windows: [], limited: true }`

### Requirement: Otros resultados de Codex sin cambios
A successful codex call, or a failed one whose stderr and last error event carry neither `insufficient_quota` nor `You exceeded your current quota`, SHALL get the same quota report as before this change: `{ billing: "api", windows: [] }` without `limited` for an `api` session, the existing windows logic for subscriptions and undefined when nothing tells the billing.

#### Scenario: Error común con clave de API
- **WHEN** the function receives session `api`, ok `false` and a `turn.failed` event with message `stream disconnected before completion`
- **THEN** it returns `{ billing: "api", windows: [] }` with no `limited` key

#### Scenario: Llamada exitosa
- **WHEN** the function receives session `api`, ok `true` and stdout with an `agent_message` item whose text mentions `insufficient_quota`
- **THEN** it returns `{ billing: "api", windows: [] }` with no `limited` key

#### Scenario: Suscripción con ventana agotada
- **WHEN** the function receives session `subscription`, ok `false`, windows with one `exhausted` window and no quota text
- **THEN** it returns billing `subscription`, those windows and `limited: true`, as today

#### Scenario: Sin dato de facturación
- **WHEN** the function receives session undefined, no windows, ok `false` and a common error
- **THEN** it returns undefined

### Requirement: El motor Codex pausa en vez de gastar intentos
The codex engine (`codexEngine` and `unsandboxedCodexEngine`) MUST pass the failed call's stderr and JSONL stdout to the quota decision, so that a call refused for lack of credit returns `ok: false` with the limited api quota and `engineBudget` pauses codex for `UNKNOWN_RESET_MS` with the reason `la clave de API se quedó sin saldo`.

#### Scenario: Lectura pausa a codex
- **WHEN** an agent span for engine codex is recorded at 15:00 with `quotaAttrs({ billing: "api", windows: [], limited: true })` and `budgetState` is computed at 15:05 for a factory whose engine is codex
- **THEN** codex is paused until 15:15 with a reason containing `la clave de API se quedó sin saldo`
