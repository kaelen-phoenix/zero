# ADR 0003 — La fábrica en Docker

- **Estado:** aceptado
- **Fecha:** 2026-11-05

## Contexto

Quien está a cargo quiere instalar la fábrica en un contenedor. Hay dos garantías que dependen de la máquina y no existen ahí tal cual: los secretos viven en el llavero del sistema, y los trabajos corren en la caja (un contenedor) con la puerta de salida. Además, hoy una caja que no está lista hace caer los trabajos a copias locales: en un contenedor, eso los pondría al lado de la llave y los secretos sin que nadie lo haya elegido.

## Decisión

### Aislamiento

Por defecto, `compose.yaml` no da acceso a Docker y `isolation: container` no cambia. Se ofrecen dos caminos, y el asistente `zero setup` pide elegir uno. Mientras no haya caja lista, con `ZERO_CONTAINER=1`, el daemon no empieza trabajos ni pasos en reposo: esperan en la cola y `zero status` dice por qué.

1. **Socket del anfitrión (`docker/compose.box.yaml`).** La caja y la puerta funcionan como en una máquina. Qué expone el socket: da control sobre la máquina anfitriona a todo lo que corra en el contenedor de zero. Los agentes dentro de la caja no lo ven, pero sí zero, las estaciones de paquetes con `allowCode` y las estaciones que corren fuera de la caja, que en esta instalación corren en el contenedor de zero (`scout`, `research`, `reply` y los agentes de las estaciones de paquetes). Por eso es un archivo aparte, activado a propósito, y el asistente lo avisa. El demonio del anfitrión resuelve las rutas de `-v` en la máquina, así que la carpeta de datos se monta en la misma ruta adentro y afuera, con `ZERO_HOME` y `TMPDIR` dentro de ella. Esto último se dedujo de leer `boxRunArgs`, `gateRunArgs` y `stageSkills`; no se ejecutó.
2. **Sin caja (`isolation: worktree`).** Solo después de una advertencia y una confirmación cuya respuesta por defecto es no. Qué expone el modo sin caja: los agentes y los comandos de las líneas corren en el mismo contenedor que `zero_master_key` y los secretos, pueden leerlos, y sus salidas a internet no pasan por la puerta.

Se descarta Docker-in-Docker porque exige `--privileged`, que da al contenedor tanto poder sobre la máquina como el socket, y además suma un demonio dentro del contenedor, con su propio almacenamiento y sin ninguna garantía a cambio.

### Secretos

Con `ZERO_CONTAINER=1`, `SecretStore` busca en la variable de entorno, después en el Docker secret `/run/secrets/<NOMBRE>` y por último en `secrets.enc`, dentro de `ZERO_HOME`, cifrado con AES-256-GCM y con permisos 600. La llave es el Docker secret `zero_master_key`, fuera del volumen, para que una copia del volumen no alcance para leerlos. Sin una llave que abra lo que ya hay, no se escribe nada: se prefirió fallar con un mensaje antes que sobrescribir los secretos o dejarlos sin cifrar. Fuera de un contenedor nada cambia: sigue el llavero, y no se lee `/run/secrets` ni `secrets.enc`.

No se usan variables de entorno para guardar credenciales, porque `docker inspect` las muestra. Los motores que corren fuera de la caja reciben la suya solo en el entorno de su propio proceso, y `setup` y `verify` no la reciben.

### Motores

Los CLI se eligen al construir la imagen (`ZERO_CLIS`). El asistente nunca instala: si el CLI no está, lo explica y vuelve a preguntar. Esta primera parte cubre Claude Code y Codex; Gemini no es un motor de zero. En `ambas` el reemplazo tiene que ser otro motor, porque `stationChain` descarta repetidos.

## Consecuencias

- Las pruebas no corren Docker: el Dockerfile y los compose se revisan de forma estática. La imagen, los login reales (`claude setup-token`, `codex login --device-auth`, cuyos flags dependen de la versión de cada CLI y viven en la tabla de motores de `src/setup.ts`) y la caja por el socket quedan sin ejercitar hasta que alguien los corra en una máquina con Docker.
- Las sesiones de los CLI (`~/.codex`, `~/.config/gh`) quedan sin cifrar en el volumen, porque cada CLI las administra sin llavero. Quien quiera evitarlo usa una API key o un token.
- Mientras corre un trabajo, `docker inspect` de la caja muestra las credenciales pasadas con `-e NOMBRE`, visibles desde la máquina anfitriona si se usa el socket. El contenedor de zero sí lo evita; la caja todavía no.
- Dentro de la caja, Codex por suscripción no tiene credencial utilizable, así que el asistente lo rechaza con caja elegida.
- Los remotos por ssh no tienen llave en el contenedor: solo funciona https, con `zero git-credential`.
- `zero setup` cambia el archivo con la fábrica en marcha: el daemon lo relee, salvo el puerto y la interfaz del panel, que piden reiniciar el contenedor.
