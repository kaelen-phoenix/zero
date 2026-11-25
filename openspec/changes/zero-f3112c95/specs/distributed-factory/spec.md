# Spec Delta

## Purpose

Con el bloque `distributed` configurado, varias máquinas van a trabajar sobre la misma cola sin pisarse. Antes de usar el protocolo, cada máquina lo prueba una vez contra el repositorio de coordinación real en GitHub, para confirmar que GitHub rechaza con 422 crear una referencia que ya existe y moverla sin avance rápido. Si la prueba no sale bien, la máquina sigue trabajando sola, como hoy. Con la prueba aprobada: - cada trabajo se publica en la cola común; - cada máquina toma solo los trabajos que puede hacer (caja de aislamiento, motores); - ninguna empieza un trabajo sin tomarlo antes, y antes de cada estación confirma que sigue siendo suyo; - al terminar lo suelta y avisa a las demás cómo terminó; - la rama del trabajo se sube a GitHub en cada checkpoint y al apagar la máquina a propósito, siempre con --force-with-lease y solo si el trabajo sigue siendo suyo; - si una máquina se cae y vence su plazo, otra retoma el trabajo desde el último checkpoint subido. La que vuelve se entera de que lo perdió y deja el trabajo sin subir, sin integrar y sin comentar nada. Sin `distributed`, todo sigue exactamente igual que hoy.

## ADDED Requirements

### Requirement: Sondeo del protocolo contra GitHub real
Con `distributed`, el pase de coordinación SHALL correr una vez por repositorio de coordinación un sondeo (`probeCoord`). El sondeo crea una referencia `probe/<id>`, comprueba que crearla otra vez da CoordConflict y que moverla desde un sha que ya no es su punta da CoordConflict, después la borra y guarda el resultado en kv `coord:probe` ({repository, at, ok, problem?}). Un sondeo fallido SHALL volver a intentarse como mucho una vez por hora.

#### Scenario: Adaptador que cumple
- **WHEN** coordPass corre con memoryCoord y sin `coord:probe` guardado
- **THEN** `coord:probe` queda con ok true para el repositorio configurado y la referencia probe/ ya no existe

#### Scenario: Adaptador que no da conflicto
- **WHEN** el sondeo corre contra un CoordApi falso cuyo create acepta una referencia que ya existe
- **THEN** `coord:probe` queda con ok false y un problem que lo explica, y el pase siguiente dentro de la misma hora no sondea de nuevo

### Requirement: El runner depende del protocolo solo después del sondeo
El daemon MUST tomar, soltar, importar o subir trabajos a través del protocolo solo cuando hay `distributed` y `coord:probe` dice ok true para el `distributed.repository` actual. Si no, SHALL correr los trabajos exactamente como hoy.

#### Scenario: Sin sondeo aprobado
- **WHEN** el daemon corre en modo once con `distributed`, un trabajo en cola y un `coord:probe` con ok false
- **THEN** el trabajo corre como hoy y memoryCoord no registra ninguna llamada a claims/, queue/ ni progress/

#### Scenario: Sin distributed
- **WHEN** el daemon corre un trabajo sin bloque `distributed`
- **THEN** memoryCoord no registra ninguna llamada y no se escribe ninguna clave kv `coord:`

### Requirement: Soltar es un compare-and-swap
releaseJob MUST soltar el trabajo moviendo `claims/<trabajo>` sin forzar, desde la punta leída, a un registro de cierre ({job, machine, name, at, released: true, status}), nunca borrando la referencia. claimJob SHALL tomar un trabajo cuyo claim es un registro de cierre como si estuviera libre, con un compare-and-swap desde esa punta.

#### Scenario: Soltar y volver a tomar
- **WHEN** la máquina A toma el trabajo, lo suelta con status delivered y la máquina B intenta tomarlo
- **THEN** releaseJob devuelve true, la referencia existe con released true y status delivered, memoryCoord no registró ningún delete de claims/ y B obtiene claimed true

#### Scenario: Soltar algo que ya no es suyo
- **WHEN** A tiene el trabajo, B lo toma después de que venció el plazo de A y A llama a releaseJob
- **THEN** releaseJob devuelve false y el claim sigue nombrando a B

### Requirement: Claim que indica una retoma
claimJob SHALL devolver `{claimed: true, takenFrom}`, con el claim anterior, cuando toma un trabajo que tenía otra máquina cuyo plazo venció.

#### Scenario: Holder caído
- **WHEN** el claim nombra a una máquina cuyo latido es más viejo que leaseMinutes y otra llama a claimJob
- **THEN** el resultado es claimed true y takenFrom nombra a la máquina caída

