# ADR 0001 — Construir zero propio vs adoptar un framework existente

- **Estado:** aceptado (2026-10-26). Ver "Decisiones tomadas" al final.
- **Fecha:** 2026-10-26

## Contexto

zero es la base de la red de agentes de Kaelen Global Defence: *"Autonomous agent network. Continuous execution. Zero human intervention required."* Requisitos:

| # | Requisito |
|---|---|
| R1 | Open source (OSI) y gratuito, igual que zero |
| R2 | Desatendido: corre en CI o como daemon, sin UI ni aprobaciones |
| R3 | Agnóstico al motor (Claude, Codex, Antigravity, agentes open source) |
| R4 | Línea completa: issue → plan → implementación → verificación → revisión independiente → reintentos → integración |
| R5 | Continuo: fuente de tareas, programación, control de concurrencia |
| R6 | Extensible o usable como librería |
| R7 | Proyecto sano y mantenido |
| R8 | **Observabilidad de primer nivel** |
| R9 | **Diseño de fábrica a oscuras:** no imitar el ciclo de vida de un equipo humano |

Se evaluaron 4 frentes en paralelo: 13 orquestadores, 12 motores de agente, ACP, 12 frameworks y motores de workflows, y 7 backends de observabilidad. Los repos se clonaron sin ejecutar nada; los datos de salud proceden de `gh api` del 2026-10-26.

## Hallazgos

### Orquestadores

| Proyecto | Licencia | Veredicto | Motivo principal |
|---|---|---|---|
| Agent Orchestrator | Apache-2.0 | Tomar ideas | El más completo (~45 adaptadores), pero centrado en la supervisión humana (kanban, app móvil), sin modo CI, sin OTel y con telemetría a PostHog activada por defecto |
| **Sortie** | Apache-2.0 | Construir encima / tomar ideas | El que más cubre: tracker → agente → PR, reacciones a fallos de CI y revisión, coste y Prometheus. Le faltan OTel, revisión independiente, auto-merge y modo Actions, y no se puede importar como librería (Go `internal/`) |
| **gh-aw** (GitHub) | MIT | Construir encima (más adelante) | Nativo de Actions, exporta OTLP, motores claude, codex, gemini y agy. Es un framework, no una línea, y está en versión pre-1.0 |
| OpenHands software-agent-sdk | MIT | Construir encima (opcional) | Runtime con ACP, OTel y coste. Dependencia pesada en Python |
| Scion (Google) | Apache-2.0 | Tomar ideas | La mejor observabilidad (reenvío OTLP por contenedor). No tiene línea de entrega, es pre-1.0 y necesita un Hub |
| no_human | MIT | Tomar ideas | Las mejores puertas: *repro gate* (el test falla antes y pasa después), guardia contra tests borrados o debilitados y revisión adversarial con otro modelo. Solo soporta 2 motores |
| CLITrigger | MIT | Tomar ideas | Límites de rondas, coste y "sin progreso", y cambio de herramienta al agotar cuota. Herramienta personal con un solo mantenedor |
| Aixgo Code | Apache-2.0 | Tomar ideas | Registro en una rama huérfana (valida el diseño del townhall). Beta, 0 estrellas, merge humano obligatorio |
| vibe-kanban | Apache-2.0 | Descartar | En proceso de cierre (sunset) y centrado en un tablero humano |
| Claude Squad | AGPL-3.0 | Descartar | Multiplexor tmux para humanos y licencia AGPL |
| AI-Agents-Orchestrator, taskpods, Orbi y otros | varias | Descartar | Sin línea de entrega, sin modo headless, AGPL o cubren un solo proveedor |

**Ninguno sustituye a zero** en una línea desatendida en CI. Todos fallan en al menos dos de R2, R8 y R9. Los más maduros están diseñados para que una persona supervise.

### Motores de agente

