# Proposal

## Why

Vas a poder llamar al destrabador cuando quieras, aunque haya trabajos en cola o corriendo y fuera del horario nocturno. Se pide de tres formas: con `zero destrabar [línea]` en la terminal, desde el chat, o con el botón «Destrabar ahora» del panel, para una línea o para todas. Usa la misma lógica y los mismos límites que la pasada normal: trabajos por día, no repetir títulos, autonomía de cada línea y tope de gasto nocturno. Con la fábrica detenida (andon), sin presupuesto o con el destrabador apagado, el pedido se rechaza y te dice por qué. Si el andon o el presupuesto aparecen después de pedirlo, el pedido queda pendiente. Hay un solo pedido pendiente por vez y nunca corren dos diagnósticos juntos. En el estado, el panel y el briefing vas a ver cuándo lo pediste, cuándo empezó, cómo terminó y qué encontró en cada línea. El trabajo 668cc221 (comando descartar y limpieza) todavía no está en main. El pedido a demanda pasa por la misma pasada donde ese trabajo engancha el cierre de los trabajos ya resueltos, así que cuando los dos estén, «destrabar» también los va a cerrar solo.

## What Changes

- Destrabador a demanda (zero destrabar)
- Supuesto: Branch zero/668cc221 (etapa 4 de 4) is not in this job's base. Both touch src/line/unjam.ts, src/daemon.ts, src/cli.ts, src/mcp/server.ts, the panel, the READMEs and the tool list of test/interface.test.ts, so whichever merges second will need small conflict resolutions. This change must not reimplement discardResolved or discardJob.
- Supuesto: Assumption: 'cuando yo quiera' means ignoring nightShift.hours, `nightShift: off` and the once-per-period rule, but keeping `unjam: off`. The run does not use up the line's regular turn, as with the packages' on-demand runs.
- Supuesto: Assumption: one pending request in the whole factory. Another can be asked for while a run is under way, and it waits for it.
- Supuesto: To respect usdPerNight and never overlap two diagnoses, a request that arrives during the idle run (scout, research) waits for the current step to end, so the start may be delayed several minutes.
- Supuesto: Assumption: over the remote chat, zero_unjam is not held for confirmation, like zero_package_run. It needs the act scope.
- Supuesto: With an engine with no sandbox of its own and no box, passExecute waits for the jobs running in the line's folder before the call, so the run may show as started while it waits.
- Supuesto: Until 668cc221 is in, the on-demand run still diagnoses failed jobs whose work is already in main.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Destrabador a demanda (zero destrabar)

## Impact

Generado por zero para el trabajo aa055053.
