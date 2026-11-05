# Spec Delta

## Purpose

Vas a poder instalar la fábrica con `docker compose` y configurarla con `docker compose run --rm zero setup`. El asistente te pregunta con qué vas a trabajar: la suscripción de Claude Code o Codex, API keys, o las dos cosas con un motor de reemplazo. También te pregunta los límites de gasto, si usás la caja de aislamiento, el puerto del panel y el acceso a GitHub. Podés volver a correrlo cuando quieras para cambiar algo. Los datos y los repositorios quedan en volúmenes, así que no se pierden al actualizar el contenedor. Las claves se piden sin mostrarse y se guardan cifradas en el volumen; la llave que las cifra es un Docker secret, fuera del volumen. Por defecto el contenedor no tiene acceso a Docker. Para usar la caja activás un archivo de compose aparte, que conecta el socket de Docker de la máquina, y el asistente te avisa que eso da control sobre esa máquina. Trabajar sin caja también es posible, pero tenés que confirmarlo después de una advertencia clara. Si no elegiste ninguna de las dos, los trabajos esperan en la cola en vez de correr sin protección. El panel se publica en un puerto configurable y, por defecto, solo se abre desde tu propia máquina. Nada se instala sin tu consentimiento: los CLI se eligen al construir la imagen. En esta primera parte entran Claude Code y Codex; Gemini queda para la siguiente, porque zero todavía no lo tiene como motor propio.

## ADDED Requirements

### Requirement: Imagen de la fábrica con CLI elegidos
El repositorio SHALL incluir `docker/Dockerfile`, que construye zero sobre Node 22 con git, gh y el cliente de Docker, conserva en `/opt/zero` los archivos con los que se construye la imagen de la caja (`package.json`, `package-lock.json`, `dist`, `agents`, `box/Dockerfile`), corre como usuario sin privilegios e instala solo los CLI de IA indicados en el argumento de construcción `ZERO_CLIS`.

#### Scenario: Contenido del Dockerfile
- **WHEN** una prueba lee `docker/Dockerfile`
- **THEN** encuentra `FROM node:22`, `ARG ZERO_CLIS`, la instalación de git, gh y el cliente de Docker, la copia de `box/Dockerfile`, una instrucción `USER` que no es root, `ENV ZERO_CONTAINER=1` y un `ENTRYPOINT` que ejecuta `dist/cli.js` con `start` como comando por defecto

### Requirement: Datos y repositorios en volúmenes de compose
`compose.yaml` SHALL guardar ZERO_HOME, HOME y los repositorios de las líneas en volúmenes, de modo que recrear el contenedor no los pierda, y MUST NOT montar el socket de Docker ni declarar credenciales en `environment`.

#### Scenario: Compose base
- **WHEN** una prueba parsea `compose.yaml` como YAML
- **THEN** el servicio `zero` monta un volumen para los datos con ZERO_HOME y HOME dentro de él y otro en `/repos`, no monta `docker.sock`, y ninguna clave de `environment` termina en `_KEY` ni `_TOKEN`

### Requirement: Puerto del panel publicado en compose
`compose.yaml` SHALL publicar el panel en el puerto `ZERO_PANEL_PORT` (4848 por defecto), atado por defecto a la interfaz 127.0.0.1 de la máquina y cambiable con `ZERO_PANEL_BIND`.

#### Scenario: Publicación por defecto
- **WHEN** una prueba lee la entrada `ports` del servicio `zero`
- **THEN** es `${ZERO_PANEL_BIND:-127.0.0.1}:${ZERO_PANEL_PORT:-4848}:${ZERO_PANEL_PORT:-4848}`

### Requirement: Interfaz de escucha del panel
El panel SHALL escuchar en `panel.host` del archivo de la fábrica, cuyo valor por defecto MUST seguir siendo 127.0.0.1.

#### Scenario: Sin panel.host
- **WHEN** se carga un archivo de fábrica sin `panel.host`
- **THEN** `config.panel.host` es `127.0.0.1`

#### Scenario: Con panel.host
- **WHEN** el daemon arranca con `panel.host: 0.0.0.0` y un puerto libre
- **THEN** el servidor del panel queda escuchando en la dirección 0.0.0.0 y sigue pidiendo la clave

### Requirement: Almacén cifrado en el volumen
Con `ZERO_CONTAINER=1`, `SecretStore` SHALL guardar por defecto los secretos en `secrets.enc` dentro de ZERO_HOME, cifrados con AES-256-GCM y con permisos 600, usando una llave de 64 caracteres hexadecimales leída del archivo `ZERO_MASTER_KEY_FILE` (por defecto `/run/secrets/zero_master_key`).

