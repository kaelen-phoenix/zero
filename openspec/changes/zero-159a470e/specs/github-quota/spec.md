# Spec Delta

## Purpose

La fábrica va a dejar de agotar el cupo de GitHub de tu cuenta, y las publicaciones del CM y todo lo que use el mismo token van a tener margen. Qué vas a notar: - Los PRs bloqueados dejan de gastar en cada vuelta. Sus checks se vuelven a consultar cuando cambia el head o con esperas crecientes, de 5 minutos hasta 1 hora. - Si nada cambió, las consultas repetidas no gastan cupo, porque preguntan "¿cambió algo?" y GitHub responde 304. - Cuando queda 20% del cupo o menos, las pasadas de fondo paran solas hasta que el cupo se renueva. También paran hasta la hora que indique GitHub si responde 403 o 429 por límite, y la pausa sigue aunque se reinicie la fábrica. - `zero status` muestra una línea con el cupo restante, la hora de renovación y qué pasada gastó más, solo cuando el cupo está bajo. - Los pedidos de cada pasada quedan registrados. También se corrige un error relacionado: hoy, si GitHub responde por límite al consultar permisos, la fábrica puede creer que una persona no tiene permiso y rechazar su issue.

## ADDED Requirements

### Requirement: Registro de pedidos por pasada
Cada pedido a GitHub de una pasada del daemon (merges, reverts, issues, proposals, research, scout) MUST quedar contado bajo el nombre de esa pasada, separando los que gastan cupo de los respondidos con 304, y al terminar cada corrida con pedidos enviados la pasada SHALL dejar una línea en el log con esos números.

#### Scenario: Conteo por pasada
- **WHEN** un cliente medido de la pasada merges recibe una respuesta 200 y una 304
- **THEN** el kv github:usage registra para merges requests 1 y notModified 1 en la hora en curso, y otra pasada no suma nada

#### Scenario: Pedido frenado no cuenta
- **WHEN** la pausa está activa y un cliente medido intenta un pedido
- **THEN** fetch no se llama y el contador de requests no cambia

### Requirement: Cupo visible en zero status cuando está bajo
`zero status` SHALL mostrar una línea que empieza con `GitHub:` con el cupo restante, el total y la hora de renovación cuando el último cupo conocido sigue vigente y el restante es 40% del total o menos, o cuando hay una pausa activa, y MUST omitirla en cualquier otro caso.

#### Scenario: Cupo bajo
- **WHEN** el último cupo conocido es 1500 de 5000 y su renovación es futura
- **THEN** formatStatus incluye una línea que empieza con `GitHub:` y contiene 1500 y 5000

#### Scenario: Cupo holgado
- **WHEN** el último cupo conocido es 4000 de 5000
- **THEN** formatStatus no incluye ninguna línea que empiece con `GitHub:`

#### Scenario: Cupo renovado
- **WHEN** el último cupo conocido es 100 de 5000 y su hora de renovación ya pasó
- **THEN** formatStatus no incluye ninguna línea que empiece con `GitHub:`

#### Scenario: Pausa activa
- **WHEN** hay una pausa por límite con hora de fin futura
- **THEN** la línea `GitHub:` indica hasta qué hora siguen en pausa las pasadas

### Requirement: Pedidos condicionales
Los clientes medidos MUST enviar `If-None-Match` con el ETag guardado en cada GET ya respondido con ETag, y ante un 304 SHALL entregar una copia de la respuesta guardada sin que el código que llamó note la diferencia; los pedidos que no son GET MUST salir sin ese encabezado.

#### Scenario: Segundo GET igual
- **WHEN** githubMerges con cliente medido pide pullRequest(10) dos veces, la primera responde 200 con ETag y la segunda 304
- **THEN** el segundo pedido lleva If-None-Match con ese ETag y ambas llamadas devuelven el mismo PullRequestState

#### Scenario: Lista paginada repetida
- **WHEN** checks(sha) se pide dos veces y el pedido de check-runs responde 200 con ETag y luego 304
- **THEN** las dos llamadas devuelven los mismos checks, aunque la paginación de Octokit modifique la respuesta que recibe

#### Scenario: Escritura sin encabezado
- **WHEN** se hace un POST a una URL que ya tiene un ETag guardado
- **THEN** el POST no lleva If-None-Match

#### Scenario: Memoria acotada
- **WHEN** se guardan más de 500 respuestas
- **THEN** la caché conserva a lo sumo 500 entradas y descarta primero las más viejas

### Requirement: Espera creciente para PRs bloqueados
Para un PR bloqueado cuyo head y `mergeable` no cambiaron, `pollMerges` MUST NOT volver a pedir sus checks antes de que venza una espera que empieza en 5 minutos y se duplica en cada consulta que sigue bloqueada, con tope de 60 minutos; un cambio de head o de `mergeable` SHALL anular la espera en esa misma pasada.

#### Scenario: Mismo SHA dentro de la espera
- **WHEN** un PR con un check fallido se revisa dos veces seguidas con el mismo reloj
- **THEN** checks se llama una sola vez, el comentario se publica una sola vez y el estado sigue blocked

