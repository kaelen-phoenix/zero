# Proposal

## Why

La fábrica está configurada en L3 por defecto, pero hoy trabaja en L2: sin una caja, un agente que se equivoca, o que es engañado por instrucciones escondidas en un archivo, puede leer o tocar cualquier cosa del usuario en su computadora personal. La caja de aislamiento es la condición que pusimos para trabajar a oscuras (ADR 0001, decisión 5). Esta change la construye.

Principios que sirve: fábrica a oscuras (L3 real), garantías impuestas por zero (el aislamiento no depende del motor), open source y gratuito (Podman, Apache-2.0, como runtime preferido) y usable por no programadores (zero prepara la caja y explica cada paso). Observabilidad: cada ejecución en la caja queda en la traza con el runtime, la imagen y los límites aplicados, y el estado de la caja se muestra en `zero status`.

## What Changes

- Nueva **caja de aislamiento**: los comandos de preparación, los agentes y la verificación de cada trabajo corren dentro de un contenedor OCI (Podman o Docker), con una copia propia del repositorio y sin acceso al resto de la computadora.
  - Las estaciones de solo lectura reciben la copia montada en modo solo lectura.
  - Usuario sin privilegios, sistema de archivos raíz de solo lectura y límites de CPU, memoria y procesos.
  - La caja recibe solo la credencial del motor de esa estación.
- Nuevo comando **`zero box`** (`status`, `setup`) que detecta qué falta y lo prepara con consentimiento del dueño: WSL2 y Podman en Windows, Podman en macOS, instrucciones en Linux, y la imagen de la caja.
- Nuevos **secretos en el llavero del sistema** (`zero secret set|list|remove`) para las credenciales que los motores necesitan dentro de la caja, sin que pasen por la línea de comandos ni por archivos.
- El **nivel efectivo** pasa a ser `L3` cuando la caja está lista y los motores configurados tienen su credencial; si falta algo, sigue en `L2` y dice exactamente qué falta y cómo resolverlo.
- `zero init` configura `isolation: container` por defecto.
- La integración sigue fuera de la caja: zero trae la rama desde la copia de la caja y la integra en el repositorio del dueño.

## Capabilities

### New Capabilities
- `isolation-box`: detección, preparación y uso de la caja de aislamiento donde corren los agentes y los comandos de cada trabajo.
- `factory-secrets`: credenciales de los motores guardadas en el llavero del sistema operativo.

### Modified Capabilities
- `factory-config`: el nivel efectivo considera el estado real de la caja y las credenciales; `zero init` configura la caja por defecto; las credenciales pueden venir del llavero de la fábrica.

## Impact

- Código: nuevos `src/box/` (runtime, imagen, copia, ejecución, preparación), `src/secrets/` (llavero), `box/Dockerfile`; cambios en `src/line/runner.ts` (modo caja), `src/agent.ts` (ejecución inyectable del motor), `src/config.ts`, `src/init.ts`, `src/app.ts`, `src/daemon.ts`, `src/cli.ts`, `src/format.ts`.
- Dependencia nueva (OSI): `@napi-rs/keyring` (MIT).
- CI: nuevo job que construye la imagen y ejecuta un trabajo real dentro de la caja con Docker.
- Observabilidad: spans `zero.box.run` con runtime, imagen, modo de montaje y código de salida; el estado de la caja en `zero status` y en el chat.

**Fuera de alcance**: restricción de la salida a internet de la caja (lista de dominios permitidos); cajas nativas sin contenedores (bubblewrap, seatbelt, AppContainer); instalación gráfica desde el panel; motores sin instalador en Linux (Antigravity) dentro de la caja.
