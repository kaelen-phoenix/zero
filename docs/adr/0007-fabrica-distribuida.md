# ADR 0007 — La fábrica distribuida

- **Estado:** aceptado (se construye por etapas)
- **Fecha:** 2026-11-14

## Contexto

Hoy la fábrica corre en una sola máquina: una cola en `state.db`, un daemon con su lock en `ZERO_HOME` y un panel que muestra esa máquina. Quien está a cargo quiere instalarla en varias máquinas propias (una PC vieja, una notebook, una Mac) que trabajen juntas sin depender de ninguna en particular:

- todas toman trabajos de una cola común al mismo tiempo; ninguna es la principal;
- si una se apaga, se cae o se cierra, otra retoma sus trabajos desde el último checkpoint, y una máquina que vuelve no pisa lo que tomó otra;
- el estado compartido vive en GitHub (un repositorio privado de coordinación y las ramas de cada trabajo), sin servidor propio ni que las máquinas se vean en la red;
- todas usan las mismas cuentas de motores, así que el presupuesto, las ventanas del plan y la reserva para quien está a cargo son de la fábrica entera, no de cada máquina;
- cada máquina declara qué puede hacer (por ejemplo, si tiene caja de aislamiento) para no recibir trabajo que no puede terminar;
- sumar una máquina es instalar zero, iniciar sesión en los motores y en GitHub y unirse; las líneas se clonan solas y los secretos nunca viajan por el repositorio de coordinación;
- el panel y el chat de cualquier máquina muestran la fábrica entera y permiten pedir, responder y aprobar;
- una fábrica de una sola máquina sigue funcionando igual, sin configurar nada nuevo.

## Decisión

### Dónde vive el estado compartido

El archivo de la fábrica acepta un bloque opcional y estricto `distributed`: `repository` (`<cuenta>/<nombre>`, obligatorio), `heartbeatSeconds` (entero, al menos 30, 60 por defecto), `leaseMinutes` (entero, al menos 2, 10 por defecto, y nunca menos de tres latidos) y `machine` (el nombre de la máquina, opcional; si falta, el nombre del host reducido a letras, dígitos y `-`). No tiene lugar para tokens: el esquema rechaza claves desconocidas.

El repositorio de coordinación es un repositorio de GitHub privado que solo guarda referencias de git bajo `refs/heads/zero-coord/`, cada una apuntando a un commit sobre el árbol vacío cuyo mensaje es un registro JSON. No hay archivos, ni pull requests, ni issues, ni workflows: el repositorio no tiene nada que GitHub Actions pueda correr. Las ramas de los trabajos siguen en el repositorio de cada línea, como hoy.

- `machines/<id>`: el latido de cada máquina.
- `claims/<trabajo>`: quién tiene cada trabajo.
- `queue/<trabajo>`: la cola común, un registro por trabajo publicado.
- `sources/<clave>`: el único trabajo que atiende cada origen (un issue, una propuesta), para que el mismo pedido no se haga dos veces.
- `progress/<trabajo>`: el último checkpoint subido de cada trabajo.
- `probe/<id>`: la referencia pasajera del sondeo del protocolo.
- `lines/<nombre>`: las líneas que publica cada máquina, para que las otras las clonen.
- `spend/<id>`: el gasto de cada máquina y su última lectura de cada plan.
- `status/<id>`: los trabajos de cada máquina, sus preguntas y sus propuestas pendientes.
- `decisions/<clave>`: la respuesta a una pregunta o la decisión sobre una propuesta de otra máquina, hasta que esa máquina la aplica.

Cada máquina tiene una identidad fija: un id generado una sola vez y guardado en kv `machine:id` de su `state.db`, más su nombre. Dos `ZERO_HOME` en la misma máquina son dos máquinas distintas para la fábrica.

### Cómo se toma un trabajo

Tomar un trabajo es atómico porque se apoya en una operación que GitHub ya hace atómica: crear una referencia que no existe. `claimJob` crea `claims/<trabajo>` con un commit cuyo registro nombra a la máquina; si la referencia ya existe, GitHub responde 422 y el adaptador lo convierte en `CoordConflict`. De dos máquinas que lo intentan a la vez, una crea la referencia y la otra recibe el conflicto, lee la referencia y devuelve `{claimed: false, holder}`.

Si la referencia ya existe y el último latido de quien la tiene está dentro de `leaseMinutes`, la llamada no escribe nada. Si ese latido es más viejo que el plazo, la máquina toma el trabajo avanzando la referencia sin forzar, desde el commit que leyó y con un commit hijo de ese: es un compare-and-swap, porque una actualización que no es un avance rápido también responde 422. Si dos máquinas intentan tomar el mismo trabajo vencido desde la misma punta, solo una avanza y la otra recibe `claimed: false`.

