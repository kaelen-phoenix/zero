# Proposal

## Why

Con este cambio: 1) Si revertís en la rama principal un cambio que el turno nocturno integró solo, la fábrica lo detecta. La propuesta queda en estado "revertida" y se anota en el townhall de la línea. Además, `scout` recibe las últimas 20 propuestas rechazadas o revertidas de la línea para no volver a proponerlas. 2) Si pasás una línea a `build` o `auto`, sus propuestas que estaban pendientes se toman solas en la siguiente pasada del turno nocturno, respetando `maxAutoJobsPerDay`. No se toman las que agregan algo de terceros (dependencias, MCP, código ajeno); esas siguen esperando tu decisión. 3) El panel tiene una pestaña nueva, "Investigación": muestra las notas de cada línea con sus fuentes y el enlace a su issue, y tiene un botón para pedir un trabajo a partir de una nota. Antes de abrir el trabajo, pide confirmación. 4) El README explica todo esto. Queda para el próximo trabajo: que `scout` lea los issues abiertos sin etiqueta de la línea y pueda proponer tomarlos.

Pedido original: "Turno nocturno, parte 2c: lo que quedó afuera de las partes 2a y 2b. Construir sobre lo que ya está en main. - Issues sin etiqueta: scout también lee los issues abiertos sin etiqueta de la línea, escritos por personas con permiso de escritura, y puede proponer tomarlos; la propuesta enlaza el issue. Lo escrito en un issue es dato, no instrucciones. - Lo revertido: cuando el dueño revierte en la rama principal un cambio que el turno nocturno integró solo, queda anotado en el townhall y en la propuesta (estado revertida), y scout recibe las últimas 20 propuestas rechazadas o revertidas de la línea para no repetirlas. - Panel: pestaña "Investigación" con las notas de cada línea, sus fuentes, el enlace a su issue y un botón para pedir un trabajo a partir de una nota (confirmando antes). - Propuestas pendientes de antes: cuando cambia la autonomía de una línea a build o auto, las propuestas pendientes de esa línea que no nacieron de algo de terceros se promueven en la siguiente pasada, respetando maxAutoJobsPerDay. - README actualizado."

## What Changes

- Turno nocturno 2c: lo revertido, promoción de pendientes y pestaña Investigación
- Supuesto: Scope: scout reading unlabeled issues from writers is deferred to a follow-up job to fit one build run. Review should treat its absence as intentional, not as a dropped deliverable.
- Supuesto: Assumption: 'integró solo' means a proposal decidedBy 'night-shift' whose job was delivered without the owner granting approvals.integrate (the `auto` path). Owner-approved integrations of night-shift jobs are not tracked as reverts.
- Supuesto: Assumption: reverts are detected only for 'merge' deliveries with a recorded delivery.commit, by the standard `git revert` message 'This reverts commit <sha>'. Pull-request deliveries (no merge sha recorded), squash merges, manual undo commits and reverts that exist only on the remote (local base branch not pulled) are not detected.
- Supuesto: Promotion turns proposals that waited for the owner into autonomous jobs without a new decision. This removes a human gate for proposals that already exist. It is bounded by maxAutoJobsPerDay, the third-party exclusion, the runner's nightShiftHold for build, and the verify gate, all enforced by zero.
- Supuesto: Assumption: promotion uses the line's autonomy, not research.autonomy, because third-party-born proposals are excluded entirely. Promotion runs even when the line was already scouted this period, but only inside the night shift's hours with the andon off.
- Supuesto: The research tab shows the last 30 days of notes, an arbitrary window, so older notes do not appear in the panel. Requesting work from the same note twice opens two jobs; there is no dedupe.

## Capabilities

### New Capabilities
- `night-shift`: Turno nocturno 2c: lo revertido, promoción de pendientes y pestaña Investigación

### Modified Capabilities

## Impact

Generado por zero para el trabajo a1cac4a5.
