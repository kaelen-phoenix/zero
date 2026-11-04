# Tasks

## 1. Implementación

- [x] 1.1 Agregar en `src/line/runner.ts` una función exportada `isTransientNetworkError(err)` que mire `code` y mensaje del error y de su cadena de `cause` (con profundidad acotada), con coincidencia por palabra completa de ECONNRESET, ETIMEDOUT, EAI_AGAIN, ECONNREFUSED y EPIPE.
- [x] 1.2 Hacer que `prepareWorkCopy` lance una clase propia (por ejemplo `SetupFailed extends Error`) cuando falla un comando de setup, con el mismo mensaje de hoy, y que esa clase nunca se considere corte de red.
- [x] 1.3 En el catch de `runJob`, después de la rama de `Interrupted`/`signal.aborted`: si es un corte de red y el contador kv `network-retry:<jobId>` está por debajo de 2, incrementarlo, loguear con `log.info` (trabajo, número de reintento, mensaje) y devolver `store.updateJob(jobId, { status: "queued" })`. Si no, seguir por el `fail` de hoy.
- [x] 1.4 Antes de volver a la cola, según `job.station`: subir `copy` fuera del `try` para que el catch lo alcance (puede no existir si falló `prepareWorkCopy`), descartar cambios sin commit y, si la estación es `build` con `attempt` > 0, restar 1 a `attempt`, como en la rama de cupo. Si esa limpieza lanza un error, terminar por el `fail` de hoy para que `runJob` nunca rechace ni deje el trabajo en `running`.
- [x] 1.5 En `src/line/integrate.ts`, envolver la llamada a `openPullRequest` del tracker: un error con `status` 422 y `already exists` en el mensaje devuelve `{ ok: false, reason }` en español, nombrando la rama y explicando que ya hay una solicitud de cambio; cualquier otro error se relanza sin cambios.
- [x] 1.6 Agregar una costura opcional para probar sin GitHub: `IntegrateOptions.pullRequests` y `RunnerDeps.pullRequests`, de tipo `(token, repository) => PullRequests`, con `createGitHubTracker` por defecto.
- [x] 1.7 Agregar a `test/runner.test.ts` las pruebas de los requisitos de corte, tope, error común, setup, detención e intento de build, con agentes falsos que lanzan ECONNRESET (un handler de `fakeAgents` que lanza se propaga).
- [x] 1.8 Agregar a `test/runner.test.ts` las pruebas del choque con solicitud de cambio: remoto con URL de GitHub y `git remote set-url --push origin <bare local>`, `vi.stubEnv("GH_TOKEN", ...)`, y `job.base` fijado en `main` antes de correr para que `startingBase` no salga a la red.
- [x] 1.9 Agregar la prueba de `createGitHubTracker` con `vi.stubGlobal("fetch", ...)` para el listado que encuentra una solicitud abierta.
- [x] 1.10 Actualizar en `AGENTS.md` la descripción de `src/line/` con el reintento por corte de red, su tope y la clave kv.
- [x] 1.11 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
