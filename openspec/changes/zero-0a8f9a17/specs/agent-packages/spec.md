# Spec Delta

## Purpose

Vas a poder extender zero con agentes propios o de terceros instalando un paquete: una carpeta local o un paquete npm con un manifiesto `zero-package.yaml`. Lo declarás en `packages` del archivo de la fábrica, o lo instalás con `zero package add`, y zero carga de ahí agentes con sus instrucciones, skills y, solo si lo autorizás con `allowCode: true`, estaciones con código propio. Cada estación tiene su pasada en el daemon mientras la fábrica está libre, su configuración y sus secretos. Un paquete roto no frena la fábrica: queda fuera y lo ves en `zero status` y en `zero package list`. El formato, la versión de la interfaz y un ejemplo mínimo que los tests cargan de verdad quedan documentados en README.md y README.es.md. Un paquete con código corre con los permisos de tu usuario, así que instalá solo lo que confiás.

## ADDED Requirements

### Requirement: Declarar paquetes en el archivo de la fábrica
`zero.factory.yaml` SHALL aceptar una lista `packages` cuyas entradas tienen exactamente uno de `path` (carpeta local; relativa a la carpeta del archivo de la fábrica o absoluta) o `npm` (nombre de paquete instalado en `<ZERO_HOME>/packages/node_modules`), y opcionalmente `allowCode` (por defecto false), `config`, `engine` y `model`.

#### Scenario: Entrada local y entrada npm
- **WHEN** el archivo declara una entrada con `path` y otra con `npm` y se analiza con parseFactory
- **THEN** la configuración resultante tiene las dos entradas, con `allowCode` en false

#### Scenario: Las dos fuentes a la vez
- **WHEN** una entrada tiene `path` y `npm`, o no tiene ninguno
- **THEN** parseFactory lanza ConfigError nombrando `packages`

#### Scenario: Motor desconocido
- **WHEN** una entrada tiene `engine` con un motor que no existe
- **THEN** parseFactory lanza ConfigError que nombra ese motor

#### Scenario: Credencial en la configuración
- **WHEN** el `config` de una entrada contiene un valor con forma de credencial
- **THEN** parseFactory lanza ConfigError, como con cualquier otra parte del archivo

### Requirement: Manifiesto del paquete y versión de la interfaz
Cada paquete MUST tener en su raíz un `zero-package.yaml` con `interface`, `name` (minúsculas, dígitos y guiones), `version` y, opcionalmente, `agents`, `skills` y `stations`; zero SHALL aceptar solo `interface: 1` y SHALL rechazar claves desconocidas y toda ruta del manifiesto absoluta, con `..` o cuya ruta real salga de la carpeta del paquete.

#### Scenario: Manifiesto válido
- **WHEN** se cargan los paquetes y la carpeta tiene un manifiesto válido con `interface: 1`
- **THEN** el paquete aparece entre los cargados con su nombre y versión

#### Scenario: Otra versión de la interfaz
- **WHEN** el manifiesto dice `interface: 2`
- **THEN** el paquete queda rechazado con un problema que nombra la versión pedida y la soportada

#### Scenario: Ruta que sale del paquete
- **WHEN** una instrucción, skill o módulo del manifiesto usa `../afuera.md`
- **THEN** el paquete queda rechazado con un problema que nombra esa ruta

#### Scenario: El manifiesto no elige motor
- **WHEN** un agente o estación del manifiesto trae `engine` o `model`
- **THEN** el paquete queda rechazado por clave desconocida

### Requirement: Un paquete roto no frena la fábrica y se ve
Un paquete que no se puede cargar MUST quedar afuera entero sin impedir que la fábrica cargue ni que los demás paquetes funcionen, y su problema SHALL aparecer en `zero status`, en `zero package list` y una sola vez en el registro por cada mensaje distinto.

#### Scenario: Carpeta que no existe
- **WHEN** una entrada apunta a una carpeta inexistente y otra a un paquete válido
- **THEN** el cargador devuelve el paquete válido y un problema para el otro, sin lanzar

