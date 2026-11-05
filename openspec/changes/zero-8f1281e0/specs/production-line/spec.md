# Spec Delta

## ADDED Requirements

### Requirement: Opción codex.sandbox en el archivo de la fábrica
El archivo de la fábrica SHALL aceptar `codex: { sandbox: on | off }`, con `on` por defecto, y SHALL rechazar cualquier otro valor o clave dentro de `codex`.

#### Scenario: Sin la opción
- **WHEN** se parsea un archivo de fábrica sin la clave `codex`
- **THEN** `config.codex.sandbox` vale `on`

#### Scenario: Apagado
- **WHEN** se parsea un archivo con `codex: { sandbox: off }`
- **THEN** `config.codex.sandbox` vale `off`

#### Scenario: Valor inválido
- **WHEN** se parsea un archivo con `codex: { sandbox: false }` o con otra clave dentro de `codex`
- **THEN** el parseo falla

### Requirement: El chat no cambia codex.sandbox
El servidor MCP MUST NOT ofrecer ninguna herramienta que lea parámetros para cambiar `codex.sandbox`; esa decisión SHALL tomarse solo en el archivo de la fábrica o desde la terminal.

#### Scenario: Herramientas del chat
- **WHEN** se listan las herramientas registradas por el servidor MCP y sus esquemas de entrada
- **THEN** ninguna tiene un nombre o un parámetro que mencione `sandbox`

### Requirement: Invocación de codex con el sandbox encendido
Con `codex.sandbox` en `on`, zero SHALL lanzar codex con `--sandbox read-only` en accesos `read` y `web`, y con `--sandbox workspace-write` en acceso `write`, igual que hoy.

#### Scenario: Argumentos por defecto
- **WHEN** se arma la invocación de codex con la opción en `on` para cada acceso
- **THEN** los argumentos llevan `read-only` en `read` y `web`, `workspace-write` en `write`, y no llevan `danger-full-access` ni `approval_policy`

### Requirement: Invocación de codex con el sandbox apagado
Con `codex.sandbox` en `off` y codex corriendo fuera de la caja, zero SHALL lanzar codex con `--sandbox danger-full-access` y `-c approval_policy="never"` en todo acceso, y MUST NOT pasarle `read-only` ni `workspace-write`.

#### Scenario: Lectura y escritura
- **WHEN** `resolveEngine("codex", config)` con la opción en `off` ejecuta una llamada `read`, una `web` y una `write` contra un codex falso que registra sus argumentos
- **THEN** las tres llamadas llevan `--sandbox danger-full-access` y `-c approval_policy="never"`, y ninguna lleva `read-only` ni `workspace-write`

#### Scenario: Motor propio llamado codex
- **WHEN** `engines` declara un motor propio llamado `codex` y la opción está en `off`
- **THEN** `resolveEngine` devuelve el motor propio, sin cambios en su invocación y sin la comprobación de solo lectura

### Requirement: Comprobación de solo lectura fuera de la caja
En cada llamada de acceso `read` o `web` que codex haga con el sandbox apagado y fuera de la caja, zero SHALL comparar la carpeta de trabajo y su repositorio antes y después de la llamada: archivos versionados, archivos sin seguimiento no ignorados, índice, HEAD, referencias, y `config` y `hooks` del repositorio. Esto SHALL valer para spec, scout, review, security, research, reply, agentes propios de tipo review y estaciones de paquetes.

#### Scenario: Llamada que no toca nada
- **WHEN** un codex falso con la opción en `off` responde sin escribir nada en un repositorio git
- **THEN** la llamada termina `ok` con su respuesta y `git status --porcelain` no cambió

#### Scenario: Archivo nuevo sin seguimiento
- **WHEN** el codex falso crea un archivo sin seguimiento
- **THEN** el archivo ya no existe y la llamada queda como fallida

#### Scenario: Archivo versionado modificado
- **WHEN** el codex falso modifica o borra un archivo versionado
- **THEN** el archivo vuelve a su contenido anterior y la llamada queda como fallida

#### Scenario: Commit durante la llamada
- **WHEN** el codex falso hace un commit, o agrega algo al índice
- **THEN** HEAD, la rama y el índice vuelven a su estado anterior y la llamada queda como fallida

#### Scenario: Hook plantado
- **WHEN** el codex falso agrega un archivo en `.git/hooks` o cambia `.git/config`
- **THEN** el hook desaparece, el config vuelve a su contenido anterior y la llamada queda como fallida

#### Scenario: Estación de escritura
- **WHEN** una llamada de acceso `write` con la opción en `off` cambia archivos
- **THEN** los cambios quedan y la llamada no falla por la comprobación

