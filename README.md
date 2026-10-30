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
 │  spec ──▶ build ──▶ verify ──▶ review ──▶ security ──▶ integrate             │
 │  requisitos   código +   tests, tests     hallazgos con citas  merge / rama  │
 │  WHEN/THEN    tests      borrados,        verificadas          / PR (y       │
 │  (OpenSpec)              rutas protegidas                      fusión sola)  │
 │        ▲───────── reintentos con la retroalimentación concreta ─────────┘    │
 │  estado en SQLite · trazas y costos · townhall (memoria de la red)           │
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **Estaciones con contrato.** Cada estación recibe y entrega algo verificable. La especificación es un change de OpenSpec con requisitos y escenarios.
- **zero aplica las garantías, no el motor:**
  - las estaciones `spec`, `review` y `security` son de solo lectura (si un motor escribe, se descarta);
  - `security` es una segunda revisión, solo de seguridad, que puede usar otro motor;
  - hay un tiempo límite por estación;
  - las salidas estructuradas se validan;
  - se detectan tests borrados o desactivados;
  - las rutas protegidas no se tocan;
  - los hallazgos de las revisiones que citan archivos o líneas inexistentes se descartan.
- **Nunca pisa tu trabajo.** Cada pedido trabaja en su propia copia (`git worktree`) y su propia rama. Solo integra en tu rama si tu copia está limpia; si no, te consulta.
- **Agnóstico al motor.** Claude (Agent SDK), Codex, Antigravity o cualquier CLI declarado en la configuración, y uno distinto por estación si querés.

## Niveles de autonomía

| Nivel | Qué aprobás |
|---|---|
| L0 asistida | La especificación y la integración |
| L1 supervisada | Solo la especificación ("vas a obtener esto") |
| L2 vigilada | Nada en el día a día; consulta solo si se toca algo protegido o se agota el presupuesto pagado por uso |
| L3 a oscuras | Nada; las políticas son límites duros, y está el botón de parada |

Por defecto la fábrica se configura en **L3**. L3 exige la **caja de aislamiento** lista (ver abajo); mientras falte algo, **trabaja en L2 y dice exactamente qué falta**. Las consultas nunca bloquean la fábrica: el trabajo queda esperando, los demás siguen, y si nadie responde a tiempo se aplica la acción por defecto.

## Empezar

```sh
npm install && npm run build
node dist/cli.js init       # crea ~/.zero/zero.factory.yaml y agrega el repo actual como línea
node dist/cli.js install    # registra zero en Claude Code (y te muestra cómo hacerlo en Codex / OpenCode)
node dist/cli.js box setup  # prepara la caja de aislamiento (pide permiso antes de instalar nada)
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

Las herramientas del chat son las mismas: `zero_request`, `zero_status`, `zero_answer`, `zero_stop`, `zero_resume`, `zero_briefing`, `zero_trace`, `zero_lines`, `zero_egress` y `zero_egress_block`.

## Issues de GitHub

Una línea puede tomar como pedidos los issues de su repositorio de GitHub que tengan una etiqueta:

```sh
zero issues on                 # en la línea (o --line <nombre>); crea la etiqueta "zero" si no existe   [--label otra]
zero issues off
```

Cargás un issue, le ponés la etiqueta `zero`, y la fábrica lo revisa cada minuto y lo convierte en un trabajo.
- **Comenta en el issue** cuando lo toma, cuando te necesita y cuando termina. El pull request incluye `Closes #N`, así que al aceptarlo se cierra el issue.
- **Solo toma issues escritos y etiquetados por personas con permiso de escritura.** En un repositorio público cualquiera puede abrir un issue, y su texto se convierte en instrucciones para los agentes.
- **Para pedirlo de nuevo** cuando el trabajo terminó, sacale y volvele a poner la etiqueta.
- **Podés seguir la conversación en el issue.** Cuando el trabajo terminó o te está esperando, la fábrica lee tus comentarios nuevos y te responde: contesta preguntas ("no lo veo publicado"), toma un pedido de ajuste como trabajo nuevo sobre el mismo issue, o aprueba o rechaza la consulta pendiente. Lo decide la estación `reply`, de solo lectura y sin acceso al repositorio, con los hechos que calcula zero (por ejemplo, si el cambio ya está en GitHub). Solo lee comentarios de personas con permiso de escritura.

En las líneas que entregan por `pull-request`, cada trabajo arranca desde la rama base de GitHub. Así incluye lo que aceptaste allá, sin mover tu rama local.

### Fusión automática

Con `autoMerge: true` en una línea `pull-request`, la fábrica también funde sus pull requests. Los revisa cada minuto y funde cada uno cuando todos sus checks de GitHub terminaron bien y no tiene conflictos; después borra la rama y avisa en el issue. Si un check falla o hay conflictos, lo deja abierto y lo avisa una vez en el pull request; si se arregla, lo funde en la revisión siguiente. `zero status` y el panel muestran los que esperan.

