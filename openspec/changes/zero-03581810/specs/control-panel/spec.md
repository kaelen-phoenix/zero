# Spec Delta

## Purpose

El panel va a tener un menú nuevo, "Línea", con una página donde cada trabajo se ve como una cinta transportadora. Las estaciones van en este orden: preparación, especificación, construcción, verificación, revisión, seguridad e integración. Cada estación tiene su propio ícono y muestra su estado con color, ícono y texto: pendiente, activa (animada), terminada (tilde), con error (en rojo y con el motivo) o esperándote ("te espera"). La pieza avanza por la cinta. Si un intento falla, vuelve a construcción y se ve "intento 2 de 3" con el error que lo causó. Al final sale de la cinta como entregada (con el enlace al pull request y si ya se fundió) o como fallida. Al tocar una estación ves cuánto tardó, cuánto costó, qué motor usó y el error, con los mismos datos que `zero trace`. Arriba hay contadores: activos, esperando, con error y entregados hoy. Si no hay nada, aparece "La fábrica está libre". La página se actualiza sola cada pocos segundos sin recargarse y anima solo lo que está pasando ahora. En el celular la cinta se pone vertical. Si tu sistema pide reducir el movimiento, no hay animaciones. No suma librerías y respeta la clave y la seguridad actuales del panel.

## ADDED Requirements

### Requirement: Menú y página de la línea de producción
El panel SHALL ofrecer en su menú un enlace "Línea" a una página nueva `GET /line` titulada "Línea de producción". La página MUST exigir una sesión válida como las demás páginas: sin sesión responde 401 con la página de ingreso y sin datos de la fábrica.

#### Scenario: Sin sesión
- **WHEN** se pide GET /line sin la cookie de sesión
- **THEN** la respuesta es 401, contiene "Panel de tu fábrica" y no contiene el nombre de la línea ni el título de ningún trabajo

#### Scenario: Con sesión
- **WHEN** se pide GET /line con una sesión válida
- **THEN** la respuesta es 200 y contiene "Línea de producción"; las demás páginas del panel tienen en el menú un enlace a "/line"

### Requirement: Filas de trabajos
La página SHALL mostrar una fila por trabajo: primero los que están en curso, esperando o en cola, y debajo los últimos terminados (los mismos `recent` de `factoryStatus`). Cada fila MUST mostrar el identificador del trabajo, la línea y el título (`jobName`), todos escapados.

#### Scenario: Activos arriba y terminados abajo
- **WHEN** hay un trabajo corriendo en `build` y otro entregado
- **THEN** la fila del trabajo en curso aparece antes que la del entregado, y cada una contiene su id, su línea y su título

#### Scenario: Escapado
- **WHEN** un trabajo tiene el título `<script>x</script>`
- **THEN** el HTML contiene `&lt;script&gt;x&lt;/script&gt;` y no la etiqueta sin escapar

### Requirement: Estaciones en orden con ícono propio
Cada fila SHALL mostrar estas siete estaciones, en este orden y unidas por una cinta: setup (preparación), spec (especificación), build (construcción), verify (verificación), review (revisión), security (seguridad) e integrate (integración). Cada estación MUST tener un ícono propio, hecho con SVG inline o con caracteres y sin recursos externos, y un atributo `data-station` con su nombre.

#### Scenario: Orden
- **WHEN** se muestra un trabajo cualquiera
- **THEN** los atributos data-station aparecen en el orden setup, spec, build, verify, review, security, integrate, cada uno con su etiqueta en español

### Requirement: Estado de cada estación
Cada estación SHALL mostrar uno de estos estados: `pending`, `active`, `done`, `error` o `waiting`. Lo MUST mostrar a la vez con una clase o un atributo `data-state`, un ícono y un texto visible: "pendiente", "activa", "lista", "error" o "te espera", nunca solo con color. El estado SHALL salir solamente de los datos guardados: el estado del trabajo, `station`, `checkpoint`, `attempt`, `question`, `delivery`, `reason` y los spans del trabajo (`zero.setup` y `zero.station.<estación>`). Reglas: - Una estación cuyo último span terminó bien está `done`. - La estación actual de un trabajo `running` está `active`. - La estación donde está parado un trabajo `waiting` está `waiting`. - La estación cuyo último span terminó con error está `error`, con el motivo resumido (`error.message` o `reason`). - Las demás están `pending`.

