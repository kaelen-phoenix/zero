# Proposal

## Why

En una línea con fusión automática, un pull request cuyos checks siguen fallando por un error del propio cambio ya no queda trabado para siempre. Primero la fábrica hace lo de hoy: lo pone al día con la rama base y vuelve a correr los checks una vez. Si los checks siguen fallando, devuelve ese mismo trabajo a la cola. El arreglo se hace sobre la misma rama y se sube al mismo pull request, sin abrir otro. El agente recibe como guía los nombres de los checks que fallaron, las pruebas que fallaron y el final del log de GitHub Actions, sin secretos ni rutas de tu máquina. Cada pull request tiene hasta 2 arreglos automáticos. Si se agotan, queda bloqueado y se avisa en el pull request como hoy, y `zero reintentar <trabajo>` habilita otra vuelta. Además, un pull request con checks fallidos que también choca con la rama base se trata primero como conflicto, aunque GitHub todavía no lo marque así. Vuelve a la cola para resolverlo, con el mismo límite de resoluciones de hoy, y el aviso dice que está en conflicto y no que fallaron los checks.

## What Changes

- Fusión automática: arreglar checks fallidos y resolver conflictos primero
- Supuesto: Assumption: 'después del reintento que hoy existe' means a fix is queued only once `unblock` has nothing left to try (not behind the base or `MAX_REFRESHES` used up, and the failed runs already rerun at this head or none to rerun). A pull request whose checks are only commit statuses (no Actions run) is fixed without a rerun.
- Supuesto: Assumption: the limit is `MAX_CHECK_FIXES` = 2 per pull request in its life, mirroring `MAX_RESOLUTIONS`. The request did not give a number.
- Supuesto: The local conflict test uses `git merge-tree --write-tree`, which needs git 2.38 or later. With an older git the test reports unknown, and the behaviour falls back to today's.
- Supuesto: The fix job keeps its original `budgetUsd` and accumulated `costUsd`, so a job that already spent most of its cap may stop at `budgetStop` and ask for approval instead of fixing.
- Supuesto: The CI log is the repository's own code output, and `scrubLocal` is a best-effort scrubber. A secret printed in an unusual format could still reach the build prompt, though it never leaves the machine except through the engine call.
- Supuesto: Pushing a fix starts new CI runs. The fix waits its turn when the repository is busy (`busy`), but a shared CI environment could still be affected the same way an `updateBranch` affects it today.
- Supuesto: Existing tests that expect a blocked 'fallaron los checks' comment right after a rerun may now see the job taken back. The build may have to adjust their fixtures (no `failedLog`, no spec, or `fixes` used up) without changing what they test.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Fusión automática: arreglar checks fallidos y resolver conflictos primero

## Impact

Generado por zero para el trabajo 8b932a08.
