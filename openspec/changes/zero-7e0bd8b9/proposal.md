# Proposal

## Why

Vas a tener una pestaña nueva en el menú del panel, "Sala de control". Es una pantalla oscura, estilo consola de operaciones, llena de módulos chicos con bordes finos, letra monoespaciada y colores neón según el estado: verde si salió bien, amarillo si espera, rojo si falló o hay una alerta, cian si está en marcha. Arriba hay una barra con el reloj, los trabajos en cola, los que están corriendo, los entregados y fallidos de hoy, lo que se gastó hoy y el estado del daemon. Debajo pasa una cinta con los últimos eventos: trabajos que entran, que pasan a otra estación, que se entregan o fallan, y pull requests fundidos. En el centro hay un grafo con las seis estaciones (spec, build, verify, review, security, integrate). Cada trabajo es un punto que se mueve de estación en estación y, al terminar, queda en una columna de decisiones a la derecha como una tarjeta del color de su resultado. A la izquierda hay gráficos chiquitos por línea con las últimas 24 horas: trabajos, intentos, costo y tiempo de verificación. Abajo están el "bus de agentes", con la actividad de cada motor y estación en el tiempo, una traza con los últimos pasos registrados y una tabla de motores con el uso del plan, la cuota y si están en pausa. Las trabas actuales y las alertas aparecen resaltadas en rojo. Todo sale de lo que la fábrica tiene registrado, sin inventar nada. La pantalla se actualiza sola por el mismo canal en vivo que usa la vista de la línea, y si ese canal se corta consulta cada pocos segundos. No usa librerías de afuera. En el celular las columnas se apilan. Es solo para mirar: desde ahí no se puede hacer ninguna acción.

## What Changes

- Pestaña "Sala de control" del panel
- Supuesto: Pull requests that auto-merge merges on its own leave no timestamped record: `MergeState` has no merge time, and only `mergeRequested` and the third-party merge write a `zero.merge` span. So the ticker's "PR fundido" events will only show merges made on request until auto-merge also records a span.
- Supuesto: 'Costo del día' is read as `budget.spentUsd`, the real per-use spend that is the same figure the budget uses, with `budget.estimatedUsd` shown next to it as the estimate. On subscription plans the real spend is $0.00.
- Supuesto: The agent bus window is an assumption: 6 hours. The request does not give one, and 24 hours of individual calls would be unreadable in one strip.
- Supuesto: 'Trabajos en cola, corriendo' counts `waiting` separately from `running`. The Monitor merges them, so the two tabs can show different 'en curso' numbers.
- Supuesto: The tab uses its own dark theme scoped to the page while the rest of the panel keeps its light and dark tokens. Contrast and the phone layout can only be checked by tests as CSS rules, not visually.
- Supuesto: The current stream code renders `lineView(productionLine(ctx))` once per tick for every stream. Generalising it must keep one render per kind per tick, or open control-room streams would add store reads every second; the control-room view reads spans of 24 h on each tick.
- Supuesto: `productionLine` calls `factoryStatus`, which may be costly to compute. `controlRoomView` should compute `factoryStatus` once and reuse it, not call `productionLine` and `factoryStatus` separately, if the build can share them.

## Capabilities

### New Capabilities
- `control-panel`: Pestaña "Sala de control" del panel

### Modified Capabilities

## Impact

Generado por zero para el trabajo 7e0bd8b9.
