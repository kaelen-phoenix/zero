# Tasks

## 1. Implementación

- [x] 1.1 En `src/line/spec.ts`, agregar la comparación de nombres (`foldRequirementName` copiado de openspec: quita el cierre `[ \t]+#+[ \t]*$`, recorta, pasa a minúsculas y colapsa espacios). Copiarla porque `@fission-ai/openspec` es solo dependencia de desarrollo y el código de `src/` no puede importarla en ejecución.
- [x] 1.2 En `src/line/spec.ts`, agregar `existingRequirementNames(repo, capability, ownChange)`: usa el mismo directorio de capacidad que `renderOpenSpecChange` (`slug(capability) || "change"`), lee el spec principal y los deltas de `openspec/changes/*`, sin `archive` ni `ownChange`, extrae los encabezados con la regex de openspec `^###\s*Requirement:\s*(.+)\s*$` (insensible a mayúsculas, aceptando CRLF) e ignora lo que no se pueda leer.
- [x] 1.3 En `src/line/spec.ts`, agregar `uniqueRequirementNames(spec, jobId, existing)`: una función pura que devuelve una especificación nueva, recorre los requisitos en orden con un conjunto de nombres tomados y aplica ` (<id>)` y luego ` (<id>-<n>)` desde 2.
- [x] 1.4 En `specStation` de `src/line/runner.ts`, después del corte de `!spec.feasible` y antes de `renderOpenSpecChange`, reemplazar `spec` por el resultado de `uniqueRequirementNames`, usando `copy.cwd` y `changeName(job.id)`. Así los archivos y `store.updateJob` usan los nombres nuevos, y `buildLoop` arma el contrato desde `job.spec`.
- [x] 1.5 Sumar pruebas unitarias en `test/line-parts.test.ts`: recolección (fuentes, `archive`, change propio, otra capacidad, entradas ilegibles, sin OpenSpec), comparación y sufijos (incluido el desempate).
- [x] 1.6 Sumar en `test/line-parts.test.ts` la prueba con el binario real `node_modules/@fission-ai/openspec/bin/openspec.js` y `archive --yes`, en un repositorio temporal: el control que falla con `already exists` y el caso con nombres únicos que pasa. Usar `renderOpenSpecChange` con `newCapability: true` en los dos changes, como hace el runner cuando la capacidad todavía no está en `openspec/specs/`.
- [x] 1.7 Sumar en `test/runner.test.ts` una prueba de punta a punta con fake agents: un change previo con «Health check» en `health-check`; comprobar `job.spec`, los dos deltas escritos, el prompt de build y `count.spec === 1`.
- [x] 1.8 Actualizar la descripción de `src/line/` en `AGENTS.md` con los nombres únicos de la estación spec.
- [ ] 1.9 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
