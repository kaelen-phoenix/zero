# Proposal

## Why

Al pedir una corrida a demanda de una estación de paquete vas a poder sumarle un pedido en texto: `zero package run <paquete>/<estación> --pedido "..."`, el mismo campo en la herramienta de chat `zero_package_run` y un botón "Pedir ahora" con un campo de texto opcional en una nueva página "Paquetes" del panel. El texto llega a la estación como `request` en el segundo argumento de su `pass`. Llega limpio: sin rutas locales ni secretos de la estación, y cortado a 4000 caracteres. La estación lo recibe como un pedido tuyo. Solo vos podés pedirlo, desde la terminal, el chat o el panel con tu sesión. Las estaciones, issues y comentarios no tienen forma de hacerlo. El comando espera a que la corrida empiece y te lo avisa. Si la fábrica sigue ocupada después de un rato, te dice que el pedido sigue pendiente. `zero status` y el panel muestran la corrida pedida, la que está en curso y el resultado de la última (terminó, falló, se pasó de tiempo o se interrumpió). Sirve para cualquier paquete y queda documentado en README.md y README.es.md.

## What Changes

- Corridas a demanda con pedido en texto, aviso de inicio y resultado visible
- Supuesto: Assumption: "presented as a request from the person in charge" means the field name and documentation tell the station that `request` is the request of the person in charge. Zero cannot rewrite the prompts a third party's station builds. The README must say so.
- Supuesto: Assumption: the CLI waits at most 2 minutes and the chat 30 s. A busy factory only runs on-demand passes when idle, so waiting forever would hang the command.
- Supuesto: Existing tests compare `factoryStatus(ctx).onDemand` with `[{station, since}]` and the pass argument with JSON.stringify({ onDemand: true }). New fields must be omitted when absent.
- Supuesto: runTurn calls mark twice on a timeout, so the run-record write must be idempotent. ended must fire exactly once.
- Supuesto: Earlier attempts at this same request failed at review, and the full `npm test` takes over 20 minutes. Builds should run focused tests per stage.
- Supuesto: The panel has no packages page yet. GET /packages must not collide with the `/packages/<pkg>/<tab>` route, and POST /packages/run has two segments fewer than a tab path.

## Capabilities

### New Capabilities
- `agent-packages`: Corridas a demanda con pedido en texto, aviso de inicio y resultado visible

### Modified Capabilities

## Impact

Generado por zero para el trabajo c119e137.
