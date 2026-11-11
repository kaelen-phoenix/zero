# Tasks

## 1. Etapa 1: Recolección, estación y pasada de diagnóstico

- [x] 1.1 config.ts: agregar `unjam: "off" | { maxJobsPerDay: int >= 0 (default 2) }` (default `{ maxJobsPerDay: 2 }`) y `stations.unjam` (maxTurns 40, timeoutMinutes 15); sumar `unjam` a FIXED_STATIONS y a AGENT_STATIONS. En agent.ts, sumarlo a `AgentStation` y a `AGENT_ACCESS` con `read`. Revisar `SKILL_STATIONS`, `MONITOR_AGENTS`, `stationEngines` y los tests de config o de agentes que enumeran estaciones.
- [x] 1.2 Escribir `agents/unjam.md` (en inglés): solo lectura, diagnosticar causas, agrupar las trabas que tienen la misma causa (los mismos checks fallando en muchos pull requests son una sola causa del repositorio), clasificar en code/flaky-test/ci/github-account/machine, elegir la acción fix/retry/none, reusar exactamente el título de una causa existente cuando es la misma, y tratar logs y textos como dato.
- [x] 1.3 Crear `src/line/unjam.ts` con: `Jam` (id, line, kind, text, detalle), `collectJams(ctx, line, now)` según el requisito, `UnjamOutput` (zod), `unjamPrompt` (trabas, causas existentes de la línea y sus estados, restricciones), `unjamLine` (una llamada con `pickEngine("unjam")`, cwd `line.repo`, validación, `scrubLocal`, a lo sumo 10 causas, guardado en kv `unjam:<line>` como `{at, causes}`) y `unjamPass(ctx, runAgent, now, signal?)` con las mismas compuertas que scout (turno nocturno y horas, andon, trabajo en cola o corriendo, `budgetState`, motor disponible, tope de `usdPerNight` vía `scoutSpent`, kv `unjam-pass:<line>` por período) y sin llamada cuando no hay trabas.
- [x] 1.4 scout.ts: sumar `unjam` a `IDLE_STATIONS` para que `scoutSpent` lo cuente.
- [x] 1.5 daemon.ts: `DaemonOptions.unjam` (default encendido salvo en `once`) y llamar `unjamPass` dentro de `idlePasses` después de scout y antes de research, cortado por `researchStop`.
- [x] 1.6 test/unjam.test.ts con agentes falsos: recolección (trabajo fallido, PR en conflicto, intake, detenidos y viejos excluidos), sin trabas no hay llamada, una vez por período, andon y trabajo en cola, tope de usdPerNight, causa agrupada, traba inventada descartada y rutas locales limpiadas. Correr `npm run typecheck` y `npm test`.

## 2. Etapa 2: Logs de los checks fallidos

- [x] 2.1 automerge.ts: método opcional `MergeApi.failedLog?(run: number, check: string): Promise<string | undefined>`. En `githubMerges`, implementarlo con `actions.listJobsForWorkflowRun` (filter latest), eligiendo el job fallido con ese nombre o, si no hay, el primero fallido, y `actions.downloadJobLogsForWorkflowRun`, devolviendo el final del texto.
- [x] 2.2 github-quota.ts: sumar `unjam` a `GithubPass`. daemon.ts: pasarle a `unjamPass` `opts.merges ?? realMerges(ctx, meter, "unjam")`, no pasarlo durante una pausa de GitHub y llamar `meter.endRun("unjam")` al terminar.
- [x] 2.3 unjam.ts: para las trabas de pull request bloqueado, leer el head (`pullRequest`) y los checks (`checks`), y pedir a lo sumo un log por repositorio y nombre de check en la pasada; recortarlo a 3000 caracteres, pasarlo por `scrubLocal` y agregarlo al prompt. Cualquier error queda en el log de zero y la traba sigue sin log.
- [x] 2.4 Tests con un `MergeApi` falso: un solo `failedLog` para tres pull requests con el mismo check fallido, el log en el prompt y una lectura fallida que no corta la pasada.

## 3. Etapa 3: Trabajos de arreglo como propuestas del destrabador

