# Proposal

## Why

When you ask for an on-demand run of a package station (`zero package run <paquete>/<estación>`), the request waits until the factory is idle. Today you can't see that it is still waiting. With this change, `zero package list` shows "corrida a demanda pendiente desde HH:MM" next to each station with a pending request. `zero status` (and the chat's status) adds one line listing the pending on-demand runs and when each was requested. Nothing changes in how or when the run happens, and the panel stays as it is.

## What Changes

- Show pending on-demand runs in `zero package list` and `zero status`
- Supuesto: Assumption: the time follows `resetTime` in src/budget.ts (HH:MM on the same day, `<weekday> HH:MM` on an earlier day), matching the 'desde HH:MM' in the request while making older requests clear.
- Supuesto: Adding a required `onDemand` field to `FactoryStatus` may break tests or callers that build FactoryStatus literals by hand. The build should update them, or read the field defensively.
- Supuesto: The panel's summary uses its own rendering and stays as it is, as the request asks, so pending runs show only in the CLI and the chat's status.

## Capabilities

### New Capabilities
- `agent-packages`: Show pending on-demand runs in `zero package list` and `zero status`

### Modified Capabilities

## Impact

Generado por zero para el trabajo c33889cf.
