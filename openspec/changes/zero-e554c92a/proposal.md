# Proposal

## Why

Ahora, cuando la revisión nocturna de trabas propone un arreglo y la estación de spec lo rechaza porque no hay nada que hacer (por ejemplo, porque el pull request ya estaba fusionado), la propuesta se libera enseguida. A la noche siguiente vuelve a aparecer con el mismo título, y cada vuelta gasta una corrida de spec y suma ruido en el townhall. Con este cambio, una propuesta así sigue ocupando su título durante 7 días desde que terminó su trabajo, y la revisión no abre otra igual en ese plazo. Pasados los 7 días la causa se puede proponer de nuevo. Los trabajos que fallan por otro motivo (por ejemplo, verify) siguen liberando el título como hasta ahora, para que zero pueda reintentar el arreglo.

## What Changes

- Unjam: un arreglo rechazado en spec no se vuelve a proponer durante 7 días
- Supuesto: Assumption: the hold also applies to capability proposals, because `openCapabilities` shares `holdsTitle`. The request only names `openFixes`, but splitting the two paths would add complexity for little gain.
- Supuesto: Assumption: the 7 days are counted from `finishedAt`, falling back to `updatedAt`. That fallback matches what `collectJams` uses.
- Supuesto: The refused job still shows up as a `job:` jam for up to 7 days (the window of `collectJams`). The diagnosis can still name it, but no new proposal is opened. The two windows have the same length, so the jam ages out about when the hold ends. The spec does not remove the jam.
- Supuesto: The hold matches on normalized titles. If the model rewords the title on the next pass, the hold does not catch it. This is an existing limit of the title dedupe.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Unjam: un arreglo rechazado en spec no se vuelve a proponer durante 7 días

## Impact

Generado por zero para el trabajo e554c92a.
