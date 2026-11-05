# Spec Delta

## Purpose

Vas a poder instalar un paquete de agentes desde un repositorio git con un solo comando, por ejemplo `zero package add github:acme/hola-zero#v1` o con una URL https o ssh. zero usa las credenciales de git que ya tenés: nunca te pide ni guarda tokens. Antes de instalar te muestra qué trae el paquete y te pide confirmación. `zero package update [nombre]` trae lo nuevo, te muestra los commits y si cambian los secretos o permisos declarados, y te vuelve a preguntar si se amplían. Para aplicar el cambio apaga la fábrica, actualiza y reinstala dependencias. Si el paquete queda inválido vuelve al commit anterior, y al final enciende una sola fábrica si estaba en marcha. También actualiza paquetes de carpeta y de npm. `zero package list` muestra la fuente, el commit o la versión instalada y si hay una actualización disponible, sin usar la red; la fábrica revisa esto una vez por día. Es el pedido anterior, con el defecto que lo frenó ya corregido: un paquete fijado a un tag anotado ya no avisa "hay una actualización" todos los días cuando nada cambió.

## ADDED Requirements

### Requirement: Fuentes git reconocidas
`zero package add` MUST reconocer como fuente git `github:<cuenta>/<repo>`, `github:<cuenta>/<repo>#<tag-o-rama>` y URLs git https, ssh:// o de la forma `git@host:ruta`, con `#<tag-o-rama>` opcional, antes de evaluar si la fuente es una carpeta o un nombre npm; las carpetas y los nombres npm MUST seguir funcionando como hasta ahora.

#### Scenario: github corto con referencia
- **WHEN** se parsea `github:acme/hola#v1`
- **THEN** el resultado es la URL `https://github.com/acme/hola.git` con la referencia `v1`, y `packageAdd` usa el camino git en lugar de tratar la fuente como carpeta

#### Scenario: formas de URL
- **WHEN** se parsean `https://host/a/b.git`, `ssh://git@host/a/b.git#main` y `git@host:a/b.git`
- **THEN** las tres se aceptan como fuente git y la segunda tiene la referencia `main`

#### Scenario: carpeta sin cambios
- **WHEN** se agrega una carpeta local con un manifiesto válido
- **THEN** el archivo de fábrica queda con `path`, sin `git` ni `commit`, y no se pide confirmación

### Requirement: Fuentes git rechazadas
zero MUST rechazar, sin ejecutar git y sin escribir nada, toda fuente git con credenciales en la URL, con un protocolo distinto de https o ssh, o con una referencia o URL que git pueda leer como opción.

#### Scenario: token en la URL
- **WHEN** la fuente es `https://usuario:token@host/a/b.git` o `https://token@host/a/b.git`
- **THEN** `packageAdd` lanza un error cuyo texto no contiene el token, el ejecutor de git no recibe ninguna llamada y el archivo de fábrica no cambia

#### Scenario: otros protocolos y opciones
- **WHEN** la fuente es `http://host/a.git`, `ext::sh -c x`, `file:///tmp/a` o `github:a/b#--upload-pack=x`
- **THEN** `packageAdd` lanza un error y el ejecutor de git no recibe ninguna llamada

#### Scenario: archivo de fábrica con credenciales
- **WHEN** `parseFactory` lee una entrada `git` con credenciales en la URL
- **THEN** lanza `ConfigError`

### Requirement: Clon fuera de las zonas de los agentes
Una fuente git MUST clonarse en `<ZERO_HOME>/packages/git/<nombre del manifiesto>` usando las credenciales de git de la persona, sin que zero ni git pidan un token por terminal y sin credenciales en argv, archivos o registros.

#### Scenario: clon en su carpeta
- **WHEN** se agrega con confirmación un repositorio git temporal cuyo manifiesto se llama `hello`
- **THEN** `<ZERO_HOME>/packages/git/hello/zero-package.yaml` existe y HEAD está en el commit de la referencia pedida

#### Scenario: sin preguntas de git
- **WHEN** el ejecutor real de git lanza un comando
- **THEN** su entorno lleva `GIT_TERMINAL_PROMPT=0` y `GIT_ALLOW_PROTOCOL=https:ssh`, sin stdin interactivo