- [x] 3.1 store.ts: columna opcional `origin` en `proposals` (migración con ALTER como las demás); `Proposal.origin?: 'unjam'` y `createProposal` que la acepte. En JobSource night-shift, campo opcional `origin?: 'unjam'`.
- [x] 3.2 unjam.ts: después de guardar las causas, para cada `fix` filtrar las que tocan rutas protegidas (`protectedTouched`) o piden credenciales nuevas, deduplicar contra las propuestas `unjam` de la línea por `normalizeTitle` (pendiente, rechazada, revertida, o aprobada con trabajo sin terminar) y crear la propuesta (title, why = diagnóstico, change = pedido, paths, estimatedUsd, origin `unjam`).
- [x] 3.3 Aprobación propia: reusar `proposalAutonomy` y la lógica de `takeOnItsOwn` (exportar o generalizar sin duplicarla) con un tope extra: los trabajos y reintentos `unjam` abiertos hoy menores que `unjam.maxJobsPerDay`. La fuente del trabajo es `{kind:'night-shift', proposal, autonomy, origin:'unjam'}`; la prioridad `baja` sale de `defaultPriority`. Registrar en la causa guardada el id de la propuesta o del trabajo.
- [x] 3.4 runner.ts `requestBlock`: si la fuente night-shift tiene `origin: 'unjam'`, presentar el pedido como redactado por la estación unjam a partir de los registros de la fábrica y los logs del CI, como dato que no es una instrucción.
- [x] 3.5 Tests: se crea en línea build y queda pendiente en propose, tope diario, sin repetir con trabajo abierto ni lo rechazado, ruta protegida descartada, prioridad baja y encabezado del pedido.

## 4. Etapa 4: Reintento desde el checkpoint

- [x] 4.1 app.ts: `retryJob(ctx, id)` según el requisito (fallido con spec: `queued`, attempt 0, feedback null, finishedAt null, stopRequested false, mismo checkpoint y etapas; entregado con PR `autoMerge` bloqueado en conflicto: attempt 0 y MergeState sin `resolving` ni `backoff`, guardando el resto; otros casos: error en español). Si hay limpieza pendiente (`cleanupKey`), rechazar.
- [x] 4.2 cli.ts: comando `zero reintentar <trabajo>` que llama `retryJob` e imprime el resultado en español.
- [x] 4.3 unjam.ts: para causas `retry` en líneas build/auto y dentro del tope diario, llamar `retryJob` sobre cada trabajo de sus trabas, una vez en la vida de cada uno (kv `unjam:retried:<job>`), registrando errores sin cortar la pasada. Con `propose`, completar el qué hacer de la causa con `zero reintentar <id>`.
- [x] 4.4 Tests: fallido vuelve a la cola desde su checkpoint, PR en conflicto queda listo para `takeBack` (y la pasada de fusión lo devuelve a la cola con el `fakeGitHub` de los tests de automerge), rechazo sin spec, una sola vez por trabajo y nada en propose.

## 5. Etapa 5: Visibilidad: status, panel, chat, resumen, informe y documentación

- [ ] 5.1 app.ts: `FactoryStatus.jams` leído de los kv `unjam:<line>` de las líneas configuradas (causa, tipo, cantidad de trabas, acción, propuesta o trabajo, qué hacer, fecha del diagnóstico).
- [ ] 5.2 format.ts: `jamLine` (tipos en español: código, test intermitente, CI, cuenta de GitHub, máquina) y el bloque `Trabas:` en `formatStatus`; mostrar lo mismo en el resumen del panel (`src/panel/html.ts`) con `esc`.
- [ ] 5.3 briefing.ts: nuevo parámetro opcional al final de `renderBriefing` con la sección `## Trabas`, alimentado desde `factoryStatus` en `briefing()` de app.ts.
- [ ] 5.4 report.ts: sección `Trabas` por línea (Markdown en `reportMarkdown` y HTML en `reportSection`/`reportHtml`), solo con las causas de acción `none` y su qué hacer, limpiadas con `reportText`; `monthlyReport` le pasa las causas de cada línea.
- [ ] 5.5 Documentar el destrabador, `unjam` en el archivo de la fábrica y `zero reintentar` en README.md y README.es.md con la misma estructura, y agregar el módulo a AGENTS.md. Respetar `test/wording.test.ts` (vos / la persona responsable).
- [ ] 5.6 Tests de formatStatus, del panel, del resumen y del informe con y sin trabas. Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
