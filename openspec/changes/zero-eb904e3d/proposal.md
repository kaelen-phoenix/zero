# Proposal

## Why

Una estación de paquete va a poder declarar en su manifiesto `whenBusy: true`. Con eso, su pasada regular corre cada `everyMinutes` aunque haya trabajos en cola o corriendo, y también mientras la autoactualización espera para cambiar de versión. Ya no queda días sin correr porque la cola nunca se vacía. La siguen frenando el andon, el presupuesto (incluido `limits.usdPerNight` para sus agentes), los secretos que falten y el hecho de que la estación ya esté corriendo. No ocupa un lugar de trabajo, no usa la caja de aislamiento ni el repositorio de una línea. Sin la opción, todo funciona igual que hoy. `zero status` y `zero package list` muestran qué estaciones tienen la opción.

## What Changes

- Package stations whose regular pass runs even when the factory is busy (whenBusy)
- Supuesto: Assumed name: `whenBusy` (the request's own example) and a new exported function `busyPass`. The tests should target behaviour through these names, or through runDaemon.
- Supuesto: Assumption: whenBusy stations move from packagesPass into busyPass, so their regular turn has one home. The everyMinutes check and busyStations also prevent doubles if both passes run.
- Supuesto: Assumption: like onDemandPass, the busy-time pass also runs while jobs wait for the box. The request lists only the andon, the budget, missing secrets and busyStations as brakes, and says the station does not compete for the box.
- Supuesto: budgetState(...).reached covers the daily and monthly limits. limits.usdPerNight is enforced inside stationAgent's ctx.runAgent (src/line/packages.ts:309), not by skipping the pass, the same as in the idle pass today.
- Supuesto: The READMEs' code blocks are compared across languages by test/docs.test.ts. The new manifest example line must keep the structure each test expects, so a trailing comment in each language is the safe shape, matching the onDemand line.
- Supuesto: A whenBusy station can call models during the day. Its spend counts against limits.usdPerNight through scoutSpent, so on a busy day it may use up night-shift budget earlier than before.

## Capabilities

### New Capabilities
- `agent-packages`: Package stations whose regular pass runs even when the factory is busy (whenBusy)

### Modified Capabilities

## Impact

Generado por zero para el trabajo eb904e3d.
