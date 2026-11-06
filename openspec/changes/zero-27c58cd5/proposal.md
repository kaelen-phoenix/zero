# Proposal

## Why

Si usás Codex con tu sesión de ChatGPT, zero lo va a tratar como suscripción y dejará de frenarlo por dólares. Si Codex informa cuánto del plan llevás usado, zero lo pausa al llegar a tu reserva (`limits.reservePercent`), igual que con Claude, y lo retoma cuando el plan se renueva. Con una clave de API sigue contando como pago por uso. Además, el tope `limits.usdPerNight` va a sumar solo lo que realmente se cobra: las llamadas de suscripción de scout, investigación y paquetes ya no lo gastan. Incluye pruebas de las dos cosas y la explicación en los dos README.

## What Changes

- Codex informa su plan y usdPerNight cuenta solo lo que se cobra
- Supuesto: No se pudo ejecutar el CLI de Codex en esta estación (shell denegado). Los textos de `codex login status` y los eventos de `codex exec --json` salen del pedido y de lo que se recuerda del CLI, sin comprobar. Hay que probarlo con un Codex real: las pruebas usan procesos falsos.
- Supuesto: Puede que `codex exec --json` no traiga `rate_limits` en la versión instalada, porque se sabe que aparecen en los eventos `token_count` de las sesiones. En ese caso el motor queda como suscripción sin ventanas y no pausa por reserva hasta que el CLI los informe. Por eso se buscan en cualquier nivel del evento.
- Supuesto: Supuesto: si hay una clave en el entorno y además una sesión de ChatGPT, gana `api`. Se eligió así porque, según lo que se recuerda del CLI (sin comprobar), `CODEX_API_KEY` manda en `codex exec` aunque `login status` diga ChatGPT, y así un cobro real no escapa a los topes. La contra: un `OPENAI_API_KEY` en el entorno por otro motivo hace ver a Codex como pago por uso aunque use la sesión.
- Supuesto: Dentro de la caja Codex solo admite claves (`src/box/credentials.ts`), así que allí siempre será `api`. La sesión de ChatGPT solo se detecta en llamadas fuera de la caja.
- Supuesto: Con `--json`, stdout crece y lleva eventos. El texto de error y el fallback ya contemplan eso, pero `runProcess` acumula toda la salida en memoria.
- Supuesto: `limited: true` también se marca si la llamada falló por otra causa con una ventana al 100%. El trabajo vuelve a la cola hasta la renovación, y el presupuesto ya pausaría ese motor de todos modos.
- Supuesto: Cada llamada sin clave lanza un proceso más (`codex login status`), y agrega hasta 10 s si se cuelga. No se guarda en caché a propósito, porque la sesión puede cambiar.
- Supuesto: La primera llamada de Codex sigue con billing `unknown` hasta tener una lectura, así que su primera pasada de tiempo libre lleva tope en dólares. Con este cambio ya no lo consume lo gastado por suscripción.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Codex informa su plan y usdPerNight cuenta solo lo que se cobra

## Impact

Generado por zero para el trabajo 27c58cd5.
