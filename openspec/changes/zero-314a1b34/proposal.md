# Proposal

## Why

Hoy, cuando la clave de API de Claude se queda sin saldo ("Credit balance is too low"), la fábrica lo toma como un error del código. Cada intento de build falla y el trabajo termina fallado sin haber probado nada. Con este cambio, zero reconoce ese mensaje como un problema de cuenta. Pausa el motor Claude unos 15 minutos con el motivo "la clave de API se quedó sin saldo" y no gasta el intento: el trabajo queda esperando y sigue desde la misma estación. Si configuraste motores de respaldo (`fallback`), la estación sigue sola con el siguiente. No agrega dependencias.

## What Changes

- Motor Claude: un saldo de API agotado pausa el motor en vez de gastar intentos
- Supuesto: Matching on the English text 'Credit balance is too low' depends on Anthropic keeping that message. If it changes, the old behaviour comes back: a failed attempt, nothing worse.
- Supuesto: A fixed 15-minute pause means the factory keeps retrying every 15 minutes while the balance stays at zero. Each retry is one refused call that costs nothing. A longer or growing wait is left out on purpose.
- Supuesto: The credit quota sets billing `api` even when the session's apiKeySource said otherwise. The message only comes from per-use credit, so that is assumed to be correct.
- Supuesto: The runner's goesOn/quotaStop log says 'subscription plan used up' and the attempt span says 'subscription plan used up'. Those texts become slightly inaccurate for API credit. Changing them is optional.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Motor Claude: un saldo de API agotado pausa el motor en vez de gastar intentos

## Impact

Generado por zero para el trabajo 314a1b34.