| Motor | Licencia | Solo lectura | Esquema JSON | Modelos libres o locales | ACP | Observabilidad | Encaje |
|---|---|---|---|---|---|---|---|
| **OpenCode** | MIT | agente `plan` + permisos | vía SDK/servidor | Sí (Ollama, OpenRouter) | nativo | JSONL + coste + OTel | **Principal y vía gratuita** |
| **Codex CLI** | Apache-2.0 | sandbox del SO (el más fuerte) | `--output-schema` | `--oss` con Ollama | adaptador | JSONL + tokens + OTel (sin $) | Principal |
| **Goose** | Apache-2.0 | allowlist en recipe | recipe validado | Sí | nativo | OTel completo + coste | Principal |
| Claude Code / Agent SDK | **Propietario** | `plan` | `--json-schema` | Solo Claude | adaptador | El más maduro | **Opcional**: credenciales propias |
| Qwen Code, Kilo CLI | Apache-2.0 / MIT | sí | sí / SDK | Sí | nativo | OTel | Segunda fila |
| Gemini CLI | Apache-2.0 | en headless pasa a YOLO | no | Solo Gemini; sin capa gratuita | nativo | OTel | Mal encaje |
| Antigravity `agy` | **Propietario** | no se puede imponer | `--json-schema` | No | binario aparte | sin OTel | Mal encaje |
| Crush | FSL (no OSI) | lo aprueba todo | no | Sí | no | no | Descartar |
| Aider | Apache-2.0 | `ask` | no | Sí | no | no | Proyecto estancado |

Claude Agent SDK: *"© Anthropic PBC. All rights reserved"*. zero puede invocarlo y seguir siendo open source si no lo redistribuye. Cada usuario debe usar sus propias credenciales; zero nunca las agrupa ni hace de proxy. Además añade unos 284 MB de binario nativo, así que no puede ser una dependencia obligatoria.

### Protocolo ACP

La v1 es estable (1.12.0) y el SDK de TypeScript `@agentclientprotocol/sdk` (Apache-2.0) es joven, así que conviene fijar su versión. Lo hablan de forma nativa OpenCode, Goose, Qwen, Kilo, Gemini, Cline, OpenHands y Copilot; Claude y Codex lo hacen mediante adaptadores Apache-2.0.

Limitaciones: no tiene salida estructurada, el informe de coste es opcional y los modos de solo lectura tienen IDs distintos en cada agente. La v2 sigue en alfa.

### Frameworks y motores de workflows

- **Frameworks de agentes** (LangGraph, Mastra, CrewAI, OpenAI Agents SDK, Google ADK): todos controlan el bucle del LLM, pero en zero ese bucle lo traen los CLIs. **No aportan nada.**
- **Motores de workflows:** ahora no hacen falta, porque GitHub ya actúa como estado durable. Cuando se necesite una flota multi-repo, colas o ejecuciones de más de 6 h: **DBOS** (MIT, solo Postgres) o **Hatchet** (MIT). Inngest (SSPL) y Restate (BSL) quedan descartados porque su licencia no es OSI.

### Observabilidad

- Las convenciones GenAI de OpenTelemetry definen spans para agentes (`invoke_workflow`, `invoke_agent`, `execute_tool`) y tokens. Su estado sigue siendo *Development* y **no incluyen coste**.
- Backends libres:
  - Langfuse: núcleo MIT, con sesiones y coste.
  - Jaeger: Apache-2.0, solo trazas.
  - SigNoz: núcleo MIT.
  - Grafana LGTM: AGPL, que no afecta a zero porque solo le enviamos datos.
  - Phoenix: ELv2, no es OSI.
- Los motores principales (OpenCode, Goose, Codex, Claude) exportan OTel de forma nativa.

## Decisión propuesta

**Construir zero propio, open source y gratuito.** Ningún orquestador cumple R2, R8 y R9 a la vez, y los frameworks genéricos no aportan valor para orquestar CLIs que traen su propio bucle. Construir el núcleo no significa reinventarlo todo:

