# Spec Delta

## Purpose

La fábrica gana una estación nueva, `scout`, que trabaja sola cuando no hay nada tuyo en la cola ni en curso. Puede correr a cualquier hora, o solo en el horario de `nightShift.hours` si lo configurás. Mira el código de cada línea, el townhall, las trazas de los últimos 30 días y las specs sin tests, y escribe propuestas de mejora: arreglos, funciones nuevas, simplificaciones, rendimiento, experiencia de uso y deuda técnica. Cada propuesta tiene título, por qué vale la pena, qué cambiaría y un costo estimado, y se guarda en state.db. Nunca propone tocar rutas protegidas ni cosas que pidan credenciales nuevas. Tampoco repite propuestas pendientes, rechazadas o ya aprobadas. Respeta tu reserva de la suscripción (`limits.reservePercent`). Con facturación por uso gasta como máximo `limits.usdPerNight`, que por defecto es $1. Se apaga con `nightShift: off`. Decidís desde la terminal (`zero proposals`, `zero proposals approve <id>`, `zero proposals reject <id> --note "motivo"`) o desde el chat. Aprobar crea un trabajo normal de la línea, marcado como del turno nocturno. Rechazar la archiva. El briefing abre con "Turno nocturno" cuando hay propuestas nuevas. La configuración de autonomía (`nightShift.autonomy` global y por línea: propose, build o auto) y el tope `nightShift.maxAutoJobsPerDay` ya se aceptan en el archivo, así tu configuración (zero y newoman en auto, solilok en propose, tope 3) carga sin errores. En esta parte, igual, todas las propuestas esperan tu decisión. Que se construyan y desplieguen solas, la pestaña "Propuestas" del panel y el README quedan para la parte siguiente.

## ADDED Requirements

### Requirement: Configuración del turno nocturno
The factory config MUST accept `nightShift` as either the string `off` or an object with optional `hours` ("HH:MM-HH:MM", local time, may wrap past midnight), `autonomy` (one of propose, build, auto; default propose) and `maxAutoJobsPerDay` (integer >= 0, default 3). Absent `nightShift` SHALL mean on, with no hours. The config MUST also accept `limits.usdPerNight` (nonnegative, default 1), `stations.scout` (defaults maxTurns 40, timeoutMinutes 15) and an optional per-line `nightShift.autonomy` with the same three values.

#### Scenario: defaults
- **WHEN** parseFactory is called with an empty YAML document
- **THEN** nightShift is on with no hours, autonomy is 'propose', maxAutoJobsPerDay is 3, limits.usdPerNight is 1 and stations.scout has maxTurns 40 and timeoutMinutes 15

#### Scenario: owner config
- **WHEN** parseFactory gets nightShift {maxAutoJobsPerDay: 3}, lines zero and newoman with nightShift.autonomy auto, and solilok with nightShift.autonomy propose
- **THEN** it parses without error and each line's effective autonomy is auto, auto and propose (the line's value, else the global default)

#### Scenario: off
- **WHEN** parseFactory gets `nightShift: off`
- **THEN** config.nightShift equals 'off'

#### Scenario: bad hours
- **WHEN** parseFactory gets nightShift.hours "25:00-08:00" or "tonight"
- **THEN** it throws a ConfigError naming nightShift.hours

#### Scenario: bad autonomy
- **WHEN** a line sets nightShift.autonomy to 'yolo'
- **THEN** parseFactory throws a ConfigError

### Requirement: Horario opcional
A pure helper MUST tell whether a given local time falls inside `nightShift.hours`. A window whose start is later than its end SHALL wrap past midnight. Without hours, every time SHALL be inside, and with `off`, none.

#### Scenario: wrapping window
- **WHEN** hours is "22:00-06:00" and the time is 23:30 or 05:59
- **THEN** it returns true; for 06:00 and 12:00 it returns false

#### Scenario: plain window
- **WHEN** hours is "00:00-08:00" and the time is 07:59
- **THEN** it returns true; for 08:00 it returns false

