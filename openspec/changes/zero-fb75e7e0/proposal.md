# Proposal

## Why

Hoy, cuando la fábrica está ociosa, el daemon lanza a la vez al explorador nocturno (scout) y a la investigación (research). Los dos miran cuánto queda del tope nocturno (limits.usdPerNight) en el mismo momento y ven el mismo saldo, así que entre los dos pueden gastar hasta el doble. Con este cambio el daemon tiene una única tarea "ociosa": primero corre scout y, cuando termina, corre research, que calcula su saldo con lo que scout ya gastó. Mientras esa tarea está en curso no arranca otra. La noche nunca gasta más que usdPerNight entre las dos estaciones. Se agrega un test del daemon con motores falsos de pago por uso que lo comprueba.

Pedido original: "Correr scout y research uno después del otro para respetar usdPerNight Por qué: En src/daemon.ts:234-235, `scout()` y `research()` se lanzan en el mismo tick y corren a la vez. Cada pasada calcula lo que le queda con `limits.usdPerNight - scoutSpent(...)` (src/line/scout.ts:175, src/line/research.ts:141), a partir de los spans ya registrados. Las dos ven el mismo saldo y entre ambas pueden gastar hasta el doble del tope nocturno. Es lo que advierte la lección del townhall "src/daemon.ts idle passes". Qué cambiaría: En el daemon, encadenar las pasadas de horas ociosas: research arranca solo si no hay ninguna pasada de scout en curso, y al revés, con una única promesa "idle" compartida. Así cada una calcula su saldo después de que la otra registró lo que gastó. Agregar un test del daemon con motores falsos de pago por uso: con las dos estaciones activas, el gasto total de la noche no pasa de usdPerNight."

## What Changes

- Scout y research en una sola pasada ociosa, una después de la otra
- Supuesto: Assumption: scout runs before research in each idle run, which gives scout priority on the shared cap. The other order would let scout see today's notes in the same night, but research could then use up the cap first. The request did not set an order.
- Supuesto: Research now waits for a whole scout pass across every line, which delays it on factories with many lines. Each pass still checks owner work before every line, so owner jobs are not delayed.
- Supuesto: The cap test only holds if the fake agent spends no more than its maxBudgetUsd. Real engines may slightly overshoot their per-call cap, which this change does not address.
- Supuesto: scoutPass counts spend since the night-shift period start, while researchPass counts since the local midnight (startOfDay). When nightShift.hours crosses midnight, the two windows differ, so the 'night' total is only exact per window. This mismatch already exists and stays out of scope.
- Supuesto: The existing daemon test 'starts the owner's job while a scout pass is still running' runs with research on by default. It must keep passing with the chained idle promise.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Scout y research en una sola pasada ociosa, una después de la otra

## Impact

Generado por zero para el trabajo fb75e7e0.
