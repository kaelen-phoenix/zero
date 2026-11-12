# Proposal

## Why

Ahora vas a poder pedirle a una estación de paquete una corrida a demanda con un texto: `zero package run <paquete>/<estación> --pedido "..."`, o lo mismo desde el chat con `zero_package_run`. La estación recibe ese texto en su corrida como `run.request`. Antes de guardarlo, zero le quita los secretos de la estación, los tokens reconocibles y tus rutas locales, y lo corta a 4000 caracteres. La estación lo recibe marcado como un pedido tuyo. Solo vos podés pedirlo, desde la terminal o el chat: las estaciones, los paquetes y los terceros no tienen forma de escribir ese pedido. Funciona igual para cualquier paquete. El comando ya no solo deja el pedido anotado. Espera hasta 2 minutos a que la corrida empiece y te avisa cuando arrancó. Si la fábrica sigue ocupada, te dice que el pedido quedó pendiente y que lo mires en `zero status`. En `zero status` y en `zero package list` vas a ver tres cosas: la corrida pedida (pendiente, y si lleva texto), la corrida en curso y cómo terminó la última (terminó bien, falló y por qué, superó su tiempo o se interrumpió). README.md y README.es.md lo documentan. En el panel, la página de paquetes tiene un botón "Pedir ahora" con un campo de texto opcional.

## What Changes

- Corridas a demanda con pedido en texto, aviso de inicio y resultado visible.
- Al mezclar la rama base, esta función ya había entrado por otro trabajo (zero-c119e137, con `onDemandPass`, `stationRunKey`, `waitStationStart` y la página de paquetes del panel). Este cambio queda con esa implementación, sin duplicarla.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-packages`: Corridas a demanda con pedido en texto, aviso de inicio y resultado visible

## Impact

Generado por zero para el trabajo 61a34085.
