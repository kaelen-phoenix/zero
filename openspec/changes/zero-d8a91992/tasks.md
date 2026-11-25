# Tasks

## 1. Implementación

- [x] 1.1 Comprobar que el cambio de OpenSpec del trabajo (`openspec/changes/zero-d8a91992/`) existe y valida con `npx openspec validate --all`. Solo requisitos ADDED con nombres nuevos: `regeneration-drill` no tiene spec principal y vive en los cambios sin archivar zero-261fd2c1 y zero-01c17758, que no se editan.
- [x] 1.2 En `src/line/drill.ts`: dejar la constante de 20 minutos solo para setup y corregir su comentario (por ejemplo `DRILL_SETUP_MS`). Agregar `timeoutMs: number` a `DrillCommand` y hacer que `tail` lo reciba. Calcular el límite de cada comando de verify con `verifyTimeoutMs(deps.store, line, command, deps.now?.() ?? new Date())`, importado de `./pace.js`.
- [x] 1.3 En `src/line/drill.ts`: agregar `"sin medir"` a `DrillOutcome` y a `OUTCOME_TEXT`. Calcular el resultado en este orden: `inválido`; después, con setup ok, agente ok sin tope, todo reconstruido y verify no vacío: `alcanzan` si todos dieron 0, o `sin medir` si todos los que dieron distinto de 0 tienen `timedOut`; si no, `no alcanzan`.
- [x] 1.4 En `src/line/drill.ts`: hacer que `commandBlock` use el `timeoutMs` del comando para «cortado a los N minutos» (hasta dos decimales con coma, nunca 0, y singular correcto) y agregue, solo para verify, que el límite se cambia con `verifyTimeoutMinutes` de la línea.
- [x] 1.5 Agregar en `src/format.ts` una función (por ejemplo `formatDrill`) con el texto de la terminal y usarla en el caso `simulacro` de `src/cli.ts`. El código de salida sigue siendo 0.
- [x] 1.6 Ampliar `test/drill.test.ts` con todos los escenarios: límite aprendido (trabajo con `store.createJob` y span insertado con `zero.run_ms`), `verifyTimeoutMinutes` de la línea, 20 minutos por defecto y en setup, `timeoutMs` en el resultado y el JSON, textos del informe, `sin medir` con `sh` inyectado y con un comando real que no termina, falla real sola y junto a un corte, archivo sin reconstruir, agente fallido, prioridad de `inválido`, texto de la terminal y documentación.
- [x] 1.7 Actualizar la entrada de `src/line/drill.ts` en `docs/agents/production-line.md` (en inglés): setup de 20 minutos, verify con `verifyTimeoutMs`, `timeoutMs` por comando y resultado `sin medir`. No tocar AGENTS.md.
- [x] 1.8 Actualizar las dos viñetas (límite y resultados) de la sección del simulacro en `README.md` y `README.es.md`, con la misma estructura y sin cambiar el bloque de código.
- [x] 1.9 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