#### Scenario: Activo en build
- **WHEN** un trabajo está `running` con station `build`, attempt 1, y con spans ok de `zero.setup` y `zero.station.spec`
- **THEN** setup y spec están en "lista", build en "activa", y verify, review, security e integrate en "pendiente"

#### Scenario: Error en verify
- **WHEN** un trabajo terminó `failed`, el último span `zero.station.verify` tiene status error y `error.message` "tests rojos"
- **THEN** verify tiene data-state "error", el texto "error" y el motivo "tests rojos"

#### Scenario: Esperando al dueño
- **WHEN** un trabajo está `waiting` con una pregunta de tipo `before-integrate`
- **THEN** integrate tiene data-state "waiting" y el texto "te espera", y las estaciones anteriores con span ok están en "lista"

#### Scenario: Estación omitida
- **WHEN** la línea no tiene comandos de setup y no existe ningún span `zero.setup`
- **THEN** setup no aparece como activa ni con error en un trabajo que ya pasó a spec

### Requirement: Reintentos visibles
Cuando un trabajo está en el intento N con N mayor que 1, su fila SHALL mostrar "intento N de M", donde M es el `maxAttempts` de la línea. La fila MUST mostrar también el error que causó el reintento, tomado del `error.message` del span `zero.attempt` anterior o de `feedback`, resumido y escapado. La pieza MUST quedar en `build`, marcada con una clase de retroceso.

#### Scenario: Reintentando
- **WHEN** un trabajo está `running` en `build` con attempt 2, la línea tiene maxAttempts 3 y el span del intento 1 terminó con error "falló verify"
- **THEN** la fila contiene "intento 2 de 3" y "falló verify", y build está activa

### Requirement: Pieza sobre la cinta y salida
Cada fila SHALL mostrar una pieza que representa el trabajo. Su posición viene de la estación actual y se expresa en un atributo de datos o en una propiedad CSS, para que un cambio de estación se pueda animar con transiciones de CSS. Un trabajo `delivered` MUST mostrar la pieza fuera de la cinta, con la etiqueta "entregado", la descripción de la entrega (`describeDelivery`) y el enlace al pull request si existe. Un trabajo `failed` o `stopped` MUST mostrarla fuera de la cinta con "fallido" o "detenido" y el motivo resumido.

#### Scenario: Entregado
- **WHEN** un trabajo está `delivered` con una entrega pull-request con url https://github.com/o/r/pull/7
- **THEN** la fila contiene "entregado" y un enlace a https://github.com/o/r/pull/7, y todas sus estaciones con span ok están en "lista"

#### Scenario: Fallido
- **WHEN** un trabajo está `failed` con reason "Se agotaron los 3 intentos"
- **THEN** la fila contiene "fallido" y "Se agotaron los 3 intentos"

### Requirement: Detalle de la estación
Al tocar una estación SHALL aparecer su detalle: duración, costo, motor y error si lo hubo. Los valores salen de los spans de esa estación y de sus spans hijos, con el mismo cálculo que `renderTrace` y `zero trace`. Por ejemplo, el costo es la suma de `zero.cost.usd` y el motor es `zero.engine`, con el modelo si está. El detalle MUST funcionar sin JavaScript, por ejemplo con `<details>`.

#### Scenario: Detalle de spec
- **WHEN** el span `zero.station.spec` duró 2 s y tiene un hijo de agente con zero.engine "claude" y zero.cost.usd 0.25
- **THEN** el detalle de spec contiene "2.0 s", "$0.250" y "claude"