#### Scenario: Visible en el estado
- **WHEN** se pide el estado de la fábrica con un paquete rechazado
- **THEN** el resultado incluye el problema con el nombre o la ruta del paquete

#### Scenario: Registro sin repetición
- **WHEN** el cargador corre dos veces con el mismo paquete rechazado
- **THEN** el mensaje se registra una sola vez

### Requirement: Agentes de un paquete
Los agentes de un paquete cargado SHALL trabajar como agentes a medida globales de tipo `review` o `build`, después de los globales del archivo y con las mismas garantías, con sus instrucciones leídas de la carpeta del paquete y con el `engine` y el `model` de la entrada; MUST NOT escribirse en el archivo de la fábrica.

#### Scenario: Revisor en un trabajo
- **WHEN** un trabajo corre en una línea con un paquete que trae un agente `review`, con agentes falsos
- **THEN** ese agente se llama después de security y recibe como instrucciones el contenido del archivo del paquete

#### Scenario: Agente que escribe
- **WHEN** un trabajo corre con un paquete que trae un agente `type: build`
- **THEN** el agente corre entre build y verify y zero commitea lo que escribió con su nombre

#### Scenario: Listado
- **WHEN** se llama a `agentList` con un paquete cargado
- **THEN** el agente aparece con origen `package` y la ruta dentro del paquete

#### Scenario: Nombre repetido
- **WHEN** un agente del paquete usa el nombre de una estación fija, de un agente del archivo o de otro paquete
- **THEN** el paquete queda rechazado con un problema que nombra el agente

#### Scenario: El archivo no cambia
- **WHEN** se edita el archivo de la fábrica con editFactory teniendo un paquete cargado
- **THEN** el texto guardado no contiene los agentes del paquete

### Requirement: Skills de un paquete
Cada carpeta de `skills` del manifiesto MUST contener `SKILL.md` y SHALL quedar disponible como `<paquete>:<skill>`, asignable con `stations.<agente>.skills` y por los agentes y estaciones del paquete con su nombre corto, pasando por la misma copia por corrida que quita `allowed-tools`.

#### Scenario: Skill propia de un agente del paquete
- **WHEN** un agente del paquete lista una skill del mismo paquete por su nombre corto y se ejecuta con createAgentRunner y un motor falso
- **THEN** el motor recibe esa skill preparada y su `SKILL.md` no contiene `allowed-tools`

#### Scenario: Asignada a una estación fija
- **WHEN** `stations.build.skills` incluye `<paquete>:<skill>`
- **THEN** `skillProblems` no informa problema y el agente de build la recibe

#### Scenario: Skill sin archivo
- **WHEN** una carpeta de `skills` no tiene `SKILL.md`
- **THEN** el paquete queda rechazado con un problema que nombra esa carpeta

### Requirement: El código corre solo con permiso explícito
zero MUST NOT importar ningún módulo de un paquete salvo que su entrada diga `allowCode: true` y su carpeta real esté fuera de los repositorios de las líneas y de `worktrees` y `jobs` de ZERO_HOME; en los demás casos los agentes y skills del paquete SHALL seguir cargando, sus estaciones SHALL quedar afuera y el motivo SHALL verse como problema.

#### Scenario: Sin permiso
- **WHEN** una pasada del daemon corre con un paquete cuya estación escribe un archivo marcador al importarse y su entrada no tiene `allowCode`
- **THEN** el marcador no existe, los agentes del paquete siguen cargados y hay un problema que nombra `allowCode`

#### Scenario: Dentro del repositorio de una línea
- **WHEN** la entrada tiene `allowCode: true` y `path` dentro del `repo` de una línea
- **THEN** el módulo no se importa y hay un problema que explica el motivo

### Requirement: Pasada de una estación en el daemon
El daemon SHALL correr las estaciones de los paquetes, una por vez, al final de la corrida de tiempo libre, cada una como máximo una vez cada `everyMinutes` (por defecto 1440) y solo sin trabajos en cola o en marcha, sin andon y sin presupuesto agotado; una pasada que falla o supera su `timeoutMinutes` (por defecto 10) MUST quedar registrada sin afectar al daemon ni a las demás pasadas.