#### Scenario: programas plantados en el repositorio
- **WHEN** el repositorio trae en su raíz `git.exe`, `git.com`, `git.cmd` o `git.bat`, o `npm.cmd`, `npm.bat` o `npm.exe` junto a un `package-lock.json`
- **THEN** zero lanza git y npm por su ruta absoluta, resuelta solo con entradas absolutas de PATH, sin shell y desde una carpeta ajena al paquete (`git -C <carpeta>`, `npm --prefix <carpeta>`), y lo plantado no corre

### Requirement: Resumen y confirmación antes de instalar
Antes de instalar dependencias o tocar el archivo de fábrica, `packageAdd` con fuente git MUST validar el manifiesto, mostrar sus agentes, skills, estaciones, secretos declarados y si pide permiso de código, y pedir confirmación; sin confirmación MUST dejar todo como estaba.

#### Scenario: resumen completo
- **WHEN** se agrega un repositorio con un agente, una skill y una estación que declara el secreto `HELLO_TOKEN`
- **THEN** el texto que recibe `say` o `confirm` antes de responder nombra el agente, la skill, la estación, `HELLO_TOKEN` y que pide permiso de código

#### Scenario: confirmación negada
- **WHEN** `confirm` responde false
- **THEN** no queda carpeta en `packages/git`, incluidos temporales, el instalador de dependencias no se llama y el archivo de fábrica no cambia

#### Scenario: sin terminal ni --yes
- **WHEN** el comando corre sin terminal interactiva y sin `--yes`
- **THEN** la confirmación da no y no se instala nada

### Requirement: Dependencias sin scripts
Tras la confirmación, si el paquete tiene `package-lock.json`, zero MUST ejecutar en su carpeta `npm ci --omit=dev --ignore-scripts`; sin ese archivo MUST no instalar dependencias.

#### Scenario: con lock
- **WHEN** el repositorio tiene `package-lock.json` y se confirma
- **THEN** el instalador recibe la carpeta del paquete y `npmCiArgs()` contiene `ci`, `--omit=dev` e `--ignore-scripts`

#### Scenario: sin lock
- **WHEN** el repositorio no tiene `package-lock.json`
- **THEN** el instalador no se llama y el paquete se agrega igual

#### Scenario: falla la instalación
- **WHEN** el instalador lanza un error durante un agregado
- **THEN** `packageAdd` falla, el clon se borra y el archivo de fábrica no cambia

### Requirement: Dependencias que npm tendría que armar
`--ignore-scripts` no alcanza a una dependencia git, porque npm la arma corriendo su `prepare`. Antes de lanzar npm sobre un paquete, zero MUST leer `package-lock.json` y `npm-shrinkwrap.json` y rechazar el agregado o la actualización, sin lanzar npm, si alguna dependencia no es un tarball https de un registro o un enlace local, o si el archivo es un enlace o no se puede leer. En una actualización git MUST leerlos del commit nuevo mientras planifica, antes de confirmar y de apagar la fábrica. Para un paquete npm MUST armar antes el lock en una carpeta descartable y rechazarlo igual, y toda ejecución de npm MUST llevar `allow-git=none` para las versiones que lo conocen.

#### Scenario: agregado con dependencia git
- **WHEN** el lock del repositorio resuelve una dependencia a `git+https://`
- **THEN** `packageAdd` lanza el motivo, `confirm` y el instalador no se llaman, `packages/git` queda sin carpetas y el archivo de fábrica no cambia

#### Scenario: actualización que solo cambia el lock
- **WHEN** un commit nuevo solo agrega al lock una dependencia git
- **THEN** el resultado marca fallo, `confirm`, `shutdown`, el instalador y `start` no se llaman, HEAD y `commit` siguen en el commit anterior y la lista avisa la actualización

#### Scenario: carpeta con dependencia git
- **WHEN** el lock de un paquete de carpeta cambia y ahora tiene una dependencia git
- **THEN** el resultado marca fallo y ni `shutdown` ni el instalador se llaman

#### Scenario: shrinkwrap junto a un lock limpio
- **WHEN** la carpeta tiene un `package-lock.json` limpio y un `npm-shrinkwrap.json` con una dependencia git
- **THEN** npm no se lanza

