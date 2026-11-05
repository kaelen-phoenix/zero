# Proposal

## Why

Una estación de paquete va a poder declarar en su manifiesto horarios locales, por ejemplo `schedule: ["08:00", "12:00", "18:00"]`. En cada horario el daemon llama a `scheduled(ctx, { at })` de la estación, aunque la fábrica tenga trabajos en curso. Esas pasadas no pueden llamar a un modelo: `ctx.runAgent` tira un error claro, así no gastan ni compiten con la línea. Sí tienen secretos, estado, registro y líneas. Cada horario corre como máximo una vez por día. Si el daemon estaba apagado o el andón estaba activado a esa hora, corre después solo si no pasaron más de 2 horas. Con el andón activado no arranca ninguna pasada. `pass` sigue igual, en los momentos libres. Queda documentado en los dos README y en AGENTS.md, con pruebas que usan estaciones falsas.

## What Changes

- Horarios livianos para estaciones de paquete
- Supuesto: Supuesto: `at` es el texto del horario del manifiesto (`"08:00"`), no un Date; la hora real de la pasada está en `ctx.now`, que difiere cuando es una recuperación.
- Supuesto: Supuesto: solo `ctx.runAgent` cambia. `ctx.requestJob`, `ctx.deliveredJobs`, `ctx.config` y `ctx.z` siguen disponibles en `scheduled`, porque el pedido solo saca `runAgent`. `requestJob` conserva sus límites (permiso en el manifiesto, cupo, andón, presupuesto) y abre trabajos de baja prioridad, que usarán modelo más tarde y dentro de la línea, no en la pasada.
- Supuesto: Supuesto: la ventana de 2 horas vale para cualquier horario sin correr, no solo al arrancar el daemon. Cubre también el andón apagado a tiempo y los secretos guardados tarde. Una estación recién instalada corre un horario de las últimas 2 horas la primera vez que el daemon la ve.
- Supuesto: Supuesto: si varios horarios quedaron atrasados dentro de la ventana, corren todos en orden, cada uno con su `at`, en lugar de correr solo el último.
- Supuesto: Supuesto: el presupuesto no frena estas pasadas, porque no gastan modelo. El pedido solo nombra el andón.
- Supuesto: Las pasadas corren dentro del proceso del daemon y con los permisos de tu usuario. 'Liviana' se impone sobre el modelo, no sobre la CPU: código de un tercero que bloquee el hilo puede frenar el bucle, igual que `pass` hoy. Además, `scheduled` va a correr en un momento en que la línea trabaja, mientras que `pass` solo corría con la fábrica libre.
- Supuesto: `scheduled` y `pass` de una misma estación pueden correr a la vez, porque las pasadas con horario no esperan a la tanda libre, y comparten `ctx.state`. Quien escribe la estación tiene que tenerlo en cuenta; conviene decirlo en el README.
- Supuesto: Las estaciones corren de a una dentro de `scheduledPass` y el daemon vuelve a mirar cada 60 s. Un horario puede arrancar hasta un minuto tarde, y una estación colgada puede demorar a las demás hasta su `timeoutMinutes`; la ventana de 2 horas absorbe esa demora.
- Supuesto: Cambio de hora: una hora local que no existe ese día corre corrida por `Date`, y una que se repite corre una sola vez porque la marca es por día.

## Capabilities

### New Capabilities
- `agent-packages`: Horarios livianos para estaciones de paquete

### Modified Capabilities

## Impact

Generado por zero para el trabajo 8951830c.
