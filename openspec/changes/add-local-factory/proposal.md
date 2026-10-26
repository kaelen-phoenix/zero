# Proposal

## Why

zero hoy es un orquestador que corre en GitHub Actions a partir de issues etiquetados. Las decisiones del ADR 0001 cambian el modelo: cada dueño tiene **su propia fábrica en su máquina**, la usa **desde el chat de su cliente de agentes** y la fábrica **trabaja sola en segundo plano**. Esta change construye esa base: una fábrica local que funciona de punta a punta y sobre la que se apoyarán el panel, el aislamiento, los plugins y los especialistas.

Principios que sirve: fábrica a oscuras (estaciones con contratos verificables, aprobaciones solo por nivel y política), agnóstico (los motores siguen detrás de `src/engines/`), observabilidad de primer nivel (cada estación emite spans y costos consultables), open source y gratuito (sin servicios externos obligatorios: estado local en SQLite integrado en Node).

## What Changes

- **BREAKING** La configuración pasa de `zero.config.json` por repo a una **definición de fábrica** `zero.factory.yaml` en el directorio de la fábrica (`~/.zero` por defecto), con varias **líneas** (repos), nivel de autonomía, límites y motores.
- **BREAKING** Se elimina el modo GitHub Actions (`zero tick`, `zero run`, workflows `zero.yml` y `townhall.yml`) y la entrada por labels. La entrada pasa a ser **pedidos** (lenguaje natural o especificación) desde el chat o la CLI.
- Nueva **línea de producción** por estaciones: `spec` → `build` → `verify` → `review` → `integrate`, con reintentos con feedback, límites de costo, rutas protegidas, guardia contra tests borrados o desactivados y **citas verificadas**.
- La estación `spec` convierte cada pedido en una especificación estructurada (requisitos + escenarios) y la escribe en formato OpenSpec.
- **Niveles de autonomía L0–L3** con aprobaciones que **aparcan** el trabajo sin bloquear la fábrica, con tiempo límite y acción por defecto. L3 exige aislamiento en caja; como esta change aún no lo implementa, la fábrica **baja a L2 y lo informa**.
- **Daemon local**: ejecuta pedidos en segundo plano, retoma lo interrumpido tras un reinicio, respeta el cordón andon (parar todo o un trabajo) y se arranca solo cuando llega un pedido desde el chat.
- **Interfaz de chat**: servidor MCP (stdio) con herramientas para pedir, consultar, aprobar, parar y leer el informe; `zero install` lo registra en los clientes detectados.
- **Observabilidad**: cada trabajo es una traza (trabajo → estación → intento → agente/comando) guardada localmente, con costo por agente; métricas definidas una sola vez; `zero trace` y `zero status`.
- **Townhall** local por fábrica, con notas por línea, borrado de secretos y sin duplicados.

## Capabilities

### New Capabilities
- `factory-config`: definición de la fábrica (líneas, nivel, límites, motores), su creación inicial y el cálculo del nivel efectivo.
- `work-intake`: cómo se piden trabajos, su ciclo de vida, las aprobaciones humanas y el cordón andon.
- `production-line`: las estaciones, sus contratos, reintentos, límites y garantías que impone zero.
- `factory-daemon`: ejecución continua en segundo plano, reanudación y concurrencia.
- `chat-interface`: herramientas MCP para usar la fábrica desde el chat y su registro en clientes.
- `factory-observability`: trazas, costos y métricas consultables de cada trabajo.
- `townhall`: memoria colectiva de la red de agentes y el informe para el dueño.

### Modified Capabilities
<!-- Ninguna: openspec/specs está vacío; todo el comportamiento se especifica por primera vez. -->

## Impact

- Código: reescritura de `src/cli.ts`, `src/config.ts`, `src/workspace.ts`; `src/pipeline.ts` se reemplaza por `src/line/`; nuevos `src/state/`, `src/daemon.ts`, `src/mcp/`, `src/install.ts`, `src/telemetry/`. `src/townhall/` pasa a almacenamiento local.
- Dependencias nuevas (OSI): `@modelcontextprotocol/sdk` (MIT), `yaml` (ISC). Estado con `node:sqlite` (integrado en Node 22, experimental).
- Se eliminan `.github/workflows/zero.yml` y `townhall.yml`; `ci.yml` se mantiene.
- Observabilidad: todo trabajo, estación, intento y llamada a agente queda registrado con duración, estado y costo.

**Fuera de alcance** (changes siguientes): panel en el navegador e instalador gráfico; registro como servicio del sistema; caja de aislamiento (contenedores); API de plugins; especialistas; motores ACP/OpenCode; integración con ccusage; exportación OpenTelemetry (OTLP); entrada desde GitHub/Linear/Jira; grafo de trazabilidad; cliente MCP gobernado para los agentes de las estaciones.
