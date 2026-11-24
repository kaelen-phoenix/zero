# Spec Delta

## Purpose

Vas a poder sumar otra PC o una máquina Linux en la nube y que trabajen como una sola fábrica: - **Líneas:** al unirse una máquina, o cuando aparece una línea nueva, los proyectos se clonan solos dentro de ZERO_HOME, sin secretos ni datos de otra máquina. Los que esa máquina no puede atender, por plataforma o motores, se muestran así y no se clonan. - **Presupuesto:** el gasto de todas las máquinas cuenta contra los mismos límites (por día, por trabajo, por noche, tu reserva y el cupo de la suscripción). - **Control:** desde el chat, la CLI o el panel de cualquiera podés pedir trabajos, responder, aprobar y ver la fábrica entera. Lo que delegás en otra máquina le llega en su próximo latido, no al instante. - **Paquetes:** podés fijar las estaciones de un paquete a una máquina. Por ejemplo, el CM corre solo en la PC de casa. - **Guía:** los dos README explican cómo instalar zero en Linux en la nube, sin puertos abiertos. - **Repositorio de coordinación:** la creación automática de repositorios todavía no existe, así que `zero unirse` muestra el comando exacto para crear el repositorio privado. Con una sola máquina o sin `distributed`, todo sigue igual. Está partido en ocho etapas chicas.

## ADDED Requirements

### Requirement: Publicar las líneas
Con el protocolo habilitado (`coordReady`), el pase de líneas SHALL publicar cada línea local con remoto de GitHub como `lines/<nombre>`. El registro lleva solo name, repository (cuenta/nombre), baseBranch, setup, verify, verifyTimeoutMinutes, integrate, autoMerge, needs {engines, platforms}, machine y at. MUST NOT publicar líneas de paquetes, líneas sin remoto de GitHub, líneas que esta máquina clonó, ni un registro donde findSecret encuentre una credencial o donde un comando contenga una ruta local. Solo la máquina que lo creó SHALL actualizarlo, por compare-and-swap y solo si cambió.

#### Scenario: Línea con remoto de GitHub
- **WHEN** una fábrica con una línea cuyo origin es de GitHub corre el pase de líneas con memoryCoord y sondeo aprobado
- **THEN** existe lines/<nombre> con el repositorio, los comandos y la integración, y no contiene la ruta local ni las claves issues, linear, jira, agents ni services

#### Scenario: Líneas que no se publican
- **WHEN** hay una línea de paquete, una sin remoto de GitHub y una con algo con forma de credencial en verify
- **THEN** ninguna de las tres tiene registro en lines/ y el pase termina sin error

#### Scenario: Nombre ya usado por otra máquina
- **WHEN** lines/tienda la creó otra máquina para otro repositorio
- **THEN** el registro no cambia y la línea local tampoco

### Requirement: Clonar las líneas publicadas
Con el protocolo habilitado, cada máquina SHALL clonar en `ZERO_HOME/lines/<nombre>` el repositorio de cada registro válido de `lines/` cuya línea no existe en su archivo, y SHALL agregar la línea con esos datos a través de `editConfig`. MUST NOT modificar una línea que ya existe, ni clonar desde otro lugar que no sea `https://github.com/<cuenta>/<nombre>.git` sin credenciales en la URL, ni copiar secretos o datos locales. El clon SHALL hacerse en una carpeta temporal que se renombra al terminar bien; un clon fallido MUST NOT dejar la línea agregada y se reintenta como mucho una vez por hora. La autenticación SHALL usar el credential helper de git, nunca argv ni archivos.

#### Scenario: Línea nueva
- **WHEN** la fábrica A publica una línea y B, sin líneas, corre su pase con un clonador inyectado que copia un repositorio bare
- **THEN** B tiene el repositorio en ZERO_HOME/lines/<nombre> y la línea en su archivo con la misma rama base, setup, verify e integración

#### Scenario: Línea existente
- **WHEN** B ya tiene una línea con ese nombre y otros comandos verify
- **THEN** el archivo de B queda igual byte por byte y no se clona nada

#### Scenario: Registro inválido
- **WHEN** lines/ contiene JSON roto, un nombre con `..` o un repository que es una URL
- **THEN** no se llama al clonador y el pase termina sin error

#### Scenario: Clon fallido
- **WHEN** el clonador falla
- **THEN** la línea no está en el archivo, no queda carpeta parcial, el problema queda guardado y otro pase dentro de la misma hora no vuelve a clonar

#### Scenario: Línea quitada a mano
- **WHEN** se borra del archivo de B una línea que B ya había clonado y corre otro pase
- **THEN** B no la vuelve a clonar hasta un nuevo `zero unirse`

