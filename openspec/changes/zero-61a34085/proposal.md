# Proposal

## Why

Ahora vas a poder pedirle a una estación de paquete una corrida a demanda con un texto: `zero package run <paquete>/<estación> --pedido "..."`, o lo mismo desde el chat con `zero_package_run`. La estación recibe ese texto en su corrida como `run.request`. Antes de guardarlo, zero le quita los secretos de la estación, los tokens reconocibles y tus rutas locales, y lo corta a 4000 caracteres. La estación lo recibe marcado como un pedido tuyo. Solo vos podés pedirlo, desde la terminal o el chat: las estaciones, los paquetes y los terceros no tienen forma de escribir ese pedido. Funciona igual para cualquier paquete. El comando ya no solo deja el pedido anotado. Espera hasta 2 minutos a que la corrida empiece y te avisa cuando arrancó. Si la fábrica sigue ocupada, te dice que el pedido quedó pendiente y que lo mires en `zero status`. En `zero status` y en `zero package list` vas a ver tres cosas: la corrida pedida (pendiente, y si lleva texto), la corrida en curso y cómo terminó la última (terminó bien, falló y por qué, superó su tiempo o se interrumpió). README.md y README.es.md lo documentan. El botón "Pedir ahora" del panel queda para un segundo paso. El panel todavía no tiene una sección de paquetes donde ponerlo.

## What Changes

- Corridas a demanda con pedido en texto, aviso de inicio y resultado visible
- Supuesto: If the daemon dies mid-run, the record stays `running` forever. Assumption: status shows it as running. A follow-up could treat a record older than the station's timeoutMinutes as interrupted.
- Supuesto: The CLI waits only 2 minutes, because the factory may be busy with jobs for hours. After that it reports the request as still pending instead of blocking.
- Supuesto: Assumption: the result shown is how the turn ended (done/failed/timeout/interrupted), not the value `pass` returns. Stations do not define any return value today.
- Supuesto: The whole `npm test` suite has timed out in earlier runs (more than 1300 s). The build should run focused test files and avoid extra tsx CLI spawns, which are slow.
- Supuesto: `requestStationRun`'s third parameter changes shape. Existing tests call it with a bare Date, so both forms must keep working.
- Supuesto: The cleaning uses the secrets the station declares plus `publicText`. A secret the station does not declare is caught only if publicText recognizes it.

## Capabilities

### New Capabilities
- `agent-packages`: Corridas a demanda con pedido en texto, aviso de inicio y resultado visible

### Modified Capabilities

## Impact

Generado por zero para el trabajo 61a34085.
