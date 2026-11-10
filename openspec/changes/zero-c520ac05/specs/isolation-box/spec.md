# Spec Delta

## ADDED Requirements

### Requirement: Git plantado en la carpeta de trabajo
En Windows, cuando zero ejecuta git con cwd en una copia de trabajo o en el repositorio de una línea, MUST ejecutar el git hallado en una entrada absoluta del PATH y nunca un `git.exe` o `git.com` de esa carpeta. Esto vale para `git`, `tryGit` y las llamadas de `integrate.ts`, `runner.ts`, `reverts.ts` y `comments.ts`.

#### Scenario: git.exe plantado en la raíz del repositorio
- **WHEN** un repositorio temporal tiene en su raíz una copia de un ejecutable llamada `git.exe` y se llama a `git(["rev-parse", "HEAD"], repo)` y a `tryGit` con ese repositorio
- **THEN** ambas devuelven el SHA real de HEAD, y el ejecutable plantado no corre

#### Scenario: PATH que incluye el directorio actual
- **WHEN** PATH es `.`, seguido de una entrada vacía y del PATH original, y el repositorio tiene un `git.exe` plantado
- **THEN** `resolveBin("git")` devuelve una ruta absoluta fuera del repositorio y `git(["rev-parse", "HEAD"], repo)` devuelve el SHA real

#### Scenario: Ninguna llamada con nombre pelado
- **WHEN** una prueba recorre los archivos de `src/` buscando `spawn("git"` y `spawnSync("git"`
- **THEN** no aparece ninguna fuera de `src/shell.ts`, y ahí la que hay lanza la ruta que da `resolveBin`

### Requirement: Motores de línea de comandos plantados en la copia de trabajo
En Windows, `runProcess` en `src/engines/cli.ts` MUST lanzar un binario de nombre pelado por la ruta absoluta hallada en el PATH, conservando el cwd pedido, y nunca un binario de ese nombre que esté en el cwd.

#### Scenario: Mismo nombre en el cwd y en el PATH
- **WHEN** hay una copia de node llamada `herramienta.exe` en el cwd y otra en una carpeta absoluta del PATH, y `runProcess` lanza `herramienta` con `-p process.execPath`
- **THEN** la salida es la ruta de la copia que está en el PATH

#### Scenario: El motor sigue trabajando en la copia de trabajo
- **WHEN** `runProcess` lanza un binario hallado en el PATH con un cwd dado y el proceso imprime `process.cwd()`
- **THEN** la salida es ese cwd

### Requirement: Búsqueda de binarios sin el directorio actual
`resolveBin(name)` en `src/shell.ts` SHALL, en Windows, recorrer PATH sin procesos auxiliares (sin `where`), ignorar las entradas relativas o vacías, probar el nombre con `.com` y `.exe` (y también el nombre exacto cuando ya trae extensión) y devolver la ruta absoluta, guardada en caché por nombre y valor de PATH. En otras plataformas MUST devolver el nombre sin cambios.

#### Scenario: Entradas relativas ignoradas
- **WHEN** PATH solo tiene `.`, una entrada vacía y una carpeta relativa, todas con el binario
- **THEN** `resolveBin` devuelve el nombre sin cambios

#### Scenario: Nombre con extensión
- **WHEN** una carpeta absoluta del PATH tiene `herramienta.exe` y se pide `herramienta.exe`
- **THEN** `resolveBin` devuelve la ruta absoluta de ese archivo

#### Scenario: La caché respeta los cambios de PATH
- **WHEN** se resuelve un nombre, cambia PATH a otra carpeta absoluta con ese binario y se resuelve de nuevo
- **THEN** la segunda respuesta es la ruta de la carpeta nueva

#### Scenario: Lo no encontrado no queda en caché
- **WHEN** un nombre no se encuentra, aparece después en una carpeta absoluta del mismo PATH y se resuelve de nuevo
- **THEN** la segunda respuesta es la ruta absoluta

#### Scenario: Otra plataforma
- **WHEN** se llama a `resolveBin("git", "linux")`
- **THEN** devuelve `git`

#### Scenario: Sin procesos auxiliares
- **WHEN** se llama a `resolveBin` con `spawn` y `spawnSync` observados
- **THEN** ninguno de los dos fue llamado

### Requirement: Binario ausente sin ejecutar lo plantado
En Windows, cuando `resolveBin` no encuentra el binario en el PATH, zero MUST lanzar el nombre con un cwd fuera del contenido no confiable, de modo que el binario plantado no corra y la falla sea la de hoy.

#### Scenario: git ausente del PATH con git.exe plantado
- **WHEN** PATH no tiene ninguna carpeta con git, el repositorio tiene un `git.exe` plantado y se llama a `git` y a `tryGit`
- **THEN** `git` lanza un error, `tryGit` devuelve undefined y el ejecutable plantado no corre

#### Scenario: Motor ausente del PATH con binario plantado
- **WHEN** PATH no tiene `herramienta`, el cwd tiene una copia de node llamada `herramienta.exe` y `runProcess` la lanza
- **THEN** la promesa se rechaza con `cannot start "herramienta"` y `Is it installed and on PATH?`, y la copia plantada no corre
