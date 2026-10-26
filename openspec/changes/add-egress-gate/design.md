# Design

## Context

Ver proposal.md. Hoy la caja (`src/box/run.ts`) corre en la red por defecto del runtime, con salida directa a internet y DNS. Los agentes necesitan internet para hablar con su modelo, y el setup para bajar paquetes. El dueño eligió observar y bloquear lo sospechoso en lugar de limitar por defecto.

Restricciones:
- Funciona igual con Podman y Docker, rootless incluido, y en Windows y macOS, donde los contenedores viven en una máquina virtual.
- La caja corre sin capacidades (`--cap-drop ALL`).
- Sin dependencias nuevas.

## Goals / Non-Goals

**Goals:**
- Que **toda** conexión de la caja hacia afuera pase por un punto que zero controla y registra.
- Bloquear lo sospechoso sin intervención y con un motivo entendible.
- Que el dueño pueda pasar de "bloquear lo sospechoso" a "lista de bloqueados" o a "solo lo permitido" sin tocar código.
- Que un trabajo cuyo agente intentó algo sospechoso no se integre solo.

**Non-Goals:**
- Detectar el envío de datos a sitios permitidos, como la API del modelo o GitHub: por nombre de sitio no se distinguen.
- Inspección TLS (MITM): exigiría instalar una CA en la caja y romper la verificación de los motores.
- Cortar por volumen. Los bytes se registran y se muestran.

## Decisions

### Una puerta en su propio contenedor, sobre una red interna
- Se crea la red `zero-box` con `--internal`: sin ruta hacia afuera. Las cajas corren solo en esa red.
- La puerta (`zero-gate`) corre en la red `zero-box` y en la red por defecto del runtime (`podman` o `bridge`), así que es lo único que la caja puede alcanzar.
- La puerta ejecuta `node /opt/zero/dist/box/gate-main.js` desde la misma imagen `zero-box:<hash>`. Si zero cambia, la puerta se reinicia con la imagen nueva. Para eso se guarda la imagen en la etiqueta `zero.image`.
- La puerta va endurecida igual que la caja (`--cap-drop ALL`, `no-new-privileges`, `--read-only`, límites), con un único montaje: `~/.zero/gate` → `/gate`.

Alternativas descartadas:
- **Proxy en el anfitrión**: en Windows y macOS la red interna vive dentro de la máquina virtual y no alcanza al anfitrión sin abrir también la salida.
- **Reglas de firewall dentro de la caja** (iptables): requieren `CAP_NET_ADMIN`, que la caja no tiene a propósito.
- **Solo variables `HTTPS_PROXY`**: un agente manipulado las ignora.

La dirección de la puerta en `zero-box` se lee con `inspect` después de arrancarla. Se evita fijar una subred, que podría chocar con la red del dueño.

### Sin DNS en la caja
Las cajas corren con `--dns 192.0.2.1`, una dirección de documentación que nunca se enruta: no pueden resolver nombres, y así se cierra el canal de sacar datos codificados en consultas DNS. No se usa `127.0.0.1` porque Docker reenvía los DNS de loopback desde la red del anfitrión. No hace falta resolver: con proxy, los clientes mandan el nombre del sitio a la puerta, y la puerta lo resuelve. `localhost` sigue funcionando por `/etc/hosts`.

### Proxy HTTP con CONNECT, propio
`src/box/gate.ts` usa `node:http`:
- `CONNECT host:puerto` para HTTPS: se arma un túnel TCP y la puerta no ve el contenido.
- Peticiones en forma absoluta (`GET http://…`) para HTTP plano.
- Cuenta los bytes en cada sentido.

La caja recibe `HTTP_PROXY`, `HTTPS_PROXY` (también en minúsculas) y `NODE_USE_ENV_PROXY=1`, para que el `fetch` de Node también lo use. `NO_PROXY` queda en `localhost,127.0.0.1,::1`, para que los servidores de prueba dentro de la caja funcionen. npm, pip, git, curl, Codex y Claude Code respetan estas variables. Un programa que no las respete simplemente no sale: falla cerrado.

### Un pase por ejecución
- Cada ejecución en la caja recibe un pase aleatorio (24 hex) en la URL del proxy: `http://<pase>@<puerta>:3128`.
- El anfitrión escribe `gate/runs/<pase>.json` con el trabajo y la estación antes de la ejecución, y lo borra al terminar.
- La puerta valida el formato del pase antes de usarlo como nombre de archivo. Sin pase válido responde `407` y registra la conexión como "sin identificar".

Un agente solo conoce su propio pase, así que no puede hacerse pasar por otro trabajo. Un contenedor que sobrevive a su ejecución tampoco puede seguir saliendo.

El pase no es un secreto del dueño: solo sirve desde la red interna y vence con la ejecución. Por eso va como valor en `-e`, a diferencia de las credenciales.