#### Scenario: npm real con un script de preparación
- **WHEN** contra npm real, una dependencia git con `prepare` llega por un lock o por un paquete npm que la declara
- **THEN** se rechaza y el script no corre

#### Scenario: lo que sí se instala
- **WHEN** el lock solo tiene tarballs https de un registro, enlaces locales, dependencias incluidas en otro paquete o alias npm
- **THEN** no hay motivo de rechazo

### Requirement: Lo que npm ci vaciaría a través de un enlace
`npm ci` vacía `node_modules` del paquete y de cada workspace antes de instalar, siguiendo enlaces, con `--ignore-scripts` o sin él. Antes de lanzar npm sobre un paquete con lock, zero MUST rechazar el agregado o la actualización si una entrada llamada `node_modules`, en cualquier nivel y sin distinguir mayúsculas, no es una carpeta de verdad; si un enlace sale de la carpeta del paquete; si `workspaces` en `package.json` tiene un patrón que pueda salir de ella; o si el lock ubica un paquete o un enlace fuera de ella. En una actualización git MUST leerlo del commit nuevo con `git ls-tree -r`, antes de confirmar y de apagar la fábrica.

#### Scenario: agregado con node_modules enlazado
- **WHEN** el repositorio versiona `node_modules` como enlace a una carpeta
- **THEN** `packageAdd` lanza el motivo, `confirm` y el instalador no se llaman, `packages/git` queda sin carpetas, el archivo de fábrica no cambia y la carpeta apuntada sigue intacta

#### Scenario: actualización con el enlace en un workspace
- **WHEN** un commit nuevo agrega `packages/a/node_modules` como enlace
- **THEN** el resultado marca fallo, `confirm`, `shutdown`, el instalador y `start` no se llaman, y HEAD y `commit` siguen en el commit anterior

#### Scenario: carpeta con enlace
- **WHEN** una carpeta con lock tiene `node_modules` o un workspace como enlace a otra carpeta
- **THEN** `realDependencies` lanza el motivo, npm no se lanza y lo apuntado sigue intacto

#### Scenario: workspaces y rutas del lock que salen
- **WHEN** `workspaces` tiene un patrón con `..` o llaves, o el lock tiene una ruta o un enlace con `..` o absoluto
- **THEN** se rechaza

#### Scenario: lo que sigue valiendo
- **WHEN** un enlace queda dentro del paquete, los workspaces son carpetas del paquete, o el repositorio no tiene lock
- **THEN** no hay motivo de rechazo

### Requirement: Entrada git en el archivo de fábrica
Un paquete instalado desde git MUST quedar en el archivo de fábrica como `git: <fuente>` con `path` (su carpeta) y `commit` (el SHA instalado), conservando los comentarios del archivo y con `allowCode` según `--permitir-codigo` como hasta ahora; el esquema MUST exigir `path` y `commit` junto a `git` y no aceptarlo junto a `npm`.

#### Scenario: entrada escrita
- **WHEN** se agrega `github:acme/hola#v1` con confirmación y `allowCode: true` en un archivo con comentarios
- **THEN** la entrada parseada es `{git: 'github:acme/hola#v1', path: <carpeta>, commit: <sha de 40 caracteres>, allowCode: true}`, el comentario sigue y las estaciones cargan

#### Scenario: esquema estricto
- **WHEN** `parseFactory` recibe una entrada `git` sin `commit`, o con `npm`
- **THEN** lanza `ConfigError`

#### Scenario: carga normal
- **WHEN** la fábrica se abre con una entrada git válida
- **THEN** `loadPackages` carga el paquete desde `path`

### Requirement: Rechazos al agregar desde git
`packageAdd` con fuente git MUST rechazar y borrar su clon temporal cuando el manifiesto es inválido, el paquete no encaja con los demás o su carpeta de destino ya existe sin estar declarada con esa fuente; repetir una fuente ya declarada MUST solo actualizar el permiso, sin clonar.

#### Scenario: manifiesto inválido
- **WHEN** el repositorio no tiene `zero-package.yaml` o declara `interface: 2`
- **THEN** `packageAdd` lanza el motivo, no se pregunta nada, `packages/git` queda sin carpetas y el archivo de fábrica no cambia

#### Scenario: manifiesto enlazado
- **WHEN** en el commit pedido el manifiesto es un enlace simbólico
- **THEN** `packageAdd` lanza el motivo, no se pregunta nada, `packages/git` queda sin carpetas y el archivo de fábrica no cambia

