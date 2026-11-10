# Proposal

## Why

When an engine stops because its plan's usage window is used up or its API key is out of credit, the log and the attempt trace will say "engine quota or credit used up" instead of "subscription plan used up". That way, reading the traces will no longer suggest a subscription problem when the real cause was API credit. The factory's behaviour does not change: the job still goes back to the queue, or moves on to a replacement engine, exactly as before.

## What Changes

- Neutral text when an engine runs out of plan or credit
- Supuesto: Assumption: the exact neutral text is `engine quota or credit used up`, as the request suggests. It stays in English because it is a log and trace text, not owner-facing UI.
- Supuesto: Telemetry already exported (OTLP) or older stored spans keep the old text, so a filter on the exact `error.message` would see both texts.
- Supuesto: The job number in the new OpenSpec change folder is assumed to be zero-94333bdc, following the repo's convention.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Neutral text when an engine runs out of plan or credit

## Impact

Generado por zero para el trabajo 94333bdc.
