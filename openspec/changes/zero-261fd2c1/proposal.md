# Proposal

## Why

Vas a tener un comando nuevo: `zero simulacro <línea> <capacidad> --archivos <patrón>`. Mide si las especificaciones de una parte del proyecto alcanzan para reconstruirla. Cómo trabaja: - Arma una copia aparte dentro de ZERO_HOME, sin historial de git. El repositorio de la línea no se toca: ni ramas, ni worktrees, ni archivos. - En esa copia borra los archivos de código que indicaste. Los tests y las especificaciones quedan. - Le pide al agente de build que los vuelva a escribir leyendo solo `openspec/specs/<capacidad>/spec.md`, con un tope de gasto. Por defecto el tope es `limits.usdPerJob`; con `--usd` se puede bajar. - Corre los comandos de verificación de la línea sobre lo regenerado. Al final guarda un informe en `ZERO_HOME/drills/<id>/informe.md` y muestra la ruta. El resultado es uno de tres: - «alcanzan»: los tests pasan y se reconstruyó todo; - «no alcanzan»: falló algún comando o quedaron archivos sin reconstruir; - «inválido»: el agente tocó tests o especificaciones. El informe también dice qué archivos se reconstruyeron, cuánto costó, la salida de cada comando y qué le faltaba a la especificación según el agente. En esta primera versión el simulacro corre en tu máquina. En líneas configuradas para trabajar dentro de la caja de aislamiento (`isolation: container`) se niega con un aviso claro. Además, en la web el ítem pasa de «en camino» a «disponible», y el comando queda documentado en README.md y README.es.md.

## What Changes

- Simulacro de regeneración desde las especificaciones (zero simulacro)
- Supuesto: Assumption: the 'part of the project' is the set of files selected with `--archivos`, and only `openspec/specs/<capacidad>/spec.md` is named as the source. The rest of the code, `openspec/changes/`, AGENTS.md and the README stay in the copy and may give implementation hints. The drill measures spec plus surrounding context, not the spec in isolation.
- Supuesto: With `isolation: container`, which is the default, the drill refuses. This first version only runs on this machine, with `isolation: worktree`, so the agent's code and the tests never run outside the box when the person in charge asked for the box.
- Supuesto: The copy, including setup output such as node_modules, stays under `ZERO_HOME/drills/<id>` for inspection and can take up disk space. Nothing deletes it on its own.
- Supuesto: Calling `budgetState` and `pickEngine` from the CLI process uses the shared state.db. The agent span has no jobId, so this cost does not count toward a job, but it does count toward the day's spending if billing records it.
- Supuesto: 'alcanzan' only means the line's verify commands passed. A weak test suite can make specs look sufficient when they are not.

## Capabilities

### New Capabilities
- `regeneration-drill`: Simulacro de regeneración desde las especificaciones (zero simulacro)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 261fd2c1.
