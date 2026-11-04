# Proposal

## Why

Una línea podrá correr varios trabajos a la vez cuando no se pisan. Con la opción `parallel` elegís cuántos como máximo; por defecto sigue siendo 1, como hoy, y el límite global `concurrency` se sigue respetando. Cada trabajo declara qué archivos o carpetas espera tocar. La fábrica no construye al mismo tiempo dos trabajos de una línea que se solapen, y un trabajo que no declaró nada corre solo. Al final, la traza muestra lo que el trabajo cambió de verdad frente a lo declarado. Antes de integrar, el trabajo se actualiza con la rama base más reciente y, si eso cambió algo, vuelve a pasar la verificación. Si hay conflicto, no queda trabado: se resuelve como un intento más, dentro de `maxAttempts`. En las líneas con `autoMerge`, un pull request de la fábrica que quede con conflictos se actualiza y se resuelve solo con el mismo mecanismo. Los trabajos del turno nocturno siguen como hoy: de a uno y solo con la fábrica libre.

Pedido original: "Trabajos en paralelo dentro de una misma línea, sin choques al integrar. Hoy el daemon corre como máximo un trabajo por línea (daemon.ts: `busy = running... r.line === job.line`), aunque cada trabajo ya tiene su propia copia de trabajo. Quiero que una línea pueda correr varios a la vez cuando no se pisan: - Opción por línea `parallel` (máximo de trabajos a la vez en esa línea; por defecto 1, como hoy). El límite global `concurrency` se sigue respetando. - La estación spec declara en su salida los archivos o carpetas que el trabajo espera tocar (patrones). El daemon no arranca un trabajo de una línea mientras haya otro en curso de esa línea cuyos patrones se solapen; si un trabajo no declaró nada, corre solo (como hoy). Lo que el trabajo realmente cambió se compara al final contra lo declarado y queda en la traza. - Antes de integrar (merge y pull-request), el trabajo se actualiza con la rama base más reciente; si eso cambió algo, vuelve a pasar la verificación. Si hay conflicto, en vez de quedar trabado se resuelve como un intento más (con el conflicto como contexto para build), dentro de maxAttempts. - Para las líneas pull-request con autoMerge: si un PR de la fábrica queda con conflictos con la base (como pasó con #32 y #57), la fábrica lo actualiza y resuelve sola con el mismo mecanismo, en vez de solo reportar "NO SE FUNDE: tiene conflictos". - Los trabajos del turno nocturno siguen como hoy (de a uno y solo con la fábrica libre). - Empieza como un change de OpenSpec; tests con git real en repos temporales (dos trabajos que no se solapan corren juntos, dos que se solapan no, conflicto al integrar resuelto en un intento); documentarlo en README.md y README.es.md."

## What Changes

- Trabajos en paralelo dentro de una línea, sin choques al integrar
- Supuesto: Assumption: a queued job has no declared paths until spec has run, so on lines with `parallel` above 1 the spec station runs before the overlap decision and the job then returns to the queue. Spec only reads, but it does count against `parallel` and `concurrency`.
- Supuesto: Assumption: 'en curso' means jobs running at that moment. Jobs parked waiting for the owner do not block others, because the line must never block on the owner; if they end up colliding, the update before integrating resolves it.
- Supuesto: Assumption: the update merges the base into the job's branch instead of rebasing, so history is never rewritten and pull requests never need a force-push.
- Supuesto: Assumption: after a clean update only verification runs again, as the owner asked, not review or security. Those do run again after a conflict attempt, because the code changed.
- Supuesto: Assumption: going back to build clears `approvals.integrate`, so an owner's approval never covers code they did not see. On L1 lines and on `build`-autonomy night-shift jobs, a resolved conflict asks again.
- Supuesto: Assumption: requeuing a delivered job reopens the same job (status `queued`, `finishedAt` cleared). It will be finalized a second time: the townhall gets a second run report, OTLP exports its spans again when it finishes again, and if it fails it ends `failed` even though it was delivered earlier.
- Supuesto: Assumption: the factory only resolves a pull request whose head matches the local branch tip, so it never overwrites something a person pushed; in that case it just reports as it does today.
- Supuesto: Declared paths are the spec agent's guess. Two jobs that touch the same file without declaring it still run together, and the safety net is the update before integrating plus the trace comparison.
- Supuesto: The line's `setup` does not run again after an update. If the base adds a dependency, verification may fail and use up an attempt until the build installs it.
- Supuesto: The update and the conflict merge run git on the host inside the job's work copy, including box clones. This is the same exposure `commitAll` already has there; the change widens it to `git merge`, which can run merge drivers configured in that copy's `.git/config`.
- Supuesto: This is a large change for one run (about a dozen files). If budget runs short, the auto-merge part is the most separable.

## Capabilities

### New Capabilities
- `parallel-jobs`: Trabajos en paralelo dentro de una línea, sin choques al integrar

### Modified Capabilities

## Impact

Generado por zero para el trabajo 99b82c4d.
