# Proposal

## Why

Vas a poder instalar la fábrica con `docker compose` y configurarla con `docker compose run --rm zero setup`. El asistente te pregunta con qué vas a trabajar: la suscripción de Claude Code o Codex, API keys, o las dos cosas con un motor de reemplazo. También te pregunta los límites de gasto, si usás la caja de aislamiento, el puerto del panel y el acceso a GitHub. Podés volver a correrlo cuando quieras para cambiar algo. Los datos y los repositorios quedan en volúmenes, así que no se pierden al actualizar el contenedor. Las claves se piden sin mostrarse y se guardan cifradas en el volumen; la llave que las cifra es un Docker secret, fuera del volumen. Por defecto el contenedor no tiene acceso a Docker. Para usar la caja activás un archivo de compose aparte, que conecta el socket de Docker de la máquina, y el asistente te avisa que eso da control sobre esa máquina. Trabajar sin caja también es posible, pero tenés que confirmarlo después de una advertencia clara. Si no elegiste ninguna de las dos, los trabajos esperan en la cola en vez de correr sin protección. El panel se publica en un puerto configurable y, por defecto, solo se abre desde tu propia máquina. Nada se instala sin tu consentimiento: los CLI se eligen al construir la imagen. En esta primera parte entran Claude Code y Codex; Gemini queda para la siguiente, porque zero todavía no lo tiene como motor propio.

## What Changes

- Instalación con Docker y asistente de primera configuración
- Supuesto: Las pruebas no corren Docker: el Dockerfile y los compose solo se revisan de forma estática. La imagen, el login de los CLI y la caja por el socket quedan sin ejercitar de punta a punta hasta que alguien los corra en una máquina con Docker.
- Supuesto: Supuesto no verificado: que la caja y la puerta de salida funcionan por el socket del anfitrión montando los datos en la misma ruta. Se dedujo de leer `boxRunArgs`, `gateRunArgs` y `stageSkills` (TMPDIR dentro de los datos); no se ejecutó.
- Supuesto: El socket de Docker da a quien corre en el contenedor de zero control sobre la máquina anfitriona. Los agentes dentro de la caja no lo ven, pero sí lo ven zero, las estaciones de paquetes con `allowCode` y las estaciones que corren fuera de la caja. Por eso es opcional y se avisa.
- Supuesto: `scout`, `research`, `reply` y `spec` en ciertos caminos pueden correr fuera de la caja, como en cualquier instalación. En Docker eso significa dentro del contenedor de zero, con acceso a la llave si hay escritura por shell. No hay que asumir que todo corre en la caja; conviene que build confirme qué estaciones usan `agentRunner` local.
- Supuesto: Mientras corre un trabajo, `docker inspect` de la caja sigue mostrando las credenciales pasadas con `-e NOMBRE`; con el socket del anfitrión se ven desde esa máquina. Lo evita el contenedor de zero, no la caja: se documenta y queda en followUps.
- Supuesto: Las sesiones de login de los CLI (`~/.codex`, `~/.config/gh`) quedan sin cifrar en el volumen, porque cada CLI las administra sin llavero disponible. Se documenta; quien las quiera evitar puede usar API key o token.
- Supuesto: En `ambas`, el reemplazo tiene que ser otro motor: `stationChain` descarta repetidos, así que Claude por suscripción con reemplazo Claude por API key no se puede expresar. Se interpretó el fallback como otro motor.
- Supuesto: El flag `codex login --device-auth` y `claude setup-token` dependen de las versiones de esos CLI y no se probaron contra el programa real. Hay que dejarlos en la tabla de motores para corregirlos en un solo lugar.
- Supuesto: Supuesto: la imagen se construye localmente con `docker compose build`, porque publicarla necesita un registro y credenciales que la fábrica no tiene. 'Imagen oficial' se interpretó como el Dockerfile y el compose oficiales del repositorio.
- Supuesto: Los remotos por ssh no tienen llave en el contenedor; solo https funciona con el helper de credenciales. Hay que documentarlo.
- Supuesto: `zero setup` cambia el archivo mientras el daemon corre, y el daemon no lo relee: el asistente tiene que indicar reiniciar el contenedor. El panel además toma el puerto al arrancar.

## Capabilities

### New Capabilities
- `docker-install`: Instalación con Docker y asistente de primera configuración

### Modified Capabilities

## Impact

Generado por zero para el trabajo 6b7f5ae6.