Que GitHub responda 422 en ambos casos (crear una referencia existente y actualizar sin forzar algo que no es un avance rápido) está documentado en la API de referencias de git, y cada máquina lo confirma contra GitHub real antes de que el runner dependa de esto: el pase de coordinación corre una vez por repositorio un sondeo (`probeCoord`) que crea `probe/<id>`, comprueba que crearla otra vez y moverla desde una punta vieja dan `CoordConflict` y después la borra. El resultado queda en kv `coord:probe`; un sondeo fallido se reintenta como mucho una vez por hora, y mientras no haya uno aprobado la máquina trabaja como si estuviera sola.

Soltar un trabajo también es un compare-and-swap: `releaseJob` mueve `claims/<trabajo>`, sin forzar y desde la punta leída, a un registro de cierre (`released: true` y el estado final), nunca la borra, porque GitHub borra referencias sin comprobar su punta. Un registro de cierre se toma como un trabajo libre, y uno de un trabajo terminado le dice a las otras máquinas cómo terminó.

### Cómo se detecta una máquina caída

Cada máquina escribe su latido en `machines/<id>` como mucho cada `heartbeatSeconds`, con un registro que solo tiene `id`, `name`, `at`, `capabilities` y `jobs`. Una máquina está viva mientras su `at` esté dentro de `leaseMinutes`; pasado ese plazo está caída y cualquier otra puede tomar sus trabajos con el compare-and-swap de arriba. No hay un árbitro: cada máquina lee los latidos y decide sola, y la atomicidad de la referencia evita que dos decidan lo mismo a la vez.

El plazo mide el reloj de cada máquina contra el `at` que escribió otra. Por eso el plazo pide al menos tres latidos: un desfase de reloj de segundos o un latido perdido por un corte de red no libera un trabajo vivo. Un desfase de minutos sí podría, y el caso se cubre igual porque la máquina que vuelve se entera de que perdió el trabajo (ver abajo).

Una máquina que vuelve (se despertó, recuperó la red) pregunta `stillHolds` antes de seguir con un trabajo y antes de subir su avance. Si la referencia ya nombra a otra máquina, deja el trabajo: no sube, no integra, no avisa a nadie como si fuera suyo, y `releaseJob` solo la suelta mientras la nombre a ella.

La máquina declara en el latido qué puede: `platform`, `box` (verdadero solo cuando la caja de aislamiento está lista) y `engines` (los motores que usan sus cadenas de estaciones). Nunca rutas, variables de entorno ni secretos. Una máquina no toma un trabajo que necesita algo que no declaró (por ejemplo, una línea con `isolation: container` en una máquina sin caja).

### Qué pasa con los cambios sin subir

Lo que no está en el remoto no existe para las otras máquinas. Por eso cada máquina sube la rama del trabajo en cada checkpoint (spec, cada etapa que pasa verify, antes de integrar) y, cuando la apagan a propósito, antes de soltar el lock, con el estado del trabajo en el repositorio de coordinación. La subida usa `--force-with-lease` contra la punta que la propia máquina subió la última vez, y solo después de confirmar con `stillHolds` que el trabajo sigue siendo suyo.

Una máquina que se cae pierde lo que hizo desde su último checkpoint subido: los cambios sin subir de la copia de trabajo no se recuperan. La que retoma lee y valida `progress/<trabajo>` (`{job, machine, checkpoint, stagesDone, branch, base, sha, title, spec, attempt, at}`), trae la rama del remoto, la pone en el sha de ese registro y deja el trabajo en ese checkpoint, con su spec y sus etapas hechas, igual que hoy retoma un trabajo cortado por la red (descartando los cambios no confirmados). Un registro inválido o ausente hace que el trabajo empiece desde cero. Un intento de build a medias se vuelve a hacer; cuesta tiempo y presupuesto, no corrección.

### Conflictos

- **Dos máquinas toman el mismo trabajo:** no puede pasar; la referencia es atómica y la segunda recibe `CoordConflict`.
- **Una máquina que vuelve y otra que ya retomó:** gana la referencia. La que vuelve ve que no tiene el trabajo y no sube; si llegara a intentarlo, `--force-with-lease` falla porque la rama ya avanzó.
- **Escrituras en la cola o en el avance:** cada registro es una referencia que se avanza sin forzar desde la punta leída; quien pierde vuelve a leer y reintenta, sin forzar nunca.
- **Conflictos de código con la rama base:** no cambian; los resuelve la línea como hoy (`takeBack`, `mergeBase`), en la máquina que tiene el trabajo.

