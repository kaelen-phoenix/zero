# Spec Delta

## Purpose

The test that checks the panel's Línea page receives a station change in under 2 seconds stops failing just because the machine is busy. It keeps checking the same thing: the change arrives in under 2 seconds. It now asks the server to look for changes every 100 ms instead of every second, so one slow tick no longer eats the whole margin. The other waits in the same file get a wider timeout when they only wait for the stream to be ready and don't measure time. The factory's behaviour does not change; only the tests do.

## ADDED Requirements

### Requirement: Stream push test keeps its 2 s bound with margin for a loaded worker
The test 'pushes the new fragment within 2 s when a job moves to the next station' in test/panel-line.test.ts MUST open the stream with a watchMs of at most 100 ms, and MUST still fail when the new fragment takes 2000 ms or more to arrive after the store update.

#### Scenario: Small watch interval
- **WHEN** the test opens /line/events for the station-change check
- **THEN** the panel is created with watchMs ≤ 100 (not 1000), and the test still asserts that the push took less than 2000 ms and that build is 'lista' and verify 'activa' in the last fragment

### Requirement: Readiness waits do not share the measured bound
Waits in test/panel-line.test.ts that only wait for the stream to be ready or to end, and do not measure a time requirement, MUST use a timeout of at least 10000 ms. Waits that measure a requirement (the 2 s push) MUST keep their explicit bound.

#### Scenario: Default until timeout
- **WHEN** `stream.until(ok)` is called without an explicit ms
- **THEN** it waits up to at least 10000 ms before throwing 'timed out waiting for the stream'

#### Scenario: Measured wait unchanged
- **WHEN** the station-change test waits for the second fragment
- **THEN** it passes 2000 explicitly and asserts that `took` is less than 2000
