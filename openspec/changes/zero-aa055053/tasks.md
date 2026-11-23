# Tasks

## 1. Etapa 1: On-demand pass and daemon

- [ ] 1.1 Add the request and record types, keys and readers in src/line/unjam.ts, with keys that cannot collide with a line's `unjam:<line>`
- [ ] 1.2 Give unjamPass the on-demand scope and a per-line result, keeping its regular behaviour and body order so zero/668cc221's discardResolved call merges before the line loop
- [ ] 1.3 Add unjamOnDemandPass and closeInterruptedUnjam
- [ ] 1.4 Add requestUnjam and waitUnjamStart in src/app.ts
- [ ] 1.5 Add DaemonOptions.unjamOnDemand and the daemon's background pass, run between idle steps and never with another unjam pass, with its shutdown and the closing of an interrupted record at start
- [ ] 1.6 Tests in test/unjam-on-demand.test.ts for the request, refusals, gates, limits, record, daemon and the job closed before the run (plus discardResolved when src/line/discard.ts is in the base)
- [ ] 1.7 Document it in docs/agents/night-shift.md and docs/agents/daemon.md

## 2. Etapa 2: Terminal, chat, status and briefing

- [ ] 2.1 Add the FactoryStatus field with the pending request, the last run, whether it is on and the non-package lines
- [ ] 2.2 Add the formatters and show them in formatStatus and in the briefing's 'Corridas a demanda' section
- [ ] 2.3 Add `zero destrabar [línea]` with its usage text, and the `zero_unjam` tool with the same start wait as zero_package_run
- [ ] 2.4 Tests for status, briefing, CLI help and refusal, the chat tool (including the read-only remote chat) and the tool list in test/interface.test.ts

## 3. Etapa 3: Panel and documentation

- [ ] 3.1 Add the 'Destrabar ahora' form with its line choice, the pending request and the last run to overviewPage, and POST /unjam in src/panel/server.ts
- [ ] 3.2 Update the destrabador's text on the Agentes page and the opening of agents/unjam.md
- [ ] 3.3 Tests for the panel form, the hidden form with unjam off, the POST and its session and origin checks
- [ ] 3.4 Update the unjam sections of README.md and README.es.md with the same structure, and docs/agents/panel.md