#### Scenario: no encaja
- **WHEN** un agente del paquete repite el nombre de un agente de otro paquete instalado
- **THEN** `packageAdd` lanza un error con ese nombre, no se instalan dependencias y el archivo de fábrica no cambia

#### Scenario: destino ocupado
- **WHEN** `packages/git/hello` ya existe y ninguna entrada lo declara con esa fuente
- **THEN** `packageAdd` lanza un error que nombra la carpeta y no modifica su contenido

#### Scenario: ya declarado
- **WHEN** se repite una fuente declarada con `allowCode: true`
- **THEN** el ejecutor de git no se llama, sigue habiendo una sola entrada y su `allowCode` es true

### Requirement: Actualización git: mostrar el cambio
`zero package update [nombre]` MUST hacer fetch de cada paquete git elegido, mostrar los commits nuevos y los cambios en secretos y permisos declarados, sin apagar la fábrica cuando no hay commit nuevo; sin nombre MUST considerar todos los paquetes.

#### Scenario: commits nuevos
- **WHEN** el repositorio remoto tiene dos commits nuevos y se llama a `packageUpdate`
- **THEN** la salida incluye los dos asuntos de commit y el SHA corto de origen y destino

#### Scenario: sin novedad
- **WHEN** no hay commits nuevos
- **THEN** la salida dice que está al día y `shutdown` no se llama

#### Scenario: secreto declarado nuevo
- **WHEN** el manifiesto del commit nuevo agrega el secreto `OTRO`
- **THEN** la salida nombra `OTRO` como secreto nuevo

#### Scenario: nombre desconocido
- **WHEN** el nombre no corresponde a ningún paquete
- **THEN** la salida dice que no existe y el resultado marca fallo

### Requirement: Confirmación al ampliar permisos
La actualización de un paquete git MUST pedir confirmación antes de aplicar solo cuando se amplía lo declarado: un secreto nuevo, una estación nueva, un `requests` nuevo o con `perLinePerDay` mayor, o un agente nuevo o existente de tipo `build`; si no se confirma MUST dejar el paquete y la fábrica como estaban.

#### Scenario: ampliación negada
- **WHEN** el commit nuevo agrega una estación y `confirm` responde false
- **THEN** `shutdown` no se llama, HEAD y `commit` siguen en el commit anterior y el resultado no cambia el archivo de fábrica

#### Scenario: ampliación aceptada
- **WHEN** el commit nuevo agrega un secreto y `confirm` responde true
- **THEN** la actualización se aplica

#### Scenario: sin ampliación
- **WHEN** el commit nuevo solo cambia instrucciones o quita un secreto
- **THEN** `confirm` no se llama y la actualización se aplica

#### Scenario: manifiesto enlazado o ilegible
- **WHEN** en el commit nuevo el manifiesto es un enlace simbólico, falta, no es válido o no se puede leer
- **THEN** la actualización no se aplica, `confirm` y `shutdown` no se llaman, el resultado marca fallo y HEAD y `commit` siguen en el commit anterior

#### Scenario: manifiesto distinto en disco
- **WHEN** tras el checkout el manifiesto de la carpeta difiere del que se evaluó en el commit
- **THEN** HEAD vuelve al commit anterior, `commit` no cambia y el resultado marca fallo

### Requirement: Aplicación segura con la fábrica apagada
Cuando hay algo que aplicar, zero MUST apagar la fábrica y esperar a que su proceso termine antes de tocar los archivos de cualquier paquete, y al terminar MUST encender una sola fábrica solo si estaba en marcha, aunque se actualicen varios paquetes o alguno falle.

#### Scenario: orden de la operación
- **WHEN** se actualiza un paquete con la fábrica en marcha
- **THEN** `shutdown` ocurre antes del checkout y del instalador, `start` ocurre después de ambos y cada uno se llama una vez

#### Scenario: estaba apagada
- **WHEN** `shutdown` devuelve `not-running`
- **THEN** la actualización se aplica y `start` no se llama

#### Scenario: varios paquetes
- **WHEN** `packageUpdate` sin nombre aplica dos paquetes y el primero falla
- **THEN** el segundo se aplica igual y `shutdown` y `start` se llaman una vez cada uno

