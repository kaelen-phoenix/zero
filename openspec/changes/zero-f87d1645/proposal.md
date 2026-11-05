# Proposal

## Why

Las estaciones que solo leen (spec, review, security, reply, scout, research, los agentes propios de revisión y los de paquetes) dejan de tener disponibles, cuando corren con Claude, las herramientas para delegar trabajo, traer páginas web o programar cosas afuera: Agent, Workflow, WebFetch, RemoteTrigger, CronCreate, ScheduleWakeup, SendMessage y PushNotification. Así zero impone la garantía de solo lectura en lugar de suponerla, y una estación de lectura ya no puede escribir a través de un subagente. `build` sigue igual. También se corrige el comentario que decía que lo no listado se deniega, y un test fija la lista por tipo de acceso. Como las pruebas usan agentes falsos, la comprobación final te queda a vos: mirar las herramientas del mensaje `init` en una corrida real.

## What Changes

- Motor Claude: negar Agent, Workflow, WebFetch y herramientas remotas en accesos de lectura
- Supuesto: `npm test` usa agentes falsos, así que solo comprueba las opciones que se pasan al SDK. Que las herramientas desaparezcan de verdad se comprueba mirando el campo `tools` del mensaje `init` en una corrida real; esa comprobación queda a cargo de la persona responsable.
- Supuesto: No se comprobó si `dontAsk` dejaba correr estas herramientas antes del cambio. El motivo del cambio se apoya en la tipificación del SDK, en la nota 39069e7f y en lo que el pedido observó en una corrida de scout, sin invocarlas.
- Supuesto: Una skill asignada a una estación de lectura que corra en un subagente dejará de funcionar, porque `Agent` queda negada. Esto es una decisión del pedido, no un defecto.
- Supuesto: `build` conserva `Agent`, así que su trabajo delegado sigue sin verse en el único span por llamada que registra zero.
- Supuesto: Es una lista de negación: una herramienta nueva o renombrada en una versión futura del SDK no queda cubierta. El pedido la eligió frente a la opción `tools` porque un error en esa opción podría romper todas las estaciones.
- Supuesto: Quedan fuera de la lista otras herramientas del SDK, como `CronDelete`, `CronList`, `Monitor`, `EnterWorktree`, `ListAgents` y `PowerShell`. Se respeta la lista del pedido sin agregar nombres.
- Supuesto: Los requisitos llevan el prefijo «Motor Claude:» para no chocar al archivar con «Estaciones de solo lectura», que ya existe en `openspec/specs/production-line/spec.md`. El requisito existente no se modifica porque `renderSpecDelta` solo escribe `ADDED`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Motor Claude: negar Agent, Workflow, WebFetch y herramientas remotas en accesos de lectura

## Impact

Generado por zero para el trabajo f87d1645.
