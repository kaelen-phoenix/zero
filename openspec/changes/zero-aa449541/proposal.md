# Proposal

## Why

The production-line specification will describe what the code already does when a Claude Code session expires. The engine is paused for 15 minutes with a notice that you need to sign in again. The job continues with a replacement engine, or goes back to the queue without spending tries. Jobs that failed before they had a specification can now be retried. The change zero-7ab160a7 moves to the archive, so no later job thinks it is still pending and repeats the work. No code changes.

## What Changes

- Archivar el cambio zero-7ab160a7 en la especificación de production-line
- Supuesto: `openspec archive` may ask for confirmation. Without --yes, or with a CLI version that has a different flag, it would wait for input, so the manual route is the fallback.
- Supuesto: The archived folders use the date of the archive (YYYY-MM-DD-). The exact date depends on when build runs, so checks should match on the -zero-7ab160a7 suffix.
- Supuesto: The CLI may rewrite whitespace or formatting in production-line/spec.md when it merges. That is acceptable as long as no requirement or scenario is lost.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Archivar el cambio zero-7ab160a7 en la especificación de production-line

## Impact

Generado por zero para el trabajo aa449541.
