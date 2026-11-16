# Tasks

## 1. Etapa 1: Corridas canceladas por concurrencia

- [x] 1.1 Crear openspec/changes/zero-2547f9dc con proposal.md, tasks.md y un delta de production-line con los requisitos de esta etapa (más adelante cada etapa agrega los suyos).
- [x] 1.2 En src/line/automerge.ts: agregar `cancelled?: true` a Check y completarlo en `githubMerges.checks` cuando conclusion es 'cancelled'. En `mergeDecision`, los checks cancelados no van a `failed`. Si todos terminaron y solo quedan cancelados, devolver un decision nuevo `{kind: 'cancelled', runs}`.
- [x] 1.3 En `watch`: con `cancelled`, si el repositorio está libre (refreshing/firstChecksElsewhere), llamar `gh.rerun` para cada corrida, guardar `MergeState.cancelledReruns` ({head, count}, que sobrevive en `kept`) y retener el repositorio con `refreshing: {head, at, rerun: true}`. Si está ocupado, guardarlo waiting con 'espera su turno para relanzar corridas canceladas'. Después de MAX_CANCELLED_RERUNS (3) por tip, bloquearlo con 'las corridas se siguen cancelando (grupo de concurrencia)'. Nunca `recordOutage`, `sameFailures`, `fixChecks` ni comentar.
- [x] 1.4 Guardar `MergeState.queued` (nombres de checks sin terminar y sin `started`) en cada mirada. Antes de `gh.merge` en `watch`, si otro pull request vigilado del mismo repositorio (`elsewhere`) tiene `queued` no vacío, guardarlo waiting con `espera que arranquen los checks de <url>`.
- [x] 1.5 Tests en un test/automerge-cancelled.test.ts nuevo con MergeApi falso: solo canceladas, cancelada más fallida, dos pull requests en turno, límite por tip, espera por checks en cola de otro.

## 2. Etapa 2: Resolución mecánica de conflictos simples

- [x] 2.1 Crear src/line/conflicts.ts con `resolveDiff3(text): string | undefined` (pura). Parsea los bloques `<<<<<<<`/`|||||||`/`=======`/`>>>>>>>`. Si los lados son iguales, quedarse con uno. Si ambos lados solo tienen líneas de import de una línea (JS/TS `import ...`/`export ... from`, Python `import`/`from x import`), unir las líneas, primero las nuestras, cada una una sola vez. Si la base está vacía y los lados no comparten líneas, poner las nuestras y después las de ellos. Cualquier otro caso devuelve undefined.
- [x] 2.2 `resolveSimply(cwd, paths): boolean`: por archivo, `git checkout --conflict=diff3 -- <path>` (con spawnGit). Leerlo, resolverlo y, si todos los archivos se resuelven, escribirlos y hacer `git add`. Si un archivo es binario, falta una de las etapas o queda un bloque sin resolver, no se escribe nada y devuelve false.
- [x] 2.3 En runJob (src/line/runner.ts, rama `conflict` cerca de la línea 202): llamar `resolveSimply`. Si devuelve true, `copy.commit(mergeMessage...)`, guardar el refresh `resolved: true`, poner checkpoint spec y station verify, y abrir un span `zero.conflicts.simple`. Si no, seguir como hasta ahora.
- [x] 2.4 Tests: test/conflicts.test.ts para la función pura (imports, ambos agregan, se pisan, iguales) y un test del runner con repositorio git real donde una mezcla con imports en conflicto llega a verify sin llamar al agente build.

## 3. Etapa 3: Tren de integración de una línea

- [x] 3.1 Crear src/line/train.ts con `Train` ({line, repository, entries: {job, url, head?}[], startedAt, block?: {pull, what, who}}), `trainKey(line)`, `readTrain` y `trainOf(ctx, job)`.
- [x] 3.2 `startTrain(ctx, {line, numbers?})` en app.ts, con `zero tren <línea> [<número>...]` en src/cli.ts y salida en castellano. Por ahora toma solo pull requests entregados por la fábrica. Ordenar por finishedAt o en el orden dado. Antes de escribir, rechazar una línea desconocida, una línea que no es pull-request, una línea que ya tiene tren o un número que no corresponde a un trabajo entregado.
- [x] 3.3 `watchedJobs` incluye los trabajos de un tren aunque no tengan autoMerge. En `pollMerges`/`watch`, a quien no es cabeza guardarlo waiting con 'en el tren: espera a <url>', sin ninguna llamada que escriba en GitHub.
- [x] 3.4 Cuando la cabeza queda merged o closed, sacarla del tren. A la nueva cabeza, borrarle una vez resolutions, refreshes, resolving y conflict (marca `trainHead` en MergeState). Con el tren vacío, borrar la kv.
- [x] 3.5 Mostrar `Tren de <línea>: N pull requests; ahora <url> (<why>)` en formatStatus (src/format.ts, `trainLine`), en el resumen del panel y en el briefing.
- [x] 3.6 Tests en test/train.test.ts: solo la cabeza, avanza al fundirse, no funde en rojo, sin autoMerge, rechazos de startTrain.