### Reglas, en este orden
`judge()` en `src/box/egress.ts` es pura:
1. **`block` del dueño**: bloqueado. Regla `listed`.
2. **`allow` del dueño o sitios del motor**: permitido. Lo explícito del dueño gana sobre las sospechas; por ejemplo, un registro en su red local.
3. **Sospechas por nombre**: regla `suspicious`.
   - IP sin nombre;
   - puerto distinto de 80/443;
   - servicio de la lista de exfiltración (pegado de texto, archivos temporales, captura de peticiones, túneles, mensajería, DNS dinámico).
4. **Resolución del nombre** en la puerta, con sospecha por dirección: si **alguna** dirección cae en red local, loopback, link-local (metadatos de nube), CGNAT, multicast, reservadas, ULA o IPv4 mapeada, se bloquea con regla `suspicious`. La conexión va a la dirección ya revisada, lo que evita el rebinding de DNS.
5. **`mode: allowlist`**: lo que no está permitido se bloquea con regla `not-allowed`.
6. Lo demás se permite.

Un sitio `ejemplo.com` cubre `ejemplo.com` y sus subdominios. Con `:puerto` se limita a ese puerto. Una IP coincide de forma exacta.

Los sitios de cada motor se declaran en su adaptador (`src/engines/`):
- `claude` → `api.anthropic.com`;
- `codex` → `api.openai.com` y `chatgpt.com`;
- los motores personalizados → su campo `hosts`.

En `allowlist` se agregan solos, para que un dueño que no programa no deje a su fábrica sin modelo.

### Registro: archivos por día, luego SQLite
- La puerta agrega una línea JSON por conexión a `gate/events-AAAA-MM-DD.jsonl`.
  - Las bloqueadas se escriben **antes** de responder, así que cuando la ejecución termina ya están en disco.
  - Las permitidas se escriben al cerrarse.
- El anfitrión las pasa a la tabla `egress`:
  - después de cada ejecución en la caja;
  - en cada vuelta del daemon;
  - antes de cada consulta.
- Cada archivo recuerda su posición en `kv`, y la lectura y la inserción van en una misma transacción (`BEGIN IMMEDIATE`). Así el daemon y la CLI pueden leer a la vez sin duplicar.
- Cada evento trae un id propio (`INSERT OR IGNORE`).
- Los archivos de días anteriores ya leídos se borran, y las filas se guardan 90 días.

La puerta no escribe en `state.db`: montar la base de la fábrica en un contenedor que habla con internet sería exponerla.

### Efecto en el trabajo
`policy.ts` agrega el evento `egress-suspicious`: `L0`–`L2` → preguntar; `L3` → fallar.
- El runner lo revisa después de `spec`, al comienzo de cada intento de `build` y antes de integrar.
- Solo cuentan los bloqueos con regla `suspicious`. Lo que el dueño bloqueó o no permitió es su política y no indica un agente manipulado.
- Aprobar la pregunta guarda `approvals.egressSeq`, el número del último registro aceptado: una sospecha nueva vuelve a preguntar. Se usa el orden en que el anfitrión leyó los registros y no la hora, porque el reloj de la máquina virtual de los contenedores puede atrasar.

### Quién puede cambiar las reglas
`allow`, `remove` y `mode` cambian `zero.factory.yaml` conservando sus comentarios, y solo desde la terminal o el archivo. Más adelante también desde el panel.

El chat solo puede **bloquear** (`zero_egress_block`). Un chat manipulado, por ejemplo por un archivo que leyó, podría pedir que se permita un sitio de exfiltración. Bloquear de más, en cambio, es molesto pero seguro y reversible.

### Vistas y métricas
- `summarizeEgress()` en `telemetry/metrics.ts` es la única definición: agrupa por sitio y puerto, con conexiones, bloqueadas, bytes, trabajos, último motivo y si el sitio es nuevo.
- `computeMetrics` agrega `egress` (conexiones, bloqueadas, sospechosas).
- La usan `zero egress`, `zero_egress`, `zero trace` y el informe.

## Risks / Trade-offs

- **Sacar datos por sitios permitidos.** La API del modelo, GitHub o un registro de paquetes siguen siendo caminos posibles, y por nombre de sitio no se distinguen. El registro de bytes lo hace visible después; cortarlo queda para más adelante.
- **Herramientas que no usan proxy.** Fallan cerradas. Si aparece una común, se documenta su variable.
- **Falsos positivos** (una dependencia que llama a una IP): el trabajo pregunta (`L0`–`L2`) o falla explicando cómo permitir el sitio (`L3`). Es preferible a integrar sin mirar.
- **Redes `--internal` en Podman rootless y Docker.** Ambos las soportan. El CI lo comprueba con los dos runtimes.
- **La puerta queda encendida entre trabajos.** Consume poca memoria y solo es alcanzable desde la red interna y con un pase vigente.

## Migration Plan

- Las cajas existentes no cambian de imagen por esto, porque la puerta usa el mismo `dist/`, pero la imagen se reconstruye igual porque cambió el código.
- Los trabajos en curso al actualizar reanudan con la puerta.
- `egress:` es opcional: sin él vale `mode: blocklist` con listas vacías.
