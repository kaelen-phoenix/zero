# Spec Delta

## ADDED Requirements

### Requirement: Una limpieza fallida no cambia cómo terminó un trabajo
When `finalizeJob` cannot remove a job's work copy (the removal throws, e.g. EBUSY on Windows), the job MUST keep the final status it was given (`delivered`, `failed` or `stopped`), with its delivery and reason, and `finalizeJob` SHALL still end the job span, publish the townhall report and return the finished job without throwing.

#### Scenario: Pull request entregado y carpeta bloqueada
- **WHEN** finalizeJob is called with status `delivered` and a pull-request delivery, and the injected work-copy removal throws an error whose message contains `EBUSY: resource busy or locked, rmdir`
- **THEN** finalizeJob resolves with a job whose status is `delivered` and whose delivery is the pull request; the stored job has status `delivered`, and the townhall gets the `run` post with no `blocker` post

#### Scenario: runJob no lo convierte en fallido
- **WHEN** runJob delivers a job (fake agents, merge or pull-request delivery) and removing the work copy throws EBUSY
- **THEN** runJob returns the job with status `delivered`, and its stored reason does not contain `Error inesperado`

### Requirement: La limpieza pendiente queda anotada
When the removal of a work copy fails, zero SHALL record a pending cleanup in kv under `cleanup:<job id>` holding the line's repository, the work-copy path, the error message and when it first failed, and SHALL log a warning.

#### Scenario: Registro en kv
- **WHEN** finalizeJob fails to remove the work copy of job J
- **THEN** kv `cleanup:J` holds JSON with the repository, the work-copy path and the error message

#### Scenario: Sin registro cuando se borra bien
- **WHEN** finalizeJob removes the work copy without error
- **THEN** there is no kv key `cleanup:<job id>`

### Requirement: Reintento en segundo plano
The daemon SHALL retry each pending cleanup in a background pass, at most once per intake interval (60 s, none in `once` runs), and on success SHALL delete its kv record. A retry that fails SHALL keep the record and update its error, and MUST NOT change the job.

#### Scenario: Reintento que funciona
- **WHEN** a `cleanup:J` record exists and the cleanup pass runs with a removal that succeeds
- **THEN** the removal is called with the recorded repository and path, the `cleanup:J` key is gone, and job J's status is unchanged

#### Scenario: Reintento que vuelve a fallar
- **WHEN** the cleanup pass runs and the removal throws again
- **THEN** `cleanup:J` still exists with the new error message, the pass does not throw, and job J's status is unchanged

#### Scenario: Carpeta que ya no existe
- **WHEN** the recorded work-copy path no longer exists on disk and the cleanup pass runs with the real removal
- **THEN** the `cleanup:J` record is deleted

### Requirement: La limpieza no toca un trabajo que volvió a trabajar
The cleanup pass MUST NOT remove the recorded work copy while its job is queued, running or waiting again (a delivered job taken back to update its pull request works in the same folder), and the automatic merge SHALL NOT take a job back while it has a pending cleanup.

#### Scenario: Trabajo retomado con limpieza pendiente
- **WHEN** a `cleanup:J` record exists and job J is queued, running or waiting
- **THEN** the cleanup pass does not call the removal and keeps the record, and once J is finished again the next pass removes the copy and deletes the record

#### Scenario: Pull request en conflicto con limpieza pendiente
- **WHEN** a watched pull request is in conflict and its job has a `cleanup:J` record
- **THEN** the job stays delivered and is not put back in the queue until the record is gone

### Requirement: Limpiezas pendientes en zero status
`factoryStatus` SHALL list the pending cleanups (job id and path), and `formatStatus` SHALL show a line starting with `Limpiezas pendientes:` with their count only while there is at least one.

#### Scenario: Con una pendiente
- **WHEN** kv holds one `cleanup:<job>` record and the status is formatted
- **THEN** the text contains `Limpiezas pendientes:` and mentions 1 copia de trabajo

#### Scenario: Sin pendientes
- **WHEN** there are no `cleanup:` records
- **THEN** the formatted status does not contain `Limpiezas pendientes`

### Requirement: Documentado en ambos README
README.md and README.es.md MUST explain, in the same place in each, that a work copy that cannot be removed when a job ends does not change the job's result, is retried in the background and shows in `zero status` until it is removed.

#### Scenario: Ambos idiomas
- **WHEN** the test reads README.md and README.es.md
- **THEN** both mention the background cleanup retry and `zero status`, and the existing structure test in test/docs.test.ts still passes
