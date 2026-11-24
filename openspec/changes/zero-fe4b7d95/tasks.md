# Tasks

## 1. Etapa 1: Publicar y clonar las líneas

- [x] 1.1 En src/coord/protocol.ts, lineRef y un lector estricto del registro de lines/ (nombre de línea, cuenta/nombre de GitHub, rama base, comandos sin caracteres de control y con largo acotado, integrate, platforms, engines).
- [x] 1.2 Agregar platforms opcional a LineSchema y `lines` (ZERO_HOME/lines) a FactoryHome en src/home.ts.
- [x] 1.3 Nuevo src/coord/lines.ts con linesPass: publicar, decidir si la máquina la atiende (plataforma inyectable), clonar con un clonador inyectable y agregar la línea por editConfig. Estado por línea en kv coord:line:<nombre>.
- [x] 1.4 El clonador real es asíncrono y con tiempo límite, sin prompts de terminal, en carpeta temporal dentro de ZERO_HOME/lines y con rename al final; rechazar un nombre que salga de esa carpeta.
- [x] 1.5 Pase de fondo en src/daemon.ts con githubMeter (pase coord), solo con coordReady y sin GitHub en pausa, esperado en el finally y cortado al apagar; en once solo con coord inyectado.
- [x] 1.6 test/coord-lines.test.ts con dos fábricas sobre memoryCoord y repositorios bare, más el caso sin distributed.

## 2. Etapa 2: Unirse, líneas no atendidas y creación del repositorio

- [x] 2.1 joinFactory: dependencias inyectables de coord y clonador, sondeo, una corrida de linesPass, permitir volver a clonar líneas quitadas a mano y texto con el resultado.
- [x] 2.2 Explicación con gh repo create --private --add-readme en zero unirse sin argumento, inválido, público o ilegible, sin crear nada; ajustar la ayuda de src/cli.ts.
- [x] 2.3 FactoryStatus con las líneas no atendidas o con clon fallido, en formatStatus y en el resumen del panel, solo con distributed.
- [x] 2.4 Tests en test/coord-daemon.test.ts o test/coord-lines.test.ts y revisar test/wording.test.ts.

## 3. Etapa 3: Estaciones de paquetes fijadas a una máquina

- [x] 3.1 machine y machines en PackageEntrySchema (src/config.ts), y problema de paquete para una estación inexistente en src/packages.ts.
- [x] 3.2 Un único predicado runsHere(ctx, station) con machineIdentity (nombre sin distinguir mayúsculas, o id), usado en packagesPass, busyPass, scheduledPass, onDemandPass, onDemandPending, whenBusyStations y como última barrera en runTurn antes de importar el módulo.
- [x] 3.3 Rechazo en stationForRun y en la subida nombrando la máquina, y la máquina fijada en zero package list y en el panel de paquetes.
- [x] 3.4 test/package-machine.test.ts, el bloque de ejemplo en los dos README y docs/agents/packages.md.

## 4. Etapa 4: Gasto publicado y topes en dólares

- [x] 4.1 Nuevo src/coord/spend.ts: armar el registro con tramos de 15 minutos a partir de los spans, publicarlo solo si cambió, leer y validar los ajenos y guardarlos en kv coord:spend.
- [x] 4.2 Llamarlo desde coordPass después del latido y solo con coordReady.
- [x] 4.3 Sumar lo ajeno en billedToday, spentToday, scoutSpent y jobBilledUsd solo con distributed, pasando la configuración donde hoy solo llega store. Un tramo que cruza el inicio del período cuenta entero.
- [x] 4.4 Actualizar las llamadas en src/line (scout, research, recruit, unjam, packages, runner) y en app.ts.
- [x] 4.5 test/coord-spend.test.ts, y que test/budget.test.ts pase sin cambios de resultado.

## 5. Etapa 5: Cupo de suscripción común y vista del presupuesto

- [x] 5.1 Incluir la última lectura de plan por motor en spend/<id> y combinarla en readings() de src/budget.ts: gana la más nueva solo si la local también es de suscripción.
- [x] 5.2 Una lectura ajena sin lectura local solo puede pausar; no cambia la forma de cobro ni quita topes.
- [x] 5.3 Rotular la suma como de toda la fábrica en budgetLine, el panel y zero_status, solo si hay gasto o lecturas ajenas.
- [x] 5.4 Tests de ventana agotada, reserva, cobro por uso local, falta de lectura local y texto sin distributed.

## 6. Etapa 6: Estado de toda la fábrica

- [ ] 6.1 Nuevo src/coord/status.ts: armar, publicar por cambio y validar status/<id> (trabajos, pregunta, propuestas pendientes), con textos por scrubLocal y sin secretos, y guardar los ajenos en kv coord:status.
- [ ] 6.2 factoryView en src/app.ts que junta lo local y lo ajeno por id según el claim, sin duplicar copias importadas, con nombre de máquina y si está viva.
- [ ] 6.3 Usarlo en formatStatus, zero status <id>, zero_status, el resumen, Pedidos y detalle de trabajo del panel, escapando el texto ajeno y tratándolo como dato.
- [ ] 6.4 test/coord-status.test.ts con dos fábricas, más la comparación de texto y HTML sin distributed.

## 7. Etapa 7: Pedir, responder y decidir desde cualquier máquina

- [ ] 7.1 Buzón local kv coord:outbox:<id> que escriben la CLI, el chat y el panel; coordPass lo publica una sola vez, también después de una pausa de GitHub, y guarda el resultado.
- [ ] 7.2 Registros decisions/ con lector estricto (trabajo y askedAt, o propuesta); la máquina dueña aplica con answerJob, approveProposal o rejectProposal, y borra lo atendido.
- [ ] 7.3 answer, confirmRemoteAction, zero_answer, zero_proposal_decide, zero approve, zero proposals y los formularios del panel aceptan trabajos y propuestas ajenos. La retención delicada usa la pregunta de la vista común.
- [ ] 7.4 requestWork para líneas publicadas que no están acá: entra al buzón como registro de queue/ con las necesidades de la línea, sin trabajo local.
- [ ] 7.5 test/coord-actions.test.ts con dos y tres fábricas, carreras, pregunta vieja, chat remoto retenido y pausa de GitHub.

## 8. Etapa 8: Guía de Linux y documentación

- [ ] 8.1 Sección de máquina Linux en la nube en README.md y README.es.md, con los mismos bloques: Node 22, git y gh, Podman sin root, llavero (Secret Service), zero init, zero setup, zero box setup, zero autostart on, loginctl enable-linger, gh auth login, claude setup-token y zero secret set, zero unirse, zero panel remote on.
- [ ] 8.2 Actualizar la sección de varias máquinas en ambos: cola común, clonado, presupuesto común, control desde cualquiera, platforms, y recomendar integrate: pull-request para líneas compartidas.
- [ ] 8.3 ADR 0007: lines/, spend/, status/ y decisions/, la excepción de agregar líneas nuevas y quitar esto de Después; ampliar test/adr-distribuida.test.ts.
- [ ] 8.4 docs/agents/distributed.md, daemon.md, engines.md y panel.md; test/docs.test.ts para la guía; npx openspec validate --all.
