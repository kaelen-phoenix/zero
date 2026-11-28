# Spec Delta

## ADDED Requirements

### Requirement: La caja marca el corte por tiempo
Cuando `runInBox` devuelve `timedOut: true` (y no `cancelled`) para una llamada de motor, el `execute` del ejecutor de la caja SHALL devolver `ok: false`, `timedOut: true` y el texto actual `la caja superó el tiempo límite (<n> min)`, donde n es `Math.round(req.timeoutMs / 60_000)`.

#### Scenario: La caja vence el tiempo
- **WHEN** un `runInBox` simulado (vi.mock de ../src/box/run.js) devuelve `{ code: 137, stdout: '', stderr: '', timedOut: true, cancelled: false }` y se llama a `box.execute` con `timeoutMs` 2_700_000
- **THEN** el resultado es exactamente `{ ok: false, text: 'la caja superó el tiempo límite (45 min)', timedOut: true }`

#### Scenario: El agentRunner de la caja pasa la marca
- **WHEN** el mismo `runInBox` simulado vence el tiempo y se usa `box.agentRunner(config)` para una estación
- **THEN** el `AgentRun` tiene `ok: false` y `timedOut: true`

### Requirement: Solo el corte por tiempo lleva la marca
El `execute` del ejecutor de la caja MUST NOT poner `timedOut` cuando la corrida se canceló, cuando falla la puerta de salida o cuando la caja termina con un código distinto de cero sin pasarse del tiempo.

#### Scenario: Cancelación
- **WHEN** `runInBox` simulado devuelve `cancelled: true` y `timedOut: false`
- **THEN** el resultado es `{ ok: false, text: 'cancelled' }` sin la propiedad `timedOut`

#### Scenario: Salida con error sin corte
- **WHEN** `runInBox` simulado devuelve `code` 1, `timedOut: false`, sin línea ZERO-RESULT
- **THEN** el resultado tiene `ok: false`, un texto con `la caja terminó con código 1` y no tiene la propiedad `timedOut`

### Requirement: Build en la caja recibe el aviso de límite de tiempo
Cuando la corrida de build que se hizo con el ejecutor de la caja vence el tiempo, el feedback del intento siguiente SHALL ser el de límite de tiempo (`llegó al límite de N minutos`, `sin commitear`, `continuá desde ahí`), y MUST NOT incluir `terminó de forma anormal` ni `Hacé cambios más chicos y enfocados`.

#### Scenario: Primer build cortado por la caja
- **WHEN** un trabajo con `stations.build.timeoutMinutes` 45 corre build con el agentRunner del ejecutor de la caja, el `runInBox` simulado escribe un archivo en la copia y vence el tiempo en el primer build, y en el segundo devuelve un ZERO-RESULT ok
- **THEN** el prompt del segundo build contiene `límite de 45 minutos`, `sin commitear` y `continuá desde ahí`, y no contiene `terminó de forma anormal` ni `Hacé cambios más chicos y enfocados`
