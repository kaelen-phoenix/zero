# Spec Delta

## ADDED Requirements

### Requirement: Fundir a pedido un pull request entregado
An operation in src/app.ts (`mergePullRequest(ctx, target, opts)`) SHALL accept a job id or a GitHub pull request URL, resolve it to a job with status `delivered` whose `delivery.url` is that pull request (compared by repository, case-insensitive, and number through `pullRequestOf`), and merge it through `MergeApi.merge(number, headSha)` only when `mergeDecision` for its current state and checks returns `merge`. This MUST work whether or not the line has `autoMerge`.

#### Scenario: Línea sin autoMerge, checks verdes
- **WHEN** a job of a pull-request line with autoMerge false is delivered with url https://github.com/o/r/pull/5, and the fake MergeApi reports it open, mergeable true, with all checks done and ok; mergePullRequest is called with that url
- **THEN** the fake records exactly one merge of #5 at its head sha, the result has merged true and the commit, and the job's delivery.commit is the merge commit

#### Scenario: Por id de trabajo
- **WHEN** mergePullRequest is called with the job's id instead of the url, in the same situation
- **THEN** the pull request is merged the same way

#### Scenario: Pull request que la fábrica no entregó
- **WHEN** mergePullRequest is called with a GitHub pull request url that no delivered job has
- **THEN** it throws an Error whose message says the factory did not deliver that pull request, and no MergeApi method that writes is called

#### Scenario: Trabajo no entregado o sin pull request
- **WHEN** mergePullRequest is called with the id of a failed job, or of a delivered job with merge-mode delivery and no url
- **THEN** it throws an Error and nothing is merged

### Requirement: Si no está listo, dice por qué sin forzar
When `mergeDecision` is not `merge`, `mergePullRequest` MUST NOT call `merge`, `updateBranch`, `rerun` or `comment`. It SHALL return `merged: false` with a reason in Spanish: the decision's `why` for `wait` and `blocked`, `ya estaba fundido` for a merged pull request and `está cerrado sin fundir` for a closed one. A GitHub refusal of the merge call itself (for example 405 or 409) SHALL also come back as `merged: false` with its message, not as a thrown error.

#### Scenario: Check fallido
- **WHEN** the fake reports a done check with ok false named e2e
- **THEN** the result is merged false, its why contains `fallaron los checks e2e`, and the fake recorded no merge, comment, update or rerun

#### Scenario: Checks en curso
- **WHEN** a check is not done
- **THEN** the result is merged false with why `esperando checks`

#### Scenario: Conflictos
- **WHEN** mergeable is false and every check passed
- **THEN** the result is merged false with why `tiene conflictos con la rama base`

#### Scenario: Ya fundido
- **WHEN** the fake reports merged true
- **THEN** the result is merged false with why `ya estaba fundido`, and the job's MergeState (kv `automerge:<job>`) becomes status merged

#### Scenario: GitHub rechaza la fusión
- **WHEN** every check passed but the fake's merge throws `Head branch was modified`
- **THEN** mergePullRequest resolves with merged false and a why containing that message

### Requirement: Cada fusión a pedido queda en la traza y en el townhall
After a merge on request, zero SHALL record a `zero.merge` span on the job (parent: the job span) with attributes `zero.merge.via` (`cli`, `chat` or `panel`), `zero.merge.commit` and the pull request url. It SHALL set the job's MergeState to `{status: "merged", why: "fundido a pedido de quien está a cargo"}`, delete the branch on a best-effort basis, comment on the source issue of a `github-issue` job as the automatic merge does, and publish one townhall post for the job's line naming the pull request and the commit. A townhall or branch-deletion failure MUST be logged and MUST NOT turn the merge into a failure.

#### Scenario: Traza y townhall
- **WHEN** mergePullRequest merges with via `cli`
- **THEN** store.spansForJob(job) contains a span named `zero.merge` with `zero.merge.via` = `cli` and the commit, trace(ctx, job) mentions it, and the townhall has a post with the job's line and job id whose body contains the pull request url

#### Scenario: Townhall que falla
- **WHEN** the townhall publish throws during a merge on request
- **THEN** mergePullRequest still resolves with merged true