#### Scenario: no hours
- **WHEN** nightShift has no hours and the time is 15:00
- **THEN** it returns true

#### Scenario: off
- **WHEN** nightShift is 'off'
- **THEN** it returns false at any time

### Requirement: Scout corre solo con la fábrica libre
The daemon SHALL start a scout pass only when all of these hold: nightShift is not off, the current time is inside its hours, there are no queued or running jobs, andon is off and budgetState(...).reached is false. A pass MUST NOT overlap another pass, and the daemon MUST await it on shutdown. Each line SHALL be scouted at most once per period. The period is the current day, or the current window when hours are set. The period is recorded in the kv store.

#### Scenario: idle factory
- **WHEN** scoutPass runs with a fake agent, no jobs and nightShift on
- **THEN** the fake agent is called once per line with station 'scout' and cwd equal to the line's repo

#### Scenario: owner work pending
- **WHEN** a job is queued or running
- **THEN** scoutPass calls no agent

#### Scenario: off
- **WHEN** nightShift is 'off'
- **THEN** scoutPass calls no agent

#### Scenario: outside hours
- **WHEN** hours is "00:00-08:00" and the injected clock reads 12:00
- **THEN** scoutPass calls no agent

#### Scenario: andon
- **WHEN** the andon kv is 'on'
- **THEN** scoutPass calls no agent

#### Scenario: once per period
- **WHEN** scoutPass runs twice in the same period on an idle factory
- **THEN** the agent is called only during the first pass; a pass in the next period calls it again

### Requirement: Límite de gasto del scout
When the scout station's engine (from pickEngine for station 'scout') bills per use, the scout's total cost of agent spans with gen_ai.agent.name 'scout' in the current period MUST stay within `limits.usdPerNight`. A pass SHALL skip lines once that cap is reached and SHALL pass the remaining amount to the agent as maxBudgetUsd. On a subscription, the scout SHALL respect the plan windows and `limits.reservePercent` through budgetState/pickEngine, and SHALL not run when pickEngine reports the chain unavailable.

#### Scenario: night cap reached
- **WHEN** api billing is recorded and scout spans already add up to limits.usdPerNight in the current period
- **THEN** scoutPass calls no agent

#### Scenario: remaining passed
- **WHEN** api billing, usdPerNight 1 and $0.40 already spent by scout this period
- **THEN** the agent request carries maxBudgetUsd 0.6

#### Scenario: subscription reserve
- **WHEN** the scout's engine is a subscription whose window is used past reservePercent
- **THEN** scoutPass calls no agent

### Requirement: Los pedidos del dueño van primero
A running scout pass MUST NOT prevent the daemon from starting the owner's queued jobs in the same loop iteration.

#### Scenario: owner job during scout
- **WHEN** a scout pass is in progress (fake agent blocked on a promise) and the owner queues a job
- **THEN** the daemon starts the owner's job before the scout pass ends

### Requirement: Propuestas guardadas
Scout output MUST be validated against a schema of proposals, each with title, why, change, estimatedUsd (>= 0), paths (string list) and needsNewCredentials (boolean). Accepted proposals SHALL be stored in a `proposals` table in state.db with id, line, title, why, change, estimatedUsd, paths, status 'pending', createdAt, and later decidedAt, note and jobId.

#### Scenario: stored
- **WHEN** the fake scout returns one valid proposal
- **THEN** store.listProposals({line}) returns it with status 'pending' and the same title, why, change and estimatedUsd

#### Scenario: invalid output
- **WHEN** the fake scout returns ok=false or output that fails the schema
- **THEN** no proposal is stored, scoutPass does not throw and the period is still marked as scouted

### Requirement: Filtro de propuestas
zero MUST discard a proposal that touches a path matching `limits.protectedPaths`, that declares needsNewCredentials, or whose normalized title equals that of an existing pending, rejected or approved proposal of the same line. Normalized means case-, accent- and whitespace-insensitive. At most 3 proposals SHALL be stored per line per pass.

