# Proposal

## Why

Vas a tener una pestaña nueva, "Monitor", en el menú del panel. Funciona como un tablero de instrumentos y muestra cómo viene trabajando la fábrica. Arriba están los totales: trabajos por día (y por semana cuando mirás 30 días), cuántos se entregaron, fallaron, esperan en cola o están en curso, la tasa de éxito con un medidor circular, el tiempo promedio por trabajo y por estación, los intentos por trabajo, cuánto llevás usado de cada plan de suscripción, el gasto del mes por motor y los tokens. Después hay una tarjeta por cada agente (spec, build, verify, review, security, scout, research, tus agentes propios y los de paquetes) con sus tokens, su costo, el tiempo trabajado, la cantidad de llamadas, las entregas en las que participó, su tasa de éxito, los motores y modelos que usó y las líneas donde trabajó. Al final hay una tarjeta por línea con sus trabajos, sus entregas, el último trabajo y los pull requests que siguen abiertos. Arriba podés elegir el período: hoy, 7 días o 30 días. Los gráficos se dibujan dentro de la página, sin librerías de afuera. La página se actualiza sola cada 15 segundos y se adapta al celular. Solo lee lo que la fábrica ya tiene guardado y no cambia nada. Los tokens se empiezan a registrar desde ahora y solo para el motor Claude. Lo que se hizo antes, o con otros motores, aparece como "sin dato". El menú lateral y los colores de marca de la parte 1 del rediseño todavía no están en main, así que la pestaña usa el encabezado y el estilo que tiene el panel hoy.

## What Changes

- Panel: pestaña "Monitor" con estadísticas de la fábrica, de cada agente y de cada línea
- Supuesto: La parte 1 del rediseño (menú lateral, colores de marca) no está en main: el panel sigue con el encabezado y la paleta de `STYLE`, así que el Monitor usa eso. Cuando llegue la parte 1, hay que mover el enlace al menú nuevo.
- Supuesto: Hoy ningún motor registra tokens. Solo Claude los va a registrar desde este cambio, así que lo anterior y los otros motores muestran "sin dato". Se supone que el `SDKResultMessage` trae `usage.input_tokens`/`output_tokens`.
- Supuesto: Los spans de scout, research y las estaciones de paquetes no tienen `jobId` ni línea. En sus tarjetas, las líneas y las entregas quedan vacías o en cero hasta que esos spans registren la línea (queda como seguimiento).
- Supuesto: Los pull requests abiertos se cuentan solo desde el estado guardado (`MergeState`). Un PR de una línea sin `autoMerge`, o cerrado a mano y nunca consultado, puede figurar como abierto.
- Supuesto: `spansSince` filtra por nombre. Para leer todos los `zero.station.*` del período quizá haga falta un método de lectura nuevo en el store. Con 30 días y mucho historial puede ser costoso, pero solo se lee al pedir la página.
- Supuesto: La recarga cada 15 s vuelve a calcular todo en cada pedido. Se acepta por simplicidad y no se agrega caché.
- Supuesto: El fallo intermitente conocido de `test/panel-line.test.ts` (stream en 2 s) y la duración total de `npm test` ya hicieron fallar corridas anteriores, ajenas a este cambio.

## Capabilities

### New Capabilities
- `control-panel`: Panel: pestaña "Monitor" con estadísticas de la fábrica, de cada agente y de cada línea

### Modified Capabilities

## Impact

Generado por zero para el trabajo 4aadbd20.