## Panel en el navegador

Con la fábrica en marcha, el panel muestra:
- el estado de la fábrica;
- los trabajos;
- las preguntas, con botones para aprobar o rechazar;
- la traza de cada trabajo;
- las salidas a internet y el informe.

Desde el panel también se pide un trabajo, se tira del andon y se bloquean o permiten sitios. Está pensado para el celular.

```sh
zero panel                     # el link del panel, con tu clave (enciende la fábrica si hace falta)
zero panel remote on           # acceso desde afuera (celular) con un túnel temporal de Cloudflare
zero panel remote off          # lo cierra
zero panel rotate              # clave nueva: los links anteriores dejan de servir
```

- El panel escucha solo en tu PC (`127.0.0.1:4848`).
- La clave viaja en el link después de `#`, así que el navegador no la envía en la dirección. Se canjea por una cookie de sesión.
- La clave vive en el llavero del sistema.
- El acceso remoto usa `cloudflared` (Apache-2.0). zero lo descarga con tu permiso de sus releases oficiales y, en Windows, verifica la firma de Cloudflare.
- Mientras el túnel esté abierto, Cloudflare transporta el tráfico del panel. Cerralo cuando no lo uses.

## La fábrica (`~/.zero/zero.factory.yaml`)

```yaml
level: L3                 # L0 · L1 · L2 · L3
isolation: container      # caja de aislamiento (worktree = copias locales, sin caja)
box: { runtime: auto, cpus: 2, memoryGb: 4, pids: 512 }   # auto = Podman, luego Docker
panel: { port: 4848 }     # 0 = sin panel
egress:                   # salidas a internet de la caja (todas pasan por la puerta de zero)
  mode: blocklist         # blocklist: sale todo salvo lo sospechoso y lo bloqueado · allowlist: solo lo permitido
  allow: []               # p. ej. nas.local, registry.local:8443 (un sitio incluye sus subdominios)
  block: []
engine: claude            # motor por defecto: claude · codex · antigravity · o uno propio
concurrency: 2            # trabajos a la vez (cada línea hace uno a la vez)
limits:                   # con una suscripción (claude.ai) el límite es el cupo real del plan: 5 horas y semana
  reservePercent: 0       # parte de cada cupo que la fábrica te deja libre (0 = usa todo el plan)
  usdPerDay: 10           # solo si se paga por uso (clave de API) · 0 = solo motores gratuitos
  usdPerJob: 3            # solo si se paga por uso
  protectedPaths: [".github/**", ".env", ".env.*", "**/*.pem", "**/*.key"]
approvals: { timeoutHours: 24, onTimeout: reject }
stations:                 # motor, modelo y tiempo límite por estación (opcional)
  review: { engine: codex, timeoutMinutes: 15 }
  security: { engine: claude }   # la revisión de seguridad; con otro motor, la mirada es más independiente
  build: { skills: [pdf] }       # skills de tu Claude Code (personales o de plugins; `plugin:skill` si el nombre se repite)
engines:                  # cualquier otro CLI de agentes, sin código
  gemini: { command: ["gemini", "-p", "{prompt}"], writeArgs: ["--yolo"], modelArgs: ["-m", "{model}"] }
lines:
  - name: tienda
    repo: /ruta/a/tienda
    baseBranch: main
    setup: ["npm ci"]     # se ejecuta en cada copia nueva
    verify: ["npm test"]  # todo debe pasar antes de la revisión
    integrate: merge      # merge · branch · pull-request (arranca desde la rama base del remoto)
    issues: { label: zero }   # opcional: toma como pedidos los issues de GitHub con esta etiqueta
    autoMerge: false          # con pull-request: la fábrica funde cuando todos los checks pasan
    stations:                 # opcional: skills que un agente suma solo en esta línea
      build: { skills: [nextjs, shadcn] }
```

Las skills se asignan también con `zero skill add <skill> --station <agente> [--line <línea>]`, `zero skill remove …` y `zero skill list` (el chat no las cambia). Con Claude se activan de forma nativa y el agente ve solo esas; con otros motores, zero agrega el texto del SKILL.md a sus instrucciones. Nunca cambian las herramientas de un agente: los de solo lectura leen la skill pero no ejecutan sus scripts, y en la caja se montan como solo lectura. Si una skill no está instalada, `zero status` lo avisa y el agente trabaja sin ella.

Los secretos **no** van en este archivo: si zero detecta algo con forma de credencial, se niega a cargarlo. Cada motor usa tu propia sesión o las variables de entorno.