1. **Núcleo propio:** la línea de producción, las puertas de calidad, el townhall y la observabilidad son lo diferencial de Kaelen.
2. **Capa de motores sobre estándares:**
   - Añadir un motor `acp` genérico con `@agentclientprotocol/sdk` (versión fijada, protocolo v1). Pasa a ser la vía agnóstica por defecto.
   - Mantener los adaptadores nativos donde aportan garantías que ACP no da: `codex` (sandbox del SO y `--output-schema`) y `opencode`, que entra como motor por defecto y vía gratuita.
   - `claude` pasa a ser **dependencia opcional** (peer/optional) y se usa con las credenciales propias de cada usuario.
   - `antigravity` queda como experimental vía ACP; se retira el adaptador por CLI.
3. **Observabilidad sobre OpenTelemetry:**
   - Solo `@opentelemetry/api` + SDK, con las variables estándar `OTEL_*`.
   - La exportación está apagada si no se configura un destino.
   - Siempre se genera un registro JSONL de cada ejecución como artefacto de Actions.
   - Modelo de spans: tarea → estación → intento → herramienta, más `zero.cost.usd` con el origen del dato (reportado, estimado o desconocido).
   - Se documenta Langfuse como backend recomendado y Jaeger como opción mínima.
4. **Ideas adoptadas** (sin depender de esos proyectos):
   - De no_human: *repro gate* y guardia contra tests borrados o debilitados.
   - De CLITrigger: límites de coste, de rondas y de "sin progreso", y cambio de motor al agotar cuota.
   - De Agent Orchestrator y Sortie: los fallos de CI y los conflictos de merge vuelven al agente responsable.
   - De Scion: reenvío de la telemetría nativa de cada CLI.
5. **Revisar más adelante:**
   - gh-aw como sustrato de ejecución alternativo cuando llegue a la 1.0.
   - Sortie como modo daemon.
   - DBOS o Hatchet cuando haya una flota multi-repo.

## Consecuencias: rediseño como línea de producción (R9)

La implementación actual (planner, coder, reviewer y PR) todavía imita a un equipo humano. La línea objetivo:

```
intención → spec + criterios ejecutables → N candidatos en paralelo (varios motores)
   → estaciones de verificación (tests, repro gate, tamper guard, tipos, seguridad, juez LLM como un sensor más)
   → selección del mejor → integración automática → vigilancia → rollback automático
```

- Los PRs quedan como registro de auditoría, no como paso obligatorio.
- Los humanos están en la sala de control: definen la intención, los presupuestos y los límites, y leen el townhall y las trazas.

## Decisiones tomadas (2026-10-26)

Contexto añadido tras este ADR:
- **Cada dueño tiene su propia fábrica en su máquina.** Funciona como un daemon local, sin servicio central y con un solo dueño.
- **La fábrica debe poder usarla alguien que no programa.** Habrá un modo simple por defecto y un modo avanzado.
- **Se configura desde un panel en el navegador**, que se abre al instalar.

| # | Decisión | Elección |
|---|---|---|
| 1 | Construir o adoptar | **Construir zero propio**, reutilizando piezas libres donde sirvan (OpenSpec, ccusage…) |
| 2 | Licencia | **Apache-2.0** |
| 3 | Entrada de trabajo | **Las dos**: lenguaje natural por defecto (una estación lo convierte en un change de OpenSpec) o especificación directa para quien sepa. Las fuentes (panel, GitHub, Linear, Jira…) son plugins |
| 4 | Autonomía | **Niveles L0–L3**, elegidos por cada dueño. **Por defecto se arranca en L3 (a oscuras)**, con límites duros y botón de parada |
| 5 | Protección del equipo | **En L3 los agentes trabajan siempre dentro de una caja aislada que prepara el instalador de zero.** Si en una máquina no es posible, la fábrica baja de nivel y explica por qué |
| 6 | Configuración | **Un archivo legible (`zero.factory.yaml`) que escribe el panel.** Los secretos van al llavero del sistema operativo |

Consecuencias inmediatas:
- **El runtime principal pasa a ser el daemon local.** GitHub Actions queda como opción.
- **Con L3 por defecto y usuarios no técnicos**, los límites duros (presupuesto, rutas prohibidas, nada publicado sin permiso) y el aislamiento automático pasan a ser requisitos del instalador, no opciones.

### Interfaz principal (2026-10-26)

