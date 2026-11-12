# Spec Delta

## ADDED Requirements

### Requirement: Una carpeta bloqueada no hace fallar un trabajo en curso
When an error reaching runJob's final catch is a locked-file error (`isLockedFolderError`: `EBUSY` in the `code` or message of the error or of its causes, up to 5 levels, never a SetupFailed), runJob SHALL kill the processes left in the job's work copy (`killLeftovers` on the work-copy path, injectable through `RunnerDeps.killLeftovers`) and put the job back in the queue from its checkpoint, at most 2 times in the job's life, counted in kv `busy-retry:<job id>`; it MUST NOT finalize the job as failed while retries remain. As with a network cut, uncommitted changes are dropped and a build cut does not spend an attempt; a drop that throws is logged and does not stop the requeue.

#### Scenario: EBUSY al reanudar vuelve a la cola
- **WHEN** runJob runs a job whose work copy already exists (a resume) and a fake agent or shell throws an Error with message `EBUSY: resource busy or locked, rmdir '<path>'`
- **THEN** runJob returns the job with status `queued` and the same checkpoint, kv `busy-retry:<id>` is `1`, the injected killLeftovers was called with the job's work-copy path, and the stored reason does not contain `Error inesperado`

#### Scenario: Código EBUSY en la causa
- **WHEN** the thrown error has no EBUSY in its message but its `cause` has `code: 'EBUSY'`
- **THEN** the job is put back in the queue the same way

#### Scenario: Sin reintentos restantes
- **WHEN** kv `busy-retry:<id>` is already `2` and EBUSY reaches the final catch again
- **THEN** the job ends `failed` through finalizeJob with a reason that mentions the locked folder

#### Scenario: Otros errores no cambian
- **WHEN** an error without EBUSY (and not a network cut) reaches the final catch
- **THEN** the job fails with `Error inesperado` as before and `busy-retry:<id>` is not written

#### Scenario: Fallo de la primera preparación
- **WHEN** the first preparation of the work copy fails with EBUSY (SetupFailed)
- **THEN** the job fails as today and is not requeued

### Requirement: El daemon cierra procesos huérfanos de trabajos interrumpidos
When the daemon starts and puts back in the queue the jobs it finds `running`, for each one whose `worktree` exists it SHALL first kill the processes left running in that folder (`killLeftovers`, injectable through `DaemonOptions.killLeftovers`); a kill that throws MUST NOT keep the job from being re-queued.

#### Scenario: Trabajo interrumpido con copia
- **WHEN** the daemon starts with a job in status `running` whose worktree folder exists, and an injected killLeftovers
- **THEN** killLeftovers is called once with that folder and the job is `queued` before any job starts

#### Scenario: Sin copia
- **WHEN** a `running` job has no worktree or its folder does not exist
- **THEN** killLeftovers is not called for it and the job is still re-queued

#### Scenario: Falla al matar
- **WHEN** the injected killLeftovers throws
- **THEN** the job is still re-queued and the daemon goes on

### Requirement: La carpeta temporal de la mezcla no hace fallar la entrega
In merge-mode integration without a checked-out base (`mergeIntoBase` in src/line/integrate.ts), a failure to remove the temporary merge folder after the merge MUST NOT change the result: the integration SHALL return ok with its delivery and the folder SHALL be recorded as a pending cleanup under kv `cleanup:<job id>-merge` (retried by the existing cleanup pass). A leftover temporary folder from an earlier run that cannot be removed before the merge SHALL be replaced by a fresh folder name instead of failing.

#### Scenario: Borrado posterior falla
- **WHEN** runJob integrates a merge-mode job (base not checked out) with an injected removal that throws EBUSY only for the temporary merge folder after the merge
- **THEN** the job ends `delivered` with a merge delivery whose commit is the base's new tip, and kv `cleanup:<job id>-merge` holds the repository and that folder's path

#### Scenario: Carpeta previa bloqueada
- **WHEN** a folder `merge-<job id>` exists in the line's scratch directory and the injected removal throws for it before the merge
- **THEN** the merge happens in a different folder, the job ends `delivered`, and the base branch contains the job's branch

#### Scenario: La pasada de limpieza la retira
- **WHEN** kv `cleanup:<job id>-merge` exists and the cleanup pass runs with a removal that succeeds
- **THEN** the removal is called with the recorded path and the record is gone

### Requirement: Documentado en ambos README (7eda98a0)
README.md and README.es.md MUST say, next to the existing sentence about work copies that cannot be removed, that a job that hits a locked folder while resuming or integrating goes back to the queue (or stays delivered) instead of failing, in both languages with the same structure.

#### Scenario: Ambos idiomas
- **WHEN** the tests read README.md and README.es.md
- **THEN** both mention resuming a job with a locked folder, and test/docs.test.ts and test/wording.test.ts pass