El directorio de la fábrica (`ZERO_HOME`, por defecto `~/.zero`) contiene:
- la definición de la fábrica;
- `state.db`, con los trabajos y las trazas;
- `townhall/`, la memoria colectiva;
- `worktrees/` y `jobs/`, con las especificaciones renderizadas;
- `bin/`, con las herramientas que zero descarga con tu permiso (cloudflared);
- `gate/`, compartido con la puerta de salida: sus reglas, los pases de las cajas en curso y sus registros;
- `daemon.log`.

## Investigación

La estación `research` investiga en la web una vez por día, con la fábrica libre: skills nuevas para los agentes (de Claude Code y de otros motores), servidores MCP y tecnologías que sirvan a la línea o a la fábrica misma (motores, librerías, herramientas, prácticas). Sigue las reglas del turno nocturno: solo corre sin pedidos tuyos en cola o en curso, con el andon apagado y con presupuesto (respeta `limits.reservePercent`); si se paga por uso, comparte con `scout` el tope de `limits.usdPerNight`.

Investiga por línea, y solo las líneas que tienen una **skill de investigación** asignada a `research`; esa skill dice qué buscar. Una línea sin skill de investigación no investiga.

```yaml
research:                 # o `research: off` para apagarla
  topics: ["motores de agentes locales"]   # opcional: temas de interés para todas las líneas
  perLinePerDay: 1        # notas por línea por día (0 = apagada); si no alcanza, las líneas se turnan
  autonomy: propose       # las propuestas nacidas de una nota esperan tu ok
stations:
  research: { timeoutMinutes: 15 }
lines:
  - name: tienda
    repo: /ruta/a/tienda
    stations:
      research: { skills: [tienda-research] }
```

```sh
zero skill add tienda-research --station research --line tienda
```

La skill es una skill normal de tu Claude Code, por ejemplo `~/.claude/skills/tienda-research/SKILL.md`:

```markdown
---
name: tienda-research
description: Qué investiga la línea tienda
---
# Investigación de la línea tienda

Buscá, en este orden:
- Skills y servidores MCP que ayuden a las estaciones build y review con Next.js y Stripe.
- Novedades de Next.js, Prisma y Playwright que cambien cómo se construye o se prueba la tienda.
- Prácticas de seguridad para pagos con tarjeta que la estación security debería revisar.

No investigues frameworks de frontend que no sean React.
```

Cada nota trae un tema, lo encontrado, las fuentes (enlaces http(s); una nota sin fuentes se descarta), para qué parte de la línea serviría y qué tan madura y confiable es. Se guarda en `state.db`, sin rutas de tu máquina ni secretos. Para no repetir temas, la estación recibe los temas de la línea de los últimos 60 días. La ves con `zero research [--line <línea>] [--days N]`, en el informe ("Investigación de hoy") y desde el chat (`zero_research`). Para convertir una nota en un trabajo de su línea: `zero research request <id>` (o `zero_research_request` en el chat). `scout` recibe las notas de su línea de los últimos 7 días y puede proponer, por ejemplo, asignar una skill a una estación o crear una estación nueva; las notas de una línea solo generan propuestas en esa misma línea.

Seguridad: lo que viene de la web es dato, nunca instrucciones, y así se lo dicen las instrucciones de `research` y de `scout`. La estación es de solo lectura: no instala, no clona y no ejecuta nada de lo que encuentra. Con Claude solo tiene las herramientas de lectura más `WebSearch` (la búsqueda corre del lado del proveedor; `WebFetch` está apagado); con otros motores trabaja como una estación de solo lectura. Todavía no pasa por la caja, así que sus búsquedas no aparecen en `zero egress`.

## Caja de aislamiento

En la caja corre todo lo que ejecuta código del proyecto o de un agente: el `setup`, los agentes y la verificación. La caja es un contenedor (Podman o Docker). La integración la hace zero afuera.

- **Copia propia.** La caja recibe un clon independiente del repositorio, sin enlaces al tuyo. No ve tu carpeta personal, tus otros proyectos ni tus claves.
- **Solo lectura de verdad.** `spec`, `review` y `security` reciben la copia montada en modo solo lectura.
- **Sin privilegios.** Corre como usuario sin privilegios, sin capacidades extra, con el sistema de archivos en solo lectura y con límites de CPU, memoria y procesos.
- **Credenciales mínimas.** Cada estación recibe solo la credencial de su motor, por nombre, nunca en la línea de comandos. Nunca recibe tokens de GitHub ni claves SSH.
- **Parada inmediata.** El andon y los tiempos límite detienen el contenedor.

```sh
zero box status                # qué falta
zero box setup                 # Windows: WSL2 + Podman · macOS: Podman · Linux: instrucciones; y la imagen
claude setup-token             # token de tu suscripción para trabajar en la caja
zero secret set CLAUDE_CODE_OAUTH_TOKEN    # lo guarda en el llavero del sistema (no se muestra)
zero secret list
```

