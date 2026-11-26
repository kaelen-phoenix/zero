# Spec Delta

## ADDED Requirements

### Requirement: Claude recognises every form of an expired or refused session
The Claude adapter (src/engines/claude.ts) SHALL set `signedOut: true` on a failed call whose text contains, case-insensitively, any of: `Failed to authenticate`, `OAuth session expired`, `OAuth token has expired`, `could not be refreshed`, `invalid_grant`, `API Error: 401` or `401 Unauthorized`. It MUST NOT set it for a call that answered successfully, or for an error that only contains a bare `401` without those words.

#### Scenario: could not be refreshed
- **WHEN** claudeThrown(new Error("Your session could not be refreshed")) is called
- **THEN** the result has ok false and signedOut true

#### Scenario: invalid_grant
- **WHEN** claudeResult is given a result with subtype error_during_execution and errors ["invalid_grant: refresh token revoked"]
- **THEN** the result has ok false and signedOut true

#### Scenario: API 401
- **WHEN** claudeResult is given a result with subtype success, is_error true and result "API Error: 401 {\"type\":\"authentication_error\"}", and separately claudeThrown(new Error("401 Unauthorized")) is called
- **THEN** both results have ok false and signedOut true

#### Scenario: bare number is not a sign-out
- **WHEN** claudeThrown(new Error("wrote 401 lines then socket hang up")) is called
- **THEN** signedOut is not true

#### Scenario: successful answer with the text
- **WHEN** claudeResult is given a result with subtype success, is_error false and result "the log said invalid_grant and API Error: 401"
- **THEN** the result has ok true and signedOut is not true

### Requirement: Each engine knows how a person signs in to it again
src/engines/ MUST export a function `signInHint(engine: string): string | undefined`, in a module with no runtime imports and re-exported from src/engines/index.ts. For `claude` it SHALL return a Spanish instruction that contains `claude` and `/login`, for `codex` one that contains `codex login`, and undefined for any other engine name.

#### Scenario: claude hint
- **WHEN** signInHint("claude") is called
- **THEN** it returns a string containing "`claude`" and "/login"

#### Scenario: codex hint
- **WHEN** signInHint("codex") is called
- **THEN** it returns a string containing "codex login"

#### Scenario: unknown engine
- **WHEN** signInHint("opencode") and signInHint("my-custom") are called
- **THEN** both return undefined

### Requirement: The signed-out pause tells how to sign in again
When the budget (src/budget.ts) pauses an engine because its session expired, the reason MUST keep starting with `falta iniciar sesión en el motor <engine>`. When signInHint(engine) gives an instruction, it SHALL be appended after `: `. The reason MUST still not mention quota, plan or credit. The pause duration (UNKNOWN_RESET_MS) and the rule that a later unmarked call ends it SHALL stay as they are.

#### Scenario: claude reason with hint
- **WHEN** the store holds one agent span of engine claude marked zero.engine.signed_out true that ended 1 minute ago, and the stations' chain is only claude
- **THEN** budgetState reports reached true until 14 minutes later, and a reason that starts with "falta iniciar sesión en el motor claude: ", contains "/login", and does not match /cupo|saldo|suscripción/

#### Scenario: engine without a hint
- **WHEN** the same signed-out span is recorded for a custom engine named "mine" that is the only engine of the chain
- **THEN** the engine's reason is exactly "falta iniciar sesión en el motor mine"

### Requirement: A job whose spec call is refused by an expired session waits and then resumes
When the spec station's only engine answers with one of the newly recognised texts, the line MUST put the job back to `queued` without failing it or spending a try. Once the pause is over and the engine answers normally, the same job SHALL get its spec.

#### Scenario: invalid_grant parks then resumes
- **WHEN** a job runs with engine claude and no fallback, and the fake spec agent answers { ok: false, text: "invalid_grant", signedOut: true }; then the clock moves 16 minutes, the fake spec agent answers normally, and the job is run again
- **THEN** the first runJob returns status queued with no reason starting with "La estación spec no produjo", budgetState's reason contains "/login", and the second run gets past spec with a spec stored