#### Scenario: Otro motor
- **WHEN** un motor que no es codex hace una llamada de lectura con la opción en `off`
- **THEN** no se toma ninguna foto de la carpeta y el resultado del motor no cambia

### Requirement: Los cambios previos de la persona a cargo se conservan
Al descartar lo que escribió la llamada, zero MUST restaurar la foto previa a la llamada y MUST NOT usar `reset --hard` ni `clean` sobre la carpeta, de modo que los cambios sin guardar y los archivos sin seguimiento que ya existían queden intactos.

#### Scenario: Repositorio con trabajo sin guardar
- **WHEN** la carpeta tiene un archivo versionado modificado, un archivo preparado en el índice y un archivo sin seguimiento antes de la llamada, y el codex falso crea otro archivo
- **THEN** después de la llamada solo desapareció el archivo nuevo; lo demás conserva su contenido y su estado en `git status`, y la llamada queda como fallida

#### Scenario: Trabajo previo que la llamada pisa
- **WHEN** el codex falso sobrescribe un archivo que ya tenía cambios sin guardar
- **THEN** el archivo vuelve al contenido que tenía antes de la llamada, no al de HEAD

### Requirement: La comprobación no reescribe referencias ajenas
La comprobación MUST NOT volver atrás referencias que no se le pueden atribuir a la llamada: en una copia de trabajo enlazada, todas menos la rama de esa copia y la que la llamada dejó abierta; en cualquier carpeta, `refs/heads/zero/*` ajenas, ramas abiertas en otro worktree y etiquetas nuevas. Esos cambios SHALL quedar en el log sin hacer fallar la llamada. El daemon MUST NOT arrancar un trabajo en un repositorio con una llamada comprobada en curso, y una llamada comprobada de una pasada de fondo SHALL esperar a los trabajos que corren en su carpeta.

#### Scenario: Copia de trabajo mientras la persona a cargo trabaja
- **WHEN** durante una llamada en una copia enlazada se agrega un worktree y se hace un commit en la copia principal
- **THEN** la rama principal, el índice principal y la rama nueva no cambian y la llamada termina `ok`

#### Scenario: Etiqueta traída por un fetch
- **WHEN** aparece una etiqueta nueva durante la llamada
- **THEN** la etiqueta queda y la llamada no falla; una etiqueta movida o borrada vuelve atrás y la llamada falla

#### Scenario: Trabajo en cola
- **WHEN** hay una llamada comprobada en curso en el repositorio de la línea y un trabajo de esa línea en cola
- **THEN** el trabajo sigue en cola hasta que la llamada termina

### Requirement: Archivos versionados bajo una regla de ignorar
La comprobación SHALL comparar y restaurar los archivos versionados aunque coincidan con una regla de ignorar.

#### Scenario: Archivo forzado
- **WHEN** el codex falso sobrescribe o borra un `keep.log` versionado con `git add -f` bajo una regla `*.log`
- **THEN** el archivo vuelve a su contenido y la llamada queda como fallida

### Requirement: Aviso de llamada fallida por escribir
Cuando la comprobación encuentra cambios, el resultado de la llamada MUST quedar con `ok: false`, sin salida estructurada y conservando `quota` y costo, y su texto SHALL decir en español que codex cambió la carpeta en una estación de solo lectura, que zero descartó los cambios, y SHALL nombrar los archivos cambiados.

#### Scenario: Texto del aviso
- **WHEN** el codex falso crea `intruso.txt` y devuelve una respuesta válida para el esquema
- **THEN** `AgentRun.ok` es false, `output` no está definido, `text` contiene `intruso.txt` y `descart`, y el costo y la `quota` informados por el motor se conservan

#### Scenario: Llamada que además falló
- **WHEN** el codex falso escribe un archivo y termina con error o por tiempo agotado
- **THEN** el archivo se descarta y `text` incluye el aviso de la comprobación

### Requirement: Carpetas que no son un repositorio
La comprobación de solo lectura SHALL funcionar igual en una carpeta de trabajo que no es la raíz de un repositorio git, como las de reply y las estaciones de paquetes, MUST NOT crear nada dentro de esa carpeta, y MUST NOT tratar como propio un repositorio que la contenga.

#### Scenario: Carpeta sin git
- **WHEN** el codex falso crea y modifica archivos en una carpeta sin `.git`
- **THEN** la carpeta queda como antes de la llamada, sin un `.git` nuevo, y la llamada queda como fallida