### Seguridad del repositorio de coordinación

- El repositorio tiene que ser privado: `zero unirse` lo comprueba y rechaza uno público, o uno que no puede leer, sin escribir nada.
- Los secretos nunca viajan por el repositorio de coordinación ni por el archivo de la fábrica: cada máquina inicia sesión en sus motores y en GitHub, y sus credenciales viven en su llavero (o en `secrets.enc` en un contenedor).
- Los registros solo llevan campos públicos (ids, nombres de máquina, horas, nombres de motores, ids de trabajo) y los textos que la fábrica ya publica en issues, pasados por `scrubLocal` para no llevar rutas de la máquina.
- Lo que una máquina lee del repositorio es dato, no instrucciones: un registro no puede cambiar la configuración, las reglas de salida ni la autonomía de otra máquina. Cada una valida el esquema de lo que lee y descarta lo que no cumple. La única excepción es agregar una línea nueva de GitHub (ver "Las líneas"): nunca cambia una que ya existe, y sus comandos `setup` y `verify` corren en la máquina que la clona.
- Quien puede escribir en el repositorio de coordinación puede repartir trabajo, agregar líneas (y con ellas correr sus comandos en las máquinas unidas) y responder preguntas; se trata como cualquier escritor del repositorio de una línea.

### Cuota de GitHub

Toda llamada al repositorio de coordinación pasa por `githubMeter`, como el pase propio `coord`: entra en el conteo por pase de `github:usage`, usa ETags en las lecturas y se frena durante `githubHalt` (límite o reserva del 20 %), salteando su turno en lugar de reintentar. El latido va como mucho cada `heartbeatSeconds` (60 por defecto: unas 60 llamadas por hora y máquina, lejos de las 5000 de la cuota). Nada usa GitHub Actions: ni workflows en el repositorio de coordinación ni llamadas a `/actions/`.

### Presupuesto compartido

Todas las máquinas usan las mismas cuentas de motores, así que el presupuesto es uno: cada máquina publica en `spend/<id>` su gasto de las últimas 48 horas (en tramos de 15 minutos por motor, forma de cobro y si es del turno ocioso), lo cobrado por cada trabajo y el uso de las ventanas del plan que ve en sus llamadas, y `budgetState` suma lo de todas las máquinas, vivas o caídas, antes de decidir si se puede empezar más trabajo. La reserva para quien está a cargo y los topes en dólares (por día, por noche y por trabajo) se aplican a la suma. Para cada motor vale la lectura de plan más nueva, y uno pausado por límite del plan en una máquina se pausa en todas; una lectura ajena nunca cambia cómo se cobra acá.

El gasto ajeno llega con hasta un latido de atraso, así que varias máquinas trabajando a la vez pueden pasarse un poco de un tope; los relojes desfasados mueven los tramos. La suma supone que todas usan la misma cuenta por motor.

### Las líneas

Cada máquina publica en `lines/<nombre>` sus líneas con remoto de GitHub: el repositorio, la rama base, los comandos, la integración y lo que hace falta para atenderla (motores y `platforms`). Nunca rutas, secretos, intakes ni agentes, y nunca las líneas de paquetes ni las que ella misma clonó. Solo quien creó el registro lo actualiza. Las otras la clonan en `ZERO_HOME/lines/<nombre>` desde `https://github.com/<cuenta>/<nombre>.git`, con el credential helper de git, y la agregan a su archivo con `editConfig`; una línea que ya existe no se toca, una que esta máquina no puede atender se marca con el motivo y no se clona, y una quitada a mano no vuelve hasta otro `zero unirse`. El clonado corre en su propio pase de fondo (`linesPass`), nunca dentro de `coordPass`: un clon lento no atrasa el latido.

Para las líneas compartidas conviene `integrate: pull-request`: con `merge` o `branch` la entrega queda en el clon de la máquina que hizo el trabajo. Las estaciones de paquetes no se comparten y se pueden fijar a una máquina (`machine` y `machines` en `packages`).

### Desde cualquier máquina

