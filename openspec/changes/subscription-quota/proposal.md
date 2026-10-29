# Proposal

## Why

El dueño usa una suscripción de Claude (claude.ai). Con ella no se paga por uso: el límite real es el cupo del plan, que se renueva cada 5 horas y cada semana. La fábrica, en cambio, se frenaba con un tope diario en dólares armado con la estimación que informa el motor (`total_cost_usd`). Ese tope no reflejaba nada real: un día paró la fábrica con "$11.16 de $10" cuando el plan estaba casi sin usar, y los trabajos fallaban por el tope por trabajo (`maxBudgetUsd`) con centavos.

## What Changes

- **El motor informa el plan.** Cada llamada dice cómo se paga la cuenta (`subscription` o `api`) y, con una suscripción, el uso de cada ventana del plan (fracción usada, estado y cuándo se renueva). Claude lo saca de los eventos `rate_limit_event` del Agent SDK y del `apiKeySource` de la sesión.
- **Con una suscripción, el límite es el plan.** Los trabajos nuevos esperan mientras una ventana está agotada (o pasó la reserva del dueño) y la fábrica retoma sola cuando se renueva. Los topes en dólares, diario y por trabajo, no se aplican.
- **Un trabajo cortado por el plan no falla.** Vuelve a la cola sin gastar un intento y sigue desde la misma estación cuando el plan se renueva.
- **Reserva para el dueño.** `limits.reservePercent` (0 por defecto) deja libre una parte de cada ventana.
- **Pago por uso igual que antes.** Con una clave de API se mantienen `usdPerDay` y `usdPerJob`, contando solo lo que se cobra.
- **Se ve el plan.** Estado, panel e informe muestran "Suscripción: 5 horas al 45% (se renueva 18:30) · semana al 32%" y el costo estimado aclarando que no se cobra.

## Capabilities

### Modified Capabilities
- `production-line`: los límites de costo dependen de cómo se paga el motor.

## Impact

- Código nuevo: `src/budget.ts`.
- Cambios en `src/engines/` (tipos y Claude), `src/agent.ts`, `src/line/runner.ts`, `src/daemon.ts`, `src/intake/comments.ts`, `src/app.ts`, `src/format.ts`, `src/panel/html.ts`, `src/config.ts`.
- Sin dependencias nuevas.

**Fuera de alcance**: la API experimental de uso del SDK (`/usage`); planes de otros motores.
