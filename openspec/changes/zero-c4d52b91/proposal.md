# Proposal

## Why

Vas a tener un documento de decisión en español: docs/adr/0005-costos-de-ci.md. Explica por qué el 13 de noviembre se agotó el presupuesto de GitHub Actions ($55,63 brutos: $25,63 incluidos en GitHub Pro más $30 de presupuesto) y por qué quedaron 15 pull requests de soliloq esperando. Después propone, una idea por sección, cómo gastar menos. Cada propuesta indica el ahorro estimado, el riesgo y qué habría que cambiar en zero o en el repositorio. Las ideas son seis: 1. Un tren de integración por línea: checks livianos en cada pull request y los pesados una vez por tanda, sacando de la tanda el cambio que la rompe. Tiene en cuenta que la merge queue de GitHub no existe para repositorios privados de una cuenta personal. 2. Juntar en un solo trabajo y un solo pull request los arreglos de Dependabot de una línea. 3. Que la fábrica lea lo gastado en Actions en el mes y el límite, y se frene o espacie el trabajo antes de llegar al tope. Incluye qué permiso pide esa lectura. 4. Cambios en los workflows de soliloq: filtros por rutas, cancelar corridas viejas de la misma rama, checks pesados solo en main o de noche, cache y runners más baratos. 5. No gastar re-corridas mientras staging está caído. 6. Un repaso de los otros costos: el plan de Claude, Vercel y Supabase. Este trabajo no instala nada ni toca soliloq ni las otras líneas. Un test revisa que el documento esté completo. Las seis propuestas también quedan anotadas para la fábrica. Un trabajo de construcción no puede escribir en la pestaña Propuestas, porque esa lista la llenan los turnos de noche. Por eso el documento las deja escritas para que el turno de noche las proponga o para que las pidas directamente.

## What Changes

- ADR 0005: bajar el costo de CI y de los servicios de la fábrica
- Supuesto: Build jobs cannot write to the Propuestas tab: the `proposals` table in ZERO_HOME's state.db is filled only by scout, unjam and promotion, and a job cannot write state outside its work copy. The six ideas therefore go into the ADR and into this spec's followUps (stored as townhall `proposal` posts that show in the briefing). After the merge, the night shift can turn them into Propuestas, or the person in charge can request them directly.
- Supuesto: Savings figures are estimates from the measured numbers in the request, not from GitHub's billing data, and the ADR must label them as such.
- Supuesto: GitHub facts not checked against the live API (the budget or spending-limit endpoint for personal accounts, macOS minute multipliers, merge queue availability) must be stated cautiously or marked `no verificado`.
- Supuesto: Another unmerged branch may also take ADR number 0005; the build must check docs/adr on its base.

## Capabilities

### New Capabilities
- `ci-costs`: ADR 0005: bajar el costo de CI y de los servicios de la fábrica

### Modified Capabilities

## Impact

Generado por zero para el trabajo c4d52b91.
