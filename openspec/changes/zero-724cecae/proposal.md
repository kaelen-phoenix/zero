# Proposal

## Why

Cuando un trabajo ya entregó su resultado (por ejemplo, abrió su pull request) y después Windows no deja borrar su carpeta de trabajo ("EBUSY: resource busy or locked"), el trabajo queda como entregado y no como fallido. La fábrica anota la carpeta pendiente y vuelve a intentar borrarla sola en segundo plano, cada minuto, hasta lograrlo. Mientras quede alguna pendiente, `zero status` lo muestra en una línea. Lo mismo vale para trabajos fallidos o detenidos: un problema al borrar la carpeta no cambia cómo terminaron. README.md y README.es.md lo explican. Esta es la primera parte del pedido. Las otras dos quedan como trabajos aparte: la actualización automática de un paquete de zero cuando se funde un pull request en su repositorio, y mostrar como problema de la cuenta de GitHub (facturación, límite de gasto, minutos agotados) los checks que no arrancan.

## What Changes

- Work-copy cleanup does not fail a delivered job and is retried in the background
- Supuesto: Assumption: the EBUSY came from `rmSync` in `removeWorkCopy`, called from `finalizeJob`. runJob's catch then finalized the same job again as `failed`. The fix lives in finalizeJob, so a failed removal also stops ending stopped and failed jobs with an error from the daemon or `stop`.
- Supuesto: A work copy that stays locked (an editor or antivirus holding a file) keeps being retried every minute with nothing to stop it. Only the first failure should log at warn level, so the log does not fill up.
- Supuesto: If two parts of the system remove the same path at once, one of them can find it already gone. The pass treats a missing path as done.
- Supuesto: Two known blockers show the full `npm test` suite close to its time limit. The build should add only small, fast tests in their own file and not slow down the existing ones.
- Supuesto: Parts 2 and 3 of the request are left out of this run on purpose (see followUps). Whoever reviews this should not read their absence as a forgotten requirement.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Work-copy cleanup does not fail a delivered job and is retried in the background

## Impact

Generado por zero para el trabajo 724cecae.
