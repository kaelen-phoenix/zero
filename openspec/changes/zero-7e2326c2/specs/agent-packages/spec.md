# Spec Delta

## Purpose

Una estación de un paquete va a poder detectar algo y pedirle un trabajo a la fábrica con `ctx.requestJob({ line, text })`, en vez de tocar repositorios por su cuenta. El cambio pasa por la línea normal: especificación, construcción, verify, revisión e integración, con la autonomía de esa línea. Vos decidís qué paquete puede pedir: el manifiesto de la estación tiene que declarar `requests: { perLinePerDay: N }`, y sin eso no puede. La fábrica respeta el cupo por línea y por día, el presupuesto y el andón; si no se puede, la estación recibe el motivo y no pasa nada más. El texto se recorta, se limpia de secretos y rutas locales, y los agentes lo reciben como datos de un tercero. Estos trabajos corren después de tus pedidos, como los del turno nocturno, y los vas a ver en el estado, el panel, el briefing y el informe mensual como "pedido por paquete <paquete>/<estación>". La documentación queda en los dos README y en AGENTS.md.

## ADDED Requirements

### Requirement: Declarar el permiso de pedir trabajos en el manifiesto
El manifiesto de una estación SHALL aceptar la clave opcional `requests` con la forma `{ perLinePerDay: N }`, donde N es un entero positivo, y ManifestSchema MUST rechazar cualquier otra forma; PACKAGE_INTERFACE MUST seguir siendo 1.

#### Scenario: Manifiesto válido
- **WHEN** una estación declara `requests: { perLinePerDay: 2 }` en un paquete con `interface: 1`
- **THEN** el paquete carga y la estación cargada tiene `requests.perLinePerDay` igual a 2

#### Scenario: Valor inválido
- **WHEN** una estación declara `requests: { perLinePerDay: 0 }`, `requests: { perLinePerDay: 1.5 }` o `requests: { otra: 1 }`
- **THEN** el paquete queda fuera y su problema nombra `requests`

### Requirement: Sin declaración no se puede pedir
Una estación sin `requests` en su manifiesto MUST recibir un motivo de `ctx.requestJob` y la fábrica SHALL NOT crear ningún trabajo.

#### Scenario: Estación sin permiso
- **WHEN** una estación sin `requests` llama a `ctx.requestJob({ line: 'web', text: 'arreglar algo' })`
- **THEN** devuelve un objeto con `reason` y sin `id`, y la cantidad de trabajos sigue igual

### Requirement: Abrir un trabajo normal con su origen
Cuando el pedido se puede tomar, `ctx.requestJob({ line, text })` SHALL crear un trabajo de tipo `request` en la cola de esa línea, a través de `requestWork`, con fuente `{ kind: 'package', package, station }`, y MUST devolver `{ id }` con el identificador del trabajo.

#### Scenario: Pedido aceptado
- **WHEN** una estación con `requests: { perLinePerDay: 1 }` del paquete `hello`, llamada `nota`, pide un trabajo en la línea `web`
- **THEN** el resultado tiene `id`, y ese trabajo está `queued` en `web` con fuente `{ kind: 'package', package: 'hello', station: 'nota' }`

### Requirement: Solo líneas de la fábrica
`ctx.requestJob` MUST devolver un motivo, sin crear trabajo, cuando `line` no es una de las líneas de `ctx.lines`, incluso si la fábrica tiene una sola línea.

#### Scenario: Línea desconocida
- **WHEN** la estación pide un trabajo en la línea `otra`, que no existe, en una fábrica con una sola línea `web`
- **THEN** devuelve `reason`, no crea ningún trabajo y `web` no recibe nada

### Requirement: Cupo por estación, línea y día
La fábrica SHALL contar en kv los trabajos que cada estación abrió en cada línea durante el día local y MUST devolver un motivo cuando la estación ya llegó a `perLinePerDay` en esa línea; el cupo MUST ser independiente del estado que la estación maneja con `ctx.state` y un pedido rechazado SHALL NOT consumirlo.