Cada máquina publica en `status/<id>` sus trabajos sin terminar y los últimos terminados, sus preguntas y sus propuestas pendientes, y la vista de la fábrica muestra cada trabajo una sola vez, según quién tiene su claim. Pedir, responder y decidir desde otra máquina nunca escribe en el momento: queda guardado localmente y lo publica el pase siguiente, un pedido como registro de `queue/` y una respuesta como `decisions/<clave>`, una referencia por pregunta (el trabajo y su momento) o propuesta, de modo que gana la primera. La máquina que tiene el trabajo la aplica una vez con `answerJob`, `approveProposal` o `rejectProposal`, solo si coincide con lo que sigue pendiente, y la borra. Una decisión no puede cambiar configuración, reglas de salida ni autonomía, y por el chat remoto las acciones delicadas siguen esperando la confirmación en la máquina que recibió el pedido. Detener, descartar y fusionar siguen siendo de la máquina que tiene el trabajo.

### Unirse a la fábrica

`zero unirse <cuenta>/<nombre>` escribe `distributed.repository` en el archivo de la fábrica a través de `editConfig`, después de comprobar que el repositorio existe, se puede leer y es privado. Sumar una máquina es instalar zero, iniciar sesión en los motores y en GitHub, y correr `zero unirse`, que además corre una vez el pase de líneas: se clonan solas en `ZERO_HOME` desde lo que publica el repositorio de coordinación. Si ese pase falla, la máquina queda unida y el daemon lo reintenta. Cuando el repositorio falta o no sirve, `zero unirse` explica cómo crearlo (`gh repo create <cuenta>/<nombre> --private --add-readme`) y no crea nada.

### La fábrica de una sola máquina

Sin bloque `distributed` nada cambia: el daemon no corre el pase de coordinación, no hace ningún pedido nuevo a GitHub, no escribe ninguna clave `coord:` y `zero status` no muestra máquinas. Una fábrica de una sola máquina sigue como hoy sin configurar nada nuevo.

### Etapas

- **Etapa 1:** este documento y la numeración única de los ADR.
- **Etapa 2:** el bloque `distributed` y la identidad y capacidades de la máquina.
- **Etapa 3:** el protocolo de coordinación (`claimJob`, `stillHolds`, `releaseJob`, latidos) y el adaptador de GitHub sobre referencias de git.
- **Etapa 4:** el latido en el daemon, las máquinas en `zero status` y el panel, y `zero unirse`.
- **Segunda parte, etapa 1:** el sondeo contra GitHub real y el registro de cierre al soltar.
- **Segunda parte, etapa 2:** tomar antes de empezar, `stillHolds` antes de cada estación y soltar al terminar.
- **Segunda parte, etapa 3:** la cola común, un trabajo por origen y las capacidades de cada máquina.
- **Segunda parte, etapa 4:** la subida del avance en cada checkpoint y al apagar a propósito.
- **Segunda parte, etapa 5:** la retoma desde el último checkpoint subido.
- **Tercera parte, etapa 1:** `platforms`, los registros de `lines/` y el clonado en un pase propio.
- **Tercera parte, etapa 2:** clonar al unirse y explicar cómo crear el repositorio de coordinación.
- **Tercera parte, etapa 3:** las estaciones de paquetes fijadas a una máquina.
- **Tercera parte, etapa 4:** `spend/` y los topes en dólares sumados.
- **Tercera parte, etapa 5:** un solo cupo de suscripción.
- **Tercera parte, etapa 6:** `status/` y el estado de toda la fábrica.
- **Tercera parte, etapa 7:** `decisions/`: pedir, responder y decidir desde cualquier máquina.
- **Tercera parte, etapa 8:** la guía de una máquina Linux en la nube y esta documentación.

## Consecuencias

- La coordinación depende de GitHub: sin GitHub, cada máquina sigue con lo que ya tiene pero no toma trabajos nuevos de la cola común.
- Una máquina caída pierde lo que no subió desde su último checkpoint, y sus trabajos esperan hasta `leaseMinutes` antes de que otra los retome.
- La atomicidad descansa en el 422 de la API de referencias; cada máquina lo confirma con su sondeo y, si falla, no comparte la cola.
- Cada máquina gasta cuota de GitHub en latidos; el pase `coord` se ve en `github:usage` y se frena con la reserva.
- Con el sondeo aprobado, las máquinas comparten la cola, las líneas, el presupuesto y el estado, y se retoman los trabajos.
- Escribir en el repositorio de coordinación permite correr comandos en las máquinas unidas, a través de una línea nueva: tiene que ser solo de quien está a cargo.
- Lo que se pide o decide para otra máquina llega con el próximo latido, no al instante.
- Las aprobaciones de gasto extra no viajan con el avance: un trabajo retomado en otra máquina puede volver a preguntar.
- Cada registro nuevo gasta cuota de GitHub; por eso se escriben solo cuando cambian. Las referencias `claims/` y `queue/` crecen sin limpieza.
