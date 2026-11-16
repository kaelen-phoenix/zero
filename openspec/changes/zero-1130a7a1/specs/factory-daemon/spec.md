# Spec Delta

## ADDED Requirements

### Requirement: Self-update status exposes the pending machine retry
`selfUpdateStatus` in src/app.ts MUST include `retry: { commit, at, tries }`, copied from the `retry` of kv `self-update:state`, whenever that state holds one and the status itself is returned (self-update enabled or history present); it SHALL omit `retry` when the state has none.

#### Scenario: State with a retry
- **WHEN** self-update is enabled and kv `self-update:state` is `{status: 'idle', retry: {commit: 'b'*40, at: '2026-11-11T13:00:00Z', tries: 2}}`
- **THEN** `factoryStatus(ctx).selfUpdate.retry` equals `{commit: 'b'*40, at: '2026-11-11T13:00:00Z', tries: 2}`

#### Scenario: State without a retry
- **WHEN** self-update is enabled and the state is `{status: 'idle'}`
- **THEN** `factoryStatus(ctx).selfUpdate.retry` is undefined

### Requirement: Status and panel tell the pending retry
`selfUpdateLines` MUST add, when `retry` is present, the line `Autoactualización: vuelve a intentar pasar a <first 12 chars of commit> a las <resetTime(at, now)> (intento <tries + 1>)` with `bad: false`, so it shows up in `formatStatus` and in the panel's `overviewPage` without the `bad` span; without `retry` it SHALL add no such line.

#### Scenario: Retry shown in status and panel
- **WHEN** the status has `retry {commit: 'b'*40, at: '2026-11-11T13:00:00Z', tries: 1}` and the last history entry is a failed switch to the same commit
- **THEN** `formatStatus` contains `Autoactualización: vuelve a intentar pasar a bbbbbbbbbbbb a las ` and `(intento 2)`, it still contains the `no pudo pasar a bbbbbbbbbbbb` line, and the `overviewPage` HTML contains the retry text not wrapped in `<span class="bad">`

#### Scenario: No retry, no line
- **WHEN** the status has no `retry`
- **THEN** neither `formatStatus` nor `overviewPage` contains `vuelve a intentar`

### Requirement: Briefing tells the pending retry
The briefing (`renderBriefing`, fed by `briefing` in app.ts from `factoryStatus(ctx).selfUpdate?.retry`) MUST include the bullet `- **Autoactualización**: vuelve a intentar pasar a <12-char commit> a las <resetTime(at, metrics.to)> (intento <tries + 1>).` when a retry is pending, in the same section as the other self-update bullets; it SHALL add no such bullet without a retry.

#### Scenario: Briefing with a retry
- **WHEN** `briefing(ctx)` runs with self-update enabled and a state holding `retry {commit: 'b'*40, at: '2026-11-11T13:00:00Z', tries: 1}`
- **THEN** the body contains `- **Autoactualización**: vuelve a intentar pasar a bbbbbbbbbbbb a las ` and `(intento 2)`

#### Scenario: Briefing without a retry
- **WHEN** `briefing(ctx)` runs with self-update enabled, a state without `retry` and only an `updated` history entry
- **THEN** the body does not contain `vuelve a intentar`