| # | Decisión | Elección |
|---|---|---|
| 7 | Cómo se usa zero | **Desde el chat del cliente de agentes del dueño** (Claude Code, Codex, agy, OpenCode). zero se instala como plugin (skills + servidor MCP stateless). El panel en el navegador queda para la configuración inicial y lo visual |
| 8 | Dónde se hace el trabajo | **En segundo plano.** El daemon de zero ejecuta la línea con los mismos clientes en modo headless, con la cuenta del dueño, y sigue aunque se cierre el chat. Los avisos fuera del chat van por panel, email o Telegram |

Pendiente de verificar: los términos de uso de cada proveedor para ejecuciones headless con una suscripción personal.

### Especialistas (2026-10-26)

| # | Decisión | Elección |
|---|---|---|
| 9 | Creación de agentes | **Especialistas definidos por contrato**, no por personaje. Cada uno declara su estación, sus permisos (impuestos por zero), una entrega comprobable y sus skills (Agent Skills). Se obtienen de **tres formas**: incluidos de fábrica (tester, seguridad, backend…), creados desde el chat (zero los arma y **los prueba con trabajos pasados antes de activarlos**), o escritos a mano o instalados como plugin compartido. El townhall mide a cada uno: aciertos, falsos positivos y costo |

### Primera etapa construida (2026-10-26)

La change OpenSpec `add-local-factory` implementa la fábrica local:
- definición en `zero.factory.yaml`, con el nivel efectivo (L3 → L2 hasta que exista la caja);
- línea `spec → build → verify → review → integrate` con checkpoints, reintentos, políticas, rutas protegidas, guardia de tests y citas verificadas;
- daemon con reanudación, andon y arranque automático;
- servidor MCP para el chat y `zero install`;
- trazas y métricas con una sola definición;
- townhall local por línea.

Se verificó de punta a punta con Claude real: un pedido en lenguaje natural se entregó integrado en `main` en 60 s, por $0.65.

### Segunda etapa: caja de aislamiento (2026-10-26)

La change OpenSpec `add-isolation-box` implementa la caja:
- un contenedor (Podman, si no Docker) con un clon independiente del proyecto, de solo lectura para `spec` y `review`, sin privilegios, con límites y con la sola credencial del motor de cada estación;
- `zero box status|setup` con consentimiento por paso;
- credenciales en el llavero del sistema.

L3 es real cuando la caja y las credenciales están listas.

### Tercera etapa: puerta de salida (2026-10-26)

| # | Decisión | Elección |
|---|---|---|
| 10 | Salida a internet de la caja | **No limitarla por defecto: verla toda y bloquear lo sospechoso.** El dueño puede armar su lista de bloqueados o pasar a una lista de permitidos (`egress.mode`). Para que verla sirva, la caja no tiene salida propia ni DNS: sale solo por una puerta de zero (proxy propio en su contenedor, red interna del runtime). Un trabajo con salidas sospechosas no se integra solo (L3 falla, L0–L2 pregunta). Desde el chat solo se puede bloquear |

| 11 | Panel y acceso remoto | **Panel servido por el daemon solo en `127.0.0.1`**, HTML del servidor, sin framework. Clave en el llavero, que viaja en el fragmento del link y se canjea por una cookie. Acceso desde el celular con un **túnel rápido de Cloudflare, temporal y a pedido** (`zero panel remote on|off`). Elegido porque funciona sin estar frente a la PC: no requiere administrador ni cuenta. La red privada (Tailscale/Headscale) queda como alternativa más privada |

| 12 | Issues como entrada | **Revisión periódica (polling) de issues con una etiqueta**, no webhooks, porque la PC del dueño no tiene una dirección pública fija. Solo se toman issues **escritos y etiquetados** por personas con permiso de escritura, porque el texto de un desconocido podría editarse después de etiquetado. El issue recibe comentarios por estado, y el PR lo cierra |

La change OpenSpec `add-egress-gate` implementa:
- la puerta;
- los pases por ejecución;
- el registro de cada conexión en `state.db`;
- las reglas y el informe `zero egress`.
