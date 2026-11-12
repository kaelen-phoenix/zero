# Proposal

## Why

El informe mensual de cada línea (`zero informe`, la pestaña "Informe mensual" del panel y `zero_monthly_report`) suma una sección "Servicios" con lo que costaron ese mes los servicios externos que usa la app. Muestra también un total del mes por app: fábrica más servicios. Arranca con tres servicios. GitHub Actions del repositorio de la línea: minutos brutos, dólares brutos, lo que cubrió el plan y lo facturado. Vercel: el costo del proyecto de la línea. Supabase: el plan y el uso del proyecto. En el archivo de la fábrica declarás, por línea, qué servicios usa y sus identificadores (proyecto, repo, organización), nunca tokens. Los tokens van como secretos (`GITHUB_BILLING_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`). Una vez por día, la fábrica lee esos datos en modo solo lectura y los guarda. El informe los toma de lo guardado, sin llamar a ninguna API ni a ningún modelo. Cada cifra dice de dónde salió y cuándo se leyó. Si falta el token, el servicio no contesta o la API no da el costo, ese servicio figura como "sin dato": el informe nunca falla ni inventa un número. Queda armado para sumar más servicios después, como Expo/EAS, Google Play o Mercado Pago.

## What Changes

- Costos de servicios externos en el informe mensual
- Supuesto: I couldn't check the exact shapes of the Vercel API (`/v1/billing/charges`, FOCUS JSONL with project tags) and the Supabase Management API from here. The adapters must treat any unexpected shape as `sin dato`. If Vercel does not attribute charges per project, the line will always show sin dato until the adapter is adjusted.
- Supuesto: The Supabase Management API does not give a dollar cost, so Supabase shows the plan and usage with its cost as "sin dato". This follows from the rule never to make up a number.
- Supuesto: GitHub's billing usage API needs a token with billing (Plan) read permission. The factory's usual token may not have it, so `GITHUB_BILLING_TOKEN` is checked first.
- Supuesto: The factory part of the total uses the same month cost the report already shows (`costUsd`, which may include subscription estimates that nobody charged). The total row must keep that distinction visible rather than hide it.
- Supuesto: For the current month, figures are partial up to their read date, and the report says so through the date.
- Supuesto: The full `npm test` run takes more than 20 minutes and earlier jobs hit the verify time limit, so builds should run focused test files.
- Supuesto: The capability's existing spec delta lives in the unarchived change zero-42a97d83 (factory-observability). New requirement names must not collide with it.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-observability`: Costos de servicios externos en el informe mensual

## Impact

Generado por zero para el trabajo f1363c50.