### Requirement: Clonar sin frenar el latido
El clonado SHALL correr en un pase propio de fondo del daemon, nunca dentro de `coordPass`, de modo que un clon lento MUST NOT atrasar el latido ni el inicio de trabajos de otras líneas.

#### Scenario: Clon lento
- **WHEN** el clonador inyectado no termina y vence heartbeatSeconds
- **THEN** el daemon vuelve a escribir machines/<id> mientras el clon sigue en curso

#### Scenario: Sin distributed
- **WHEN** el daemon corre sin bloque distributed
- **THEN** memoryCoord no registra llamadas, no se crea ZERO_HOME/lines y no se escribe ninguna clave kv coord:

### Requirement: Líneas que la máquina no puede atender
Una línea SHALL aceptar el campo opcional `platforms` (lista de win32, darwin o linux). Una máquina cuya plataforma no está en `needs.platforms`, o cuyas cadenas no tienen todos los motores de `needs.engines`, MUST NOT clonar esa línea y SHALL marcarla con el motivo en `zero status` y en el panel. Cuando deja de haber motivo, el pase siguiente SHALL clonarla.

#### Scenario: Otra plataforma
- **WHEN** una línea publicada tiene platforms ["darwin"] y el pase corre como linux
- **THEN** no se clona y formatStatus muestra la línea con que no se atiende en esta máquina por la plataforma

#### Scenario: Motor que falta
- **WHEN** la línea pide codex y las cadenas de esta máquina solo tienen claude
- **THEN** no se clona y el motivo nombra codex

#### Scenario: Se vuelve posible
- **WHEN** después se agrega codex a la cadena de esta máquina
- **THEN** el pase siguiente clona la línea

### Requirement: Clonar al unirse
`zero unirse` SHALL, después de escribir `distributed.repository`, sondear el repositorio si hace falta, correr una vez el pase de líneas y contar qué líneas clonó, cuáles no atiende y cuáles fallaron. Un problema en ese pase MUST NOT deshacer la unión: el daemon reintenta después.

#### Scenario: Se une y clona
- **WHEN** joinFactory corre con un chequeo privado y un coord inyectado que publica una línea atendible y otra que no
- **THEN** joined es true, la atendible está clonada y agregada, y el texto nombra las dos

#### Scenario: El clon falla
- **WHEN** el clonador inyectado falla durante joinFactory
- **THEN** joined es true, distributed.repository queda escrito y el texto cuenta la falla

### Requirement: Explicar cómo crear el repositorio de coordinación
Sin argumento, con un nombre inválido, con un repositorio público o con uno que no puede leer, `zero unirse` SHALL explicar cómo crear el repositorio privado con `gh repo create <cuenta>/<nombre> --private --add-readme`, aclarando que necesita un primer commit, y MUST NOT crear ni escribir nada.

#### Scenario: Sin argumento
- **WHEN** se corre `zero unirse` sin repositorio
- **THEN** el texto contiene el comando con --private y --add-readme, y el archivo de la fábrica no cambia

#### Scenario: No lo puede leer
- **WHEN** el chequeo inyectado falla para me/zero-coord
- **THEN** joined es false y el texto contiene el comando con me/zero-coord

### Requirement: Estaciones fijadas a una máquina
Una entrada de `packages` SHALL aceptar `machine` (todas sus estaciones) y `machines` (mapa de estación a máquina, que manda sobre `machine`), con el nombre o el id de una máquina. Una estación fijada MUST NOT correr en otra máquina por ninguna vía: período, whenBusy, horario, a demanda o subida. Un nombre que no coincide con ninguna máquina MUST hacer que no corra en ninguna. Una estación inexistente en `machines` SHALL aparecer como problema del paquete. Sin estos campos nada cambia.

#### Scenario: Otra máquina
- **WHEN** plus/cm está fijada a pc-casa y los pases regular, whenBusy y con horario corren en la máquina nube
- **THEN** el módulo de la estación no se importa ni se ejecuta en ninguno

#### Scenario: A demanda
- **WHEN** en nube se pide zero package run plus/cm, o se le sube un archivo
- **THEN** se rechaza con un texto que nombra pc-casa y no queda pedido pendiente

#### Scenario: La máquina fijada
- **WHEN** los mismos pases corren en pc-casa
- **THEN** la estación corre como siempre

#### Scenario: Solo una estación
- **WHEN** machines fija solo cm y el paquete tiene además otra estación
- **THEN** en nube corre la otra y no cm

### Requirement: Publicar el gasto
Con el protocolo habilitado, cada máquina SHALL publicar en `spend/<id>` su gasto de las últimas 48 horas en tramos de 15 minutos por motor, forma de cobro y si es del turno ocioso; lo cobrado por cada trabajo sin terminar o terminado en esas 48 horas; y la última lectura de plan de cada motor. MUST escribirlo solo si cambió y como mucho una vez por latido, sin prompts, rutas ni textos. SHALL guardar los registros válidos de las otras máquinas, vivas o caídas, y descartar los inválidos (montos negativos o no finitos, fechas inválidas, trabajos con id inválido).

