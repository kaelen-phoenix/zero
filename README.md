# zero

**Kaelen Global Defence** — *Autonomous agent network. Continuous execution. Zero human intervention required.*

`zero` es el orquestador base de Kaelen: convierte issues de GitHub en pull requests revisados, sin intervención humana, usando una red de agentes que se ejecuta de forma continua en GitHub Actions.

**Agnóstico al motor:** zero define el proceso; los agentes son intercambiables. Claude Code, OpenAI Codex, Google Antigravity o cualquier CLI de agente headless, y cada rol puede usar uno distinto (p. ej. Codex implementa y Claude revisa).

## Cómo funciona

```
 issue [zero:ready]
        │
        ▼
   ┌─────────┐   plan (JSON)    ┌────────┐   commit   ┌─────────┐   diff   ┌──────────┐
   │ planner │ ───────────────▶ │ coder  │ ─────────▶ │ verify  │ ───────▶ │ reviewer │
   └─────────┘   read-only      └────────┘            └─────────┘          └──────────┘
        │ inviable                   ▲    fallo de tests  │       cambios pedidos │
        ▼                            └────────────────────┴───────────────────────┘
  [zero:failed]                         hasta maxAttempts intentos       │ aprobado
                                                                         ▼
                                                             PR abierto [zero:review]
```

| Rol | Acceso | Responsabilidad |
|---|---|---|
| **planner** | solo lectura | Explora el repo, produce un plan estructurado o rechaza la tarea si es ambigua/insegura |
| **coder** | lectura, edición, bash | Implementa el plan, añade tests, aplica el feedback del intento anterior |
| **reviewer** | solo lectura | Última puerta: aprueba o devuelve problemas concretos |

Las garantías importantes las aplica zero, no el motor, así que valen igual para cualquier proveedor:

- **Puerta de verify:** entre coder y reviewer, zero ejecuta los comandos `verify` de `zero.config.json`; un cambio que no pasa tests nunca llega a revisión.
- **Solo lectura real:** si un planner/reviewer modifica el workspace (porque su motor no sabe sandboxearlo), zero descarta los cambios.
- **Salida estructurada validada:** plan y review se definen con zod; se pasa JSON Schema a los motores que lo soportan y, al resto, se les pide JSON y se valida igual.
- **Timeout duro** por rol; ninguna ejecución queda colgada esperando a un humano.

### Estados (labels)

`zero:ready` → `zero:working` → `zero:review` (PR abierto) o `zero:failed` (con comentario explicando por qué).

## Townhall

El espacio común de la red, con dos capas:

**Foro de agentes (memoria colectiva).** Cada ejecución publica *posts* estructurados en una rama huérfana del repo, `zero-townhall` (JSONL por mes: gratis, versionado y auditable, sin servidores):

| Tipo | Quién lo publica | Para qué |
|---|---|---|
| `run` | zero | Resultado, intentos, duración, coste y motores de cada tarea |
| `finding` | planner | Hechos del codebase que las siguientes ejecuciones deben saber |
| `lesson` | reviewer | Errores recurrentes y convenciones a aplicar |
| `proposal` | planner | Trabajo descubierto fuera de alcance |
| `blocker` | zero | Lo que la red no pudo resolver y requiere a un humano |

Antes de trabajar, planner y coder reciben los últimos `finding`, `lesson` y `blocker`: la red no repite errores ni redescubre lo que ya sabe.

**Informe a la sala de control.** El workflow `townhall` (diario, 07:00 UTC) sintetiza el foro en un issue con label `zero:townhall`: producción, tasa de éxito, coste por entrega, comparativa por motor, **lo que necesita a un humano** (blockers y propuestas) y lo que la red aprendió. Es determinista: no gasta tokens. También se puede lanzar a mano con `zero briefing`.

Configuración en `zero.config.json` → `townhall`: `store` (`github` | `local` | `off`), `branch`, `recallLimit`, `briefing.sink` (`issue` | `stdout`), `briefing.days`.

## Puesta en marcha