### Requirement: Tomar antes de empezar
Con el protocolo habilitado, el daemon MUST llamar a claimJob antes de runJob y MUST NOT empezar un trabajo si el resultado es claimed false. El trabajo queda en la cola local y no se marca como fallido.

#### Scenario: Otra máquina lo tiene
- **WHEN** un trabajo en cola tiene en memoryCoord un claim vivo de otra máquina
- **THEN** el daemon en modo once no corre ninguna estación para ese trabajo y el trabajo sigue en estado queued

#### Scenario: Dos daemons a la vez
- **WHEN** dos fábricas de test con ZERO_HOME distintos comparten un memoryCoord y el mismo trabajo importado, y corren a la vez
- **THEN** el trabajo lo ejecuta exactamente una de las dos (el agente falso se llama para su spec una sola vez)

### Requirement: Comprobar antes de cada estación
Con el protocolo habilitado, el runner MUST llamar a stillHolds antes de cada estación (spec, build, verify, los agentes de la línea, las revisiones e integrate). Si el trabajo ya no es suyo, SHALL dejarlo sin subir, sin integrar y sin publicar nada en su origen (issue, Linear, Jira), y terminarlo localmente con finalizeJob como stopped con el motivo "Lo retomó otra máquina de la fábrica."

#### Scenario: Lo perdió a mitad de camino
- **WHEN** un trabajo pasa la spec y, antes del build, el claim en memoryCoord pasa a nombrar a otra máquina
- **THEN** el agente de build no se llama, no se hace push ni integración, el trabajo termina stopped con ese motivo y el IssueApi falso no recibe comentarios para ese issue

### Requirement: Soltar al terminar
Con el protocolo habilitado, cuando un trabajo llega a un estado final (delivered, failed o stopped), el daemon SHALL llamar a releaseJob con ese estado. Cuando el trabajo se interrumpe por un apagado a propósito, SHALL soltarlo después de subir su avance. Una interrupción por andon o por cuota MUST NOT soltarlo.

#### Scenario: Entregado
- **WHEN** un trabajo tomado termina delivered
- **THEN** claims/<trabajo> es un registro de cierre con status delivered

#### Scenario: Andon
- **WHEN** un trabajo tomado se interrumpe por el andon
- **THEN** claims/<trabajo> sigue nombrando a esta máquina sin released

### Requirement: Cola común
Con el protocolo habilitado, el pase de coordinación SHALL publicar cada trabajo local en cola que todavía no publicó como `queue/<trabajo>`. El registro lleva id, line, kind, request pasado por scrubLocal, priority, source, createdAt y needs {box, engines}. El pase SHALL importar como trabajos en cola los registros válidos de otras máquinas cuya línea existe en esta, con el mismo id. Los registros inválidos, los de líneas que no existen acá y los que tienen un id que ya existe localmente MUST descartarse sin crear trabajos ni fallar.

#### Scenario: Publicar e importar
- **WHEN** la fábrica A tiene un trabajo en cola y A y B, que comparten un memoryCoord, corren su pase de coordinación
- **THEN** B tiene un trabajo queued con el mismo id, línea y pedido, y la request publicada no contiene la ruta local del repositorio de A

#### Scenario: Registro inválido
- **WHEN** queue/ contiene un registro con JSON roto o con un id con caracteres fuera de [A-Za-z0-9-]
- **THEN** no se crea ningún trabajo y el pase termina sin error

#### Scenario: Línea desconocida
- **WHEN** un registro de queue/ nombra una línea que esta máquina no tiene
- **THEN** no se importa y ningún trabajo local queda como failed

### Requirement: Un pedido, un trabajo
Antes de publicar un trabajo con origen (source), el pase MUST crear `sources/<clave del origen>` con el id del trabajo. Si la referencia ya existe con otro id, el trabajo local es un duplicado: SHALL terminar con finalizeJob como stopped con el motivo "Lo tomó otra máquina de la fábrica.", sin publicarse y sin comentar en su origen, y el estado del issue de GitHub que lo nombraba SHALL pasar a nombrar el trabajo del registro.

#### Scenario: El mismo issue en dos máquinas
- **WHEN** A y B crean cada una un trabajo para el mismo issue de GitHub y corren su pase de coordinación una después de la otra
- **THEN** queda un solo trabajo en queue/, el de la segunda máquina termina stopped como duplicado y su kv issue:<repo>#<n> nombra el id del trabajo de la primera

### Requirement: Solo lo que la máquina puede hacer
Con el protocolo habilitado, el daemon MUST NOT tomar un trabajo importado si needs.box es true y esta máquina no tiene la caja lista, ni si needs.engines incluye un motor que no figura en machineCapabilities de esta máquina. Ese trabajo SHALL quedar en la cola sin tomarse.