#### Scenario: protected path
- **WHEN** a proposal lists paths ['.github/workflows/ci.yml']
- **THEN** it is not stored

#### Scenario: credentials
- **WHEN** a proposal sets needsNewCredentials true
- **THEN** it is not stored

#### Scenario: duplicate
- **WHEN** a rejected proposal titled 'Mejorar Caché' exists and the scout returns 'mejorar cache'
- **THEN** it is not stored

#### Scenario: cap
- **WHEN** the scout returns 5 valid distinct proposals
- **THEN** exactly 3 are stored

### Requirement: Aprobar una propuesta
approveProposal(ctx, id) in app.ts MUST turn a pending proposal into a normal queued job of its line through requestWork, with a request built from title, why and change. The job's source SHALL be `{kind: 'night-shift', proposal: <id>}`, the job span SHALL carry `zero.night_shift` true, and the proposal SHALL become 'approved' with the job id and decidedAt. Unknown or already decided ids MUST fail with a Spanish error.

#### Scenario: approve
- **WHEN** approveProposal is called on a pending proposal
- **THEN** a queued job exists on the proposal's line whose request contains the title, whose source.kind is 'night-shift', and the proposal's status is 'approved' with that jobId

#### Scenario: twice
- **WHEN** approveProposal is called again on the same id
- **THEN** it throws an error in Spanish and no second job is created

#### Scenario: unknown
- **WHEN** approveProposal is called with a nonexistent id
- **THEN** it throws an error in Spanish

### Requirement: Rechazar una propuesta
rejectProposal(ctx, id, note?) MUST set a pending proposal's status to 'rejected' with decidedAt and the optional note. Unknown or already decided ids MUST fail with a Spanish error.

#### Scenario: reject with note
- **WHEN** rejectProposal(id, 'no hace falta') is called on a pending proposal
- **THEN** the proposal's status is 'rejected', its note is 'no hace falta' and no job is created

### Requirement: Terminal y chat
The CLI SHALL offer `zero proposals` (lists pending proposals with id, line, title and estimated cost), `zero proposals approve <id>` and `zero proposals reject <id> [--note "motivo"]`. The MCP server SHALL offer `zero_proposals` (read-only list) and `zero_proposal_decide` (id, decision approve|reject, optional note). Both MUST go through app.ts.

#### Scenario: mcp tools listed
- **WHEN** the MCP server's tool list is read in interface tests
- **THEN** it includes zero_proposals and zero_proposal_decide

#### Scenario: cli reject
- **WHEN** the CLI runs `proposals reject <id> --note motivo` against a test home with a pending proposal
- **THEN** the proposal is rejected with note 'motivo'

### Requirement: Briefing del turno nocturno
When pending proposals were created within the briefing's period, the briefing MUST open with a section titled 'Turno nocturno' that lists them (id, line, title), and jobs whose source is night-shift that finished in the period. Without any, the section SHALL be absent.

#### Scenario: with proposals
- **WHEN** briefing() runs with one pending proposal created today
- **THEN** the first section heading of the body is 'Turno nocturno' and it includes the proposal's title

#### Scenario: without
- **WHEN** briefing() runs with no proposals or night-shift jobs
- **THEN** the body contains no 'Turno nocturno' section

### Requirement: Estación scout de solo lectura
'scout' MUST be an agent station with read access (AGENT_ACCESS 'read', in AGENT_STATIONS) whose instructions live in agents/scout.md, in English. A scout failure (agent error or thrown exception) MUST be logged and MUST NOT stop the daemon or other lines.

#### Scenario: read access
- **WHEN** AGENT_ACCESS.scout is read
- **THEN** it equals 'read' and agents/scout.md exists

#### Scenario: failure isolated
- **WHEN** the fake scout throws on the first line of two
- **THEN** scoutPass resolves and the second line is still scouted
