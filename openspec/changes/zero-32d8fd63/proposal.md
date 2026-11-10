# Proposal

## Why

Hoy, si Codex trabaja con una clave de API de OpenAI y esa cuenta se queda sin saldo, zero toma el rechazo como un error del código. Gasta los 3 intentos del trabajo y lo termina fallado sin haber probado nada. Con este cambio, zero reconoce los mensajes de saldo o cuota agotados de OpenAI (`insufficient_quota`, `You exceeded your current quota`). Entonces pausa el motor Codex unos 15 minutos con el motivo "la clave de API se quedó sin saldo" y no gasta el intento: el trabajo queda esperando y sigue desde la misma estación. Si configuraste motores de respaldo (`fallback`), la estación sigue sola con el siguiente. Ya funciona así para Claude. Una llamada exitosa, o un fallo por otra razón, se comporta igual que hoy.

## What Changes

- Codex con clave de API: saldo agotado (insufficient_quota) pausa el motor
- Supuesto: Assumption: OpenAI's out-of-credit error carries `insufficient_quota` or `You exceeded your current quota` in the text Codex prints (stderr or the error/turn.failed event). If Codex rewords or hides it, the old behaviour comes back (a failed attempt), nothing worse.
- Supuesto: Assumption: with session `subscription` (ChatGPT sign-in) the text is not treated as out of API credit and the existing windows logic stays. With an unknown session the text implies per-use billing, like the Claude change did.
- Supuesto: Ordinary rate limits (`rate_limit_exceeded`, 429 without insufficient_quota) are left out on purpose. They are temporary and are not a lack of credit.
- Supuesto: Only the error event and stderr are searched, never the agent's answer, so a model that quotes the text in a successful answer does not pause the engine.
- Supuesto: A fixed 15-minute pause retries every 15 minutes while the balance is zero. Each retry is one refused call.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Codex con clave de API: saldo agotado (insufficient_quota) pausa el motor

## Impact

Generado por zero para el trabajo 32d8fd63.
