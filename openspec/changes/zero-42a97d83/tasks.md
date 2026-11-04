# Tasks

## 1. Implementación

- [x] 1.1 Agregar a `src/state/store.ts`, si hace falta, una lectura de trabajos terminados en un rango y por línea (o filtrar `finishedSince` en el nuevo módulo), sin cambios de esquema.
- [x] 1.2 Crear `src/report.ts`: tipos `MonthlyReport`/`LineReport`, `parseMonth` y `previousMonth` (límites en hora local), `reportText` (aplica `scrub` por cada línea configurada, `scrubLocal` y quita las rutas `~...` que quedan), etiquetas de origen, link de entrega (solo http(s)), totales, suma de costo de suscripción desde `spansForJob` con el span de agente (`AGENT_SPAN`, `zero.billing`, `zero.cost.usd`), y los renderizadores `reportMarkdown` y `reportHtml` (documento autónomo, escapa con `esc`).
- [x] 1.3 Agregar `monthlyReport(ctx, { line?, month? })` a `src/app.ts`, con la elección de líneas (configuradas más las que tengan trabajos ese mes) y el link de commit vía `lineRepository`; es la única lógica que usan CLI, panel y chat.
- [x] 1.4 Agregar `zero informe [línea] [--mes] [--html]` a `src/cli.ts`: opciones `mes` y `html` en `parseArgs`, entrada en `USAGE`, aviso por stderr cuando no se indica línea, error cuando `--html` va sin línea.
- [x] 1.5 Agregar al panel `/report` y `/report/export` en `src/panel/server.ts`, `reportPage` y el link `Informe mensual` en `page()` en `src/panel/html.ts`. Reutilizar los encabezados de seguridad existentes y sumar `Content-Disposition` a la descarga; el nombre de archivo se sanea.
- [x] 1.6 Registrar `zero_monthly_report` en `src/mcp/server.ts` con `readOnlyHint`, y actualizar la lista exacta de herramientas en `test/interface.test.ts`.
- [x] 1.7 Escribir `test/report.test.ts` sobre un state.db de prueba (`testFactory`, trabajos cerrados con `finalizeJob`, spans con `insertSpan`, reloj fijado con `now`) cubriendo límites del mes, mes por defecto e inválido, elección de líneas, orígenes, links, totales, costo con suscripción, limpieza de secretos y rutas, escapado, CLI y ausencia de escrituras; agregar los tests del panel (siguiendo `test/panel-proposals.test.ts`) y el de MCP.
- [x] 1.8 Documentar en `README.md` y `README.es.md` (bloque de comandos de Getting started, lista de herramientas de chat, sección del panel), con los mismos bloques de código, y actualizar `AGENTS.md` (Layout: `src/report.ts` y `monthlyReport`).
- [x] 1.9 Correr `npm run typecheck`, `npm test`, `npm run build` y `npx openspec validate --all`.
