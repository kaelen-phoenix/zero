# Spec Delta

## ADDED Requirements

### Requirement: Modelo informado por el motor Claude
El motor Claude SHALL informar como `model` de su `EngineResult` la clave de `modelUsage` del mensaje de resultado cuando hay una sola, tanto en resultados de éxito como de error.

#### Scenario: Un solo modelo en un resultado exitoso
- **WHEN** `claudeResult` recibe un resultado `success` con `modelUsage` igual a `{ "claude-opus-5-5": { costUSD: 0.4 } }`
- **THEN** el resultado tiene `model` igual a `claude-opus-5-5`

#### Scenario: Un solo modelo en un resultado de error
- **WHEN** `claudeResult` recibe un resultado `error_max_turns` con `modelUsage` igual a `{ "claude-sonnet-5-5": { costUSD: 0.1 } }`
- **THEN** el resultado tiene `ok` en false y `model` igual a `claude-sonnet-5-5`

### Requirement: Modelo de mayor costo cuando hubo varios
Cuando `modelUsage` tiene varias claves, el motor Claude MUST informar como `model` la de mayor `costUSD`.

#### Scenario: Varios modelos con costos distintos
- **WHEN** `claudeResult` recibe `modelUsage` igual a `{ "claude-haiku-5-5": { costUSD: 0.01 }, "claude-opus-5-5": { costUSD: 0.9 }, "claude-sonnet-5-5": { costUSD: 0.2 } }`
- **THEN** el resultado tiene `model` igual a `claude-opus-5-5`

### Requirement: Sin modelo cuando no hay modelUsage
Cuando el mensaje de resultado no trae `modelUsage` o lo trae vacío, el motor Claude MUST devolver su `EngineResult` sin `model` y sin fallar.

#### Scenario: Resultado sin modelUsage
- **WHEN** `claudeResult` recibe un resultado `success` sin el campo `modelUsage`
- **THEN** el resultado tiene `ok` en true y `model` es undefined

#### Scenario: modelUsage vacío
- **WHEN** `claudeResult` recibe un resultado `success` con `modelUsage` igual a `{}`
- **THEN** el resultado tiene `ok` en true y `model` es undefined

### Requirement: Modelo de respuesta en la traza
Cada llamada a un agente SHALL registrar `gen_ai.response.model` en su span al cerrarlo cuando el motor informó `model`, sin alterar `gen_ai.request.model`, y MUST omitir ese atributo cuando el motor no lo informó.

#### Scenario: Motor que informa el modelo
- **WHEN** `createAgentRunner` corre una estación configurada con el modelo `claude-sonnet-5-5` y el ejecutor devuelve `model` igual a `claude-opus-5-5`
- **THEN** el span de agente tiene `gen_ai.request.model` igual a `claude-sonnet-5-5` y `gen_ai.response.model` igual a `claude-opus-5-5`

#### Scenario: Motor que no informa el modelo
- **WHEN** `createAgentRunner` corre una estación y el ejecutor devuelve un resultado sin `model`
- **THEN** el span de agente se cierra sin el atributo `gen_ai.response.model`

#### Scenario: Llamada fallida que informa el modelo
- **WHEN** el ejecutor devuelve `ok` en false con `model` igual a `claude-opus-5-5`
- **THEN** el span de agente se cierra con estado `error` y `gen_ai.response.model` igual a `claude-opus-5-5`

### Requirement: Aviso en el log cuando el modelo difiere
Cuando zero pidió un modelo y el motor informó uno distinto, el runner de agentes SHALL escribir una línea con `log.info` que incluya el modelo pedido y el que respondió, y MUST NOT escribirla si coinciden, si no se pidió modelo o si el motor no informó ninguno.

#### Scenario: Modelos distintos
- **WHEN** la estación pide `claude-sonnet-5-5` y el ejecutor devuelve `model` igual a `claude-opus-5-5`
- **THEN** `log.info` recibe una llamada cuyos campos incluyen `claude-sonnet-5-5` como modelo pedido y `claude-opus-5-5` como modelo de respuesta

#### Scenario: Modelos iguales
- **WHEN** la estación pide `claude-opus-5-5` y el ejecutor devuelve `model` igual a `claude-opus-5-5`
- **THEN** `log.info` no recibe ninguna llamada de aviso de modelo distinto

#### Scenario: Sin modelo pedido
- **WHEN** la estación no tiene modelo configurado y el ejecutor devuelve `model` igual a `claude-opus-5-5`
- **THEN** `log.info` no recibe ninguna llamada de aviso de modelo distinto y el span registra `gen_ai.response.model` igual a `claude-opus-5-5`

#### Scenario: Sin modelo informado
- **WHEN** la estación pide `claude-sonnet-5-5` y el ejecutor devuelve un resultado sin `model`
- **THEN** `log.info` no recibe ninguna llamada de aviso de modelo distinto
