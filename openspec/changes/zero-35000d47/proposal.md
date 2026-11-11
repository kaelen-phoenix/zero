# Proposal

## Why

The test that checks the panel's Línea page receives a station change in under 2 seconds stops failing just because the machine is busy. It keeps checking the same thing: the change arrives in under 2 seconds. It now asks the server to look for changes every 100 ms instead of every second, so one slow tick no longer eats the whole margin. The other waits in the same file get a wider timeout when they only wait for the stream to be ready and don't measure time. The factory's behaviour does not change; only the tests do.

## What Changes

- Real margin for the panel stream's 2 s test under load
- Supuesto: Raising the default `until` timeout makes a real regression (no first fragment at all) take 10 s to fail instead of 2 s. It still fails, and the time stays well under vitest's per-test timeout. Check the vitest config: if testTimeout is ≤ 10 s, use a slightly lower default such as 8000 ms.
- Supuesto: With watchMs 100 the test no longer exercises the production default of 1000 ms. The 2 s requirement now covers the push mechanism, not the default interval. That matches the original task's intent ('use a small watchMs').
- Supuesto: This addresses only this test. Other load-sensitive tests and `machineTrouble` not recognising such timeouts are out of scope.

## Capabilities

### New Capabilities
- `control-panel`: Real margin for the panel stream's 2 s test under load

### Modified Capabilities

## Impact

Generado por zero para el trabajo 35000d47.