#### Scenario: Corre una vez por período
- **WHEN** la pasada de paquetes corre dos veces con el mismo reloj y otra vez pasados `everyMinutes`
- **THEN** la función `pass` del módulo se llama dos veces en total

#### Scenario: Daemon de una sola corrida
- **WHEN** `runDaemon` corre con `once: true` y `packages: true` y una estación válida sin trabajos pendientes
- **THEN** se llama su `pass` y la clave de última corrida queda guardada

#### Scenario: Fábrica ocupada o detenida
- **WHEN** hay un trabajo en cola, o el andon está encendido, o el presupuesto está agotado
- **THEN** `pass` no se llama

#### Scenario: La pasada falla
- **WHEN** `pass` de la primera estación lanza un error
- **THEN** el error queda en el registro sin valores de sus secretos declarados y la segunda estación corre igual

#### Scenario: La pasada se cuelga
- **WHEN** `pass` nunca termina y vence su `timeoutMinutes`
- **THEN** `ctx.signal` queda abortada y la pasada de paquetes sigue con la estación siguiente

#### Scenario: Módulo sin pass
- **WHEN** el módulo no exporta una función `pass`
- **THEN** no se ejecuta nada de esa estación y queda registrado el motivo

### Requirement: Configuración de una estación
Cada `pass` SHALL recibir en `ctx.config` el `config` de la entrada del paquete; cuando el módulo exporta `parseConfig`, zero MUST pasar el valor por esa función antes de la pasada y SHALL omitir la pasada si lanza.

#### Scenario: Configuración válida
- **WHEN** la entrada tiene `config: {saludo: hola}` y el módulo exporta `parseConfig`
- **THEN** `pass` recibe el valor que devolvió `parseConfig`

#### Scenario: Configuración inválida
- **WHEN** `parseConfig` lanza
- **THEN** `pass` no se llama, no se guarda la última corrida y el motivo queda en el registro

### Requirement: Secretos de una estación
Una estación MUST declarar en `secrets` los nombres que usa, con el formato de nombres de `SecretStore`; `ctx.secrets.get` SHALL devolver solo los declarados, y sin alguno de ellos la pasada SHALL omitirse e informarse en `zero package list`.

#### Scenario: Secreto declarado
- **WHEN** la estación declara `HELLO_TOKEN`, guardado en SecretStore
- **THEN** `ctx.secrets.get("HELLO_TOKEN")` devuelve su valor

#### Scenario: Secreto no declarado
- **WHEN** la estación pide con `ctx.secrets.get` un nombre existente que no declaró
- **THEN** recibe undefined

#### Scenario: Secreto faltante
- **WHEN** falta un secreto declarado
- **THEN** `pass` no se llama y `zero package list` muestra el nombre del secreto, nunca un valor

### Requirement: Agentes y presupuesto de una estación
`ctx.runAgent` SHALL llamar a un agente de solo lectura con las instrucciones y skills del manifiesto, en una carpeta vacía de la estación, registrado como `package:<paquete>/<estación>`, eligiendo motor de la cadena de la entrada, y su gasto MUST contar en `limits.usdPerNight` junto con las estaciones de tiempo libre; sin motor o sin tope restante MUST devolver `ok: false` sin llamar al motor.

#### Scenario: Solo lectura
- **WHEN** `pass` llama a `ctx.runAgent` con un agente falso
- **THEN** la petición lleva `custom.access: read`, el nombre `package:<paquete>/<estación>` y como `cwd` una carpeta vacía de la estación

#### Scenario: Gasto compartido
- **WHEN** se registró un span de agente `package:hello/nota` con costo 0.4
- **THEN** `scoutSpent` del período suma ese 0.4

#### Scenario: Tope agotado
- **WHEN** el motor se cobra por uso y `limits.usdPerNight` ya se gastó
- **THEN** `ctx.runAgent` devuelve `ok: false` y no se registra ninguna llamada al agente

#### Scenario: Salida validada
- **WHEN** `pass` llama a `ctx.runAgent` con un `schema` creado con `ctx.z` y el agente devuelve algo que no cumple
- **THEN** el resultado tiene `ok: false`