#### Scenario: Sin caja
- **WHEN** se importa un trabajo con needs.box true en una máquina cuya caja no está lista
- **THEN** no se llama a claimJob para ese trabajo y el trabajo sigue queued

#### Scenario: Motor que falta
- **WHEN** se importa un trabajo con needs.engines ["codex"] en una máquina cuyas capacidades declaran solo ["claude"]
- **THEN** no se llama a claimJob para ese trabajo

### Requirement: Terminado en otra máquina
Cuando el pase de coordinación ve que el claim de un trabajo local en cola es un registro de cierre de otra máquina, SHALL terminar la copia local con finalizeJob, con ese mismo estado y el motivo "Lo terminó la máquina <nombre>.", sin publicar nada en su origen.

#### Scenario: Entregado por B
- **WHEN** A tiene en cola un trabajo que B tomó y soltó con status delivered
- **THEN** después del pase de A, su trabajo está delivered con ese motivo y no se corrió ninguna estación en A

### Requirement: Subir el avance en cada checkpoint
Con el protocolo habilitado, el runner MUST subir la rama del trabajo al remoto origin de la línea con `git push --force-with-lease=refs/heads/<rama>:<último sha subido por esta máquina>` en tres momentos: después de guardar la spec, después de cada etapa que pasa verify y antes de integrar. Antes de cada subida SHALL confirmar con stillHolds que el trabajo sigue siendo suyo. Después SHALL guardar el sha subido y escribir `progress/<trabajo>` ({job, machine, checkpoint, stagesDone, branch, base, sha, title, spec, attempt, at}) con un compare-and-swap.

#### Scenario: Checkpoint de spec
- **WHEN** un trabajo con un repositorio remoto bare de test pasa la estación de spec
- **THEN** la rama existe en el remoto con el sha local y progress/<trabajo> tiene checkpoint spec y ese sha

#### Scenario: Etapa verificada
- **WHEN** una spec con dos etapas pasa verify en la primera
- **THEN** progress/<trabajo> tiene stagesDone 1 y el remoto tiene el commit de esa etapa

#### Scenario: Rama movida por otro
- **WHEN** antes de una subida alguien mueve la rama remota a un commit que esta máquina no subió
- **THEN** el push falla por el lease, la rama remota no cambia y el trabajo termina como perdido ("Lo retomó otra máquina de la fábrica.")

#### Scenario: Ya no es suyo
- **WHEN** stillHolds da false justo antes de una subida
- **THEN** no se ejecuta ningún git push

### Requirement: Subir al apagar a propósito
Cuando el daemon se apaga a propósito (pedido de apagado o señal), SHALL subir la rama de cada trabajo tomado que se interrumpió, igual que en un checkpoint y con lo que esté commiteado, y soltar su claim. Todo eso MUST pasar antes de liberar el lock del daemon.

#### Scenario: Apagado durante el build
- **WHEN** un daemon de test recibe el pedido de apagado mientras un trabajo tomado está en build
- **THEN** el remoto tiene la rama con el último commit del trabajo, claims/<trabajo> quedó soltado y el trabajo local volvió a queued

### Requirement: Retomar desde el último checkpoint
Cuando claimJob devuelve takenFrom, antes de correr el trabajo el daemon SHALL leer y validar `progress/<trabajo>`, traer esa rama del remoto origin y poner el trabajo local en ese checkpoint, con spec, title, stagesDone, branch, base y attempt. Así el runner retoma sin rehacer lo que ya se había subido. Un progress inválido o ausente SHALL hacer que el trabajo empiece desde cero.

#### Scenario: Retoma después de una etapa
- **WHEN** A subió progress con checkpoint spec, stagesDone 1 y su rama, deja de latir más allá de leaseMinutes y B toma el trabajo
- **THEN** en B no se llama a la estación de spec ni al build de la etapa 1, el build de la etapa 2 parte del commit subido por A y el sha de progress pasa a ser el de B

#### Scenario: Progress roto
- **WHEN** progress/<trabajo> tiene JSON inválido al retomar
- **THEN** el trabajo corre desde checkpoint none y no se lanza ningún error

### Requirement: La que vuelve no pisa nada
Una máquina que vuelve después de que otra retomó su trabajo MUST NOT subir, integrar ni comentar en el origen de ese trabajo. Su copia local SHALL terminar como perdida en la próxima comprobación de stillHolds.

#### Scenario: A vuelve
- **WHEN** B retomó el trabajo de A y A, despierta, sigue con su build
- **THEN** la rama remota sigue en el sha de B, A no integra y el trabajo local de A termina stopped con el motivo de perdido
