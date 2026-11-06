# Proposal

## Why

Hoy, en una línea con `autoMerge`, un pull request de la fábrica que queda con conflictos solo recibe el aviso "NO SE FUNDE". Con este cambio, la fábrica retoma ese mismo trabajo y mezcla la rama base en la rama del trabajo, con un merge normal: nunca rebase ni force-push. Si hay conflictos, build los resuelve como un intento más dentro de `maxAttempts`. Después se vuelve a verificar y revisar, y se sube al mismo pull request, que se funde como cualquier otro cuando GitHub lo da por listo. Nunca se commitean marcadores de conflicto. La fábrica solo toca el pull request si su punta coincide con tu rama local, así que no pisa lo que haya subido una persona. Si no puede resolverlo, el pull request queda como estaba, con el aviso de siempre, y se sigue vigilando. Los trabajos en paralelo dentro de una línea quedan para otro pedido.

## What Changes

- Actualización automática de pull requests con conflictos en líneas autoMerge
- Supuesto: Supuesto: la causa del fallo de box.e2e en el PR #61 es que agregó `paths` como campo obligatorio a `SpecSchema`, mientras el spec falso de `test/box.e2e.test.ts` no lo trae. Se dedujo leyendo el código y no se ejecutó. Este cambio no toca `SpecSchema`, así que no debería repetirse.
- Supuesto: Supuesto: se retoma el mismo trabajo en vez de abrir uno nuevo, porque 'un intento más dentro de maxAttempts' habla de ese trabajo. Por eso un trabajo entregado vuelve a `queued` y termina dos veces: el townhall recibe un segundo informe, `finishedAt` cambia (y con él los informes por fecha y los 14 días de vigilancia) y el export OTLP puede reenviar sus spans.
- Supuesto: Supuesto: si no se resuelve, el trabajo vuelve a `delivered` en vez de quedar `failed`. Así el aviso y la vigilancia siguen como hoy. El motivo queda en el log y como `blocker` del townhall, no en el estado del trabajo.
- Supuesto: Supuesto: se hace un solo intento por punta. Un corte de red durante el push consume el intento de esa punta y el pull request queda informado como bloqueado hasta que su punta cambie. Un fetch fallido en la pasada no lo consume.
- Supuesto: Supuesto: una mezcla limpia también repite review y security, no solo verify, porque reutiliza el camino de `buildLoop`. Cuesta más, pero es más seguro.
- Supuesto: Después de una mezcla, el `setup` de la línea no corre de nuevo sobre el resultado: corre al recrear la copia, antes de mezclar. Si la base agrega una dependencia, la verificación puede fallar y gastar un intento.
- Supuesto: El presupuesto del trabajo es acumulado: un trabajo que ya gastó casi todo su tope, con cobro por uso, puede frenarse por `budgetStop`. En L3 se rinde y en niveles menores pregunta.
- Supuesto: Con la caja, `git merge` corre en la máquina dentro del clon del trabajo, como ya pasa con `commitAll`. En reintentos corre después de un agente que pudo cambiar `.git/config` de ese clon, y un merge driver configurado ahí se ejecutaría en la máquina. Revisar esto en la revisión de seguridad.
- Supuesto: Entre la vuelta a la cola y el arranque, el trabajo puede esperar a otros de la línea. Si una persona sube algo en ese tiempo, se gasta en la actualización y el chequeo con `ls-remote` evita pisarlo, pero el gasto ya se hizo.
- Supuesto: Los `test/box.e2e` necesitan un runtime de contenedores; si la máquina no lo tiene, ese test no confirma este cambio.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Actualización automática de pull requests con conflictos en líneas autoMerge

## Impact

Generado por zero para el trabajo 56ec4470.
