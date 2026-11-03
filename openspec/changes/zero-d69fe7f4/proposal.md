# Proposal

## Why

zero va a poder mandar la traza de cada trabajo terminado (trabajo → estaciones → intentos → llamadas al agente y comandos, con duración, estado, motor, modelo y costo) a un colector OpenTelemetry como Jaeger, Grafana Tempo o Honeycomb. Viene apagado. Se prende escribiendo en zero.factory.yaml la dirección del colector (OTLP/HTTP). Si el colector pide una clave, en el archivo va solo el nombre del secreto, y el valor sale de una variable de entorno o del llavero del sistema. El envío corre en segundo plano y nunca frena ni rompe la producción. Si el colector no responde, zero lo anota, reintenta unas pocas veces con espera y después sigue de largo. state.db sigue siendo la fuente de verdad: zero trace muestra lo mismo que antes. Antes de salir, a los atributos se les quitan los secretos y las rutas locales del dueño. El README (inglés y español) explica cómo activarlo. En el sitio, la exportación OTLP deja de figurar como "en camino" y aparece como disponible.

Pedido original: "Terminar uno de los "en camino" del sitio: exportación de trazas por OTLP. Hoy los spans y métricas quedan solo en state.db; src/telemetry/tracer.ts ya sigue las convenciones GenAI de OpenTelemetry pensando en exportarlos por OTLP. Que zero pueda mandarlos a un colector OpenTelemetry (Jaeger, Grafana Tempo, Honeycomb, etc.): - Opcional y apagado por defecto: se activa en zero.factory.yaml con el endpoint (OTLP/HTTP). Los encabezados con credenciales (por ejemplo una API key del colector) nunca van en el archivo, en argv ni en logs: desde el llavero del sistema o una variable de entorno. - Preferir OTLP/HTTP con JSON usando fetch, sin sumar dependencias, salvo que haya una razón fuerte. - Spans con su jerarquía (trabajo → estaciones → llamadas al agente) y sus atributos, con IDs válidos para OTLP. - Exportar nunca puede romper ni frenar la producción: si el colector no responde, se registra y se sigue (reintento acotado, sin acumular memoria sin límite). state.db sigue siendo la fuente de verdad. - Nunca exportar secretos ni rutas locales del dueño en los atributos. - Tests con un colector falso (servidor HTTP local en el test). - Empieza como un change de OpenSpec. Documentarlo en README.md y README.es.md (misma estructura). - En el sitio (site/index.html y site/main.js), sacar "Exportación de trazas por OTLP" de la lista de "en camino" y mencionarla como disponible, en español e inglés. Hay otro trabajo en curso (943e22bf) que cambia el hero y textos del sitio: tocar lo mínimo del sitio para no chocar."

## What Changes

- Exportación opcional de trazas por OTLP/HTTP
- Supuesto: Export covers only finished jobs' traces. Spans without a job (scout and research passes) and the metrics are not exported in this change. I assumed the request ('exportación de trazas') is mainly about traces.
- Supuesto: Job span ids (`job-<id>`) and any non-hex ids are mapped to 16-hex ids with a hash. Ids in the collector therefore differ from what `zero trace` shows, although they are stable.
- Supuesto: Past jobs are not backfilled: the cursor starts when export is first enabled. Changing the endpoint does not resend history.
- Supuesto: When a batch fails 5 times it is dropped from the export (state.db still keeps it). With a long outage, those traces are missing in the collector.
- Supuesto: Job 943e22bf edits site texts. To limit conflicts, the site change only touches the `next.otlp` item and the `workflow.trace` string.
- Supuesto: Scrubbing works by pattern. It can miss paths in unusual formats, and for that reason attributes are scrubbed rather than allow-listed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-observability`: Exportación opcional de trazas por OTLP/HTTP

## Impact

Generado por zero para el trabajo d69fe7f4.
