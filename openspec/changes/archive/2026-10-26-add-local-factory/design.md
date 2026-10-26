# Design

## Context

Ver proposal.md. Se parte del código actual: motores (`src/engines/`), ejecutor de agentes agnóstico con salida estructurada validada (`src/agent.ts`), townhall y un pipeline atado a GitHub Issues y Actions. Restricciones: Node 22, TypeScript ESM, dependencias OSI, sin servidores externos, Windows/macOS/Linux, un solo dueño por fábrica.

## Goals / Non-Goals

**Goals:**
- Una fábrica que funcione de punta a punta en la máquina del dueño: pedido desde el chat → trabajo en segundo plano → integración.
- Que todo estado sobreviva a reinicios y que todo paso quede trazado.
- Mantener intacta la capa de motores; la línea solo depende de `AgentRunner`.

**Non-Goals:**
- Caja de aislamiento, panel web, servicio del sistema, plugins, especialistas, OTLP: changes posteriores (ver proposal, fuera de alcance).
- Escalar a varias máquinas: la fábrica es local y de un solo dueño.

## Decisions

### Directorio de la fábrica
`ZERO_HOME` (por defecto `~/.zero`) contiene `zero.factory.yaml`, `state.db`, `townhall/`, `worktrees/<línea>/<trabajo>/`, `jobs/<trabajo>/` (especificación renderizada) y `daemon.log`. Alternativa descartada: config por repo (`zero.config.json`), porque una fábrica atiende varias líneas y el dueño no siempre tiene un repo propio.

### Estado en `node:sqlite`
Tablas: `jobs` (estado, estación, checkpoint, especificación, costo, consulta pendiente), `spans` (traza) y `kv` (señal de vida, andon). Modo WAL para que daemon, CLI y servidor MCP compartan el archivo. Alternativas: `better-sqlite3` (compilación nativa, fricción en Windows) y archivos JSON (sin transacciones). `node:sqlite` es experimental en Node 22; se aísla detrás de `src/state/` para poder cambiarlo.

### Máquina de estados con checkpoint
El trabajo guarda la última estación completada (`checkpoint`). El ejecutor de la línea reanuda desde ahí: tras aprobar la especificación o tras un reinicio no repite trabajo. `build`, `verify` y `review` forman un bucle de intentos; un reinicio en medio del bucle repite el intento en curso sobre la misma copia de trabajo.

### Copias de trabajo con `git worktree`
Cada trabajo usa `git worktree add -b zero/<id>` desde la rama base. Barato, no toca la copia del dueño y deja una rama auditable. Es aislamiento de archivos, no de proceso; por eso L3 baja a L2 hasta que exista la caja.

### Integración
- `merge`: si la rama base está abierta en otra copia, se exige que esa copia esté limpia y se hace `git merge --no-ff` allí; si no está abierta en ninguna, se usa una copia temporal. Conflicto o copia sucia → `git merge --abort` si aplica y el trabajo pasa a `waiting`.
- `branch`: no integra; informa la rama.
- `pull-request`: `git push` al remoto y solicitud de cambio en GitHub con el token del entorno (`GH_TOKEN` o `gh auth token`).

### Aprobaciones y política
Un único módulo decide, a partir del nivel efectivo y del evento (`spec-ready`, `before-integrate`, `protected-path`, `budget-exceeded`), si se continúa, se consulta o se falla. Las consultas guardan pregunta, opciones, vencimiento y acción por defecto; el daemon aplica los vencimientos.

### Andon y cancelación
`EngineRequest` gana `signal?: AbortSignal`. El daemon consulta `kv` cada pocos segundos; al detectar parada global o de un trabajo, aborta el controlador del trabajo. Los motores CLI matan el proceso; el motor Claude usa su `abortController`.

### Daemon
Un proceso Node con un bucle: aplica vencimientos, respeta andon y presupuesto diario, y lanza trabajos (uno por línea, máximo global). Señal de vida en `kv` cada 5 s con su PID; otro daemon con señal de menos de 15 s y PID vivo impide arrancar. Al iniciar devuelve a `queued` los trabajos `running`. El arranque automático lanza `node <cli> start` desacoplado con la salida a `daemon.log`.

### Interfaz de chat
`zero mcp` es un servidor MCP por stdio que lee y escribe directamente `state.db`: no abre puertos ni necesita un canal con el daemon. `zero install` usa `claude mcp add --scope user` cuando `claude` existe; para Codex y OpenCode imprime la configuración, porque su formato no se verificó en esta máquina.

### Observabilidad de cada estación
Modelo de spans compatible con las convenciones GenAI de OpenTelemetry, para exportarlo por OTLP en una change posterior:

| Elemento | Span | Atributos clave |
|---|---|---|
| Trabajo | `zero.job` | `zero.line`, `zero.level`, `zero.outcome` |
| Estación | `zero.station.<nombre>` | `zero.station` |
| Intento | `zero.attempt` | `zero.attempt` |
| Agente | `gen_ai.invoke_agent` | `gen_ai.agent.name`, `gen_ai.request.model`, `zero.engine`, `zero.cost.usd`, `zero.cost.source` |
| Comando de verificación | `zero.verify.command` | `process.command_line`, `process.exit.code` |

Las métricas se derivan de `jobs` y `spans` en `src/telemetry/metrics.ts`, la única definición que usan `zero status`, el informe y el MCP. Cada estación publica además en el townhall: `spec` (hallazgos, propuestas), `review` (lecciones) y el trabajo (resultado o bloqueo).

### Especificación en formato OpenSpec
La estación `spec` produce JSON validado con zod (requisitos con escenarios WHEN/THEN). zero lo renderiza como change OpenSpec (`proposal.md`, `specs/<capacidad>/spec.md`, `tasks.md`) en `jobs/<id>/` y, si el repo tiene `openspec/`, en `openspec/changes/zero-<id>/` de la copia de trabajo.

### Citas verificadas
Cada hallazgo de `review` trae `file` y `line`. zero comprueba que el archivo exista dentro de la copia de trabajo (sin salir de ella) y que la línea esté dentro del archivo. Los hallazgos inválidos se descartan y se cuentan en el span de la estación.

## Risks / Trade-offs

- [`node:sqlite` es experimental] → aislado en `src/state/`; los tests cubren el uso real.
- [Integrar en la copia del dueño mientras trabaja] → solo si está limpia; si no, consulta. El merge es equivalente a un `git pull` que el dueño haría.
- [Guardia de tests heurística] (borrados y marcas `skip`/`only`/`xit`/`@pytest.mark.skip`) → no detecta asserts debilitados; la detección fuerte de manipulación queda para una change posterior.
- [Sin caja de aislamiento] → la fábrica no permite L3 efectivo y lo dice; las rutas protegidas siguen activas.
- [Codex/OpenCode sin registro automático] → instrucciones impresas hasta verificar su formato de configuración.

## Migration Plan

- Se eliminan los workflows `zero.yml` y `townhall.yml` y los comandos `tick`/`run`. Quien use zero en Actions debe quedarse en la versión anterior hasta que exista un runtime de Actions sobre la nueva fábrica.
- `zero.config.json` deja de leerse; `zero init` crea la nueva definición. El repo de zero se registra como su propia línea.
