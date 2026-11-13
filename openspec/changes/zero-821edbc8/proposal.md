# Proposal

## Why

La autoactualización de la fábrica (PR #165, trabajo 7dd6e0f1) quedó trabada porque choca con main. Este trabajo la trae entera a una rama nueva, que ya incluye todo lo de main. Resuelve los choques sin perder nada de ninguno de los dos lados. Se conservan las trabas y el aviso de instalación atrasada de main y también la autoactualización, que se activa con `selfUpdate: { enabled: true }` en el archivo de la fábrica. Su decisión de diseño pasa a ser el ADR 0005, porque el 0004 ya está ocupado en main. Al terminar pasan el chequeo de tipos, los tests y la validación de OpenSpec, y el pull request viejo #165 se puede cerrar a mano.

## What Changes

- Rescatar la autoactualización del PR #165 fusionándola con main
- Supuesto: Assumption: the rescue is delivered as this job's own pull request (branch zero/821edbc8) that contains the merge, not as a push to zero/7dd6e0f1. PR #165 has to be closed by hand after this one merges.
- Supuesto: The PR was written against an older main. Since then main changed AGENTS.md, src/daemon.ts, src/app.ts and the tests widely, so tests that build a full FactoryStatus or call renderBriefing positionally may need small fixture updates.
- Supuesto: Self-update (applying an update) and main's install-freshness (detecting a stale install) overlap in purpose. This job keeps both as they are and does not unify them.
- Supuesto: openspec validate may fail if the PR's delta spec has requirement names that are now in openspec/specs/factory-daemon/spec.md. In that case, rename the PR's requirements with a suffix instead of dropping them.
- Supuesto: If the review station has no shell, it can't check that b02d8f2 is an ancestor. It has to check by reading the files instead.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Rescatar la autoactualización del PR #165 fusionándola con main

## Impact

Generado por zero para el trabajo 821edbc8.
