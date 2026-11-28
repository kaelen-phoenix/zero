# Spec Delta

## Purpose

Hoy `zero simulacro` le da 20 minutos a cada comando de verify, aunque los trabajos normales de esa línea ya usan un límite más largo: el de `verifyTimeoutMinutes` o el aprendido de lo que tardaron las corridas aprobadas. Si la suite tarda más de 20 minutos, el simulacro la corta y dice «las especificaciones no alcanzan». Esa conclusión es falsa, y además ya se pagó la llamada al agente. Con este cambio: - Los comandos de verify del simulacro usan el mismo límite que un trabajo de esa línea. Los de setup siguen con 20 minutos. - El informe dice a cuántos minutos se cortó cada comando y que ese límite se cambia con `verifyTimeoutMinutes` de la línea. - Hay un resultado nuevo, «sin medir». Sale cuando todo lo demás salió bien y lo único que falló fueron comandos de verify cortados por tiempo. Así no se culpa a las especificaciones. - «inválido» sigue teniendo prioridad, y un test que falla de verdad sigue dando «no alcanzan».

## ADDED Requirements

### Requirement: Verify del simulacro con el límite de la línea
`runDrill` MUST run each verify command of the line with the time limit `verifyTimeoutMs(deps.store, line, command, now)`, where `now` is `deps.now?.()` or the current date, and MUST run each setup command with `DRILL_COMMAND_MS` (20 minutes).

#### Scenario: verifyTimeoutMinutes de la línea
- **WHEN** a drill runs on a line with `verifyTimeoutMinutes: 45`, one setup command and one verify command, with no verify history, using a fake `sh` that records `opts.timeoutMs` per command
- **THEN** the verify command gets 45 * 60_000 ms and the setup command gets 20 * 60_000 ms

#### Scenario: Límite aprendido
- **WHEN** the store holds a job of line `demo` and an ok `zero.verify.command` span for that job and the same command line, with `zero.run_ms` equal to 30 minutes and within the last 30 days, and a drill runs on `demo` without `verifyTimeoutMinutes`
- **THEN** the fake `sh` receives `timeoutMs` 60 * 60_000 for that verify command

#### Scenario: Sin historia ni opción
- **WHEN** a drill runs on a line without `verifyTimeoutMinutes` and with no history
- **THEN** the verify command gets 20 * 60_000 ms

### Requirement: Cada comando guarda su límite
Each `DrillCommand` (setup and verify) MUST carry the `timeoutMs` it was run with, also in `resultado.json`. When a command timed out, the report MUST say `cortado a los N minutos`, where N is its own limit rounded to minutes, and MUST name `verifyTimeoutMinutes` as the line's option that changes the limit. It MUST NOT print a fixed 20.

#### Scenario: Texto del corte con el número real
- **WHEN** a drill runs on a line with `verifyTimeoutMinutes: 45` and the fake `sh` answers the verify command with `{ code: 1, timedOut: true }`
- **THEN** `informe.md` contains `cortado a los 45 minutos` and `verifyTimeoutMinutes`, and does not contain `cortado a los 20 minutos`; `resultado.json` has `verify[0].timeoutMs` equal to 2700000

#### Scenario: Límite guardado sin corte
- **WHEN** a drill whose verify passes runs on a line with `verifyTimeoutMinutes: 45`
- **THEN** `r.verify[0].timeoutMs` is 2700000 and the report does not contain `cortado a los`

### Requirement: Resultado «sin medir» cuando verify se corta por tiempo
`DrillOutcome` MUST include `sin medir`. The outcome MUST be `sin medir` only when all of these hold: no test or specification was touched, setup passed, the agent ended ok without hitting its cap, every removed file was rebuilt, at least one verify command ran, at least one verify command failed, and every verify command with a non-zero code has `timedOut` true. Otherwise the existing rules MUST stay as they are: `inválido` first, then `alcanzan`, then `no alcanzan`. A verify command that ends with a non-zero code without `timedOut` MUST keep the outcome at `no alcanzan`, even when another one timed out.

#### Scenario: Corte por tiempo da sin medir
- **WHEN** the agent rebuilds `src/mod.ts` correctly and the fake `sh` answers the only verify command with `{ code: 1, timedOut: true }`
- **THEN** `r.outcome` is `sin medir`, and `resultado.json` has outcome `sin medir`

#### Scenario: Fallo real sigue siendo no alcanzan
- **WHEN** a line has two verify commands, the first answered with `{ code: 1, timedOut: true }` and the second with `{ code: 3, timedOut: false }`
- **THEN** `r.outcome` is `no alcanzan`

#### Scenario: inválido tiene prioridad
- **WHEN** the agent changes `test/mod.test.ts` and the only verify command times out
- **THEN** `r.outcome` is `inválido`

#### Scenario: Sin medir no tapa otros problemas
- **WHEN** the verify command times out but the agent does not rebuild `src/mod.ts` (or the agent ends with `ok: false`, or with `budgetLimited`)
- **THEN** `r.outcome` is `no alcanzan`

### Requirement: El resultado nuevo se explica en español
The report's `Resultado:` line MUST explain `sin medir` in Spanish: the line's tests were cut by their time limit, so the drill does not say whether the specifications are enough, and `verifyTimeoutMinutes` raises the limit. `zero simulacro` MUST print `Resultado: sin medir` for that outcome.

#### Scenario: Informe con sin medir
- **WHEN** a drill ends with outcome `sin medir`
- **THEN** `informe.md` contains `**sin medir**` and `verifyTimeoutMinutes`, and its `Resultado:` line does not contain `no alcanzan`