#### Scenario: no se apaga
- **WHEN** `shutdown` devuelve `timeout` con un pid
- **THEN** no se modifica ningún paquete, `start` no se llama, la salida nombra el pid y el resultado marca fallo

#### Scenario: registro de instalación
- **WHEN** la actualización termina bien
- **THEN** la entrada del archivo tiene el `commit` nuevo, HEAD coincide y los comentarios del archivo siguen

### Requirement: Vuelta al commit anterior
Si tras actualizar un paquete git fallan las dependencias, su manifiesto no es válido, cambió de nombre o el paquete no carga junto a los demás, zero MUST volver al commit anterior, reinstalar sus dependencias si tiene lock y dejar `commit` sin cambios en el archivo.

#### Scenario: manifiesto inválido tras actualizar
- **WHEN** el commit nuevo declara un agente cuyas instrucciones no existen
- **THEN** HEAD vuelve al commit anterior, `commit` no cambia, la salida da el motivo, el resultado marca fallo y `start` se llama si la fábrica estaba en marcha

#### Scenario: fallan las dependencias
- **WHEN** el instalador lanza un error en la actualización
- **THEN** HEAD vuelve al commit anterior, el instalador se llama otra vez para el commit anterior si hay lock y `commit` no cambia

#### Scenario: cambio de nombre
- **WHEN** el commit nuevo cambia `name` en el manifiesto
- **THEN** HEAD vuelve al commit anterior y la salida lo explica

### Requirement: Protecciones de la carpeta git
zero MUST negarse a actualizar una entrada git cuya carpeta no está dentro de `<ZERO_HOME>/packages/git`, no es la raíz de su propio repositorio git o tiene cambios locales en archivos versionados, sin apagar la fábrica ni tocar esa carpeta.

#### Scenario: carpeta ajena
- **WHEN** el `path` de la entrada apunta a un repositorio fuera de `packages/git`
- **THEN** el resultado marca fallo, `shutdown` no se llama y ese repositorio no cambia

#### Scenario: sin .git propio
- **WHEN** la carpeta del paquete está dentro de otro repositorio y no tiene `.git` propio
- **THEN** el resultado marca fallo y HEAD del repositorio exterior no cambia

#### Scenario: cambios locales
- **WHEN** un archivo versionado del paquete fue modificado
- **THEN** el resultado marca fallo, el archivo conserva su contenido y `shutdown` no se llama

### Requirement: Actualización de carpetas
Para un paquete de carpeta, `zero package update` MUST reinstalar dependencias (`npm ci --omit=dev --ignore-scripts`) solo si `package-lock.json` cambió desde el último registro, y sin cambio MUST no apagar la fábrica.

#### Scenario: lock igual
- **WHEN** se agrega una carpeta con lock y se actualiza sin que el lock cambie
- **THEN** el instalador y `shutdown` no se llaman y la salida dice que está al día

#### Scenario: lock cambiado
- **WHEN** el contenido del lock cambia y se actualiza dos veces
- **THEN** la primera vez `shutdown`, el instalador y `start` se llaman una vez cada uno, y la segunda no se llama ninguno

#### Scenario: paquete anterior sin registro
- **WHEN** la carpeta tiene lock y no hay huella registrada
- **THEN** el instalador se llama una vez y la huella queda registrada

#### Scenario: sin lock
- **WHEN** la carpeta no tiene lock
- **THEN** el instalador no se llama

### Requirement: Actualización de npm
Para un paquete npm, `zero package update` MUST consultar la última versión e instalarla dentro de `<ZERO_HOME>/packages` con `--ignore-scripts`, con la fábrica apagada, y sin versión nueva MUST no apagarla.

#### Scenario: versión nueva
- **WHEN** la consulta inyectada devuelve una versión distinta de la instalada
- **THEN** el orden es `shutdown`, `install` con `<ZERO_HOME>/packages` y `<nombre>@<versión>`, y `start`

#### Scenario: al día
- **WHEN** la consulta devuelve la versión instalada
- **THEN** `install` y `shutdown` no se llaman

#### Scenario: falla el manifiesto tras instalar
- **WHEN** la versión instalada deja el manifiesto inválido
- **THEN** el resultado marca fallo con el motivo y `start` se llama si estaba en marcha