1. **Secrets** del repo (Settings → Secrets → Actions):
   - La clave del motor que uses: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTIGRAVITY_API_KEY`, `GEMINI_API_KEY`…
   - `ZERO_GH_TOKEN` — recomendado: PAT o token de GitHub App con `contents`, `issues`, `pull-requests`. Sin él se usa `GITHUB_TOKEN`, y los PRs que abra zero no dispararán CI.
2. **Labels**:
   ```sh
   gh label create zero:ready   --color 1f883d --description "Lista para la red de agentes"
   gh label create zero:working --color bf8700 --description "Un agente está trabajando"
   gh label create zero:review  --color 0969da --description "PR abierto, pendiente de merge"
   gh label create zero:failed  --color cf222e --description "zero no pudo completarla"
   ```
3. Crea un issue con una tarea concreta y ponle `zero:ready`. El workflow `zero` arranca al instante (y además cada 30 min como latido).

Ejecución local:

```sh
npm install
export ANTHROPIC_API_KEY=... GH_TOKEN=$(gh auth token) GITHUB_REPOSITORY=kaelen-phoenix/zero
npm run dev -- run 12     # un issue concreto
npm run dev -- tick       # el siguiente zero:ready
npm run dev -- briefing   # informe del townhall
```

## Motores

| Motor | Cómo se invoca | Clave | Solo lectura | Esquema nativo |
|---|---|---|---|---|
| `claude` (defecto) | Claude Agent SDK (incluido) | `ANTHROPIC_API_KEY` | allowlist de herramientas | sí |
| `codex` | `codex exec` | `OPENAI_API_KEY` | `--sandbox read-only` | sí (`--output-schema`) |
| `antigravity` | `agy -p` (experimental) | `ANTIGRAVITY_API_KEY` | guardia de zero | no (JSON del texto) |
| *personalizado* | cualquier CLI declarado en config | la suya | guardia de zero | no |

Cualquier otro agente (Gemini CLI, opencode, aider, Cursor CLI…) se añade sin código, en `zero.config.json`:

```json
{
  "engine": "claude",
  "engines": {
    "gemini": {
      "command": ["gemini", "-p", "{prompt}", "--output-format", "json"],
      "writeArgs": ["--yolo"],
      "modelArgs": ["-m", "{model}"]
    }
  },
  "roles": {
    "coder":    { "engine": "codex", "timeoutMinutes": 60 },
    "reviewer": { "engine": "gemini", "model": "gemini-3-pro", "timeoutMinutes": 15 }
  }
}
```

`{prompt}` y `{model}` se sustituyen; si el comando no contiene `{prompt}`, el prompt se envía por stdin. `readArgs`/`writeArgs` se añaden según el rol. Las instrucciones de cada rol (`agents/*.md`) son las mismas para todos los motores, y los agentes leen las convenciones del repo de `AGENTS.md`.

Para instalar el CLI de un motor en Actions, añádelo al paso *Install engine CLIs* de `.github/workflows/zero.yml` (`codex` ya está).

## Configuración (`zero.config.json`)

| Campo | Defecto | |
|---|---|---|
| `engine` | `claude` | Motor por defecto de todos los roles |
| `engines` | `{}` | Motores CLI personalizados (ver arriba) |
| `baseBranch` | `main` | Rama base de los PRs |
| `branchPrefix` | `zero/` | Prefijo de ramas de trabajo |
| `maxAttempts` | `3` | Rondas coder→verify→review antes de fallar |
| `verify` | `["npm run typecheck", "npm test"]` | Comandos que deben pasar |
| `roles.<rol>` | ver `src/config.ts` | `engine`, `model`, `timeoutMinutes`; `maxTurns` y `maxBudgetUsd` donde el motor lo soporte |

zero ejecuta `git checkout -B` y descarta cambios no confirmados en el directorio de trabajo: úsalo siempre en un clon dedicado (en Actions ya lo es).

## Desarrollo

```sh
npm run typecheck && npm test && npm run build
```

zero trabaja también sobre sí mismo: los issues de este repo con `zero:ready` mejoran el propio orquestador. Ver `AGENTS.md` para las convenciones que siguen los agentes.

## Próximos pasos

- Auto-merge de PRs aprobados cuando CI pasa (cierre del bucle sin humanos).
- Decomposición: planner que divide issues grandes en sub-issues `zero:ready`.
- Varios repos objetivo desde un único despliegue de zero.
- Telemetría de coste/éxito por tarea y por motor, para elegir el mejor motor por rol con datos.
