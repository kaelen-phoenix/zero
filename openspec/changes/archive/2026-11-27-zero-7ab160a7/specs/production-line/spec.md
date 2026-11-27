# Spec Delta

## ADDED Requirements

### Requirement: Claude reports an expired session with a neutral signal
The Claude adapter (src/engines/claude.ts) SHALL set `signedOut: true` on the EngineResult of a failed call (a thrown SDK error, a non-success result's errors, or a result with `is_error`) whose text contains `Failed to authenticate` or `OAuth session expired`/`OAuth token has expired` (case-insensitive), and MUST NOT set it on a call that answered successfully, whatever its text says.

#### Scenario: thrown expired session
- **WHEN** claudeThrown(new Error("Failed to authenticate: OAuth session expired and could not be refreshed")) is called
- **THEN** the result has ok false, signedOut true, and no quota with limited true

#### Scenario: error result with the text
- **WHEN** claudeResult is given a result with subtype success, is_error true and result "Failed to authenticate. API Error: 401", or subtype error_during_execution with errors ["OAuth session expired"]
- **THEN** the result has ok false and signedOut true

#### Scenario: successful answer containing the text
- **WHEN** claudeResult is given a result with subtype success, is_error false and result "the log said Failed to authenticate: OAuth session expired"
- **THEN** the result has ok true and signedOut is not true

#### Scenario: other errors
- **WHEN** claudeThrown(new Error("socket hang up")) is called
- **THEN** signedOut is not true

### Requirement: The signed-out mark reaches the agent run and its span
The agent runner (src/agent.ts) MUST carry `EngineResult.signedOut` to `AgentRun.signedOut` and record `zero.engine.signed_out: true` on the call's `gen_ai.invoke_agent` span, and SHALL record nothing extra when the engine did not report it.

#### Scenario: span attribute
- **WHEN** createAgentRunner runs with an execute that returns { ok: false, text: "Failed to authenticate", signedOut: true } and a tracer
- **THEN** the AgentRun has signedOut true and the agent span has attribute zero.engine.signed_out true

#### Scenario: no attribute otherwise
- **WHEN** the execute returns { ok: true, text: "done" }
- **THEN** the agent span has no zero.engine.signed_out attribute and the AgentRun has no signedOut

### Requirement: A signed-out engine is paused for a bounded wait with a sign-in reason
The budget (src/budget.ts) SHALL pause an engine whose latest agent call on this machine is marked signed out, until UNKNOWN_RESET_MS (15 minutes) after that call ended. The reason MUST be in Spanish and say that you need to sign in to that engine (for example `falta iniciar sesión en el motor claude`), and MUST NOT mention quota, plan or credit. A later call of that engine without the mark SHALL end the pause.

#### Scenario: paused after a signed-out call
- **WHEN** the store holds one agent span of engine claude marked zero.engine.signed_out true that ended 1 minute ago, and the line stations' chain is only claude
- **THEN** budgetState reports reached true, until about 14 minutes later, and a reason that contains "iniciar sesión" and contains neither "cupo", "saldo" nor "suscripción"

#### Scenario: pause expires
- **WHEN** the same span ended 16 minutes ago
- **THEN** pickEngine for spec returns claude with available true

#### Scenario: later success clears it
- **WHEN** after the signed-out span there is a later agent span of claude without the mark
- **THEN** the claude engine is not paused

### Requirement: A signed-out call goes on with a replacement
When a station's call comes back signed out and its chain has another engine that is not paused, the runner MUST go on with that replacement in the same try or attempt, exactly as it does for a call refused by quota, without spending a try or attempt.

#### Scenario: spec with replacement
- **WHEN** a job runs with engine claude and fallback [codex], and the fake spec agent answers its first call with { ok: false, text: "Failed to authenticate", signedOut: true } and then normally
- **THEN** the spec station's second call goes to engine codex with replaces claude, and the job continues past spec (it is delivered with passing verify)

### Requirement: A signed-out call without replacement sends the job back to the queue without spending tries
When a call comes back signed out and no other engine of the chain is available, the runner SHALL put the job back to `queued` at the same station, without consuming a spec try or a build attempt and without failing the job, as it does for `quota.limited`.

#### Scenario: spec without replacement
- **WHEN** a job runs with engine claude and no fallback, and the fake spec agent always answers { ok: false, text: "Failed to authenticate: OAuth session expired", signedOut: true }
- **THEN** runJob returns status queued (not failed), the spec agent was called exactly once, the job has no reason starting with "La estación spec no produjo", and budgetState(...).reached is true with a reason about signing in

#### Scenario: build without replacement
- **WHEN** the fake build agent answers { ok: false, text: "Failed to authenticate", signedOut: true } on its first call
- **THEN** runJob returns status queued, the job's attempt is back to its value before that build attempt, and the zero.attempt span ends with an error

#### Scenario: resumes after the wait
- **WHEN** the job from the spec scenario is run again after the clock moves 16 minutes and the fake spec agent now answers normally
- **THEN** the job continues past spec and gets a spec

### Requirement: A failed job without a spec can be retried from the start
`retryJob` (src/app.ts) SHALL accept a failed job without a spec whose reason does not start with SPEC_REFUSAL. It MUST put that job back to `queued` from the beginning: attempt 0, checkpoint `none`, no station, stagesDone 0, and no feedback, finishedAt, worktree, base or branch. It MUST also set stopRequested to false and drop the job's network and locked-folder retry counters. It SHALL return kind `queued`.

#### Scenario: retry without spec
- **WHEN** retryJob is called on a failed job with no spec, attempt 2, station spec and reason "La estación spec no produjo una especificación válida: Failed to authenticate"
- **THEN** it returns kind queued and the job has status queued, attempt 0, checkpoint none, no station, no finishedAt and no feedback

#### Scenario: spec refusal still refused
- **WHEN** retryJob is called on a failed job with no spec whose reason starts with SPEC_REFUSAL
- **THEN** it throws the current error containing "sin especificación" and the job is unchanged

#### Scenario: existing rules kept
- **WHEN** retryJob is called on a failed job with a spec, a stopped job, or a job with a pending cleanup
- **THEN** the behaviour is the same as before (from its checkpoint, "solo se reintenta", "no se pudo borrar")
