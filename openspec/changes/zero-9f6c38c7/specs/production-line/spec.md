# Spec Delta

## ADDED Requirements

### Requirement: El motor informa el corte por tope en dólares
EngineResult and AgentRun MUST carry an optional vendor-neutral flag `budgetLimited` that is true when the engine stopped the call because it reached the request's `maxBudgetUsd`. The Claude adapter SHALL set it when the SDK result has subtype `error_max_budget_usd` or its error text contains "Reached maximum budget". In every other case it SHALL leave the flag unset. createAgentRunner SHALL copy the flag from the EngineResult to the AgentRun.

#### Scenario: Resultado de Claude cortado por presupuesto
- **WHEN** the Claude result mapping receives a result message with subtype `error_max_budget_usd` and total_cost_usd 0.42
- **THEN** it returns ok false, budgetLimited true and costUsd 0.42

#### Scenario: Texto de presupuesto de Claude
- **WHEN** the Claude result mapping receives an error result whose text or errors contain "Reached maximum budget"
- **THEN** it returns budgetLimited true

#### Scenario: Otros errores no marcan presupuesto
- **WHEN** the Claude result mapping receives subtype `error_max_turns` or a successful result
- **THEN** budgetLimited is not true

#### Scenario: El runner de agentes propaga la marca
- **WHEN** createAgentRunner runs a fake engine execute that returns {ok:false, text:'Reached maximum budget', budgetLimited:true}
- **THEN** the AgentRun returned has budgetLimited true

### Requirement: Un build cortado por presupuesto no consume intento
When a build call returns budgetLimited true and the job was not aborted, the runner MUST discard the work copy's uncommitted changes. It MUST NOT count the attempt (job.attempt stays at its value before that attempt) and MUST NOT write the "Hacé cambios más chicos y enfocados" feedback or any other feedback for that attempt. It SHALL go straight to the budget-exceeded decision of policy.ts, keeping checkpoint `spec`: at levels where decide(level,'budget-exceeded') is 'ask' the job SHALL wait with a question of kind `budget-exceeded` and data.extraUsd = limits.usdPerJob; where it is 'fail' the job SHALL fail with a reason that mentions the budget ("presupuesto").

#### Scenario: L2 pregunta al dueño
- **WHEN** at L2 a fake build returns {ok:false, text:'Reached maximum budget', budgetLimited:true} on its first call
- **THEN** the job is `waiting` with question.kind `budget-exceeded`, checkpoint `spec`, attempt 0, feedback not containing 'más chicos', and build was called exactly once

#### Scenario: L3 falla por presupuesto sin quemar intentos
- **WHEN** at L3 with maxAttempts 3 a fake build always returns budgetLimited true
- **THEN** the job is `failed` with a reason matching /presupuesto/ (not 'Se agotaron los 3 intentos'), and build was called exactly once

#### Scenario: Aprobar retoma desde la especificación
- **WHEN** the owner approves the budget-exceeded question of that L2 job and the job runs again with a build that now writes valid changes
- **THEN** spec is not called again, the next build call is attempt 1, its prompt contains no 'Feedback from the previous attempt' section, and the job is delivered

### Requirement: No arrancar un intento con presupuesto insuficiente
Before starting a build attempt (or resuming at review/security) whose next engine is not on a subscription, the runner MUST treat the job budget as used up when what remains (budgetUsd + approvals.extraBudgetUsd - billed) is below a minimum of 10% of the job's total cap (budgetUsd + approvals.extraBudgetUsd). In that case it SHALL take the same budget-exceeded path (ask or fail by policy.ts) without calling the agent. Subscription engines SHALL keep starting attempts as today.

#### Scenario: Queda menos del mínimo
- **WHEN** at L2 a job with budgetUsd 1 has already been billed 0.95 by a non-subscription engine and the build loop starts an attempt
- **THEN** build is not called and the job waits with a `budget-exceeded` question

#### Scenario: Queda lo suficiente
- **WHEN** a job with budgetUsd 1 has been billed 0.5 and the build loop starts an attempt
- **THEN** build is called with maxBudgetUsd close to 0.5

#### Scenario: Suscripción no se frena
- **WHEN** the build engine is on a subscription plan and the billed total is above the job budget
- **THEN** build is still called with maxBudgetUsd undefined
