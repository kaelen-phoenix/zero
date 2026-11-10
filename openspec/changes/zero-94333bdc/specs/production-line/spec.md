# Spec Delta

## ADDED Requirements

### Requirement: Mensaje neutro en el span del intento al agotarse cupo o crédito
When an agent call of an attempt returns a quota with `limited: true` and the job goes back to the queue, the runner MUST end the `zero.attempt` span with status `error` and `error.message` equal to `engine quota or credit used up`, whatever the quota's billing, and it SHALL NOT write the text `subscription plan used up`.

#### Scenario: Saldo de API agotado en build
- **WHEN** a job runs with a fake build agent whose result is `ok: false` with quota `{ billing: "api", windows: [], limited: true }` and no replacement engine is available
- **THEN** the job ends `queued` and its `zero.attempt` span has status `error` and attrs `error.message` equal to `engine quota or credit used up`

#### Scenario: Plan de suscripción agotado
- **WHEN** the same job runs with a build result whose quota is `{ billing: "subscription", limited: true, windows: [...] }`
- **THEN** the `zero.attempt` span's `error.message` is also `engine quota or credit used up`

### Requirement: Mensajes neutros en el log al agotarse cupo o crédito
The runner's log entries for a job requeued because of a limited quota, and for moving on to a replacement engine after one, MUST say `engine quota or credit used up` (`engine quota or credit used up; job back in the queue until it renews` and `engine quota or credit used up; going on with a replacement`) instead of `subscription plan used up`.

#### Scenario: Ningún texto viejo en el runner
- **WHEN** src/line/runner.ts is searched for the text `subscription plan used up`
- **THEN** there are no matches, and the text `engine quota or credit used up` appears in the requeue log, the replacement log and every attempt span ending caused by a limited quota
