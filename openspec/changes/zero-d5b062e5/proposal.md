# Proposal

## Why

Cuando un pedido es grande (muchas tareas o muchas partes del código), la especificación lo divide en etapas chicas. La fábrica construye y verifica cada etapa por separado, una detrás de otra, en la misma rama del trabajo, así cada intento de build tiene que hacer menos y entra en su tiempo. Cuando una etapa compila y pasa verify, ese avance queda guardado. Si después la etapa siguiente se corta por tiempo o falla, la fábrica reintenta solo esa etapa y no vuelve a construir las anteriores. Los intentos se cuentan por etapa. La revisión y la revisión de seguridad miran el cambio completo una sola vez, al final, y se entrega como siempre. Vas a ver en qué etapa está cada trabajo ("etapa 2 de 4") en `zero status` y en la vista de la línea del panel. README.md y README.es.md lo explican. Los pedidos chicos siguen igual que hoy.

## What Changes

- Pedidos grandes en etapas que se construyen y verifican una detrás de otra
- Supuesto: Assumption: "en la misma rama" is the option built here. Chained jobs (one job per stage, each delivered separately) are left for later.
- Supuesto: Assumption: the spec agent decides when a request is big, following its instructions. Zero does not split tasks on its own and does not reject long specs without stages, so that a job never fails only for that.
- Supuesto: Assumption: saving progress applies at stage level. A stage cut by time loses only its own unverified work: as today, that work stays uncommitted in the copy for the next attempt. The earlier verified stages are never rebuilt. No partial commit is verified in the middle of a stage.
- Supuesto: Attempts per stage let a staged job make up to maxAttempts × stages build calls. The job's dollar cap (budgetStop) still applies and stops it.
- Supuesto: A review or security rejection after the last stage retries only the last stage's build with the feedback, even if the problem comes from an earlier stage. The build agent can still edit any file.
- Supuesto: Old specs stored without `stages` must keep working. Making the field optional keeps both the existing Spec fixtures and codex strict mode (nullable) valid.
- Supuesto: The full npm test run has already gone past the factory's time limit in earlier jobs (townhall blockers). New tests must be few and must not add slow waits.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Pedidos grandes en etapas que se construyen y verifican una detrás de otra

## Impact

Generado por zero para el trabajo d5b062e5.
