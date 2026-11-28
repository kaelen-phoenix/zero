# Proposal

## Why

El simulacro de regeneración va a darles a los comandos de verify el mismo tiempo que les da un trabajo: lo que diga `verifyTimeoutMinutes` de la línea, o más si las corridas aprobadas recientes tardaron más. El setup conserva sus 20 minutos. Si lo único que falla es que algún comando de verify se quedó sin tiempo, el resultado va a ser «sin medir» en lugar de «no alcanzan». Así un corte deja de leerse como un problema de las especificaciones. Un test que falla de verdad sigue dando «no alcanzan», y tocar tests o especificaciones sigue dando «inválido». El informe va a decir a los cuántos minutos se cortó cada comando y, en los de verify, que ese límite se cambia con `verifyTimeoutMinutes`. La terminal también va a explicar el resultado nuevo, y la documentación queda al día.

## What Changes

- Simulacro de regeneración: límite de tiempo aprendido y resultado «sin medir»
- Supuesto: El pedido no distingue setup y verify al nombrar `verifyTimeoutMinutes` en el informe. Se asume que solo aparece en los cortes de verify, porque el límite del setup no se cambia con ese ajuste.
- Supuesto: Un setup cortado por tiempo sigue dando `no alcanzan`: el pedido exige que el setup haya pasado para `sin medir`.
- Supuesto: Se asume que un comando que termina con código 0 cuenta como aprobado aunque `timedOut` sea true, igual que en verify.
- Supuesto: El simulacro usa el límite aprendido pero sus corridas no suman historial: sus comandos no dejan spans con trabajo. Además corre fuera de la cola de comandos de las líneas (`localCommands`), así que con otros trabajos en marcha puede tardar más que las corridas aprobadas. En ese caso el corte da `sin medir` y no una conclusión falsa.
- Supuesto: Un código reconstruido que se cuelga también da `sin medir`: por el tiempo solo no se puede distinguir de una máquina lenta.
- Supuesto: El requisito «Tests de la línea contra lo regenerado» del cambio sin archivar zero-261fd2c1 todavía dice 20 minutos para verify. Este cambio lo reemplaza sin editarlo.
- Supuesto: Se asume que el código de salida de `zero simulacro` sigue siendo 0 para todos los resultados.

## Capabilities

### New Capabilities
- `regeneration-drill`: Simulacro de regeneración: límite de tiempo aprendido y resultado «sin medir»

### Modified Capabilities

## Impact

Generado por zero para el trabajo d8a91992.
