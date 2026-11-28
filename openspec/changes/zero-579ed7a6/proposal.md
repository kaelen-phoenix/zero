# Proposal

## Why

Las pruebas de conflictos (test/automerge-conflicts.test.ts y test/conflict-agents.test.ts) dejan de cortarse cuando corre la suite completa en Windows. Cada uno de esos dos archivos tiene su propio límite de 180 s por prueba, más amplio que el general de 120 s. La limpieza de carpetas temporales de las pruebas reintenta más veces y espera más entre intento e intento. Si una carpeta sigue tomada por un proceso de git (EBUSY, EPERM, ENOTEMPTY), la limpieza avisa y la deja, en lugar de hacer fallar la prueba siguiente. Lo que prueban esas pruebas no cambia.

## What Changes

- Estabilizar las pruebas de conflictos en Windows (límite propio y limpieza tolerante a EBUSY)
- Supuesto: main already raised the global testTimeout to 120 s in vitest.config.ts (commit 20962a1), so the original failure may already be gone. This change adds margin and does not fix a proven current failure.
- Supuesto: `vi.setConfig` at module level applies to the current test file. If the build uses describe options instead, every top-level describe in both files must get them (automerge-conflicts has 9, conflict-agents has 3).
- Supuesto: Ignoring EBUSY in cleanup can leave folders in %TEMP% when a git process of a cut test is still running. That was chosen on purpose over failing unrelated tests.
- Supuesto: This does not wait for git child processes started by src/ code during the tests. The tests have no handle on them, and tracking them would mean touching the runner's killLeftovers wiring.
- Supuesto: There is no OpenSpec capability for test infrastructure, so 'test-suite-stability' is a new name. This is a test-only change, with no change to product behaviour or docs/agents/ files.

## Capabilities

### New Capabilities
- `test-suite-stability`: Estabilizar las pruebas de conflictos en Windows (límite propio y limpieza tolerante a EBUSY)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 579ed7a6.
