# Spec Delta

## Purpose

Hoy la página "Línea" del panel pregunta cada 5 segundos si algo cambió. Con este cambio, la fábrica le avisa a la página apenas un trabajo cambia de estado (empieza, pasa de estación, falla, espera tu respuesta o se entrega), y la cinta se mueve enseguida, en menos de un par de segundos, sin recargar la página. Si no pasa nada, no se envía nada. Si la conexión de aviso se corta (por ejemplo por el túnel o el celular), la página vuelve sola a preguntar cada 5 segundos y se reconecta después. Al volver a mirar la pestaña se pone al día al instante. Se sigue exigiendo tu clave: sin sesión no hay avisos, y si cambiás la clave los avisos abiertos se cortan. No suma librerías ni cambia la seguridad del panel.

## ADDED Requirements

### Requirement: Stream de cambios de la línea protegido por sesión
El panel SHALL ofrecer `GET /line/events`, un stream Server-Sent Events (`Content-Type: text/event-stream`, `Cache-Control: no-store`) con la vista de la línea. El endpoint MUST exigir la misma sesión que las demás páginas: sin sesión válida responde 401 con la página de ingreso y sin datos de trabajos. La cabecera Content-Security-Policy del panel MUST NOT cambiar.

#### Scenario: Sin sesión
- **WHEN** se pide GET /line/events sin la cookie de sesión
- **THEN** la respuesta es 401, no es text/event-stream y no contiene el id ni el título de ningún trabajo

#### Scenario: Con sesión
- **WHEN** se pide GET /line/events con una sesión válida
- **THEN** la respuesta es 200 con Content-Type text/event-stream y Cache-Control no-store

### Requirement: Estado actual al conectarse
Al abrir el stream, el servidor SHALL enviar de inmediato un evento con el fragmento actual de la línea, el mismo HTML que devuelve `lineView(productionLine(ctx))` y `GET /line?fragment=1`. MUST codificarlo como SSE válido: cada línea del HTML va en su propia línea `data: ` y el evento termina con una línea vacía.

#### Scenario: Primer evento
- **WHEN** hay un trabajo `running` en `build` y se abre GET /line/events con sesión
- **THEN** el primer evento recibido, una vez unidas sus líneas `data:` con saltos de línea, es igual a lineView(productionLine(ctx)) y contiene la fila del trabajo con build en data-state "active"

### Requirement: Aviso ante cada cambio de estado
Cuando cambia lo que muestra la línea (estado, estación, intento, pregunta, entrega, motivo o spans de un trabajo, o un trabajo nuevo), el servidor SHALL enviar a cada stream abierto un evento con el fragmento nuevo en un plazo máximo de 2 s, sin que el navegador lo pida. El cambio MUST detectarse leyendo el estado guardado, para que también cuenten los cambios hechos por otro proceso (por ejemplo `zero answer` desde la terminal). El intervalo de revisión del servidor MUST poder configurarse en `PanelOptions` para los tests.

#### Scenario: Cambio de estación
- **WHEN** con un stream abierto sobre un trabajo en `build`, el store actualiza el trabajo a station `verify` y agrega un span ok `zero.attempt` › `zero.station.build`
- **THEN** en menos de 2 s llega un evento nuevo donde build está en "lista" y verify en "activa"

#### Scenario: Trabajo nuevo
- **WHEN** con un stream abierto se crea un trabajo con requestWork
- **THEN** llega un evento nuevo que contiene la fila id="job-<id>" de ese trabajo

### Requirement: Sin eventos si nada cambia
El servidor MUST NOT enviar un evento de datos cuando el fragmento no cambió desde el último que envió a ese stream. Para que proxies y túneles no corten una conexión callada, SHALL enviar cada 25 s como mucho una línea de comentario SSE (que empieza con `:`).

#### Scenario: Silencio
- **WHEN** se abre el stream y no cambia nada durante varios intervalos de revisión
- **THEN** después del primero no llega ningún otro evento con líneas `data:`; solo puede haber líneas de comentario

### Requirement: Los streams se cortan al cambiar la clave
Un stream abierto MUST cerrarse cuando la sesión con la que se abrió deja de ser válida porque la clave del panel cambió, a más tardar en la siguiente revisión después de vencer la caché de la clave. Después del cierre no se envían más datos.

#### Scenario: Rotación de clave
- **WHEN** un stream abierto con la sesión de la clave A sigue conectado y la opción `key` pasa a devolver la clave B (con `now` avanzado más allá de KEY_TTL_MS)
- **THEN** el servidor termina la respuesta y no llega ningún evento con datos de trabajos después del cambio

### Requirement: El stream no traba el cierre ni pierde recursos
Cuando el cliente se desconecta, el servidor MUST dejar de revisar y de escribir para ese stream. Cerrar el servidor del panel con `close()` y `closeAllConnections()`, como hace el daemon, MUST terminar sin quedar colgado aunque haya streams abiertos.

#### Scenario: Cierre con streams abiertos
- **WHEN** hay dos streams abiertos y se llama a server.close() y server.closeAllConnections()
- **THEN** el callback de close se ejecuta en menos de 2 s

#### Scenario: Cliente que se va
- **WHEN** un cliente aborta su stream y después cambia un trabajo
- **THEN** el servidor no lanza error ni registra un warning por escribir en una conexión cerrada

### Requirement: La página escucha los avisos y aplica solo lo que cambió
El script de la página `/line` SHALL abrir un `EventSource` a `/line/events` (misma origin) y, en cada evento, aplicar el fragmento con la misma actualización en el lugar que ya existe (filas que se conservan, transiciones CSS de la pieza, `<details>` abiertos que siguen abiertos). El script MUST seguir siendo un `<script>` inline con el nonce de la respuesta, sin `eval`, `new Function` ni manejadores `on…=` en el HTML.

#### Scenario: Script de la página
- **WHEN** se pide GET /line con sesión
- **THEN** el HTML contiene `new EventSource("/line/events")`, cada <script> lleva el nonce de la cabecera CSP y no hay atributos on…=

### Requirement: Respaldo por consulta periódica
Si el navegador no tiene `EventSource`, o el stream da error y no está abierto, la página SHALL volver a pedir `/line?fragment=1` cada 5 s, como hoy, mientras esté visible. Cuando la pestaña vuelve a estar visible MUST pedir el fragmento enseguida. Mientras el stream está abierto, la consulta periódica MUST NOT hacer pedidos.

#### Scenario: Respaldo presente
- **WHEN** se pide GET /line con sesión
- **THEN** el script sigue conteniendo `fetch("/line?fragment=1"` con un intervalo de 5000 ms, condicionado a que el stream no esté abierto, y escucha `visibilitychange`