#### Scenario: Guardar y leer
- **WHEN** se guarda un secreto con una llave válida y se abre otro `SecretStore` con la misma llave
- **THEN** `get` devuelve el valor, y los bytes de `secrets.enc` y de `secrets.json` no contienen ese valor

### Requirement: Sin llave no se escriben secretos
El almacén cifrado MUST NOT escribir un secreto cuando la llave falta, no tiene el formato esperado o no descifra el `secrets.enc` existente: SHALL fallar con un mensaje que explica cómo crear la llave y sin repetir el valor, dejando el archivo como estaba.

#### Scenario: Sin llave
- **WHEN** se llama a `set` sin archivo de llave
- **THEN** lanza un error que nombra `zero_master_key`, no aparece el valor en el mensaje y no se crea ningún archivo con el secreto

#### Scenario: Llave equivocada
- **WHEN** se llama a `set` con una llave distinta de la que cifró `secrets.enc`
- **THEN** lanza un error, `secrets.enc` queda idéntico y `get` devuelve undefined con esa llave

### Requirement: Docker secrets como origen de credenciales
Con `ZERO_CONTAINER=1`, `SecretStore.get` SHALL buscar una credencial primero en la variable de entorno, después en el archivo `<ZERO_SECRETS_DIR o /run/secrets>/<NOMBRE>` solo si el nombre cumple `SECRET_NAME`, y por último en el almacén cifrado; `list` SHALL incluir esos nombres sin mostrar valores.

#### Scenario: Archivo de Docker secret
- **WHEN** existe `<dir>/OPENAI_API_KEY` con un salto de línea final y no hay variable de entorno
- **THEN** `get` devuelve el valor sin el salto de línea y `list` incluye `OPENAI_API_KEY`

#### Scenario: Nombre con ruta
- **WHEN** se pide `get("../otro")`
- **THEN** devuelve undefined sin leer fuera del directorio de secretos

### Requirement: Llavero del sistema fuera de un contenedor
Sin `ZERO_CONTAINER=1`, `SecretStore` MUST seguir usando el llavero del sistema operativo y MUST NOT leer `/run/secrets` ni `secrets.enc`.

#### Scenario: Fuera del contenedor
- **WHEN** se resuelve el almacén por defecto sin `ZERO_CONTAINER` y con un directorio de secretos que tiene un archivo con ese nombre
- **THEN** el almacén elegido es el llavero del sistema y `get` no devuelve el valor de ese archivo

### Requirement: Comando setup repetible
`zero setup` SHALL crear la fábrica si no existe y, si existe, cambiar solo lo que el asistente administra (`engine`, `fallback`, los límites elegidos, `isolation`, `panel`), conservando las líneas y los comentarios del archivo y validándolo con `parseFactory` antes de escribirlo.

#### Scenario: Segunda corrida
- **WHEN** se corre el asistente sobre un archivo con una línea y un comentario eligiendo otro motor
- **THEN** `engine` y `fallback` cambian y la línea y el comentario siguen en el archivo

### Requirement: Setup sin terminal
`zero setup` sin terminal interactiva MUST terminar con código distinto de 0, sin cambiar nada, e indicar que hace falta `docker compose run` con terminal.

#### Scenario: Sin TTY
- **WHEN** se llama al asistente con entradas no interactivas
- **THEN** devuelve un error, el archivo de la fábrica no se crea ni cambia y no se guarda ningún secreto

### Requirement: Elección de motores y fallback
El asistente SHALL ofrecer los modos `suscripción`, `API key` y `ambas`, y escribir en `engine` el primer motor elegido y en `fallback` los demás, en orden; en `ambas` MUST pedir un motor por suscripción y otro distinto por API key como reemplazo.

#### Scenario: Ambas
- **WHEN** se elige `ambas` con Claude por suscripción y Codex por API key
- **THEN** el archivo queda con `engine: claude` y `fallback: [codex]`

#### Scenario: Mismo motor en ambas
- **WHEN** se elige Claude para los dos lados en `ambas`
- **THEN** el asistente explica que tienen que ser motores distintos, vuelve a preguntar y no escribe esa combinación

#### Scenario: Solo API key
- **WHEN** se elige `API key` solo con Codex
- **THEN** el archivo queda con `engine: codex` y `fallback: []`

### Requirement: Límites según la elección
El asistente SHALL pedir `limits.usdPerDay` y `limits.usdPerJob` cuando hay algún motor por API key y `limits.reservePercent` cuando hay alguno por suscripción, y MUST NOT tocar los límites del tipo que no se eligió.

#### Scenario: Solo suscripción
- **WHEN** se elige solo suscripción con reserva 20 sobre un archivo con `usdPerDay: 7`
- **THEN** `reservePercent` queda en 20 y `usdPerDay` sigue en 7

#### Scenario: Valor inválido
- **WHEN** se responde `abc` a `usdPerDay`
- **THEN** el asistente vuelve a preguntar y no escribe ese valor