## 4. Etapa 4: Pull requests ajenos en el tren y en zero fusionar

- [ ] 4.1 `startTrain`: cuando el número dado no corresponde a un trabajo entregado, adoptarlo con `adoptPullRequest` (mismas reglas) y guardar `entry.head` con el head al momento de adoptarlo. Cuando el trabajo adoptado empuja, actualizar `entry.head` con el tip local de su rama.
- [ ] 4.2 En `watch`, para una cabeza adoptada (source pull-request): si `pr.headSha !== entry.head`, no fundir y poner `train.block = {pull, what: 'alguien empujó a la rama después de que la fábrica la verificó', who: 'author'}`.
- [ ] 4.3 `deliveredPullRequest`/`mergePullRequest` (src/app.ts): para la URL de un pull request de un repositorio de una línea sin trabajo entregado, leer el pull request y sus checks, y fundirlo con su headSha solo cuando `mergeDecision` da `merge`. Abrir un span `zero.merge` sin jobId y no escribir ningún trabajo ni MergeState. Si el repositorio no es de ninguna línea, rechazarlo.
- [ ] 4.4 Tests en test/merge-request.test.ts y test/train.test.ts: ajeno verde, ajeno rojo, repositorio ajeno, adoptado al tren, head movido.

## 5. Etapa 5: Destrabe de día y acción train

- [ ] 5.1 src/config.ts: agregar `urgentAfterHours` a UnjamSchema (número >= 0, default 2).
- [ ] 5.2 automerge.ts: agregar `MergeState.blockedSince`. Se pone al pasar a blocked, se conserva mientras siga blocked y desaparece en cualquier otro estado.
- [ ] 5.3 src/line/unjam.ts: `urgentUnjamPass(ctx, runAgent, now, {running, signal, merges})`. Revisa unjam no off, andon, budgetState, pickEngine, running < concurrency, que no haya en cola un trabajo que no sea `lowPriority`, y por línea un pull request (en jams `pull-request`) con blockedSince de al menos urgentAfterHours. Respeta kv `unjam-urgent:<line>` y usa como tope el resto de usdPerNight del período. Llama `unjamLine`.
- [ ] 5.4 src/daemon.ts: correrlo como pasada de fondo en el intervalo de intake, fuera de `idlePasses`, una a la vez, esperada al salir y cortada al apagar (como runSchedules). Agregar `DaemonOptions.urgentUnjam` para los tests y que esté apagada en las corridas `once` salvo que se inyecte.
- [ ] 5.5 Agregar `train` a CAUSE_ACTIONS. En `unjamLine`, `trainCauses`: en build/auto llamar `startTrain` con los pull requests de las trabas (los ajenos no, porque las trabas son de la fábrica). En propose poner `todo` con 'zero tren <línea>'.
- [ ] 5.6 Actualizar agents/unjam.md (en inglés): corre también de día, sabe de la acción train, de las corridas canceladas por concurrencia que zero relanza sola y de los conflictos simples que zero resuelve sola.
- [ ] 5.7 Tests en test/unjam.test.ts: corre con trabajos, no corre con un pedido en cola, una vez por plazo, blockedSince, train en build y en propose.

## 6. Etapa 6: Qué falta y quién lo tiene que hacer

- [ ] 6.1 UnjamOutput y Cause: agregar `who` (enum owner, author, github, factory; nullable). `acceptCauses` lo conserva. Si action es none y falta `who`, usar `owner`.
- [ ] 6.2 Agregar `who` a JamView y a `jamViews`. En `jamLine` (src/format.ts), mostrar `qué falta: <todo> · lo tiene que hacer: vos | quien abrió el pull request | GitHub | la fábrica`. En `trainLine`, mostrar el block con lo mismo.
- [ ] 6.3 Panel (src/panel/html.ts) y briefing: que usen las mismas funciones, con esc.
- [ ] 6.4 Actualizar AGENTS.md (unjam, automerge, tren, conflicts.ts), README.md y README.es.md (`zero tren` con la misma estructura). Revisar que test/wording.test.ts y test/docs.test.ts pasen.
- [ ] 6.5 Tests: formatStatus, panel y briefing con causa `who` y con tren bloqueado. Correr npm run typecheck, npm test y npx openspec validate --all.