#### Scenario: Carpeta dentro de otro repositorio
- **WHEN** la carpeta de trabajo es un subdirectorio de un repositorio git y el codex falso escribe en ella
- **THEN** lo escrito se descarta y `git status` del repositorio contenedor, su índice y sus referencias no cambian por la comprobación

### Requirement: Si no se puede comprobar, no se llama
Si zero no puede tomar la foto previa, MUST NOT lanzar codex y SHALL devolver una llamada fallida; si no puede restaurar la carpeta después, SHALL devolver una llamada fallida cuyo texto diga que la carpeta pudo quedar modificada.

#### Scenario: Foto imposible
- **WHEN** la foto previa falla, por ejemplo porque la carpeta de trabajo no existe
- **THEN** el codex falso no se ejecuta y `ok` es false

#### Scenario: Restauración imposible
- **WHEN** el codex falso cambia un archivo y la restauración falla, simulada mediante un error inyectado en el paso de restaurar
- **THEN** `ok` es false y `text` dice que la carpeta pudo quedar modificada

### Requirement: Codex dentro de la caja cuando está lista
Con `isolation: container` y la caja lista, zero SHALL correr codex dentro de la caja también en las pasadas del daemon que hoy corren en la máquina (scout, research, reply y estaciones de paquetes), MUST seguir corriendo los demás motores de esas pasadas donde corren hoy, y dentro de la caja codex SHALL recibir las mismas banderas que recibe con la opción en `on`.

#### Scenario: Pasada de fondo con caja lista
- **WHEN** el daemon corre una pasada de scout con la opción en `off`, `isolation: container`, la caja lista y un ejecutor de caja falso inyectado por `boxExecutor`
- **THEN** la llamada de codex pasa por el ejecutor de la caja y no se ejecuta ningún proceso local de codex

#### Scenario: Otro motor en la misma pasada
- **WHEN** en esa misma configuración una estación de fondo usa un motor que no es codex
- **THEN** esa llamada corre en la máquina, como hoy

#### Scenario: Sin la opción
- **WHEN** la opción está en `on` y la caja está lista
- **THEN** las pasadas de fondo de codex corren en la máquina, como hoy

#### Scenario: Pedido a la caja
- **WHEN** el ejecutor de la caja arma el pedido para el agente interno con la opción en `off`
- **THEN** `BoxAgentRequest` no menciona `codex.sandbox`, y el motor resuelto dentro de la caja usa `read-only` o `workspace-write` según el acceso

#### Scenario: Sin comprobación en la caja
- **WHEN** una estación de lectura corre codex por el ejecutor de la caja con la opción en `off`
- **THEN** zero no toma ninguna foto de la carpeta, porque la caja monta la copia en solo lectura

#### Scenario: Caja no lista o isolation worktree
- **WHEN** la opción está en `off` y la caja no está lista, o `isolation` es `worktree`
- **THEN** codex corre en la máquina con `danger-full-access` y con la comprobación de solo lectura

### Requirement: zero status avisa
Con `codex.sandbox` en `off` y sin un motor propio llamado `codex`, `zero status` SHALL mostrar una línea que empiece con `AVISO:` y diga que Codex corre sin su sandbox y que zero solo comprueba la carpeta de trabajo y su repositorio; con la caja lista y `isolation: container` SHALL decir en cambio que Codex corre dentro de la caja.

#### Scenario: Sin caja
- **WHEN** `formatStatus` recibe el estado de una fábrica con la opción en `off` y la caja no lista
- **THEN** la salida tiene una línea `AVISO:` que contiene `sin su sandbox` y `codex.sandbox: off`

#### Scenario: Con caja lista
- **WHEN** `formatStatus` recibe el estado con la opción en `off`, `isolation: container` y la caja lista
- **THEN** la salida no contiene `sin su sandbox` y dice que Codex corre dentro de la caja

#### Scenario: Por defecto
- **WHEN** la opción está en `on`, o `engines` declara un motor propio llamado `codex`
- **THEN** la salida no menciona `codex.sandbox`

### Requirement: Documentación en los dos README
`README.md` y `README.es.md` SHALL documentar `codex.sandbox`, con la misma estructura y el mismo bloque de código: cuándo usarla, qué comprueba zero, que corre dentro de la caja cuando está lista, y qué no cubre (archivos ignorados por git, resto de la máquina y salida a internet fuera de la caja).

#### Scenario: Los dos idiomas
- **WHEN** corre `test/docs.test.ts` con un chequeo agregado para `codex: { sandbox: off }`
- **THEN** la opción aparece en ambos README y las pruebas de estructura y de palabras (`test/docs.test.ts`, `test/wording.test.ts`) pasan
