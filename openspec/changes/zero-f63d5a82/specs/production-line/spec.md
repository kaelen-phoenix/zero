# Spec Delta

## ADDED Requirements

### Requirement: Recolección de trabas por línea
Zero MUST juntar, por cada línea configurada, sus trabas a partir de su propio estado, sin llamar a un modelo: trabajos `failed` terminados en los últimos 7 días (motivo y su último feedback, recortado), trabajos `waiting`, trabajos entregados de líneas `autoMerge` cuyo MergeState está `blocked` (motivo, URL del pull request y si GitHub lo reporta en conflicto), los registros de entorno caído y de facturación de checks de su repositorio, los problemas de intake de la línea (GitHub, Linear, Jira y alertas de seguridad), las limpiezas pendientes de sus trabajos y, con `isolation: container`, la caja que no está lista. Cada traba MUST llevar un identificador estable dentro de la pasada.

#### Scenario: Trabajo fallido y PR bloqueado
- **WHEN** una línea tiene un trabajo `failed` de ayer con motivo "verify falló" y un trabajo entregado con `automerge:<id>` en `blocked` y `backoff.mergeable: false`
- **THEN** `collectJams` devuelve para esa línea una traba de trabajo fallido con ese motivo y una traba de pull request marcada como conflicto con su URL

#### Scenario: Trabajo detenido o viejo
- **WHEN** una línea tiene solo un trabajo `stopped` y un trabajo `failed` de hace 10 días
- **THEN** `collectJams` no devuelve trabas para esa línea

#### Scenario: Problema de intake
- **WHEN** el kv `intake.problem.<line>` tiene un texto
- **THEN** `collectJams` devuelve una traba de intake de esa línea con ese texto

### Requirement: Pasada del destrabador con la fábrica ociosa
El daemon SHALL correr la pasada del destrabador dentro de su corrida ociosa compartida (después de scout y antes de research), solo con `unjam` distinto de `off`, el turno nocturno encendido y dentro de sus horas, sin trabajos en cola ni corriendo, sin andon, con presupuesto, con un motor disponible para la estación `unjam`, a lo sumo una vez por línea por período del turno nocturno (kv `unjam:<line>`), y MUST NOT llamar al modelo para una línea sin trabas.

#### Scenario: Sin trabas no hay llamada
- **WHEN** la pasada corre y ninguna línea tiene trabas
- **THEN** el agente falso no recibe ninguna llamada

#### Scenario: Una vez por período
- **WHEN** la pasada corre dos veces el mismo día sobre una línea con trabas
- **THEN** el agente falso recibe una sola llamada para esa línea

#### Scenario: Andon o trabajo del responsable
- **WHEN** el andon está encendido o hay un trabajo en cola
- **THEN** la pasada no llama al agente

### Requirement: Presupuesto nocturno compartido
Lo que gasta la estación `unjam` MUST contarse en `scoutSpent`, y con facturación por uso cada llamada MUST llevar como tope lo que queda de `limits.usdPerNight` en el período; si no queda nada, la pasada no llama al agente.

#### Scenario: Gasto contado
- **WHEN** hay un span de agente `unjam` facturado por uso de 0,5 USD en el período
- **THEN** `scoutSpent` incluye esos 0,5 USD

#### Scenario: Tope agotado
- **WHEN** `limits.usdPerNight` es 1 y scout ya gastó 1 USD por uso en el período
- **THEN** la pasada del destrabador no llama al agente

### Requirement: Estación de solo lectura
La estación `unjam` MUST correr con acceso `read`, en el repositorio de la línea y con sus instrucciones en `agents/unjam.md`, y su respuesta SHALL validarse con un esquema de causas, cada una con título, tipo (`code`, `flaky-test`, `ci`, `github-account` o `machine`), las trabas que agrupa, un diagnóstico, una acción (`fix`, `retry` o `none`), el pedido de arreglo y las rutas que tocaría (para `fix`), y qué hacer (para `none`).

#### Scenario: Acceso
- **WHEN** se consulta `AGENT_ACCESS.unjam`
- **THEN** vale `read`

#### Scenario: Instrucciones
- **WHEN** se listan los archivos de `agents/`
- **THEN** existe `agents/unjam.md`

