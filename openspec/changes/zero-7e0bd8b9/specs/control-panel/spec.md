# Spec Delta

## Purpose

Vas a tener una pestaña nueva en el menú del panel, "Sala de control". Es una pantalla oscura, estilo consola de operaciones, llena de módulos chicos con bordes finos, letra monoespaciada y colores neón según el estado: verde si salió bien, amarillo si espera, rojo si falló o hay una alerta, cian si está en marcha. Arriba hay una barra con el reloj, los trabajos en cola, los que están corriendo, los entregados y fallidos de hoy, lo que se gastó hoy y el estado del daemon. Debajo pasa una cinta con los últimos eventos: trabajos que entran, que pasan a otra estación, que se entregan o fallan, y pull requests fundidos. En el centro hay un grafo con las seis estaciones (spec, build, verify, review, security, integrate). Cada trabajo es un punto que se mueve de estación en estación y, al terminar, queda en una columna de decisiones a la derecha como una tarjeta del color de su resultado. A la izquierda hay gráficos chiquitos por línea con las últimas 24 horas: trabajos, intentos, costo y tiempo de verificación. Abajo están el "bus de agentes", con la actividad de cada motor y estación en el tiempo, una traza con los últimos pasos registrados y una tabla de motores con el uso del plan, la cuota y si están en pausa. Las trabas actuales y las alertas aparecen resaltadas en rojo. Todo sale de lo que la fábrica tiene registrado, sin inventar nada. La pantalla se actualiza sola por el mismo canal en vivo que usa la vista de la línea, y si ese canal se corta consulta cada pocos segundos. No usa librerías de afuera. En el celular las columnas se apilan. Es solo para mirar: desde ahí no se puede hacer ninguna acción.

## ADDED Requirements

### Requirement: Pestaña Sala de control en el menú
El panel SHALL mostrar en el menú lateral (`NAV` en `src/panel/html.ts`) de toda página con sesión un enlace a `/control-room` con el texto "Sala de control", marcado con `aria-current="page"` cuando esa es la página mostrada. GET `/control-room` con sesión MUST responder 200 con la página de la sala de control. Sin sesión MUST responder 401 con la página de ingreso y sin datos de la fábrica.

#### Scenario: Enlace en el menú
- **WHEN** se pide `/` con una sesión válida
- **THEN** el HTML contiene `href="/control-room"` y el texto `Sala de control`

#### Scenario: Página marcada
- **WHEN** se pide `/control-room` con sesión
- **THEN** la respuesta es 200 y el enlace a `/control-room` tiene `aria-current="page"`

#### Scenario: Sin sesión
- **WHEN** se pide `/control-room` sin cookie de sesión
- **THEN** la respuesta es 401, contiene "Panel de tu fábrica" y no contiene el nombre de ninguna línea configurada

### Requirement: Barra superior con datos reales
La sala de control SHALL mostrar una barra superior (`data-module="topbar"`) con: el reloj (hora local del servidor al armar la vista, `HH:MM:SS`, que el script de la página adelanta cada segundo), los trabajos `queued`, los trabajos `running` y los `waiting` por separado, los entregados y los fallidos de hoy (`factoryStatus().today.delivered` y `.failed`), el costo del día (`budget.spentUsd` como gasto real y `budget.estimatedUsd` como estimado, en USD con dos decimales) y el estado del daemon (`daemon.state`: `running`, `unresponsive`, `stopped` o `crashed`, con su texto en español). Todas las cifras MUST salir del estado guardado.

#### Scenario: Contadores
- **WHEN** hay 2 trabajos `queued`, 1 `running`, 1 entregado hoy y 1 fallido hoy
- **THEN** la barra superior muestra 2 en cola, 1 corriendo, 1 entregado y 1 fallido, cada cifra en un elemento con su `data-stat` (`queued`, `running`, `delivered`, `failed`)

#### Scenario: Costo del día
- **WHEN** hoy hay spans `gen_ai.invoke_agent` con facturación `api` que suman 1.25 USD
- **THEN** la barra muestra `$1.25` como costo del día

#### Scenario: Daemon caído
- **WHEN** el estado del daemon es `crashed`
- **THEN** la barra muestra el estado del daemon con `data-status="bad"`

