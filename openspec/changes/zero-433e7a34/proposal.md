# Proposal

## Why

Te queda un pull request nuevo con la autoactualización de la fábrica del PR #165 (trabajo 7dd6e0f1) ya integrada sobre el main actual, sin conflictos. Conserva todo lo que main ya tiene: la frescura de la instalación, la estación unjam, la fusión automática y el ADR 0004 de servidores MCP. El ADR del PR pasa a ser el 0005. Antes de entregarlo tienen que pasar el typecheck, los tests y la validación de openspec. El PR #165 viejo queda reemplazado y lo cerrás a mano.

## What Changes

- Rescatar el PR #165 (autoactualización) resolviendo sus conflictos con main
- Supuesto: The request asks to push to PR #165's own branch without force. A factory job can only push its own branch (zero/433e7a34), so the merged result arrives as a new pull request that contains #165's commits. #165 has to be closed by hand, or it is closed automatically once this one merges, because its head becomes an ancestor.
- Supuesto: I couldn't use the shell during spec (no git access), so the list of conflicted files comes from a townhall note and may be incomplete. The build should trust `git merge`'s own report.
- Supuesto: The PR's self-update may overlap with main's install-freshness (both check whether the install is behind). Removing the duplication changes the PR's code, and the PR's tests may need adjusting.
- Supuesto: The full `npm test` suite has been close to or over verify's 20-minute default, so verify may time out even when the merge is correct.
- Supuesto: The PR's ADR number changes from 0004 to 0005. Any test that checks the PR's ADR by path must change with it.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Rescatar el PR #165 (autoactualización) resolviendo sus conflictos con main

## Impact

Generado por zero para el trabajo 433e7a34.