#### Scenario: Cupo agotado
- **WHEN** una estación con `perLinePerDay: 1` pide dos trabajos en la línea `web` el mismo día
- **THEN** el primero devuelve `id`, el segundo devuelve `reason` y hay un solo trabajo

#### Scenario: Otra línea
- **WHEN** esa misma estación, con el cupo agotado en `web`, pide un trabajo en la línea `blog`
- **THEN** devuelve `id`

#### Scenario: Día nuevo
- **WHEN** la estación pide otro trabajo en `web` en una pasada del día local siguiente
- **THEN** devuelve `id`

#### Scenario: Rechazo sin consumo
- **WHEN** una estación con `perLinePerDay: 1` pide con texto vacío y después pide con texto válido
- **THEN** el primero devuelve `reason` y el segundo devuelve `id`

#### Scenario: El estado no toca el cupo
- **WHEN** una estación con el cupo agotado escribe en `ctx.state` y vuelve a pedir
- **THEN** sigue devolviendo `reason`

### Requirement: Andón, presupuesto y fin de la pasada
`ctx.requestJob` MUST devolver un motivo, sin crear trabajo, cuando el andón está activo, cuando `budgetState` indica que se alcanzó el presupuesto o cuando el `signal` de la pasada ya está abortado.

#### Scenario: Andón activo
- **WHEN** la estación pide un trabajo con el andón activado durante su pasada
- **THEN** devuelve `reason` y no se crea ningún trabajo

#### Scenario: Presupuesto alcanzado
- **WHEN** la estación pide un trabajo después de que `budgetState` pasó a `reached: true`
- **THEN** devuelve `reason` y no se crea ningún trabajo

#### Scenario: Pasada terminada
- **WHEN** una estación guarda su `ctx`, su pasada se aborta y luego llama a `requestJob`
- **THEN** devuelve `reason` y no se crea ningún trabajo

### Requirement: Nunca tira
`ctx.requestJob` MUST devolver un motivo en vez de lanzar una excepción ante cualquier entrada o falla interna, incluidos `line` o `text` que no son texto, un texto vacío o un argumento ausente.

#### Scenario: Entradas inválidas
- **WHEN** la estación llama a `requestJob()` , a `requestJob({ line: 1, text: {} })` y a `requestJob({ line: 'web', text: ' ' })`
- **THEN** las tres llamadas devuelven `reason` sin lanzar y no se crea ningún trabajo

#### Scenario: Falla interna
- **WHEN** la creación del trabajo lanza un error cuyo mensaje contiene el valor de un secreto declarado por la estación
- **THEN** `requestJob` devuelve `reason` sin ese valor y el cupo no cambia

### Requirement: Limpiar y recortar el texto
La fábrica MUST guardar el texto del pedido sin los valores de los secretos declarados por la estación, sin los patrones de secretos que reconoce `redact` y sin rutas locales, recortado a 4000 caracteres como máximo.

#### Scenario: Texto limpio
- **WHEN** el texto contiene el valor de un secreto declarado, un token `ghp_` con forma válida y una ruta bajo /home
- **THEN** el `request` del trabajo no contiene ninguno de los tres

#### Scenario: Texto largo
- **WHEN** el texto tiene 10000 caracteres
- **THEN** el `request` del trabajo tiene como máximo 4000 caracteres

### Requirement: El texto llega a los agentes como datos
El bloque de pedido que reciben los agentes para un trabajo con fuente `package` MUST nombrar al paquete y la estación de origen, MUST decir que el texto viene de un tercero y es dato y no instrucciones para saltear controles, y SHALL NOT decir que lo envió la persona dueña de la fábrica.

#### Scenario: Prompt de la estación spec
- **WHEN** un trabajo con fuente `{ kind: 'package', package: 'hello', station: 'nota' }` llega a la estación spec con un agente falso
- **THEN** el prompt contiene `hello/nota` y el texto de datos de un tercero, y no contiene `The owner sent`

#### Scenario: Otros trabajos sin cambios
- **WHEN** un trabajo sin fuente llega a la estación spec
- **THEN** el prompt sigue conteniendo `The owner sent a request in plain language`