### Requirement: API key sin exponer
El asistente SHALL pedir cada API key por la entrada sin mostrarla y guardarla en `SecretStore` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), y el valor MUST NOT aparecer en argumentos de procesos, en `zero.factory.yaml` ni en lo que el asistente muestra.

#### Scenario: Clave ingresada
- **WHEN** se ingresa una API key con preguntas y ejecutor de comandos falsos
- **THEN** el almacén tiene el valor, y ni los argumentos registrados, ni el archivo, ni los mensajes registrados lo contienen

### Requirement: Login de suscripción guiado
Para un motor por suscripción, el asistente SHALL lanzar con consentimiento y con la terminal heredada el login de su CLI: para Claude `claude setup-token` y pedir el token sin mostrarlo para guardarlo como `CLAUDE_CODE_OAUTH_TOKEN`; para Codex `codex login --device-auth`, cuya sesión queda en el HOME del volumen.

#### Scenario: Claude con consentimiento
- **WHEN** se acepta el login de Claude y se pega el token
- **THEN** el ejecutor recibió `claude` con `setup-token` y el almacén tiene `CLAUDE_CODE_OAUTH_TOKEN`

#### Scenario: Sin consentimiento
- **WHEN** se rechaza el login
- **THEN** no se lanza ningún comando y el asistente muestra el comando para hacerlo después

### Requirement: Credencial que no corresponde a la elección
Al elegir un método para un motor, el asistente SHALL borrar del almacén la credencial guardada del otro método de ese motor, y avisar cuando esa credencial venga de una variable de entorno o de un Docker secret, porque no puede borrarla y seguiría usándose.

#### Scenario: De API key a suscripción
- **WHEN** `ANTHROPIC_API_KEY` está guardada y se elige Claude por suscripción
- **THEN** `ANTHROPIC_API_KEY` deja de estar en el almacén

#### Scenario: Credencial en Docker secret
- **WHEN** `ANTHROPIC_API_KEY` viene de un Docker secret y se elige Claude por suscripción
- **THEN** el asistente muestra un aviso que nombra `ANTHROPIC_API_KEY` sin mostrar su valor

### Requirement: CLI ausente sin instalación
Cuando el CLI de un motor elegido no está en la imagen, el asistente MUST NOT instalar nada: SHALL rechazar esa elección e indicar que hay que reconstruir la imagen con `ZERO_CLIS`.

#### Scenario: Codex ausente
- **WHEN** se elige Codex y `codex` no está en PATH
- **THEN** el mensaje nombra `ZERO_CLIS`, no se ejecuta ningún comando de instalación y el asistente vuelve a preguntar

### Requirement: Elección explícita de aislamiento
En un contenedor, el asistente SHALL pedir una elección explícita de aislamiento: con un runtime que responde ofrece la caja avisando que el socket da control sobre la máquina anfitriona, y `isolation: worktree` MUST escribirse solo después de mostrar la advertencia y de una confirmación cuya respuesta por defecto es no.

#### Scenario: Sin confirmar
- **WHEN** no hay runtime y se rechaza la confirmación de trabajar sin caja
- **THEN** el archivo queda con `isolation: container`

#### Scenario: Con confirmación
- **WHEN** no hay runtime y se confirma trabajar sin caja
- **THEN** el archivo queda con `isolation: worktree`, y la advertencia mostrada dice que los agentes corren en el mismo contenedor que la llave y los secretos

#### Scenario: Con runtime
- **WHEN** el runtime responde y se elige la caja
- **THEN** el archivo queda con `isolation: container`, el mensaje avisa del control sobre la máquina anfitriona e indica correr `zero box setup`

### Requirement: Suscripción sin login dentro de la caja
El asistente MUST NOT dejar configurado un motor por suscripción sin credencial utilizable dentro de la caja: con `isolation: container`, Codex por suscripción SHALL rechazarse explicando que dentro de la caja necesita una API key o que hay que elegir trabajar sin caja.

#### Scenario: Codex por suscripción con caja
- **WHEN** se elige la caja y Codex por suscripción
- **THEN** el asistente lo explica y vuelve a preguntar, y esa combinación no queda escrita

### Requirement: Sin caja lista los trabajos esperan en un contenedor
Con `ZERO_CONTAINER=1`, `isolation: container` y la caja no lista, el daemon MUST NOT empezar trabajos ni los pasos en reposo, que SHALL esperar en la cola, y `zero status` SHALL decir por qué y qué correr, en vez de pasarlos a copias locales.

#### Scenario: Caja no lista
- **WHEN** corre una pasada del daemon con un trabajo en cola, `ZERO_CONTAINER=1` y la caja no lista
- **THEN** el trabajo sigue `queued` y no se llamó a ningún agente