#### Scenario: El pase automático no vuelve a tocarlo
- **WHEN** an autoMerge job was merged on request and pollMerges runs afterwards
- **THEN** watchedJobs no longer includes it and the fake gets no further calls for it

### Requirement: Fundir desde la CLI y el chat
`zero fusionar <trabajo | url>` and the MCP tool `zero_merge` (input `target`) MUST call `mergePullRequest` with via `cli` and `chat` respectively, and SHALL print a Spanish summary: on success the pull request url and that it is merged, otherwise `No lo fundí: <why>`. The CLI SHALL exit 1 when nothing was merged. The real adapter SHALL be the line's signed `githubMerges` (`signedMerges` with `lineSignature`) with the GitHub token from `githubToken`. Without a token, the answer SHALL say how to sign in and nothing is merged.

#### Scenario: Herramienta del chat
- **WHEN** createZeroMcpServer's `zero_merge` is called with a target and an injected fake MergeApi factory whose pull request is ready
- **THEN** the tool's text says the pull request was merged and is not an error

#### Scenario: Chat sin listo
- **WHEN** zero_merge is called and the fake reports a failed check
- **THEN** the text starts with `No lo fundí:` and contains the reason

#### Scenario: Ayuda de la CLI
- **WHEN** the CLI usage text is printed
- **THEN** it lists `zero fusionar <trabajo | url>`

### Requirement: Botón Fundir en el panel
The panel's job page SHALL show a `Fundir` form posting to `/job/<id>/merge` only for a delivered job with a GitHub pull request delivery whose MergeState is not `merged` or `closed`. The first POST without `confirm=1` MUST only return a confirmation page. With `confirm=1` it SHALL call `mergePullRequest` with via `panel` and the panel's injected merge adapter (`PanelOptions.merges`; the daemon passes the metered real one), then redirect back to `/job/<id>` with a message saying it was merged or `No lo fundí: <why>`.

#### Scenario: Botón visible
- **WHEN** jobPage renders a delivered job with url https://github.com/o/r/pull/6
- **THEN** the HTML contains a form with action `/job/<id>/merge` and the text `Fundir`

#### Scenario: Botón oculto
- **WHEN** jobPage renders a running job, a delivered merge-mode job, or a delivered job whose kv `automerge:<id>` has status merged
- **THEN** the HTML has no `/merge` form

#### Scenario: Confirmación primero
- **WHEN** an authenticated POST to /job/<id>/merge without confirm is made
- **THEN** the response is a confirmation page and the fake MergeApi recorded no merge

#### Scenario: Fundir confirmado
- **WHEN** the same POST is made with confirm=1 and the fake reports the pull request ready
- **THEN** the fake recorded one merge, the response redirects to /job/<id>, and the job has a `zero.merge` span with via `panel`

### Requirement: Detectar checks que GitHub no arrancó por facturación
`githubMerges` SHALL mark a failed check run with `billing: true` when its output title, summary, text or (only for failed runs that have `annotations_count > 0`) its annotations match `billingRefusal`, a pure exported function that recognises `The job was not started because recent account payments have failed or your spending limit needs to be increased` (case-insensitive, either half of the sentence). `Check` SHALL also carry `started` (the run's `started_at`) only when GitHub says the run is in progress or completed.

#### Scenario: Texto de GitHub
- **WHEN** billingRefusal is given the full GitHub message, or only `your spending limit needs to be increased`
- **THEN** it returns true

#### Scenario: Otro fallo
- **WHEN** billingRefusal is given `Process completed with exit code 1`
- **THEN** it returns false

### Requirement: Retener sin gastar ni comentar un pull request frenado por facturación
In `pollMerges`, when a watched pull request's failed checks include at least one with `billing`, zero MUST NOT comment on it, refresh it, rerun its checks or count those failures toward an environment outage (`checks-failures:`/`checks-outage:`). It SHALL record or widen kv `checks-billing:<repo>` (since, the latest refusal time, and the pull requests' jobs), mark the pull request's MergeState with `billing` (kept by every save, like `outage`) and leave it `blocked` with a why from `billingText` and a backoff. It SHALL log a warning only when the record is new.

