# Spec Delta

## Purpose

Vas a tener un documento de decisión en español: docs/adr/0005-costos-de-ci.md. Explica por qué el 13 de noviembre se agotó el presupuesto de GitHub Actions ($55,63 brutos: $25,63 incluidos en GitHub Pro más $30 de presupuesto) y por qué quedaron 15 pull requests de soliloq esperando. Después propone, una idea por sección, cómo gastar menos. Cada propuesta indica el ahorro estimado, el riesgo y qué habría que cambiar en zero o en el repositorio. Las ideas son seis: 1. Un tren de integración por línea: checks livianos en cada pull request y los pesados una vez por tanda, sacando de la tanda el cambio que la rompe. Tiene en cuenta que la merge queue de GitHub no existe para repositorios privados de una cuenta personal. 2. Juntar en un solo trabajo y un solo pull request los arreglos de Dependabot de una línea. 3. Que la fábrica lea lo gastado en Actions en el mes y el límite, y se frene o espacie el trabajo antes de llegar al tope. Incluye qué permiso pide esa lectura. 4. Cambios en los workflows de soliloq: filtros por rutas, cancelar corridas viejas de la misma rama, checks pesados solo en main o de noche, cache y runners más baratos. 5. No gastar re-corridas mientras staging está caído. 6. Un repaso de los otros costos: el plan de Claude, Vercel y Supabase. Este trabajo no instala nada ni toca soliloq ni las otras líneas. Un test revisa que el documento esté completo. Las seis propuestas también quedan anotadas para la fábrica. Un trabajo de construcción no puede escribir en la pestaña Propuestas, porque esa lista la llenan los turnos de noche. Por eso el documento las deja escritas para que el turno de noche las proponga o para que las pidas directamente.

## ADDED Requirements

### Requirement: ADR de costos con formato de ADR
The repository MUST contain docs/adr/0005-costos-de-ci.md whose first line starts with `# ADR 0005`, with the lines `**Estado:**` and `**Fecha:**` and the sections `## Contexto`, `## Decisión` and `## Consecuencias`, and no other ADR file in docs/adr SHALL use the number 0005.

#### Scenario: header and sections
- **WHEN** a test reads docs/adr/0005-costos-de-ci.md
- **THEN** the first line matches /^# ADR 0005/ and the file contains `**Estado:**`, `**Fecha:**`, `## Contexto`, `## Decisión` and `## Consecuencias`

#### Scenario: unique number
- **WHEN** a test lists docs/adr
- **THEN** exactly one file name starts with `0005-`

### Requirement: Contexto con los datos medidos
The ADR's context SHALL state the measured November figures given in the request: $55,63 gross, $25,63 included in GitHub Pro, a $30 budget, the cut on 13 November, 15 soliloq pull requests waiting (8 of them security fixes), that zero is public, and that soliloq, newoman, glowingsanhair and zero-plus are private, along with the soliloq jobs `android`, `ios`, `e2e-flujos`.

#### Scenario: figures present
- **WHEN** a test reads the ADR
- **THEN** it contains `55,63`, `25,63`, `soliloq`, `android`, `ios`, `e2e-flujos`, `newoman`, `glowingsanhair` and `zero-plus`

### Requirement: Una propuesta por idea con ahorro y riesgo
The ADR MUST have one `### Propuesta N` section (N = 1 to 6) for each of the six topics of the request, and each section MUST contain a line starting with `**Ahorro estimado:**` and a line starting with `**Riesgo:**`.

#### Scenario: six proposals
- **WHEN** a test splits the ADR on `### Propuesta ` headings
- **THEN** there are at least 6 sections and every one contains `**Ahorro estimado:**` and `**Riesgo:**`

### Requirement: Tren de integración
The integration-train proposal SHALL describe light checks per pull request and heavy checks once per batch (on a schedule or every N changes) on an integration branch. It SHALL describe how the change that breaks a batch is found and taken out (bisection), and it MUST say that GitHub's merge queue is not available for private repositories of a personal account.

#### Scenario: train terms
- **WHEN** a test reads the ADR
- **THEN** it contains `tren de integración`, `merge queue` and `bisección`

### Requirement: Dependabot agrupado
The Dependabot proposal SHALL say that today `pollSecurityAlerts` in `src/intake/security-alerts.ts` opens one job per package. It SHALL propose a single job and a single pull request per line per batch, and weigh it against Dependabot's own `groups` setting.

#### Scenario: grouping terms
- **WHEN** a test reads the ADR
- **THEN** it contains `src/intake/security-alerts.ts` and `groups`

### Requirement: Presupuesto de Actions conocido
The Actions-budget proposal SHALL name the existing reader `githubReader` in `src/billing/readers.ts` (`/settings/billing/usage`, secret `GITHUB_BILLING_TOKEN`) and the existing `ChecksBilling` handling in `src/line/automerge.ts`. It SHALL state that reading a personal account's billing needs the `user` scope on a classic token (or the fine-grained equivalent). It MUST mark as `no verificado` anything about reading the spending limit or budget that was not checked against GitHub.

#### Scenario: budget terms
- **WHEN** a test reads the ADR
- **THEN** it contains `GITHUB_BILLING_TOKEN`, `ChecksBilling`, `` `user` `` and matches /no verificado/i

### Requirement: Workflows de soliloq
The workflow proposal SHALL cover path filters (`paths`), cancelling older runs of the same branch (`concurrency` with `cancel-in-progress`), heavy checks only on main or on a schedule, caching, and cheaper runners. It MUST say that cancelled runs are still billed for the minutes they used.

#### Scenario: workflow terms
- **WHEN** a test reads the ADR
- **THEN** it contains `paths`, `concurrency`, `cancel-in-progress` and `cache`

### Requirement: Sin re-corridas con el entorno caído
The shared-environment proposal SHALL describe what `ChecksOutage` in `src/line/automerge.ts` already does (no rerun while an outage is recorded, probing with backoff). It SHALL also say what is still missing to stop paying for reruns against a staging that is down.

#### Scenario: outage terms
- **WHEN** a test reads the ADR
- **THEN** it contains `ChecksOutage` and `staging`

### Requirement: Otros costos
The ADR SHALL include a proposal reviewing the factory's other costs: the Claude plan, Vercel and Supabase. It SHALL point to the existing monthly report services (`lines[].services`) as the source of those figures, and it MUST mark as estimates any figure not measured.

#### Scenario: other costs terms
- **WHEN** a test reads the ADR
- **THEN** it contains `Claude`, `Vercel`, `Supabase` and `services`

### Requirement: Alcance solo documental
The change MUST NOT modify any file under `src/`, any workflow, or any other line's repository. The only files it MAY add are the ADR, its test and the OpenSpec change. The ADR text SHALL respect the wording rule checked by test/wording.test.ts.

#### Scenario: wording test passes
- **WHEN** `npm test` runs
- **THEN** test/wording.test.ts and the new ADR test pass
