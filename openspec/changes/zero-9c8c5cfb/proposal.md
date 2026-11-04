# Proposal

## Why

Hoy zero solo anota el modelo que pidió, así que el gasto puede atribuirse a un modelo que no fue el que trabajó, porque Claude Code puede cambiar de modelo por su cuenta. Con este cambio, cada llamada al motor Claude también guarda en su traza el modelo que respondió de verdad. Si participaron varios modelos, guarda el de mayor costo. Cuando el modelo que respondió no coincide con el pedido, queda una línea informativa en el log. Los motores que no informan el modelo siguen funcionando igual, y el trabajo no se detiene ni cambia de resultado por una diferencia de modelo.

Pedido original: "Motor Claude: registrar en el span el modelo que respondió de verdad Por qué: La nota 003d7a59 (fuentes: https://code.claude.com/docs/en/model-config y https://code.claude.com/docs/en/changelog) cuenta que Claude Code puede cambiar de modelo solo, por ejemplo cuando marca un mensaje, y que zero no se entera. Hoy src/agent.ts:202 solo graba `gen_ai.request.model`, el modelo que zero pidió. claudeResult (src/engines/claude.ts:119) no lee `modelUsage` del mensaje de resultado. Así, la observabilidad y el coste por modelo pueden atribuir el gasto a un modelo que no fue el que trabajó. Qué cambiaría: Agregar `model?: string` a EngineResult en src/engines/types.ts. En claudeResult, tomarlo de las claves de `result.modelUsage`: si hay una, esa; si hay varias, la de mayor costo. En src/agent.ts, al cerrar el span, grabar `gen_ai.response.model` cuando venga informado, y cuando no coincida con el modelo pedido, dejar un log.info. Las pruebas se hacen sobre claudeResult con un SDKResultMessage falso, para los casos de un modelo, varios modelos y sin modelUsage. Empieza como un change de OpenSpec con el requisito en factory-observability. No suma dependencias."

## What Changes

- Motor Claude: registrar en el span el modelo que respondió
- Supuesto: Supuesto: la comparación con el modelo pedido es exacta, como dice el pedido. Si una estación configura un alias como `opus`, y el motor informa el id completo, habrá un `log.info` en cada llamada aunque no haya habido cambio real. Es solo ruido de log y no afecta el resultado del trabajo.
- Supuesto: Supuesto: si no se pidió modelo (estación sin `model`), no hay con qué comparar. Por eso no se deja aviso, pero el span sí registra `gen_ai.response.model`.
- Supuesto: Supuesto: cuando hay varios modelos, el que se registra es el de mayor costo aunque otro haya respondido el mensaje final, como pide el pedido. Un subagente caro puede quedar registrado en lugar del modelo principal. En empate de costo queda el primero en el orden de las claves.
- Supuesto: Supuesto: también se informa el modelo en los resultados de error, porque el SDK declara `modelUsage` en ambos tipos y esas llamadas también gastan. El pedido no distinguía entre éxito y error.
- Supuesto: Un resultado de esquema inválido marca la llamada como fallida después de que el motor respondió. Aun así, el span registra el modelo que respondió, porque se lee de `result` y no de `run`.
- Supuesto: Con este cambio el costo por modelo sigue sin calcularse: `zero.cost.usd` sigue siendo el total de la llamada, y `spanEngine` en `src/telemetry/tracer.ts` sigue mostrando el modelo pedido en `zero trace`. Lo que se gana es el dato en el span.
- Supuesto: Las líneas de código citadas en el pedido están algo corridas: `gen_ai.request.model` está en src/agent.ts:203 y `claudeResult` en src/engines/claude.ts:123.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-observability`: Motor Claude: registrar en el span el modelo que respondió

## Impact

Generado por zero para el trabajo 9c8c5cfb.