#### Scenario: Mensaje de estado
- **WHEN** se formatea el estado en esa situación
- **THEN** el texto dice que los trabajos esperan la caja y nombra `zero setup` o `zero box setup`, y no dice que corren en copias locales

#### Scenario: Fuera de un contenedor
- **WHEN** corre la misma pasada sin `ZERO_CONTAINER`
- **THEN** el trabajo empieza como hoy, en una copia local

### Requirement: Caja por el socket del anfitrión como opción aparte
`docker/compose.box.yaml` SHALL ser el único archivo de compose que monta el socket de Docker, y SHALL montar el directorio de datos en la misma ruta dentro y fuera del contenedor, con ZERO_HOME y TMPDIR dentro de él, porque el demonio del anfitrión resuelve las rutas de `-v` en la máquina.

#### Scenario: Override de la caja
- **WHEN** una prueba parsea `docker/compose.box.yaml`
- **THEN** monta `/var/run/docker.sock`, el volumen de datos es `${ZERO_DATA}:${ZERO_DATA}` con `ZERO_DATA` obligatoria, y ZERO_HOME y TMPDIR empiezan con `${ZERO_DATA}`

### Requirement: Credenciales para motores fuera de la caja
Con `ZERO_CONTAINER=1`, un motor que corre fuera de la caja SHALL recibir las credenciales de `SecretStore` que le corresponden solo en el entorno de su propio proceso, y los comandos `setup` y `verify` MUST NOT recibirlas.

#### Scenario: Motor local
- **WHEN** `createAgentRunner` ejecuta un motor falso sin caja, con `OPENAI_API_KEY` en el almacén y `ZERO_CONTAINER=1`
- **THEN** la petición al motor lleva esa credencial en `env` y `process.env` no la tiene

#### Scenario: Fuera de un contenedor
- **WHEN** se ejecuta lo mismo sin `ZERO_CONTAINER`
- **THEN** la petición al motor no lleva credenciales en `env`

### Requirement: Acceso a GitHub configurado por el asistente
El asistente SHALL ofrecer tres opciones para GitHub: `gh auth login` con consentimiento y sesión en el volumen, un token pedido sin mostrarse y guardado como `GH_TOKEN` en `SecretStore`, o ninguno.

#### Scenario: Token
- **WHEN** se elige token y se ingresa un valor
- **THEN** `GH_TOKEN` queda en el almacén y el valor no aparece en mensajes, argumentos ni archivo

#### Scenario: Login
- **WHEN** se elige login y se acepta
- **THEN** el ejecutor recibe `gh` con `auth login`

#### Scenario: Ninguno
- **WHEN** se elige ninguno
- **THEN** no se lanza ningún comando y no se guarda `GH_TOKEN`

### Requirement: Token de GitHub del almacén en el contenedor
Con `ZERO_CONTAINER=1`, `githubToken` SHALL usar la variable de entorno, después `GH_TOKEN` de `SecretStore` y por último `gh auth token`, y `zero git-credential get` SHALL entregar ese token a git solo para `github.com`.

#### Scenario: Token en el almacén
- **WHEN** no hay variable de entorno y `GH_TOKEN` está en el almacén
- **THEN** `githubToken` devuelve ese valor sin lanzar `gh`

#### Scenario: Credencial para github.com
- **WHEN** git pide credenciales con `host=github.com`
- **THEN** el comando imprime `username=x-access-token` y `password=<token>`

#### Scenario: Otro host
- **WHEN** git pide credenciales con `host=ejemplo.com`
- **THEN** el comando no imprime nada y termina con código 0

### Requirement: Guía de instalación con Docker en los dos idiomas
`README.md` y `README.es.md` SHALL tener, después de la sección de primeros pasos, una sección con los mismos bloques de código que cubra crear `zero_master_key`, construir con `ZERO_CLIS`, `zero setup`, volúmenes, puerto del panel, y las opciones de caja con socket o sin caja con su advertencia.

#### Scenario: Sección en ambos
- **WHEN** `test/docs.test.ts` lee las secciones `## Install with Docker` y `## Instalar con Docker`
- **THEN** ambas tienen `docker compose run --rm zero setup`, `ZERO_CLIS`, `zero_master_key`, `compose.box.yaml` y `ZERO_PANEL_PORT` en sus bloques de código y mencionan el socket

### Requirement: Decisión de aislamiento registrada
`docs/adr/0003-fabrica-en-docker.md` SHALL registrar la decisión de aislamiento y de secretos dentro de Docker, incluyendo por qué se descarta Docker-in-Docker (exige `--privileged`), qué expone el socket y qué expone el modo sin caja.

#### Scenario: Contenido del ADR
- **WHEN** una prueba lee el archivo
- **THEN** contiene `socket`, `--privileged`, `worktree` y `zero_master_key`
