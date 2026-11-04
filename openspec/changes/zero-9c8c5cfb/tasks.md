# Tasks

## 1. Implementación

- [ ] 1.1 src/engines/types.ts: agregar a `EngineResult` el campo opcional `model?: string`, con un comentario que diga que es el modelo que respondió según el motor.
- [ ] 1.2 src/engines/claude.ts: agregar una función auxiliar que reciba `result.modelUsage` y devuelva la clave de mayor `costUSD` (la única, si hay una; undefined, si falta o está vacío). Tolerar que falte el campo, porque los resultados falsos de las pruebas pueden no traerlo.
- [ ] 1.3 src/engines/claude.ts: en `claudeResult`, incluir `...(model && { model })` en los dos retornos, el de error y el de éxito, sin cambiar el resto del mapeo.
- [ ] 1.4 src/agent.ts: al cerrar el span en `span?.end`, agregar `...(result.model && { "gen_ai.response.model": result.model })`.
- [ ] 1.5 src/agent.ts: después de obtener el resultado, llamar a `log.info` cuando `model` y `result.model` estén definidos y sean distintos, con el nombre del agente, el motor, el modelo pedido y el que respondió en los campos. El aviso no debe depender de que exista un span.
- [ ] 1.6 Pruebas de `claudeResult` en test/budget-cut.test.ts, junto al helper `sdkResult`, o en test/engines.test.ts, con un `SDKResultMessage` falso: un modelo en éxito, un modelo en error, varios modelos, sin `modelUsage` y con `modelUsage` vacío.
- [ ] 1.7 Pruebas de `createAgentRunner` con un `EngineExecute` falso y `trace` (como en test/fallback.test.ts): atributos del span con y sin `model`, llamada fallida, y `vi.spyOn(log, "info")` para los casos de modelos distintos, iguales, sin modelo pedido y sin modelo informado. El modelo pedido se configura en `stations` de `testFactory`.
- [ ] 1.8 Ejecutar `npm run typecheck`, `npm test` y `npx openspec validate --all`.