#### Scenario: Publica y lee
- **WHEN** A registra llamadas cobradas y A y B corren su pase
- **THEN** spend/<A> tiene los montos y B los guarda; un segundo pase de A sin gasto nuevo no escribe spend/<A>

#### Scenario: Registro inválido
- **WHEN** spend/x tiene un monto negativo o JSON roto
- **THEN** se descarta y budgetState no cambia

### Requirement: Topes en dólares sumados
Con `distributed`, `budgetState` (`limits.usdPerDay`, por motor), el tope de la noche (`limits.usdPerNight`) y el tope por trabajo (`usdPerJob`) SHALL contar el gasto propio más el publicado por las otras máquinas, sin contar dos veces el propio, aplicando la misma regla de cobro que hoy. Sin `distributed` MUST dar los mismos resultados que hoy aunque haya quedado gasto ajeno guardado.

#### Scenario: Tope del día
- **WHEN** con usdPerDay 10, esta máquina gastó 6 por uso y otra publicó 5 del mismo motor hoy
- **THEN** el motor queda pausado por el límite del día y spentUsd es 11

#### Scenario: Tope de la noche
- **WHEN** con usdPerNight 1, otra máquina publicó 1 de gasto ocioso en el período
- **THEN** scout no llama a ningún motor cobrado por uso

#### Scenario: Tope del trabajo retomado
- **WHEN** otra máquina publicó 2.5 para un trabajo con usdPerJob 3 que esta retoma
- **THEN** lo que le queda al trabajo es 0.5

#### Scenario: Sin distributed
- **WHEN** hay gasto ajeno en kv y el archivo no tiene distributed
- **THEN** budgetState es idéntico al de antes

### Requirement: Un solo cupo de suscripción
Con `distributed`, para cada motor SHALL valer la lectura de plan más nueva entre todas las máquinas cuando la local también es de suscripción, de modo que un motor pausado por límite del plan o por `reservePercent` en una máquina se pausa en todas. Una lectura ajena MUST NOT cambiar cómo se cobra un motor que acá se paga por uso, ni quitar los topes en dólares de un motor que acá todavía no tiene lectura.

#### Scenario: Ventana agotada en otra
- **WHEN** otra máquina publicó una lectura más nueva con la ventana de 5 horas agotada hasta las 18:00
- **THEN** el motor está pausado acá hasta las 18:00 y no se empiezan trabajos que solo tienen ese motor

#### Scenario: Reserva
- **WHEN** con reservePercent 20 la lectura ajena más nueva dice 85% de uso
- **THEN** el motor está pausado por la reserva

#### Scenario: Acá se paga por uso
- **WHEN** la lectura local es api y la ajena subscription
- **THEN** la forma de cobro local sigue siendo api y rige usdPerDay

### Requirement: Ver el presupuesto común
Con gasto de otras máquinas, `zero status`, el panel y `zero_status` SHALL decir que el gasto y el límite son de toda la fábrica. Sin `distributed`, el texto MUST ser el de hoy.

#### Scenario: Con otras máquinas
- **WHEN** hay gasto ajeno de hoy y formatStatus corre con distributed
- **THEN** la línea de presupuesto muestra la suma y dice que es de todas las máquinas

### Requirement: Estado de toda la fábrica
Con el protocolo habilitado, cada máquina SHALL publicar en `status/<id>` sus trabajos locales sin terminar y los últimos terminados, con id, línea, título, estado, estación, etapa, prioridad y, si espera, su pregunta y vencimiento, además de sus propuestas pendientes, con los textos pasados por scrubLocal y sin secretos, y solo cuando cambió. `zero status`, el panel y `zero_status` de cualquier máquina SHALL mostrar los trabajos de todas, cada trabajo una sola vez según la máquina que tiene su claim, con el nombre de esa máquina.

#### Scenario: Trabajo de otra máquina
- **WHEN** A corre un trabajo que B tiene importado en cola y las dos corren sus pases
- **THEN** el estado de B lo muestra una vez, trabajando y en A, y no también en cola

#### Scenario: Detalle por id
- **WHEN** en B se pide zero status <id> o zero_status con el id de un trabajo que solo está en A
- **THEN** muestra su estado, su máquina y su pregunta pendiente

#### Scenario: Máquina caída
- **WHEN** venció el plazo de A
- **THEN** sus trabajos se muestran con la marca de que esa máquina está caída

#### Scenario: Sin rutas ni secretos
- **WHEN** la pregunta de un trabajo contiene una ruta local del repositorio o algo con forma de credencial
- **THEN** status/<id> no los contiene

