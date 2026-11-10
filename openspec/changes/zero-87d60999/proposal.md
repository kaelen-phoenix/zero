# Proposal

## Why

Vas a poder pedirle a la fábrica que corra ya una estación de un paquete, sin esperar su horario ni su período. Se pide con `zero package run <paquete>/<estación>` o desde el chat con la herramienta `zero_package_run`. La fábrica la corre una sola vez apenas pueda: cuando no tiene otro trabajo en cola ni en marcha, con el andon apagado y con presupuesto. Usa el mismo contexto de siempre y el mismo tope de `limits.usdPerNight`, y la estación recibe `{ onDemand: true }` para saber que se la pediste vos. Solo se puede pedir si la estación declara `onDemand: true` en su manifiesto; si no, o si ya hay un pedido pendiente para esa estación, la fábrica te responde con el motivo y no anota nada. Queda documentado en README.md y README.es.md.

## What Changes

- Corridas a demanda de estaciones de paquetes
- Supuesto: Assumption: 'apenas pueda' means the next idle packages pass (no queued or running jobs, andon off, budget left), the same condition as regular package passes. It does not mean right away while jobs are running, because stations share `limits.usdPerNight` and the daemon's idle-run ordering.
- Supuesto: Assumption: the on-demand data is passed as `pass`'s second argument (`{ onDemand: true }`), mirroring `scheduled(ctx, { at })`, and `StationContext` stays unchanged. Regular passes keep calling `pass(ctx)` with no second argument.
- Supuesto: Assumption: the request is refused up front when the andon is on or the budget is reached, and the daemon also holds a pending run while either holds later. A request accepted earlier can therefore wait.
- Supuesto: An on-demand run does not reset the station's `everyMinutes` period. A regular pass may run soon after, in a later pass.
- Supuesto: The CLI cannot check whether the module actually exports `pass` without importing third-party code. A station declaring `onDemand` without `pass` is only detected when the daemon tries it, and the request is then cleared with a warning.
- Supuesto: The kv delete API name in src/state/store.ts must be checked by the build station.

## Capabilities

### New Capabilities
- `agent-packages`: Corridas a demanda de estaciones de paquetes

### Modified Capabilities

## Impact

Generado por zero para el trabajo 87d60999.
