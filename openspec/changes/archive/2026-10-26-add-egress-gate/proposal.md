# Proposal

## Why

La caja de aislamiento impide que un agente toque la computadora del dueño, pero puede salir a internet sin que nadie lo vea. Un agente manipulado, o una dependencia maliciosa durante el setup, podría mandar el código del proyecto o la credencial del motor a cualquier sitio.

El dueño decidió **no limitar la salida a internet**. Prefiere ver todas las salidas, bloquear automáticamente las sospechosas y, más adelante, armar su propia lista de bloqueados o pasar a una lista de permitidos, eligiendo el modo.

Para que ver las salidas sirva de algo, tienen que verse **todas**: si la caja tuviera salida directa, un agente manipulado podría ignorar al vigilante. Por eso la caja deja de tener ruta propia a internet y sale solo por una puerta de zero, que por defecto deja pasar todo salvo lo sospechoso.

Principios que sirve:
- **Fábrica a oscuras**: nadie mira en vivo. La puerta bloquea sola, y un trabajo con salidas sospechosas no se integra solo.
- **Observabilidad de primer nivel**: cada conexión queda registrada con destino, trabajo, estación, bytes y decisión.
- **Garantías impuestas por zero**: el control no depende de que el motor respete un proxy.
- **Usable por no programadores**: cada bloqueo se explica en palabras simples.
- **Open source y gratuito**: la puerta es código de zero, sin dependencias nuevas.

## What Changes

- Nueva **puerta de salida**: un proxy HTTP/HTTPS de zero que corre en su propio contenedor (`zero-gate`, con la misma imagen de la caja).
  - Las cajas pasan a una red interna sin salida (`zero-box`) y sin DNS. Solo pueden salir a través de la puerta.
  - Cada ejecución en la caja recibe un pase propio, así cada conexión queda asociada a su trabajo y su estación.
- **Reglas de salida** en `zero.factory.yaml` (`egress:`):
  - `mode: blocklist` (por defecto): sale todo salvo lo sospechoso y lo que el dueño bloquee.
  - `mode: allowlist`: solo salen los sitios permitidos y los del motor configurado.
  - `allow` y `block`: listas de sitios del dueño. Un sitio incluye sus subdominios y puede llevar puerto.
- **Bloqueo automático de lo sospechoso**, con motivo en palabras simples:
  - direcciones IP sin nombre;
  - la red local o direcciones internas, también cuando un nombre resuelve a ellas;
  - puertos distintos de 80 y 443;
  - servicios típicos para sacar datos: pegar textos, compartir archivos, capturar peticiones, túneles, mensajería y DNS dinámico.
- **Registro de salidas** en el estado de la fábrica:
  - destino, puerto, trabajo, estación, decisión, motivo, bytes enviados y recibidos, y duración;
  - el informe agrupa por sitio y marca los sitios nuevos.
- **Efecto en los trabajos**:
  - Si la puerta bloqueó una salida sospechosa de un trabajo, en `L3` el trabajo falla sin integrarse y explica cómo permitir el sitio si es legítimo.
  - En `L0`–`L2`, el trabajo pregunta al dueño antes de seguir.
- **Vistas**:
  - `zero egress [trabajo] [--days N]` y la herramienta MCP `zero_egress`;
  - las salidas en `zero trace` y un resumen en el informe;
  - `zero egress allow|block|remove <sitio>` y `zero egress mode <modo>` para editar las reglas;
  - desde el chat solo se puede **bloquear** (`zero_egress_block`). Permitir y cambiar el modo quedan para la terminal, el archivo y, más adelante, el panel.

## Capabilities

### New Capabilities
- `egress-gate`: la puerta de salida de la caja, sus reglas, el registro de conexiones y su efecto en los trabajos.

### Modified Capabilities
- `production-line`: un trabajo con salidas sospechosas bloqueadas no se integra sin el dueño.
- `chat-interface`: herramientas `zero_egress` y `zero_egress_block`.
- `factory-observability`: las salidas forman parte de la traza y del informe, con una sola definición.

## Impact

- Código nuevo:
  - `src/box/egress.ts`: reglas, puras;
  - `src/box/gate.ts` y `src/box/gate-main.ts`: el proxy;
  - `src/box/network.ts`: red, contenedor de la puerta, pases y lectura de registros.
- Cambios en `src/box/run.ts`, `src/box/executor.ts`, `src/agent.ts`, `src/config.ts`, `src/state/store.ts`, `src/telemetry/metrics.ts`, `src/line/runner.ts`, `src/line/policy.ts`, `src/line/answer.ts`, `src/app.ts`, `src/daemon.ts`, `src/cli.ts`, `src/format.ts`, `src/mcp/server.ts`, `src/townhall/briefing.ts` y `src/engines/` (los sitios de cada motor).
- Sin dependencias nuevas.
- CI: el job de la caja comprueba con Podman y con Docker que:
  - la caja no puede salir directo ni resolver nombres;
  - un sitio normal sale por la puerta;
  - uno sospechoso se bloquea y queda registrado.

**Fuera de alcance**:
- Cortar conexiones por volumen enviado: los bytes se ven, pero no se cortan.
- Inspeccionar el contenido cifrado (TLS).
- Controlar la salida de trabajos que corren fuera de la caja.
- El panel en el navegador, que es la próxima change y mostrará estas mismas salidas con botones para permitir y bloquear.