#### Scenario: Sin distributed
- **WHEN** no hay bloque distributed
- **THEN** el texto de formatStatus y el HTML del panel son los de hoy

### Requirement: Responder y aprobar desde cualquier máquina
`zero approve`, `zero_answer` y los formularios del panel SHALL aceptar un trabajo en espera de otra máquina: la decisión se guarda localmente y el pase siguiente la publica creando una sola vez una referencia `decisions/` atada al trabajo y al momento de su pregunta. La máquina que tiene el trabajo SHALL aplicarla una vez con `answerJob`, solo si coincide con la pregunta vigente, y borrar la referencia ya atendida. Una decisión para otra pregunta, un trabajo que no espera o un registro inválido MUST NOT tener efecto. La primera decisión publicada gana.

#### Scenario: Aprobar desde B
- **WHEN** A tiene un trabajo esperando, en B se aprueba y corren los pases de B y de A
- **THEN** en A el trabajo vuelve a la cola con esa aprobación y la decisión no se aplica otra vez

#### Scenario: Dos respuestas
- **WHEN** B aprueba y C rechaza la misma pregunta, y B publica primero
- **THEN** A aplica la aprobación y C informa que ya se había respondido

#### Scenario: Pregunta vieja
- **WHEN** la decisión corresponde a una pregunta anterior del mismo trabajo
- **THEN** el trabajo sigue esperando

#### Scenario: Apagada
- **WHEN** la máquina que tiene el trabajo no está viva
- **THEN** la respuesta dice que se entregará cuando vuelva

### Requirement: Las acciones delicadas siguen retenidas
Por el chat remoto, aprobar archivos protegidos de un trabajo o una propuesta que está en otra máquina MUST quedar retenido igual que con uno local, y SHALL publicarse solo después de la confirmación en la máquina que recibió el pedido. Las decisiones publicadas MUST NOT cambiar configuración, reglas de salida ni niveles de autonomía.

#### Scenario: Chat remoto
- **WHEN** un chat remoto aprueba en B una pregunta protected-path de un trabajo de A
- **THEN** queda una acción pendiente y no hay ninguna referencia decisions/ hasta confirmarla

### Requirement: Pedir desde cualquier máquina
Un pedido desde la CLI, el chat o el panel SHALL poder nombrar una línea publicada que esta máquina no tiene clonada o no puede atender. El pedido se guarda localmente, el pase siguiente lo publica en `queue/` con las necesidades de la línea, y MUST NOT crear un trabajo local ni terminarlo como fallido. Las líneas que esta máquina tiene siguen como hoy, por la cola común.

#### Scenario: Línea de otra máquina
- **WHEN** en B se pide un trabajo para una línea publicada que B no atiende y corren los pases de B y de A
- **THEN** A tiene un trabajo queued con el id que informó B, y B lo muestra en la vista de la fábrica sin trabajo local

#### Scenario: Línea que no existe
- **WHEN** se pide para una línea que no está ni local ni publicada
- **THEN** se rechaza con las líneas conocidas

#### Scenario: GitHub en pausa
- **WHEN** githubHalt rige cuando se hace el pedido
- **THEN** queda guardado y se publica una sola vez en el pase posterior a la pausa

### Requirement: Decidir propuestas desde cualquier máquina
Aprobar o rechazar una propuesta pendiente de otra máquina desde `zero proposals` o `zero_proposal_decide` SHALL entregar la decisión por la misma vía, y la máquina dueña SHALL aplicarla una sola vez con `approveProposal` o `rejectProposal`.

#### Scenario: Aprobar desde B
- **WHEN** A publica una propuesta pendiente, B la aprueba y corren los pases
- **THEN** A crea exactamente un trabajo a partir de esa propuesta

#### Scenario: Ya decidida
- **WHEN** la propuesta ya fue decidida en A cuando llega la decisión
- **THEN** no se crea otro trabajo y el pase termina sin error

### Requirement: Guía de Linux en la nube
README.md y README.es.md SHALL tener en el mismo lugar una sección con los mismos bloques de comandos para una máquina Linux en la nube. La sección cubre requisitos, Podman para la caja, servicio de usuario que arranca con la máquina, llavero del sistema, inicio de sesión en los motores y en GitHub sin pegar secretos en archivos, `zero unirse` y el panel por el túnel sin puertos abiertos. MUST aclarar qué no prueban los tests de zero y qué comandos piden administrador.

#### Scenario: Las dos guías
- **WHEN** corre test/docs.test.ts
- **THEN** las dos secciones contienen podman, zero box setup, zero autostart on, loginctl enable-linger, gh auth login, zero secret set, zero unirse y zero panel remote on, con los mismos niveles y bloques

#### Scenario: Nada viejo
- **WHEN** se lee la sección de varias máquinas en ambos README
- **THEN** ya no dice que la cola común es el próximo paso