### Requirement: Cinta de eventos en vivo
La sala de control SHALL mostrar una cinta (`data-module="ticker"`) con los eventos de las últimas 24 horas, el más nuevo primero y como máximo 40. Los eventos son: trabajo que entró (`createdAt`), trabajo que pasó a una estación (inicio de un span `zero.station.<estación>` con `jobId`, para spec, build, verify, review, security e integrate), trabajo entregado o fallido (`finishedAt` con estado `delivered` o `failed`) y pull request fundido (span `zero.merge` terminado). Cada evento muestra la hora, el tipo, la línea y el id del trabajo, con el texto escapado. La cinta MUST desplazarse con una animación CSS y MUST respetar `prefers-reduced-motion`.

#### Scenario: Tipos de evento
- **WHEN** en las últimas 24 horas un trabajo se creó, abrió un span `zero.station.build` y terminó `delivered`, y hay un span `zero.merge` terminado
- **THEN** la cinta contiene un evento de cada tipo (`data-event` `created`, `station`, `delivered`, `merged`), ordenados del más nuevo al más viejo

#### Scenario: Ventana y límite
- **WHEN** hay 50 eventos en las últimas 24 horas y uno de hace 30 horas
- **THEN** la cinta muestra exactamente 40 eventos y no muestra el de hace 30 horas

#### Scenario: Escape
- **WHEN** la línea de un trabajo se llama `<b>x</b>`
- **THEN** el HTML de la cinta contiene `&lt;b&gt;x&lt;/b&gt;` y no contiene `<b>x</b>`

#### Scenario: Movimiento reducido
- **WHEN** se lee el CSS de la página
- **THEN** hay una regla `@media (prefers-reduced-motion: reduce)` que apaga la animación de la cinta

### Requirement: Grafo de estaciones y columna de decisiones
La sala de control SHALL dibujar en SVG incrustado (`data-module="graph"`) un nodo por estación en el orden spec, build, verify, review, security, integrate, y un punto (`data-job="<id>"`, `data-at="<estación>"`) por cada trabajo sin terminar, puesto en la estación donde está según la misma regla de `productionLine` (`LineRow.at`; un trabajo `queued` sin estación va a la entrada, `data-at="queued"`). Los trabajos terminados en las últimas 24 horas (como máximo 20, los más nuevos) MUST aparecer en una columna de decisiones a la derecha como tarjetas (`data-decision="<id>"`) coloreadas por resultado: `delivered` verde, `failed` rojo, `stopped` amarillo. Los puntos `running` MUST usar el color cian y una animación, los `waiting` el amarillo. Cuando llega una actualización, el script de la página MUST mover el punto que ya existía con el mismo `data-job` a su nueva posición (con una transición CSS) en vez de crear uno nuevo.

#### Scenario: Punto en su estación
- **WHEN** hay un trabajo `running` con `station` `verify`
- **THEN** el SVG del grafo contiene un elemento con `data-job` igual a su id y `data-at="verify"`

#### Scenario: Estaciones en orden
- **WHEN** se arma el grafo
- **THEN** los nodos `data-node` aparecen en el orden spec, build, verify, review, security, integrate

#### Scenario: Decisiones
- **WHEN** en las últimas 24 horas terminaron un trabajo `delivered`, uno `failed` y uno `stopped`
- **THEN** la columna de decisiones tiene tres tarjetas con `data-status` `ok`, `bad` y `warn`, respectivamente

#### Scenario: Terminado viejo
- **WHEN** un trabajo terminó hace 30 horas
- **THEN** no aparece en la columna de decisiones

#### Scenario: Script que mueve puntos
- **WHEN** se pide `/control-room`
- **THEN** el script de la página busca los puntos por `data-job` para actualizarlos en su lugar

### Requirement: Series por línea de las últimas 24 horas
La sala de control SHALL mostrar a la izquierda (`data-module="series"`) un bloque por línea configurada (`data-line="<nombre>"`) con cuatro sparklines SVG de 24 cubetas de una hora que terminan en la hora actual: trabajos creados, intentos (spans `zero.attempt` iniciados de trabajos de la línea), costo (suma de `zero.cost.usd` de los spans `gen_ai.invoke_agent` de trabajos de la línea) y tiempo de verificación (promedio de duración de los spans `zero.station.verify` terminados, sin `zero.skipped`, en la cubeta; 0 si no hubo). Cada sparkline MUST mostrar el último valor y el total o el máximo de la ventana. Una línea sin actividad MUST mostrar sus series en cero.

