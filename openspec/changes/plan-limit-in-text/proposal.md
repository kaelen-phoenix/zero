# Proposal

## Why

El 10 de noviembre de 2026 el plan de la suscripción de Claude se agotó por sesiones de fuera de la fábrica. El SDK respondió a la fábrica con un error cuyo único dato era el texto `You've hit your session limit · resets 5am`, sin el evento de límite rechazado que zero espera. La fábrica lo tomó como una falla del trabajo: seis pedidos en cola fallaron en la especificación, uno gastó sus tres intentos en la revisión y cuatro actualizaciones de pull requests en conflicto se dieron por intentadas.

## What Changes

- Motor Claude: una llamada fallida cuyo texto dice que el plan llegó a su límite cuenta como rechazada por el plan, igual que cuando llega el evento. El trabajo vuelve a la cola y el motor se pausa de a 15 minutos hasta que el plan acepte pedidos.
- Solo se lee de llamadas fallidas, nunca de una respuesta.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: un plan agotado que solo se anuncia en el texto del error pausa el motor en vez de fallar el trabajo

## Impact

`src/engines/claude.ts` (`refusedQuota`) y `test/budget-cut.test.ts`.