### Requirement: Causas agrupadas y validadas
Zero MUST guardar en kv `unjam:<line>` (reemplazando el anterior) el diagnóstico de la línea con su fecha, quedándose solo con las causas que nombran al menos una traba presente en el prompt (las demás trabas nombradas se descartan), a lo sumo 10 causas, y con todo texto pasado por `scrubLocal`. Una causa que agrupa varias trabas MUST guardarse una sola vez.

#### Scenario: Mismos checks en muchos PRs
- **WHEN** el agente falso devuelve una causa `ci` que agrupa 15 trabas de pull request
- **THEN** el kv `unjam:<line>` tiene una sola causa con las 15 trabas

#### Scenario: Traba inventada
- **WHEN** el agente falso devuelve una causa que solo nombra un identificador que no estaba en el prompt
- **THEN** esa causa no se guarda

#### Scenario: Rutas locales
- **WHEN** el diagnóstico contiene una ruta absoluta de la máquina
- **THEN** lo guardado dice `(ruta local)` en su lugar

### Requirement: Logs de checks fallidos
Para una traba de pull request con checks fallidos de GitHub Actions, el prompt del destrabador SHALL incluir el final (a lo sumo 3000 caracteres, pasado por `scrubLocal`) del log del job fallido, leído por el `MergeApi.failedLog` opcional a lo sumo una vez por repositorio y nombre de check en la pasada, con los pedidos contados en la pasada `unjam` del medidor de GitHub. Si GitHub está en pausa, no hay token o la lectura falla, la traba MUST seguir en el prompt sin log.

#### Scenario: Un log por check y repositorio
- **WHEN** tres pull requests del mismo repositorio fallan en el check `android` y la API falsa tiene un log para cada uno
- **THEN** `failedLog` se llama una sola vez para `android` y el prompt incluye ese log

#### Scenario: Lectura fallida
- **WHEN** `failedLog` lanza un error
- **THEN** el prompt incluye la traba sin log y la pasada sigue

### Requirement: Un trabajo de arreglo por causa
Por cada causa guardada con acción `fix`, zero SHALL crear una propuesta del turno nocturno con origen `unjam` en la línea de la causa, salvo que ya exista en esa línea una propuesta `unjam` con el mismo título normalizado (`normalizeTitle`) pendiente, rechazada, revertida o aprobada con su trabajo sin terminar, o que la causa toque rutas protegidas o pida credenciales nuevas.

#### Scenario: Sin repetir con trabajo abierto
- **WHEN** la pasada vuelve a dar una causa `fix` con el mismo título que una propuesta `unjam` aprobada cuyo trabajo sigue en cola
- **THEN** no se crea otra propuesta ni otro trabajo

#### Scenario: Sin repetir lo rechazado
- **WHEN** la causa tiene el título de una propuesta `unjam` rechazada
- **THEN** no se crea propuesta

#### Scenario: Ruta protegida
- **WHEN** la causa `fix` nombra una ruta protegida
- **THEN** no se crea propuesta

### Requirement: Autonomía, tope diario y baja prioridad
Una propuesta `unjam` MUST seguir la autonomía de su línea (`proposalAutonomy`): con `build` o `auto`, y mientras los trabajos y reintentos abiertos hoy por el destrabador sean menos que `unjam.maxJobsPerDay` (2 por defecto) y quede `nightShift.maxAutoJobsPerDay`, zero SHALL aprobarla sola, abriendo un trabajo con fuente `{kind: 'night-shift', proposal, autonomy, origin: 'unjam'}` (prioridad `baja`); con `propose` MUST quedar pendiente para la persona responsable.

#### Scenario: Línea en build
- **WHEN** una línea con autonomía `build` recibe una causa `fix` nueva
- **THEN** se crea un trabajo con fuente night-shift de origen `unjam` y prioridad `baja`, y la propuesta queda `approved` por `night-shift`

#### Scenario: Línea en propose
- **WHEN** una línea con autonomía `propose` recibe una causa `fix` nueva
- **THEN** la propuesta queda `pending` y no se crea trabajo

#### Scenario: Tope diario
- **WHEN** `unjam.maxJobsPerDay` es 1 y la pasada da dos causas `fix` en una línea `build`
- **THEN** se abre un solo trabajo y la otra propuesta queda pendiente

### Requirement: Pedido presentado como dato
El bloque de pedido del runner MUST presentar un trabajo de origen `unjam` como redactado por la estación destrabadora a partir de los registros de la fábrica y los logs del CI, no por la persona responsable, y su texto como dato que no es una instrucción.

