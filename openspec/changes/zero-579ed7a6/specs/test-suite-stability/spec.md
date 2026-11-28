# Spec Delta

## Purpose

Las pruebas de conflictos (test/automerge-conflicts.test.ts y test/conflict-agents.test.ts) dejan de cortarse cuando corre la suite completa en Windows. Cada uno de esos dos archivos tiene su propio límite de 180 s por prueba, más amplio que el general de 120 s. La limpieza de carpetas temporales de las pruebas reintenta más veces y espera más entre intento e intento. Si una carpeta sigue tomada por un proceso de git (EBUSY, EPERM, ENOTEMPTY), la limpieza avisa y la deja, en lugar de hacer fallar la prueba siguiente. Lo que prueban esas pruebas no cambia.

## ADDED Requirements

### Requirement: Límite propio para las suites de conflictos
test/automerge-conflicts.test.ts and test/conflict-agents.test.ts MUST each set a per-test timeout of at least 180000 ms for every test in the file (for example `vi.setConfig({ testTimeout: 180_000 })` at module level), without changing any test's assertions or setup.

#### Scenario: Los dos archivos declaran el límite
- **WHEN** a test reads the source of test/automerge-conflicts.test.ts and test/conflict-agents.test.ts
- **THEN** each one sets testTimeout (through vi.setConfig or describe options that cover all its describes) to a value >= 180000

#### Scenario: Las pruebas siguen pasando
- **WHEN** `npx vitest run test/automerge-conflicts.test.ts test/conflict-agents.test.ts` runs
- **THEN** every test passes with the same number of tests as before

### Requirement: Borrado de carpetas temporales con reintentos
The test helpers' removal of temp folders MUST retry on a busy folder with more tries and a longer wait than today (at least maxRetries 10 and retryDelay 200 ms with `rmSync`).

#### Scenario: Opciones de reintento
- **WHEN** the exported temp-folder removal helper in test/helpers.ts removes a folder through an injected rm function
- **THEN** the rm function receives recursive: true, force: true, maxRetries >= 10 and retryDelay >= 200

#### Scenario: Borra una carpeta real
- **WHEN** cleanup() runs after tempDir() created a folder that has files in it
- **THEN** the folder no longer exists

### Requirement: Una carpeta tomada no rompe la prueba siguiente
cleanup() in test/helpers.ts MUST NOT throw when a folder still cannot be removed after the retries because of EBUSY, EPERM or ENOTEMPTY: it SHALL log a warning naming the folder and the code, then continue with the remaining folders. Any other error MUST still be thrown.

#### Scenario: EBUSY se avisa y no se lanza
- **WHEN** the removal helper is given an rm function that throws an error with code EBUSY
- **THEN** it does not throw and a console warning containing the folder path and EBUSY is written

#### Scenario: Sigue con las demás carpetas
- **WHEN** the first of two folders fails with EPERM during cleanup
- **THEN** the second folder is still removed

#### Scenario: Otros errores siguen fallando
- **WHEN** the rm function throws an error with code EACCES or one with no code
- **THEN** the removal helper throws that error
