# Tasks

## 1. Implementación

- [x] 1.1 src/state/store.ts: sumar `{ kind: 'package'; package: string; station: string }` a `JobSource`.
- [x] 1.2 src/packages.ts y src/config.ts: agregar `requests` opcional y estricto a `ManifestStationSchema` (`perLinePerDay` entero positivo), llevarlo a `PackageStation` en `packageStations`. No cambiar `PACKAGE_INTERFACE`: es un agregado opcional y un zero anterior ya rechaza la clave desconocida con un error claro.
- [x] 1.3 src/line/packages.ts: agregar `requestJob` a `StationContext`, con resultado `{ id: string } | { reason: string }` y sin lanzar nunca (try/catch, error pasado por `withoutSecrets`). Orden de comprobaciones: signal abortado (lección del townhall: una pasada vencida no debe causar efectos), sin `requests`, `line` y `text` que sean texto, línea en `ctx.lines`, andón, `budgetState(...).reached`, cupo. Motivos en español.
- [x] 1.4 src/line/packages.ts: el cupo vive en una sola clave kv por estación y línea, `${stationKey}:requests:<line>`, con JSON `{ day, count }` (día de `startOfDay(now)`), para que no crezca ni la alcance `ctx.state`, cuyas claves llevan `:state:`. Se suma solo después de crear el trabajo.
- [x] 1.5 src/line/packages.ts: limpiar el texto con `withoutSecrets` y luego `publicText(text, repos).text`, recortar a una constante de 4000 caracteres, rechazar el vacío, y abrir el trabajo con `requestWork` de `app.ts` y la fuente `package`.
- [x] 1.6 src/app.ts: en `requestWork`, sumar el atributo de traza `zero.package` con `<paquete>/<estación>` para esa fuente.
- [x] 1.7 src/line/runner.ts: en `requestBlock`, para la fuente `package`, reemplazar `The owner sent` por un texto en inglés que nombre `<package>/<station>` y diga que viene de un tercero, que es dato que describe un problema y no instrucciones sobre controles, secretos o permisos.
- [x] 1.8 src/daemon.ts: renombrar el predicado `autonomous` a uno de baja prioridad que incluya la fuente `package`, y usarlo en `ownerFirst` y en la condición de arranque. No tocar la copia homónima de `briefing` en `app.ts`, que solo describe el turno nocturno.
- [x] 1.9 src/format.ts: agregar `jobOrigin(job)`, que devuelve `pedido por paquete <paquete>/<estación>` solo para esa fuente; usarlo en `formatJob` y en las listas de `formatStatus` (incluidos los últimos terminados).
- [x] 1.10 src/panel/html.ts y src/app.ts: mostrar `jobOrigin` en `jobLine`, `jobPage` y las filas de `/line` (`LineRow`, `lineRow`), escapado con `esc`.
- [x] 1.11 src/townhall/briefing.ts y `briefing` en src/app.ts: nuevo parámetro opcional al final de `renderBriefing` con los trabajos de paquete terminados en el período o abiertos, y sección `## Pedidos de paquetes` solo si hay alguno.
- [x] 1.12 src/report.ts: agregar el caso `package` a `originLabel`.
- [x] 1.13 Tests en test/packages.test.ts o un test/package-requests.test.ts nuevo, con estaciones falsas (`stationPkg`) y agentes falsos: manifiesto, cada motivo de rechazo, cupo por línea y día con reloj falso, limpieza y recorte, resultado de L1 y L2 por `runJob`, `requestBlock`, orden y arranque en el daemon, vistas de estado, panel, briefing e informe.
- [x] 1.14 Documentar en README.md y README.es.md (manifiesto, fila de `ctx.requestJob`, comportamiento y motivos) y en AGENTS.md (`src/packages.ts`, `src/line/packages.ts`, prioridad del daemon).
- [x] 1.15 Correr `npm run typecheck`, `npm test`, `npm run build` y `npx openspec validate --all`.