#### Scenario: Cubeta de trabajos
- **WHEN** la línea `tienda` tiene 2 trabajos creados hace 30 minutos y 1 hace 5 horas
- **THEN** la serie de trabajos de `tienda` tiene 24 valores, el último es 2, el de 5 horas atrás es 1 y la suma es 3

#### Scenario: Costo de la línea
- **WHEN** un trabajo de `tienda` tiene spans de agente con costo 0.10 y 0.30 en la última hora
- **THEN** el último valor de la serie de costo de `tienda` es 0.40

#### Scenario: Verificación promedio
- **WHEN** hay dos spans `zero.station.verify` de `tienda` terminados en la última hora, de 2 y 4 minutos
- **THEN** el último valor de la serie de verificación es 3 minutos (180000 ms)

#### Scenario: Línea sin actividad
- **WHEN** una línea configurada no tiene trabajos
- **THEN** su bloque existe y sus cuatro series son 24 ceros

### Requirement: Bus de agentes
La sala de control SHALL mostrar (`data-module="bus"`) la actividad de las últimas 6 horas en SVG: una fila por motor (`zero.engine`) y una por estación o agente (`gen_ai.agent.name`) de los spans `gen_ai.invoke_agent`, con un segmento por llamada ubicado y medido en el tiempo según su inicio y su fin (hasta ahora si sigue abierta), coloreado por estado: abierta cian, `ok` verde, `error` rojo.

#### Scenario: Filas por motor y estación
- **WHEN** en las últimas 6 horas hay un span de `build` con motor `claude` y uno de `review` con motor `codex`
- **THEN** el bus tiene filas `data-row` para `claude`, `codex`, `build` y `review`

#### Scenario: Llamada abierta
- **WHEN** un span de agente empezó hace 10 minutos y no terminó
- **THEN** su segmento tiene `data-status="run"` y llega hasta el borde derecho (ahora)

#### Scenario: Fuera de la ventana
- **WHEN** un span de agente terminó hace 7 horas
- **THEN** no aparece en el bus

### Requirement: Traza de decisiones
La sala de control SHALL mostrar (`data-module="trace"`) los últimos 20 spans terminados de las últimas 24 horas, el más nuevo primero, cada uno con la hora de fin, el nombre del span, el trabajo (enlace a `/job/<id>` cuando tiene uno), el estado, la duración y el costo cuando lo tiene. Los textos MUST ir escapados.

#### Scenario: Últimos 20
- **WHEN** hay 25 spans terminados en las últimas 24 horas
- **THEN** la traza muestra 20 filas y la primera es la del span que terminó último

#### Scenario: Enlace al trabajo
- **WHEN** un span de la traza tiene `jobId` `abcd1234`
- **THEN** su fila contiene `href="/job/abcd1234"`

### Requirement: Tabla de motores
La sala de control SHALL mostrar (`data-module="engines"`) una fila por motor de `budgetState().engines` con: facturación (`subscription`, `api` o `unknown`), el uso de cada ventana vigente del plan de ese motor (`windows`, con su etiqueta y porcentaje como en el Monitor), y si está en pausa, con `until` y `reason`. Un motor en pausa MUST mostrarse con `data-status="bad"`.

#### Scenario: Motor en pausa
- **WHEN** `budgetState` informa el motor `codex` en pausa con un motivo
- **THEN** la fila de `codex` tiene `data-status="bad"` y muestra el motivo

#### Scenario: Uso del plan
- **WHEN** el último span de `claude` informa una ventana de suscripción usada al 40 %
- **THEN** la fila de `claude` muestra esa ventana con 40 %

### Requirement: Trabas y alertas en rojo
La sala de control SHALL mostrar (`data-module="alerts"`) resaltadas con `data-status="bad"`: cada traba de `factoryStatus().jams` (con su texto y `qué falta` como `jamLine`), cada caída de entorno (`outages`), cada bloqueo por facturación (`billing`), cada pull request en `merges` con estado `blocked`, las alertas de seguridad abiertas por línea (`securityAlerts`), el andon encendido, el presupuesto alcanzado (`budget.reached`, con `reason`) y un daemon que no está `running`. Sin ninguna de esas cosas MUST mostrar "Sin trabas ni alertas".

