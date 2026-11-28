# Proposal

## Why

Vas a tener un revisor de rendimiento para las apps que construye la fábrica, y funciona con cualquier motor: 1) Zero trae su propia skill `zero:performance`: una lista de controles armada desde fuentes oficiales (web.dev, Next.js, PostgreSQL, Django, Rails, Express, entre otras). Cada control dice cómo detectarlo en el código, cómo arreglarlo y de qué fuente sale: consultas sin paginar o sin índice, N+1, falta de caché, estáticos sin CDN, imágenes sin optimizar, un solo paquete de JavaScript, trabajo pesado dentro de la respuesta en vez de en una cola, y otros. 2) La estación build tiene una regla nueva para no introducir esos problemas. En las líneas con el revisor activado, además recibe la skill. 3) Se activa por línea con `performance: true`. Desde ahí, un revisor de solo lectura mira cada cambio después de review y security. Solo frena los problemas graves de los que está seguro (high o critical, con confianza 8 o más). Lo demás va como una sección «Rendimiento» en el pull request, con el archivo, la línea y el arreglo concreto. 4) Una auditoría a demanda por línea (`zero rendimiento <línea>`) revisa el código actual con la misma lista y deja propuestas ordenadas por impacto. Esas propuestas siempre esperan tu aprobación: no se construye nada sin que vos digas que sí.

## What Changes

- Revisor de rendimiento: skill, regla de build, revisor de pull requests y auditoría a demanda
- Supuesto: Assumption: the reviewer is a built-in custom review agent (origin `zero`), not a new fixed station. This reuses zero's blocking rule (high or critical with confidence 8 or more) and the custom agents' engine chain, so it works with any engine, but it adds a fourth origin that agentList, the panel's /agents and the box's stationEngines may need to show or handle.
- Supuesto: Assumption: 'comentario' means a `## Rendimiento` section in the pull request body, not a separate GitHub comment. Lines that do not deliver by pull request keep these findings only in the trace (see followUps).
- Supuesto: Reserving the name `performance` on activated lines could refuse an existing factory file that already has a custom agent with that name. The refusal applies only where the built-in is on.
- Supuesto: The checklist's sources are written by the build agent from its own knowledge: the test can only check that each URL is https on an allowlisted official domain, not that each page exists or says what is claimed.
- Supuesto: Zero runs from its repository (dist/ plus agents/ next to it, no `files` field in package.json). The new `skills/` folder must sit next to `agents/` and be found through import.meta.url, like agents/*.md. A container image or installer that copies only some folders would need it too (check docker/ and site/ installers).
- Supuesto: The audit agent runs on line.repo while jobs may be running. It must be read-only and go through the same guard as other on-demand calls (passExecute/runGuarded for unsandboxed engines).
- Supuesto: Stage 4 is the largest one. If it runs over budget, the CLI wiring can stay while the chat or panel entry points are left to followUps.

## Capabilities

### New Capabilities
- `performance-review`: Revisor de rendimiento: skill, regla de build, revisor de pull requests y auditoría a demanda

### Modified Capabilities

## Impact

Generado por zero para el trabajo e0131a74.
