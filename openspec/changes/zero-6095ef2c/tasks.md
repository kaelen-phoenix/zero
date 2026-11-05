# Tasks

## 1. Implementación

- [x] 1.1 Confirmar que la rama parte de `origin/main` (hoy es 9e3d87c, ya con el `execute` de #86). El change de OpenSpec `zero-6095ef2c`, con capacidad `production-line`, sale de esta especificación; comprobarlo con `npx openspec validate --all`.
- [x] 1.2 En `src/engines/cli.ts`, agregar junto a `antigravityInvocation` las constantes del umbral (30_000) y de la instrucción corta `Follow the instructions received on stdin.`.
- [x] 1.3 Cambiar `antigravityInvocation`: calcular `fullPrompt(req)` una sola vez; si su `.length` supera el umbral, poner la instrucción corta en `-p` y el prompt en `stdin`; si no, dejar la invocación como está hoy, con `stdin` sin definir. No tocar las demás flags, `nativeSchema` ni `customInvocation`.
- [x] 1.4 En `runProcess`, agregar a `child.stdin` un listener de `error` con un comentario breve que explique que el resultado lo deciden `close` y `error` del proceso.
- [x] 1.5 En `test/engines.test.ts`, probar la invocación con 30.000 y 30.001 caracteres exactos, los `args` completos en lectura y escritura, `nativeSchema` y el motor personalizado con `{prompt}` y un prompt largo.
- [x] 1.6 Agregar las pruebas con proceso falso (prompt largo leído por stdin, proceso que no lee stdin con código 0 y con código 3, binario inexistente) en un archivo que use el mismo `vi.mock` de `spawn` que `test/engines-empty-output.test.ts`. Hacer que fallen si aparece un `uncaughtException`.
- [x] 1.7 Agregar a `AGENTS.md`, en el párrafo de `src/agent.ts` + `src/engines/`, una frase sobre el envío por stdin de Antigravity por encima de 30.000 caracteres.
- [x] 1.8 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