#### Scenario: Traba
- **WHEN** `factoryStatus` tiene una traba en `jams`
- **THEN** el módulo de alertas tiene un elemento con `data-status="bad"` que muestra el texto de la traba

#### Scenario: Andon
- **WHEN** el andon está encendido
- **THEN** el módulo de alertas muestra un aviso rojo sobre el andon

#### Scenario: Sin alertas
- **WHEN** no hay trabas, caídas, bloqueos ni alertas, el andon está apagado, el presupuesto no se alcanzó y el daemon está `running`
- **THEN** el módulo muestra "Sin trabas ni alertas"

### Requirement: Actualización en vivo por stream con polling de respaldo
GET `/control-room?fragment=1` con sesión MUST devolver solo el fragmento de la sala de control. GET `/control-room/events` con sesión MUST abrir un stream `text/event-stream` que manda el fragmento al abrirse y otra vez cada vez que cambia, con el mismo vigilante, latido, cierre por cambio de clave y encabezados que `/line/events`. Sin sesión MUST responder 401. El script de la página MUST usar `EventSource("/control-room/events")` y, mientras el stream no esté abierto, consultar `/control-room?fragment=1` cada 5 segundos con la página visible. `/line/events` MUST seguir mandando solo el fragmento de la línea.

#### Scenario: Primer fragmento
- **WHEN** se abre `/control-room/events` con sesión
- **THEN** el primer evento `data:` contiene `data-module="topbar"`

#### Scenario: Cambio
- **WHEN** con el stream abierto (vigilante de 20 ms), un trabajo nuevo entra en cola
- **THEN** llega un nuevo evento cuyo fragmento muestra un trabajo más en cola

#### Scenario: Stream sin sesión
- **WHEN** se pide `/control-room/events` sin cookie
- **THEN** la respuesta es 401

#### Scenario: Respaldo
- **WHEN** se pide `/control-room`
- **THEN** el HTML contiene `new EventSource("/control-room/events")` y `/control-room?fragment=1`

#### Scenario: Línea intacta
- **WHEN** están abiertos a la vez `/line/events` y `/control-room/events`
- **THEN** el stream de la línea no recibe fragmentos de la sala de control

### Requirement: Estética de consola, sin recursos externos, apta para celular
La página `/control-room` MUST dibujarse con SVG y CSS incrustados por el servidor: fondo oscuro propio en ambos temas del panel, tipografía monoespaciada chica, módulos con bordes finos y los colores neón verde, amarillo, rojo y cian asignados por `data-status` (`ok`, `warn`, `bad`, `run`). MUST NOT cargar scripts, hojas de estilo, fuentes ni imágenes externas, MUST NOT tener más `<script>` que el suyo con el nonce de la página, y su grilla MUST apilar las columnas en una sola en pantallas de hasta 600 px.

#### Scenario: Sin recursos externos
- **WHEN** se pide `/control-room`
- **THEN** el HTML no contiene `<script src`, `<link`, `src="http` ni `url(http`, y todo `<script` lleva `nonce=`

#### Scenario: Celular
- **WHEN** se lee el CSS de la sala de control
- **THEN** hay una regla `@media (max-width: 600px)` que deja su grilla en una columna

#### Scenario: Tipografía y colores
- **WHEN** se lee el CSS de la sala de control
- **THEN** usa una familia `monospace` y define colores para `data-status` `ok`, `warn`, `bad` y `run`

### Requirement: Sala de control solo lectura
La sala de control MUST ser solo lectura: `/control-room` y su fragmento MUST NOT tener formularios ni botones de acción, y armar su vista (`controlRoomView` en `src/app.ts`) MUST NOT escribir jobs, spans, kv ni archivos.

#### Scenario: Sin formularios
- **WHEN** se pide `/control-room` y `/control-room?fragment=1`
- **THEN** ninguno de los dos contiene `<form` ni `method="post"`

#### Scenario: Sin escrituras
- **WHEN** se llama a `controlRoomView` dos veces con el mismo `now` sobre un estado con trabajos, spans y kv
- **THEN** la cantidad de jobs, spans y claves kv no cambia y ambas llamadas devuelven lo mismo