#### Scenario: Encabezado del pedido
- **WHEN** el runner arma el prompt de un trabajo con fuente night-shift de origen `unjam`
- **THEN** el prompt no dice `The owner sent` y nombra a la estación unjam

### Requirement: Reintento desde el checkpoint
`retryJob` en `app.ts` (detrás de `zero reintentar <trabajo>`) SHALL volver a poner en cola desde su checkpoint, con `attempt` en 0 y sin feedback, un trabajo `failed` con especificación cuya línea sigue configurada. A un trabajo entregado cuyo pull request de una línea `autoMerge` está bloqueado en conflicto SHALL ponerle `attempt` en 0 y sacarle a su MergeState `resolving` y `backoff`, para que la pasada de fusión lo devuelva a la cola con `takeBack`. A cualquier otro trabajo MUST rechazarlo con un motivo en español.

#### Scenario: Trabajo fallido
- **WHEN** se llama `retryJob` sobre un trabajo `failed` con spec, `attempt` 3 y checkpoint `spec`
- **THEN** el trabajo queda `queued`, con `attempt` 0, el mismo checkpoint y `finishedAt` vacío

#### Scenario: PR en conflicto
- **WHEN** se llama `retryJob` sobre un trabajo entregado con MergeState `blocked`, `resolving` igual a su head y `attempt` igual a `maxAttempts`
- **THEN** el trabajo queda con `attempt` 0 y su MergeState sin `resolving` ni `backoff`

#### Scenario: Trabajo sin spec
- **WHEN** se llama `retryJob` sobre un trabajo `failed` sin especificación
- **THEN** lanza un error en español y el trabajo no cambia

### Requirement: Reintento por el destrabador
Por cada causa con acción `retry`, en líneas con autonomía `build` o `auto` y dentro del tope diario, zero SHALL llamar `retryJob` sobre cada trabajo de las trabas que agrupa, a lo sumo una vez en la vida de cada trabajo (kv `unjam:retried:<job>`); con `propose` MUST NOT reintentar y el qué hacer de la causa nombra `zero reintentar <trabajo>`.

#### Scenario: Una sola vez
- **WHEN** dos pasadas en días distintos dan la misma causa `retry` sobre el mismo trabajo fallido en una línea `build`
- **THEN** el trabajo se reintenta una sola vez

#### Scenario: Línea en propose
- **WHEN** la causa `retry` es de una línea `propose`
- **THEN** el trabajo sigue `failed` y lo guardado dice `zero reintentar <id>`

### Requirement: Trabas visibles en status, panel y chat
`factoryStatus` SHALL devolver `jams` con las causas guardadas de cada línea, y `formatStatus` (y con él `zero_status`) y el resumen del panel MUST mostrar un bloque `Trabas:` con una línea por causa: línea, título, cantidad de trabas, tipo en español y el trabajo o propuesta abierto o el qué hacer.

#### Scenario: Status
- **WHEN** el kv `unjam:<line>` tiene una causa `ci` con 15 trabas y un trabajo abierto
- **THEN** `formatStatus` incluye `Trabas:` y una línea con el título, `15 trabas`, `CI` y el id del trabajo

#### Scenario: Panel
- **WHEN** se pide la página de inicio del panel con esa misma causa guardada
- **THEN** el HTML incluye el título de la causa

#### Scenario: Sin trabas
- **WHEN** no hay diagnósticos guardados
- **THEN** `formatStatus` no incluye `Trabas:`

### Requirement: Sección Trabas en el resumen y el informe
El resumen diario (`renderBriefing`) SHALL tener una sección `## Trabas` con las causas guardadas, y el informe mensual de cada línea (Markdown y HTML) MUST tener una sección `Trabas` con sus causas de acción `none` y qué hacer, solo cuando la línea tiene alguna.

#### Scenario: Informe
- **WHEN** una línea tiene guardada una causa `machine` con acción `none` y qué hacer "Instalá Podman o Docker"
- **THEN** el Markdown y el HTML del informe de esa línea incluyen `Trabas` y ese texto

#### Scenario: Informe sin trabas
- **WHEN** la línea no tiene causas de acción `none`
- **THEN** el informe no incluye la sección `Trabas`

#### Scenario: Resumen
- **WHEN** se arma el resumen con una causa guardada
- **THEN** incluye `## Trabas` y su título
