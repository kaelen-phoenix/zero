# zero

**Kaelen Global Defence**: *Autonomous agent network. Continuous execution. Zero human intervention required.*

zero es una **fábrica de software que corre en tu máquina**. Le pedís trabajo desde el chat de tu cliente de IA (Claude Code, Codex, agy…) o desde la terminal. La fábrica lo especifica, lo construye, lo verifica, lo revisa y lo integra sola, en segundo plano, aunque cierres el chat.

Es open source (Apache-2.0) y gratuito. Cada uno tiene su propia fábrica: nadie se conecta a la tuya.

## Cómo funciona

```
 vos, en el chat o la terminal: "quiero aplicar descuentos a los precios"
                    │
                    ▼  (zero_request / zero request)
 ┌──────────────── zero daemon (tu máquina) ───────────────────────────────────┐
 │  spec ──▶ build ──▶ verify ──▶ review ──▶ integrate                          │
 │  requisitos   código +   tests, tests     hallazgos con   merge / rama / PR  │
 │  WHEN/THEN    tests      borrados,        citas verificadas                  │
 │  (OpenSpec)              rutas protegidas                                    │
 │        ▲───────── reintentos con la retroalimentación concreta ─────────┘    │
 │  estado en SQLite · trazas y costos · townhall (memoria de la red)           │
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **Estaciones con contrato.** Cada estación recibe y entrega algo verificable. La especificación es un change de OpenSpec con requisitos y escenarios.
- **zero aplica las garantías, no el motor:**
  - las estaciones `spec` y `review` son de solo lectura (si un motor escribe, se descarta);
  - hay un tiempo límite por estación;
  - las salidas estructuradas se validan;
  - se detectan tests borrados o desactivados;
  - las rutas protegidas no se tocan;
  - los hallazgos de la revisión que citan archivos o líneas inexistentes se descartan.
- **Nunca pisa tu trabajo.** Cada pedido trabaja en su propia copia (`git worktree`) y su propia rama. Solo integra en tu rama si tu copia está limpia; si no, te consulta.
- **Agnóstico al motor.** Claude (Agent SDK), Codex, Antigravity o cualquier CLI declarado en la configuración, y uno distinto por estación si querés.

## Niveles de autonomía

| Nivel | Qué aprobás |
|---|---|
| L0 asistida | La especificación y la integración |
| L1 supervisada | Solo la especificación ("vas a obtener esto") |
| L2 vigilada | Nada en el día a día; consulta solo si se toca algo protegido o se agota el presupuesto |
| L3 a oscuras | Nada; las políticas son límites duros, y está el botón de parada |

Por defecto la fábrica se configura en **L3**. L3 exige la **caja de aislamiento**, que todavía no está disponible: mientras tanto **trabaja en L2 y lo informa** en su estado. Las consultas nunca bloquean la fábrica: el trabajo queda esperando, los demás siguen, y si nadie responde a tiempo se aplica la acción por defecto.

## Empezar

```sh
npm install && npm run build
node dist/cli.js init       # crea ~/.zero/zero.factory.yaml y agrega el repo actual como línea
node dist/cli.js install    # registra zero en Claude Code (y te muestra cómo hacerlo en Codex / OpenCode)
```

Después, en tu chat: *"zero, quiero que mi tienda calcule descuentos"*. O desde la terminal:

```sh
zero request "quiero que mi tienda calcule descuentos"   # la fábrica se enciende sola si estaba apagada
zero status                    # cómo va todo
zero status <trabajo>          # detalle, y la pregunta si te está esperando
zero approve <trabajo>         # aprobar (o --reject --note "por qué")
zero trace <trabajo>           # paso a paso: estaciones, intentos, agentes, comandos, costo
zero briefing                  # informe: producción, costo, aprendizajes, lo que te necesita
zero stop [trabajo]            # andon: para un trabajo o toda la fábrica · zero resume
zero line add <ruta>           # agregar otro proyecto
zero start [--detach] · zero shutdown
```

Las herramientas del chat son las mismas: `zero_request`, `zero_status`, `zero_answer`, `zero_stop`, `zero_resume`, `zero_briefing`, `zero_trace` y `zero_lines`.

## La fábrica (`~/.zero/zero.factory.yaml`)

```yaml
level: L3                 # L0 · L1 · L2 · L3
isolation: worktree       # container (caja) llegará en una próxima versión
engine: claude            # motor por defecto: claude · codex · antigravity · o uno propio
concurrency: 2            # trabajos a la vez (cada línea hace uno a la vez)
limits:
  usdPerDay: 10           # 0 = solo motores gratuitos
  usdPerJob: 3
  protectedPaths: [".github/**", ".env", ".env.*", "**/*.pem", "**/*.key"]
approvals: { timeoutHours: 24, onTimeout: reject }
stations:                 # motor, modelo y tiempo límite por estación (opcional)
  review: { engine: codex, timeoutMinutes: 15 }
engines:                  # cualquier otro CLI de agentes, sin código
  gemini: { command: ["gemini", "-p", "{prompt}"], writeArgs: ["--yolo"], modelArgs: ["-m", "{model}"] }
lines:
  - name: tienda
    repo: /ruta/a/tienda
    baseBranch: main
    setup: ["npm ci"]     # se ejecuta en cada copia nueva
    verify: ["npm test"]  # todo debe pasar antes de la revisión
    integrate: merge      # merge · branch · pull-request
```

Los secretos **no** van en este archivo: si zero detecta algo con forma de credencial, se niega a cargarlo. Cada motor usa tu propia sesión o las variables de entorno.

El directorio de la fábrica (`ZERO_HOME`, por defecto `~/.zero`) contiene:
- la definición de la fábrica;
- `state.db`, con los trabajos y las trazas;
- `townhall/`, la memoria colectiva;
- `worktrees/` y `jobs/`, con las especificaciones renderizadas;
- `daemon.log`.

## Observabilidad

Cada trabajo deja una traza: trabajo → estación → intento → agente o comando. Cada elemento registra duración, estado, motor, modelo y costo, y el costo indica su origen (`reported` o `unknown`).

Las métricas (entregados, fallidos, tasa de éxito, costo por entrega, espera humana, desglose por motor) se calculan con una única definición, que usan por igual la terminal, el chat y el informe. Los nombres de los spans siguen las convenciones GenAI de OpenTelemetry, para poder exportarlos por OTLP más adelante.

## Townhall

Es la memoria colectiva de la fábrica. Cada trabajo publica:
- su resultado;
- los hallazgos (`spec`) y las lecciones (`review`), siempre con su fuente;
- las propuestas de trabajo nuevo;
- los bloqueos.

Las estaciones `spec` y `build` reciben las notas recientes de **su misma línea**. Las notas se guardan con los secretos borrados y sin duplicados. Si el townhall falla, la producción sigue igual.

## Desarrollo

```sh
npm run typecheck && npm test && npm run build
```

zero se diseña con **OpenSpec** (`openspec/`): cada cambio es una propuesta con especificación, diseño y tareas. Las decisiones están en `docs/adr/` y las convenciones para agentes en `AGENTS.md`.

## Próximas etapas

Caja de aislamiento (L3 real) · panel en el navegador e instalador · servicio del sistema · API de plugins y especialistas · motores ACP/OpenCode · ccusage · exportación OTLP · entrada desde GitHub/Linear/Jira · MCP gobernado para los agentes de las estaciones.