### Requirement: Lo que una estación recibe de la fábrica
El `ctx` de una estación SHALL ofrecer `package`, `station`, `now`, `signal`, `config`, `secrets`, `runAgent`, `z`, `log`, `lines` (solo nombres), `state.get`/`state.set` guardados en claves propias de esa estación, y `deliveredJobs(since)` con línea, título, resumen y fecha de trabajos entregados, sin identificadores de trabajo, ramas ni rutas locales.

#### Scenario: Estado separado
- **WHEN** dos estaciones guardan el mismo nombre con `ctx.state.set`
- **THEN** cada una lee de vuelta su propio valor

#### Scenario: Trabajos entregados
- **WHEN** un trabajo entregado tiene en su título su identificador y una ruta bajo /home
- **THEN** `deliveredJobs` lo devuelve sin el identificador ni la ruta

### Requirement: Instalar y ver paquetes
La CLI SHALL ofrecer `zero package list`, `zero package add <carpeta|paquete-npm> [--permitir-codigo]` y `zero package remove <nombre>`, respaldados por operaciones en `app.ts`: `add` MUST validar el manifiesto antes de tocar el archivo de la fábrica y, para npm, instalar en `<ZERO_HOME>/packages` con `--ignore-scripts` y un nombre validado; `remove` SHALL quitar la entrada y dejar los archivos.

#### Scenario: Agregar una carpeta
- **WHEN** `packageAdd` recibe una carpeta con manifiesto válido
- **THEN** el archivo de la fábrica gana la entrada con `path`, conservando sus comentarios, y sin `allowCode`

#### Scenario: Agregar con código
- **WHEN** `packageAdd` recibe `--permitir-codigo` para un paquete con estaciones
- **THEN** la entrada tiene `allowCode: true`

#### Scenario: Avisar del código
- **WHEN** `packageAdd` recibe un paquete con estaciones sin ese permiso
- **THEN** el mensaje avisa que sus estaciones no corren hasta dar el permiso

#### Scenario: Manifiesto inválido
- **WHEN** `packageAdd` recibe una carpeta sin manifiesto válido
- **THEN** lanza un error y el archivo de la fábrica queda igual

#### Scenario: Instalar de npm
- **WHEN** `packageAdd` recibe un nombre npm con un instalador falso inyectado
- **THEN** el instalador recibe `<ZERO_HOME>/packages` y el nombre, y `--ignore-scripts` está en los argumentos reales que arma zero

#### Scenario: Nombre peligroso
- **WHEN** `packageAdd` recibe `--foo` o un nombre con espacios o `;` como paquete npm
- **THEN** lanza un error sin llamar al instalador

#### Scenario: Quitar
- **WHEN** `packageRemove` recibe el nombre de un paquete declarado
- **THEN** la entrada sale del archivo y su carpeta sigue existiendo

### Requirement: Documentación del formato
README.md y README.es.md MUST explicar en una sección con la misma estructura el formato del paquete, la versión de la interfaz, el `ctx` de una estación, cómo instalar uno, que el código corre con los permisos del usuario, y un ejemplo mínimo que funcione; ese texto SHALL presentar los paquetes solo como una forma de extender zero con agentes de terceros o propios.

#### Scenario: Mismos bloques en los dos idiomas
- **WHEN** corre `test/docs.test.ts`
- **THEN** las dos secciones contienen `zero-package.yaml`, `interface: 1`, `allowCode`, `zero package add` y `export async function pass`, y pasan las comprobaciones de estructura existentes

#### Scenario: El ejemplo funciona
- **WHEN** un test escribe en una carpeta temporal el manifiesto y el módulo tomados de los bloques de código del README y los carga con `allowCode: true`
- **THEN** el paquete carga sin problemas y su `pass` corre con un agente falso

#### Scenario: Solo extensión
- **WHEN** un test lee esas secciones en los dos idiomas
- **THEN** no aparecen las palabras `community`, `enterprise`, `premium`, `commercial`, `comercial`, `edition` ni `edición`