#### Scenario: Vence la espera
- **WHEN** el reloj avanza 5 minutos desde el primer bloqueo y sigue fallando el mismo check
- **THEN** checks se vuelve a llamar y la siguiente espera es de 10 minutos

#### Scenario: Tope de la espera
- **WHEN** el mismo PR sigue bloqueado en consultas sucesivas
- **THEN** la espera nunca supera los 60 minutos

#### Scenario: Cambia el head
- **WHEN** durante la espera el head pasa de abc a def con checks en verde
- **THEN** en esa pasada se piden los checks de def y se funde el PR

#### Scenario: Cierre durante la espera
- **WHEN** durante la espera pullRequest informa que el PR se fundió o se cerró
- **THEN** el estado pasa a merged o closed sin pedir checks

#### Scenario: Vencimiento de la vigilancia
- **WHEN** pasan más de 14 días desde la entrega mientras dura la espera
- **THEN** el estado pasa a expired

### Requirement: Freno ante respuestas por límite
Al recibir 429, o 403 con `x-ratelimit-remaining: 0`, `retry-after` o un mensaje de rate limit, zero MUST guardar una pausa persistente hasta el momento más tardío entre `x-ratelimit-reset` y `retry-after` (60 segundos si no viene ninguno), y mientras dure SHALL NOT iniciar pasadas de GitHub ni enviar pedidos desde clientes medidos.

#### Scenario: 403 por límite primario
- **WHEN** un pedido medido responde 403 con x-ratelimit-remaining 0 y x-ratelimit-reset dentro de 30 minutos
- **THEN** githubHalt devuelve esa hora de fin y el siguiente pedido medido falla sin llamar a fetch

#### Scenario: 429 con retry-after
- **WHEN** un pedido medido responde 429 con retry-after 120 y sin x-ratelimit-reset
- **THEN** la pausa termina 120 segundos después

#### Scenario: 403 de permisos
- **WHEN** un pedido medido responde 403 con mensaje Resource not accessible, con cupo restante y sin retry-after
- **THEN** no se crea ninguna pausa

#### Scenario: El daemon no arranca pasadas
- **WHEN** hay una pausa guardada y runDaemon corre en modo once con fakes de issues y merges
- **THEN** las fakes no reciben ninguna llamada de pollIssues, syncProposalIssues, syncResearchIssues, pollMerges ni detectReverts

#### Scenario: Sobrevive al reinicio
- **WHEN** se crea un medidor nuevo sobre el mismo store con la pausa vigente
- **THEN** sus pedidos siguen frenados

#### Scenario: Termina la pausa
- **WHEN** el reloj pasa la hora de fin
- **THEN** githubHalt devuelve undefined y los pedidos vuelven a salir

#### Scenario: pollMerges cortado a mitad de camino
- **WHEN** la pausa se activa mientras pollMerges recorre varios PRs
- **THEN** los PRs restantes no generan pedidos y su estado guardado no cambia

### Requirement: Reserva del cupo
Mientras el último cupo conocido siga vigente y lo restante sea 20% del total o menos, zero MUST frenar las pasadas de fondo y los clientes medidos hasta `x-ratelimit-reset`, dejando ese margen para lo demás que use la cuenta; solo el cupo `core`, o una respuesta sin `x-ratelimit-resource`, SHALL actualizar ese dato.

#### Scenario: Justo en la reserva
- **WHEN** una respuesta informa x-ratelimit-remaining 1000 de 5000 con renovación futura
- **THEN** githubHalt devuelve la hora de renovación como fin de la pausa

#### Scenario: Por encima de la reserva
- **WHEN** una respuesta informa x-ratelimit-remaining 1001 de 5000
- **THEN** githubHalt devuelve undefined

#### Scenario: Se renovó el cupo
- **WHEN** el último cupo es 100 de 5000 y su hora de renovación ya pasó
- **THEN** githubHalt devuelve undefined

#### Scenario: Otro recurso
- **WHEN** una respuesta con x-ratelimit-resource search informa remaining 1
- **THEN** el cupo guardado no cambia

#### Scenario: El 304 también informa
- **WHEN** una respuesta 304 trae x-ratelimit-remaining 900 de 5000
- **THEN** el cupo guardado queda en 900 de 5000 y se activa la reserva

### Requirement: Un límite no se confunde con falta de permiso
`IssueApi.permission` MUST propagar el error cuando la consulta falla por límite de GitHub o por una pausa de zero, y SHALL seguir devolviendo `none` ante los demás errores.

#### Scenario: Consulta frenada por límite
- **WHEN** el pedido de permisos responde 403 con x-ratelimit-remaining 0
- **THEN** permission rechaza con error en vez de devolver none

#### Scenario: El issue no queda rechazado
- **WHEN** takeIssues llega a la verificación de confianza durante un límite
- **THEN** no se escribe el estado del issue ni se publica el comentario de rechazo, y una pasada posterior puede tomarlo

#### Scenario: Usuario desconocido
- **WHEN** el pedido de permisos responde 404
- **THEN** permission devuelve none