#### Scenario: Retenido sin comentario
- **WHEN** pollMerges runs on an autoMerge pull request whose checks are [ci ok, build done failed with billing true and run 42], with a fake that has rerun, behind and updateBranch
- **THEN** the fake recorded no comment, update or rerun, the MergeState is blocked with `billing` set, kv `checks-billing:kaelen/demo` exists, and no `checks-outage:` key was written

#### Scenario: Dos pull requests, un solo registro
- **WHEN** two watched pull requests of the same repository both have billing-refused checks and pollMerges runs
- **THEN** there is one `checks-billing:<repo>` record listing both jobs, and both MergeStates carry `billing`

### Requirement: Avisar una vez por repositorio
`factoryStatus` SHALL list each `checks-billing:` record as `billing: {repository, since, pulls}[]` and leave the pull requests it holds out of `merges`. `formatStatus`, the panel's overview and the briefing MUST each show one line per repository through the shared `billingText` (`GitHub no arranca los checks en <repo> desde HH:MM: revisá los pagos o el límite de gasto de la cuenta (Billing & plans); la fábrica los vuelve a correr sola cuando GitHub deje`), never one per pull request, and nothing when there is no record.

#### Scenario: Una línea en zero status
- **WHEN** a `checks-billing:kaelen/demo` record holds two pull requests and the status is formatted
- **THEN** the text contains `GitHub no arranca los checks en kaelen/demo` exactly once and neither pull request appears among the `Fusión automática` lines

#### Scenario: Panel y briefing
- **WHEN** overviewPage(factoryStatus(ctx), ...) and briefing(ctx) are rendered with that record
- **THEN** each contains the billingText line once

#### Scenario: Sin registro
- **WHEN** there is no `checks-billing:` key
- **THEN** formatStatus, overviewPage and the briefing do not contain `GitHub no arranca los checks`

### Requirement: Volver a correr solo cuando GitHub deja
After the pull requests, `pollMerges` SHALL follow each `checks-billing:` record. Recovery is a check that is not `billing` and whose `started` is later than the record's latest refusal, seen at a watched tip of the repository in that pass or at the tip of the base branch (read with `checks(base)` at most every 5 minutes). Once recovered, with the repository free (no hold, no first checks elsewhere), it SHALL call `rerun` for the billing-refused runs of one held pull request (the oldest) per pass, at most once per run in that pull request's life (`MergeState.billingRerun`, kept by every save). It SHALL clear that pull request's `billing` mark and set `refreshing: {head, at, rerun: true}` so the repository is held as for any rerun. The record is deleted once no held pull request is left. Before recovery, nothing is rerun.

#### Scenario: Sin señal, no se reintenta
- **WHEN** a billing record exists and a later pass sees only the same billing-refused checks and a base whose checks have no later `started`
- **THEN** the fake recorded no rerun

#### Scenario: GitHub vuelve a arrancar
- **WHEN** the base branch's checks include a check with started later than the refusal and no billing, and pollMerges runs
- **THEN** the fake recorded `rerun 42` once, the pull request's MergeState is waiting with refreshing.rerun true, billingRerun contains 42 and no `billing` mark

#### Scenario: De a uno
- **WHEN** two pull requests are held by the record and GitHub recovered
- **THEN** the first pass reruns only the oldest one's runs, and the second one's runs are rerun only on a later pass after the first one's checks all ended

#### Scenario: Una vez por corrida
- **WHEN** after the rerun, run 42 is refused for billing again and later GitHub recovers again
- **THEN** run 42 is not rerun a second time, and the pull request is blocked with the billing notice

#### Scenario: Registro olvidado
- **WHEN** every held pull request was rerun or is no longer watched
- **THEN** the `checks-billing:<repo>` key is gone and the status shows no billing line

### Requirement: Documentado en ambos README (1906996b)
README.md and README.es.md MUST explain, in the same place in each (next to `It merges only when GitHub says so`), merging on request (`zero fusionar`, `zero_merge`, the panel's Fundir button) and the automatic rerun of checks GitHub did not start because of billing. The CLI usage of `zero fusionar` MUST be listed in both READMEs where the other daily commands are.

#### Scenario: Ambos idiomas
- **WHEN** test/docs.test.ts reads both READMEs
- **THEN** both contain `zero fusionar` and `zero_merge` and mention billing (`facturación` in Spanish, `billing` in English), and the existing structure test still passes
