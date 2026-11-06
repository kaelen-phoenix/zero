# Tasks

## 1. Implementación

- [x] 1.1 En `src/line/reverts.ts`, agregar `closedKey = (jobId) => `reverts:closed:${jobId}``, una constante de 24 horas y el reloj `(ctx.now ?? (() => new Date()))()`, igual que `src/line/automerge.ts:141`.
- [x] 1.2 Agregar una función que lea la fecha con su propio try/catch: un error de `getKv`, una clave ausente o un valor que `Date.parse` no entiende significan que hay que consultar. El error de lectura se registra con `log.warn`. La lectura no debe quedar dentro del try actual de `mergeCommit`, porque ahí un fallo del kv saltearía la consulta.
- [x] 1.3 En `mergeCommit`, después de `if (it.commit || !it.pr || !merges) return it`, devolver `it` sin llamar a `merges` ni a `pullRequest` si el reloj es anterior a la fecha guardada.
- [x] 1.4 Tras `gh.pullRequest`: si `!state.open && !state.merged`, guardar la fecha `now + 24h` en ISO; si `state.open`, o si está fundido con `mergeCommitSha`, borrar la clave. Un PR fundido sin sha no toca el kv. Registrar el commit con `recordMergeCommit` antes de borrar. Envolver cada escritura y cada borrado en su propio try/catch con `log.warn`, para que un fallo del kv no pierda el commit obtenido.
- [x] 1.5 Agregar tests en `test/night-shift-2d.test.ts`, en un `describe` nuevo, con una `MergeApi` falsa que cuente las llamadas a `pullRequest` por número y permita cambiar el estado entre pasadas (`fakeMerges` devuelve un estado fijo), usando `factory()`/`prLine()` y su `set` para mover el reloj y `vi.spyOn(ctx.store, ...)` para los fallos del kv. Cubrir todos los escenarios. Para el caso de dos PRs, crear el segundo trabajo con otra URL de PR, ya que `autonomousPullRequest` fija `/pull/7` y su rama.
- [x] 1.6 Actualizar la entrada de `src/line/reverts.ts` en `AGENTS.md` con la espera `reverts:closed:<job>`.
- [x] 1.7 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
