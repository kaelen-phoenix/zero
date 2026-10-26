# Design

## Context

Ver proposal.md. La línea de producción (`src/line/runner.ts`) ya separa estaciones, copia de trabajo y motor. Hoy todo corre en el equipo del dueño: copias con `git worktree`, comandos con `sh`, motores como procesos locales. Restricciones: debe funcionar en Windows Home (sin Hyper-V; contenedores solo vía WSL2), macOS y Linux; open source y gratuito; el dueño puede no saber programar.

## Goals / Non-Goals

**Goals:**
- Que todo lo que ejecuta código del proyecto o de un agente (setup, agentes, verificación) corra en un contenedor con una copia propia del repositorio.
- Mismo motor y mismo comportamiento dentro y fuera de la caja: la caja ejecuta el código de motores de zero, no una reimplementación.
- Verificación real de la caja en CI, sin depender del equipo del desarrollador.

**Non-Goals:**
- Filtrar la salida a internet (la caja necesita red para el modelo y los paquetes). Queda para una change posterior con un proxy de salida.
- Cajas nativas sin contenedores.

## Decisions

### Runtime: Podman primero, Docker después, por su CLI
Se detecta `podman` y luego `docker`, ejecutando `<runtime> info`; `ZERO_BOX_RUNTIME` lo fuerza. Se usa la CLI (compatible entre ambos) en lugar de SDKs. Podman es Apache-2.0 sin restricciones de uso; Docker Desktop tiene licencia comercial para empresas medianas, pero Docker Engine se acepta si el dueño ya lo tiene.

### Imagen: el mismo zero, construido para Linux
`box/Dockerfile` parte de `node:22-bookworm` (git, python3 y compiladores para la verificación de la mayoría de proyectos), instala `@openai/codex` y copia `package.json`, `package-lock.json`, `dist/` y `agents/` de la instalación de zero, con `npm ci --omit=dev` dentro de Linux. Así trae el binario de Claude para Linux del Agent SDK. La etiqueta es `zero-box:<hash>`, donde el hash es el contenido de esos archivos: si zero cambia, la imagen se reconstruye. El contexto de construcción es un directorio temporal con solo esos archivos.

### Protocolo de ejecución de agentes
El anfitrión arma el pedido completo, con las instrucciones de la estación, el prompt, el esquema, el modelo y los límites, y lo envía por stdin a `node /opt/zero/dist/box/agent.js` dentro de la caja. Ese script resuelve el motor con el mismo `resolveEngine` (incluidos los motores personalizados del YAML), lo ejecuta con `cwd=/work` e imprime `ZERO-RESULT <json>`. La validación de la salida estructurada sigue en el anfitrión.

Alternativa descartada: ejecutar los motores en el anfitrión con `cwd` montado. No aísla nada, porque el motor seguiría siendo un proceso local.

### Copia del proyecto: clon independiente
En modo caja la copia es `git clone --no-hardlinks` en `worktrees/<línea>/<trabajo>`. Un worktree no sirve: su `.git` apunta al repositorio del dueño, invisible y con otra ruta dentro de la caja, y los hardlinks permitirían corromper sus objetos. Commits y diffs los hace zero en el anfitrión sobre el clon. Antes de integrar, `git fetch <clon> +zero/<id>:zero/<id>` trae la rama al repositorio del dueño; desde ahí la integración no cambia. El modo de cada trabajo se guarda en el trabajo (columna `isolation`), porque un trabajo iniciado en caja debe terminar en caja.

### Montajes y privilegios
`run --rm -i --init --name zero-<trabajo>-<n> --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp --tmpfs /home/zero:mode=1777 -e HOME=/home/zero --cpus 2 --memory 4g --pids-limit 512 -v <copia>:/work[:ro] -w /work`.

Se montan en solo lectura (`:ro`) las estaciones `spec` y `review` y la verificación no; el build y el setup van en lectura-escritura. En Linux el proceso corre con el uid/gid del dueño (Docker: `--user`; Podman: `--userns=keep-id`) para que los archivos le pertenezcan; en Windows y macOS, con el usuario `node` de la imagen. `safe.directory=*` se pasa por variables `GIT_CONFIG_*` para que git acepte la copia con otro propietario. Los límites se configuran en `box:` del YAML.

### Credenciales
Cada motor declara qué variables puede usar: `claude` → `CLAUDE_CODE_OAUTH_TOKEN` o `ANTHROPIC_API_KEY`; `codex` → `CODEX_API_KEY` u `OPENAI_API_KEY`; los motores personalizados → su lista `secrets`. Antigravity no tiene instalador para Linux, así que no corre en la caja.

Se buscan en el entorno y luego en el llavero (`@napi-rs/keyring`, servicio `zero`). Se pasan con `-e NOMBRE` sin valor, tomando el valor del entorno del proceso hijo, para que no aparezcan en la lista de procesos. Los nombres guardados se indexan en `secrets.json`, solo nombres, porque el llavero no permite listar.

### Estado de la caja y nivel efectivo
`inspectBox` ejecuta las sondas (runtime, máquina, imagen) y guarda el resultado en `kv` (`box`). `effectiveLevel` recibe la disponibilidad: caja lista según la última inspección, más la presencia de credenciales calculada en el momento. El daemon inspecciona al iniciar y cada 10 minutos; `zero box status` y `zero box setup` refrescan.

### Preparación
`planBoxSetup` produce pasos según la plataforma y las sondas:
- **Windows:** `wsl --install --no-distribution`, elevado, con reinicio; `winget install RedHat.Podman`; `podman machine init`; `podman machine start`.
- **macOS:** `brew install podman` (o instrucciones si no hay Homebrew); `podman machine init`; `podman machine start`.
- **Linux:** instrucciones para instalar Podman con el gestor de paquetes, sin ejecutarlas.
- **Todas:** construcción de la imagen.

Cada paso declara si instala, requiere administrador o reinicio; los que lo hacen piden confirmación salvo con `--yes`. Tras un paso que requiere reinicio, el plan se detiene y lo indica.

### Verificación sin residuos
Tras los comandos de verificación (dentro o fuera de la caja) se descartan los cambios no confirmados, para que los artefactos de la verificación nunca entren en un commit posterior. El cambio del intento ya está confirmado antes de verificar.

### Observabilidad
Cada ejecución en la caja es un span `zero.box.run`, hijo del agente o comando correspondiente, con `zero.box.runtime`, `zero.box.image`, `zero.box.mount` (`ro`/`rw`) y `process.exit.code`. `zero status` muestra el estado de la caja y los pasos pendientes. El nivel efectivo y su motivo ya forman parte del estado.

## Risks / Trade-offs

- [La caja tiene red] → un agente manipulado podría enviar fuera el código del proyecto o la credencial del motor de esa estación. Mitigación: solo existe esa credencial; la lista de dominios permitidos queda como siguiente change.
- [WSL2 requiere virtualización activa y reinicio] → en equipos sin virtualización la caja no estará lista; la fábrica sigue en L2 y lo explica.
- [Imagen de ~1 GB y primera construcción lenta] → se construye una vez por versión de zero; el estado muestra el progreso.
- [Codex sin versión fijada en la imagen] → la versión instalada queda en la etiqueta y en los spans; fijarla es configurable.
- [Diferencias de permisos en montajes entre sistemas] → cubiertas por las opciones de usuario por plataforma y probadas en CI con Docker en Linux; Windows y macOS se prueban manualmente cuando haya runtime.