Con la caja lista y las credenciales de los motores guardadas, la fábrica pasa a **L3 real**.

### Salidas a internet

La caja no tiene salida propia a internet ni DNS: sale solo por la **puerta** de zero, un proxy que corre en su propio contenedor. Así se ve **todo** lo que sale, también lo de un agente que intente ignorar al vigilante.

- **Por defecto no se limita nada salvo lo sospechoso** (`mode: blocklist`). La puerta bloquea sola, y explica por qué:
  - direcciones IP sin nombre;
  - tu red local y las direcciones internas, también cuando un nombre apunta a ellas;
  - puertos que no son 80 ni 443;
  - nombres tan largos que parecen llevar datos;
  - servicios típicos para sacar datos: pegar textos, compartir archivos, capturar peticiones, túneles, mensajería y DNS dinámico.
- **Cada conexión queda registrada**: sitio, trabajo, estación, bytes enviados y recibidos, y la decisión.
- **Un trabajo con salidas sospechosas no se integra solo.** En L3 falla y explica cómo permitir el sitio; en L0–L2 te pregunta.
- **Tus reglas**: bloquear o permitir sitios, o pasar a `allowlist` para que salga solo lo permitido. Los sitios de tus motores se permiten solos, así la fábrica no se queda sin modelo.

```sh
zero egress                    # qué salió hoy, cuánto y qué se bloqueó   [--days N]
zero egress <trabajo>          # las salidas de un trabajo (también en `zero trace`)
zero egress block <sitio>      # también desde el chat
zero egress allow <sitio>      # solo desde la terminal: un chat manipulado no puede abrir la puerta
zero egress remove <sitio>
zero egress mode allowlist     # o blocklist
```

Lo que la puerta no puede ver: el contenido cifrado, y los datos que se envíen a un sitio permitido (por ejemplo, la API del modelo). Los bytes enviados quedan registrados para detectarlo después.

## Observabilidad

Cada trabajo deja una traza: trabajo → estación → intento → agente o comando. Cada elemento registra duración, estado, motor, modelo y costo, y el costo indica su origen (`reported` o `unknown`).

Las métricas (entregados, fallidos, tasa de éxito, costo por entrega, espera humana, desglose por motor, conexiones y bloqueos de la caja) se calculan con una única definición, que usan por igual la terminal, el chat y el informe. Los nombres de los spans siguen las convenciones GenAI de OpenTelemetry, para poder exportarlos por OTLP más adelante.

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

## Hacia dónde va: la intención es el producto

Todo orquestador de IA parte del mismo supuesto: el código es el producto y los agentes son obreros que lo tocan. zero apunta a dar vuelta eso. **El producto es la intención del dueño; el código es su consecuencia**, algo que la fábrica puede volver a producir cuando haga falta.

- **La verdad vive en las especificaciones.** `openspec/specs/` deja de ser documentación y pasa a ser la fuente: lo que el sistema tiene que hacer, escrito como requisitos y escenarios. El dueño lee y edita intenciones, en su idioma, desde el chat, el panel o el celular; el código lo mantiene la fábrica.
- **Simulacro de regeneración.** Para demostrar que las especificaciones alcanzan, la fábrica toma un módulo, lo construye de nuevo desde cero solo a partir de su spec, en una copia aparte, y corre los mismos tests. Si el resultado se comporta distinto, la spec estaba incompleta: la fábrica propone qué escenario falta. El código viejo nunca se pisa; el simulacro solo mide y propone. Es caro en tokens, así que corre a pedido o con poca frecuencia, nunca en cada trabajo.
- **Turno nocturno (en camino).** Cuando no hay trabajo y sobra presupuesto, la estación de solo lectura `scout` revisa el townhall, las trazas y las specs sin cubrir, y escribe propuestas de trabajo. El dueño se despierta con ellas en el informe y las aprueba o las rechaza; la fábrica aprende de los rechazos. Pasa de esperar pedidos a tener iniciativa, con la regla de siempre: nada sale hacia afuera sin el ok del dueño.
- **Lazo cerrado con el producto vivo.** Más adelante, los errores de producción, la analítica y los comentarios de los usuarios entran como pedidos que nadie tuvo que escribir: intención → cambio → despliegue → observación → nueva intención.

## Próximas etapas

Skills asignables por agente y por línea · simulacro de regeneración · entradas desde Linear y Jira · instalador · red privada para el panel (Tailscale/Headscale) · cortar envíos grandes a sitios no habituales · servicio del sistema · API de plugins y especialistas · motores ACP/OpenCode · ccusage · exportación OTLP · MCP gobernado para los agentes de las estaciones.
