# zero

**Kaelen Global Defence** — *Autonomous agent network. Continuous execution. Zero human intervention required.*

`zero` es el orquestador base de Kaelen: convierte issues de GitHub en pull requests revisados, sin intervención humana, usando una red de agentes Claude (Claude Agent SDK) que se ejecuta de forma continua en GitHub Actions.

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

| Agente | Herramientas | Responsabilidad |
|---|---|---|
| **planner** | solo lectura | Explora el repo, produce un plan estructurado o rechaza la tarea si es ambigua/insegura |
| **coder** | lectura, edición, bash | Implementa el plan, añade tests, aplica el feedback del intento anterior |
| **reviewer** | solo lectura + `git diff` | Última puerta: aprueba o devuelve problemas concretos |

Entre coder y reviewer, el orquestador ejecuta los comandos `verify` de `zero.config.json`; un cambio que no pasa tests nunca llega a revisión. Todos los agentes corren con `permissionMode: "dontAsk"`: lo que no está en su allowlist se deniega, así que ninguna ejecución se queda esperando a un humano.

### Estados (labels)

`zero:ready` → `zero:working` → `zero:review` (PR abierto) o `zero:failed` (con comentario explicando por qué).

## Puesta en marcha

1. **Secrets** del repo (Settings → Secrets → Actions):
   - `ANTHROPIC_API_KEY` — obligatorio.
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
```

## Configuración (`zero.config.json`)

| Campo | Defecto | |
|---|---|---|
| `model` | `claude-opus-5-5` | Modelo por defecto de todos los roles |
| `baseBranch` | `main` | Rama base de los PRs |
| `branchPrefix` | `zero/` | Prefijo de ramas de trabajo |
| `maxAttempts` | `3` | Rondas coder→verify→review antes de fallar |
| `verify` | `["npm run typecheck", "npm test"]` | Comandos que deben pasar |
| `roles.<rol>` | ver `src/config.ts` | `model`, `maxTurns`, `maxBudgetUsd` por rol |

`maxBudgetUsd` limita el gasto de cada ejecución de agente; el coste estimado total de cada tarea aparece en el PR.

## Desarrollo

```sh
npm run typecheck && npm test && npm run build
```

zero trabaja también sobre sí mismo: los issues de este repo con `zero:ready` mejoran el propio orquestador. Ver `CLAUDE.md` para las convenciones que siguen los agentes.

## Próximos pasos

- Auto-merge de PRs aprobados cuando CI pasa (cierre del bucle sin humanos).
- Decomposición: planner que divide issues grandes en sub-issues `zero:ready`.
- Varios repos objetivo desde un único despliegue de zero.
- Telemetría de coste/éxito por tarea.