### Requirement: Resumen con contadores
Arriba de la página SHALL haber cuatro contadores: trabajos activos (en curso más en cola), esperando, con error (fallidos hoy) y entregados hoy. MUST usar los mismos números que `factoryStatus`.

#### Scenario: Contadores
- **WHEN** hay un trabajo corriendo, uno esperando y uno entregado hoy
- **THEN** la página muestra 1 activo, 1 esperando y 1 entregado hoy, con las etiquetas "activos", "esperando", "con error" y "entregados hoy"

### Requirement: Fábrica libre
Si no hay ningún trabajo para mostrar, la página SHALL mostrar el mensaje "La fábrica está libre" y una cinta quieta, sin ninguna estación en estado `active`.

#### Scenario: Sin trabajos
- **WHEN** se pide GET /line con la base de trabajos vacía
- **THEN** el HTML contiene "La fábrica está libre" y ningún elemento con data-state "active"

### Requirement: Actualización automática con nonce
La página SHALL actualizarse sola cada pocos segundos (entre 3 y 10) sin recargarse. Para eso pide un fragmento autenticado, por ejemplo `GET /line?fragment=1` o `GET /line/rows`, y reemplaza o actualiza solo las filas. El script MUST ser un `<script>` inline con el nonce de la respuesta, MUST NOT usar `eval`, `new Function` ni manejadores inline (`on...=`), y su pedido MUST ir a la misma origin. El fragmento MUST exigir sesión. La política de seguridad de contenido del panel MUST NOT cambiar.

#### Scenario: Script con nonce
- **WHEN** se pide GET /line con sesión
- **THEN** cada etiqueta <script> del HTML lleva nonce igual al valor 'nonce-…' de la cabecera Content-Security-Policy, el HTML no contiene atributos on…= y la cabecera CSP es la misma que la de GET /

#### Scenario: Fragmento protegido
- **WHEN** se pide el endpoint del fragmento sin sesión
- **THEN** responde 401 sin datos de trabajos

#### Scenario: Fragmento con datos
- **WHEN** se pide el endpoint del fragmento con sesión mientras hay un trabajo en build
- **THEN** responde 200 con la fila de ese trabajo y build en data-state "active"

### Requirement: Animaciones solo con CSS y solo en lo activo
Las animaciones SHALL estar hechas solo con CSS (transiciones y `@keyframes`) dentro del estilo inline del panel: - el engranaje gira, la lupa recorre y el escudo brilla en la estación activa; - la cinta avanza hacia la estación activa; - el tilde aparece con un rebote; - la estación con error se sacude una vez; - la estación que espera late despacio; - la pieza se desliza. Las animaciones infinitas MUST aplicarse solo a estaciones `active` o `waiting` de trabajos no terminados. Las de un trabajo terminado MUST NOT repetirse.

#### Scenario: Keyframes presentes
- **WHEN** se pide GET /line
- **THEN** el CSS contiene reglas @keyframes y las reglas con `animation: … infinite` solo apuntan a selectores de estado active o waiting

### Requirement: Movimiento reducido
El CSS MUST contener una regla `@media (prefers-reduced-motion: reduce)` que desactive las animaciones y las transiciones, por ejemplo con `animation: none` y `transition: none`. Los estados MUST seguir siendo distinguibles por ícono y texto.

#### Scenario: Regla de movimiento reducido
- **WHEN** se pide GET /line
- **THEN** el HTML contiene `@media (prefers-reduced-motion: reduce)` y dentro de ese bloque `animation: none` y `transition: none`

### Requirement: Pantallas angostas
En pantallas angostas (por ejemplo, menos de 600 px de ancho) la cinta SHALL pasar a vertical o desplazarse en horizontal sin desbordar la página. Para eso MUST haber una regla `@media (max-width: …)` para la cinta.

#### Scenario: Regla para el celular
- **WHEN** se pide GET /line
- **THEN** el CSS contiene una regla @media (max-width: …) que cambia la dirección de la cinta (flex-direction: column) o le da overflow-x: auto
