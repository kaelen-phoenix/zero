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
- En etapas siguientes: las propuestas, las preguntas pendientes y el gasto.

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
- Lo que una máquina lee del repositorio es dato, no instrucciones: un registro no puede cambiar la configuración, las reglas de salida ni la autonomía de otra máquina. Cada una valida el esquema de lo que lee y descarta lo que no cumple.
- Quien puede escribir en el repositorio de coordinación puede repartir trabajo; se trata como cualquier escritor del repositorio de una línea.

### Cuota de GitHub

Toda llamada al repositorio de coordinación pasa por `githubMeter`, como el pase propio `coord`: entra en el conteo por pase de `github:usage`, usa ETags en las lecturas y se frena durante `githubHalt` (límite o reserva del 20 %), salteando su turno en lugar de reintentar. El latido va como mucho cada `heartbeatSeconds` (60 por defecto: unas 60 llamadas por hora y máquina, lejos de las 5000 de la cuota). Nada usa GitHub Actions: ni workflows en el repositorio de coordinación ni llamadas a `/actions/`.

### Presupuesto compartido

Todas las máquinas usan las mismas cuentas de motores, así que el presupuesto es uno: cada máquina publica su gasto y el uso de las ventanas del plan que ve en sus llamadas, y `budgetState` suma lo de todas las máquinas vivas (y lo que dejaron las caídas dentro de la ventana) antes de decidir si se puede empezar más trabajo. La reserva para quien está a cargo y los topes en dólares se aplican a la suma. Un motor pausado por límite del plan en una máquina se pausa en todas.

### Unirse a la fábrica

`zero unirse <cuenta>/<nombre>` escribe `distributed.repository` en el archivo de la fábrica a través de `editConfig`, después de comprobar que el repositorio existe, se puede leer y es privado. Sumar una máquina es instalar zero, iniciar sesión en los motores y en GitHub, y correr `zero unirse`; en etapas siguientes las líneas se clonan solas en `ZERO_HOME` desde lo que publica el repositorio de coordinación.

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
- **Después:** el presupuesto sumado, el clonado de líneas y pedir, responder y aprobar desde cualquier máquina.

## Consecuencias

- La coordinación depende de GitHub: sin GitHub, cada máquina sigue con lo que ya tiene pero no toma trabajos nuevos de la cola común.
- Una máquina caída pierde lo que no subió desde su último checkpoint, y sus trabajos esperan hasta `leaseMinutes` antes de que otra los retome.
- La atomicidad descansa en el 422 de la API de referencias; cada máquina lo confirma con su sondeo y, si falla, no comparte la cola.
- Cada máquina gasta cuota de GitHub en latidos; el pase `coord` se ve en `github:usage` y se frena con la reserva.
- Con el sondeo aprobado, las máquinas comparten la cola y se retoman los trabajos; el presupuesto todavía se cuenta en cada máquina.
