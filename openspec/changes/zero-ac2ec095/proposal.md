# Proposal

## Why

Hoy `zero simulacro` le da 20 minutos a cada comando de verify, aunque los trabajos normales de esa línea ya usan un límite más largo: el de `verifyTimeoutMinutes` o el aprendido de lo que tardaron las corridas aprobadas. Si la suite tarda más de 20 minutos, el simulacro la corta y dice «las especificaciones no alcanzan». Esa conclusión es falsa, y además ya se pagó la llamada al agente. Con este cambio: - Los comandos de verify del simulacro usan el mismo límite que un trabajo de esa línea. Los de setup siguen con 20 minutos. - El informe dice a cuántos minutos se cortó cada comando y que ese límite se cambia con `verifyTimeoutMinutes` de la línea. - Hay un resultado nuevo, «sin medir». Sale cuando todo lo demás salió bien y lo único que falló fueron comandos de verify cortados por tiempo. Así no se culpa a las especificaciones. - «inválido» sigue teniendo prioridad, y un test que falla de verdad sigue dando «no alcanzan».

## What Changes

- Simulacro de regeneración: límite de verify aprendido y resultado «sin medir» cuando se corta por tiempo
- Supuesto: Assumption: `sin medir` also requires at least one failed verify command that timed out. A run where every command passed is still `alcanzan`, and a run where no verify command ran (setup failed) is still `no alcanzan`.
- Supuesto: Assumption: when `sh` kills a command for its time limit, it resolves with `code ?? 1`, so a timed-out command has a non-zero code and `timedOut: true`. The rule looks at `timedOut`, not at the code.
- Supuesto: Old `resultado.json` files have no `timeoutMs` in their commands. Nothing reads them back today, so the new field can be required in the type.
- Supuesto: The learned limit can reach 4 hours per command, so a drill can take much longer than before. That is intended: it matches what a job of the line does.
- Supuesto: `test/docs.test.ts` requires the two READMEs to have the same structure. The edits to their drill bullets must match.
- Supuesto: The drill's verify commands do not go through `localCommands` or record `zero.verify.command` spans. That is outside this change, so drills neither feed nor compete with the learned history.

## Capabilities

### New Capabilities
- `regeneration-drill`: Simulacro de regeneración: límite de verify aprendido y resultado «sin medir» cuando se corta por tiempo

### Modified Capabilities

## Impact

Generado por zero para el trabajo ac2ec095.