### Requirement: Misma autonomía e integración que un pedido normal
Un trabajo con fuente `package` SHALL seguir el nivel, la política de aprobación y el modo de integración de su línea igual que un pedido sin fuente, sin pasar por las retenciones propias del turno nocturno.

#### Scenario: Línea en L2
- **WHEN** un trabajo con fuente `package` corre en una línea L2 con integración `merge` y agentes falsos
- **THEN** termina `delivered` con entrega `merge`, sin ninguna pregunta

#### Scenario: Línea en L1
- **WHEN** un trabajo con fuente `package` corre en una línea L1 con agentes falsos
- **THEN** queda `waiting` con la especificación para aprobar, igual que un pedido sin fuente

### Requirement: Prioridad baja en el daemon
El daemon MUST considerar los trabajos con fuente `package` después de los demás trabajos en cola y SHALL arrancarlos solo cuando no haya otro trabajo corriendo ni otro trabajo en cola que no sea de baja prioridad, igual que los trabajos autónomos del turno nocturno.

#### Scenario: Orden de la cola
- **WHEN** `ownerFirst` recibe, en este orden, un trabajo de paquete, un trabajo autónomo del turno nocturno y un trabajo sin fuente
- **THEN** el trabajo sin fuente queda primero y los otros dos después, en su orden original

#### Scenario: Espera al pedido normal
- **WHEN** el daemon tiene en cola un trabajo de paquete en la línea `web` y un trabajo sin fuente en la línea `blog`, con concurrencia suficiente
- **THEN** el trabajo sin fuente arranca primero y el de paquete arranca recién cuando aquel terminó

#### Scenario: De a uno
- **WHEN** el daemon tiene en cola dos trabajos de paquete en líneas distintas, con concurrencia suficiente
- **THEN** nunca corren los dos al mismo tiempo

### Requirement: Origen visible en estado y panel
El estado de la CLI y del chat, el panel y la vista de la línea MUST mostrar `pedido por paquete <paquete>/<estación>` en cada trabajo con fuente `package`, y SHALL NOT mostrar ese texto en los demás.

#### Scenario: Estado
- **WHEN** hay un trabajo de paquete en cola y se formatea con `formatStatus` y con `formatJob`
- **THEN** ambos textos contienen `pedido por paquete hello/nota`

#### Scenario: Panel
- **WHEN** se renderizan la página principal, `jobPage` y la vista `/line` con ese trabajo
- **THEN** las tres contienen `pedido por paquete hello/nota`

#### Scenario: Trabajo sin origen de paquete
- **WHEN** se formatea un trabajo sin fuente
- **THEN** el texto no contiene `pedido por paquete`

### Requirement: Origen visible en briefing e informe
El briefing MUST listar en una sección propia los trabajos con fuente `package` que terminaron en el período o siguen abiertos, con su origen y resultado, y el informe mensual MUST indicar `Pedido por paquete <paquete>/<estación>` como origen.

#### Scenario: Briefing
- **WHEN** un trabajo de paquete se entregó dentro del período del briefing
- **THEN** el cuerpo contiene `pedido por paquete hello/nota` y el identificador del trabajo

#### Scenario: Trabajo abierto
- **WHEN** un trabajo de paquete sigue en cola al generar el briefing
- **THEN** el cuerpo lo lista con su origen

#### Scenario: Sin trabajos de paquete
- **WHEN** no hay trabajos de paquete en el período
- **THEN** el cuerpo no contiene la sección

#### Scenario: Informe mensual
- **WHEN** el informe incluye un trabajo de paquete del mes
- **THEN** su origen es `Pedido por paquete hello/nota`

### Requirement: Documentación
README.md y README.es.md MUST documentar `requests` en el manifiesto y `ctx.requestJob` en la tabla del `ctx`, con la misma estructura, y AGENTS.md SHALL describir la fuente `package` y su prioridad.

#### Scenario: Dos idiomas
- **WHEN** corre `test/docs.test.ts`
- **THEN** cada README contiene `perLinePerDay` y `ctx.requestJob`, y la prueba de paridad entre ambos pasa