### Requirement: Lista con fuente y versión instalada
`zero package list` MUST mostrar para cada paquete su fuente y su commit o versión instalada, y si hay una actualización disponible según lo último registrado, sin usar la red ni lanzar git o npm.

#### Scenario: paquete git
- **WHEN** se formatea la lista con un paquete git instalado
- **THEN** el texto contiene su fuente y el SHA corto del commit

#### Scenario: actualización vista
- **WHEN** lo último visto registrado difiere del commit instalado
- **THEN** el texto avisa que hay una actualización con el SHA corto visto y la fecha de la revisión

#### Scenario: al día tras actualizar
- **WHEN** una actualización se aplica
- **THEN** el texto ya no avisa actualización para ese paquete

#### Scenario: visto y no aplicado
- **WHEN** `packageUpdate` hace fetch y la confirmación de ampliación se niega
- **THEN** la lista avisa que hay una actualización

#### Scenario: sin red
- **WHEN** se llama a `packageList` con ejecutores inyectados de git y npm
- **THEN** ninguno recibe llamadas

### Requirement: Revisión periódica de novedades
Con la fábrica en marcha, zero MUST revisar a lo sumo una vez por día, en un pase que no toca las carpetas de los paquetes, la última revisión remota de cada paquete git y npm y registrarla; un error de red o de credenciales MUST quedar en el registro sin frenar la fábrica.

#### Scenario: novedad registrada
- **WHEN** el remoto de un repositorio temporal tiene un commit nuevo y corre el pase
- **THEN** lo visto queda registrado con ese SHA y HEAD de la carpeta del paquete no cambia

#### Scenario: una vez por día
- **WHEN** el pase corre dos veces dentro de las mismas 24 horas
- **THEN** el ejecutor de git recibe llamadas solo en la primera

#### Scenario: remoto caído
- **WHEN** el ejecutor de git falla para un paquete
- **THEN** el pase no lanza error y los demás paquetes se revisan

### Requirement: Tags anotados en la revisión periódica
`packageUpdatesPass` MUST pedirle a `git ls-remote` tanto `<ref>` como `<ref>^{}` cuando la fuente tiene referencia, de modo que lo registrado para un tag anotado sea el commit al que apunta y no el objeto tag, y un paquete sin cambios en su remoto MUST no mostrar aviso de actualización.

#### Scenario: tag anotado sin cambios
- **WHEN** contra un repositorio temporal real, con git real, se instala `github:acme/hola#v1` donde `v1` se creó con `git tag -a`, y corre `packageUpdatesPass`
- **THEN** lo visto registrado es igual al `commit` instalado y `formatPackages(packageList(ctx))` no contiene `hay una actualización`

#### Scenario: tag anotado movido
- **WHEN** contra un repositorio temporal real, tras instalar `#v1`, se agrega un commit, se mueve el tag con `git tag -f -a v1` y corre `packageUpdatesPass`
- **THEN** lo visto registrado es el SHA del commit nuevo, igual a `git rev-parse v1^{commit}`, y la lista avisa la actualización con su SHA corto

#### Scenario: tag liviano sin cambios
- **WHEN** contra un repositorio temporal real se instala `#v1` donde `v1` es un tag liviano, y corre `packageUpdatesPass`
- **THEN** lo visto registrado es igual al `commit` instalado y la lista no avisa actualización

#### Scenario: argumentos de ls-remote
- **WHEN** corre el pase para una fuente con referencia `v1` y para una fuente sin referencia
- **THEN** el ejecutor de git recibe `v1` y `v1^{}` como patrones después de la URL en el primer caso, y solo `HEAD` en el segundo

### Requirement: Documentación de fuentes git y actualización
README.md, README.es.md y AGENTS.md MUST documentar las fuentes git y `zero package update`, en los dos README con la misma estructura y los mismos bloques de código, con ejemplos genéricos que no nombren paquetes concretos reales.

#### Scenario: ambos idiomas
- **WHEN** corre `test/docs.test.ts`
- **THEN** los dos README contienen en sus bloques de código `zero package add github:` y `zero package update`, y las pruebas de estructura y bloques iguales pasan

#### Scenario: palabras
- **WHEN** corre `test/wording.test.ts`
- **THEN** pasa
