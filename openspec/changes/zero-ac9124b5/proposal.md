# Proposal

## Why

Hoy la página "Línea" del panel pregunta cada 5 segundos si algo cambió. Con este cambio, la fábrica le avisa a la página apenas un trabajo cambia de estado (empieza, pasa de estación, falla, espera tu respuesta o se entrega), y la cinta se mueve enseguida, en menos de un par de segundos, sin recargar la página. Si no pasa nada, no se envía nada. Si la conexión de aviso se corta (por ejemplo por el túnel o el celular), la página vuelve sola a preguntar cada 5 segundos y se reconecta después. Al volver a mirar la pestaña se pone al día al instante. Se sigue exigiendo tu clave: sin sesión no hay avisos, y si cambiás la clave los avisos abiertos se cortan. No suma librerías ni cambia la seguridad del panel.

Pedido original: "Issue #6 de GitHub: Actualizar panel Actualizar el panel de línea automáticamente conforme se produzcan cambios de estado."

## What Changes

- Panel de línea: actualización inmediata ante cada cambio de estado
- Supuesto: Interpretation: the page already self-refreshes every 5 s, so I read "conforme se produzcan cambios de estado" as push-on-change (SSE) instead of a faster poll. If the owner only wanted a shorter interval, this does more than they asked, but it still meets the request.
- Supuesto: Change detection runs on a server-side interval over SQLite (about 1 s), not on in-process events, because CLI processes (`zero answer`, `zero stop`) also write the store. Each tick renders the fragment once, which costs a little CPU while a stream is open.
- Supuesto: Cloudflare quick tunnels or mobile networks may buffer or cut SSE. The polling fallback and the EventSource auto-reconnect cover this, but on such links the latency can fall back to about 5 s.
- Supuesto: The existing test in test/panel-line.test.ts asserts `fetch("/line?fragment=1"` and `setInterval(..., 5000)`, so the fallback has to keep that shape or the test has to be updated on purpose.
- Supuesto: Browsers allow about 6 HTTP/1.1 connections per origin. Several /line tabs, each holding a stream, could starve other panel requests. That is acceptable for a single-owner panel.

## Capabilities

### New Capabilities
- `control-panel`: Panel de línea: actualización inmediata ante cada cambio de estado

### Modified Capabilities

## Impact

Generado por zero para el trabajo ac9124b5.
