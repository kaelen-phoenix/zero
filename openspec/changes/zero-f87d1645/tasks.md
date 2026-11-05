# Tasks

## 1. Implementación

- [x] 1.1 En `src/engines/claude.ts`, agregar una constante con la lista de ocho herramientas y un `Record<Access, string[] | undefined>` o equivalente: la lista para `read` y `web`, nada para `write`.
- [x] 1.2 En `claudeOptions`, pasar `disallowedTools` solo cuando el acceso tenga lista, de modo que con `write` la clave no quede definida. No agregar la opción `tools`.
- [x] 1.3 Corregir el comentario de `TOOLS` en `src/engines/claude.ts`: `allowedTools` solo autoaprueba y lo que no está listado no queda necesariamente denegado; `disallowedTools` es lo que saca una herramienta del contexto. Explicar brevemente por qué se usa una lista de negación y no `tools`: no se puede confirmar sin un modelo cómo afectaría a `StructuredOutput` y `Skill`. Ajustar también el comentario de `WebFetch` si hace falta.
- [x] 1.4 En el bloque `claude options` de `test/skills.test.ts`, agregar tests que fijen la lista para `read` y `web`, confirmen que `write` no tiene `disallowedTools` y mantiene sus `allowedTools`, que las skills no cambian la lista, y que `tools` sigue sin definirse.
- [x] 1.5 Actualizar en `AGENTS.md` la línea de `src/agent.ts` + `src/engines/` para que diga que el motor Claude niega esas herramientas con los accesos `read` y `web`, y que la comprobación final es mirar las herramientas del mensaje `init` en una corrida real.
- [x] 1.6 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
