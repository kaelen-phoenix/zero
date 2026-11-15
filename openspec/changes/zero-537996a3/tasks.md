# Tasks

## 1. Etapa 1: Documento de decisión y numeración de ADR

- [x] 1.1 Rename 0005-autoactualizacion.md to 0006-autoactualizacion.md (header ADR 0006).
- [x] 1.2 Write docs/adr/0007-fabrica-distribuida.md covering every topic.
- [x] 1.3 Add test/adr-distribuida.test.ts, with the prefix uniqueness check.
- [x] 1.4 Add the OpenSpec change skeleton (proposal, tasks, spec delta for distributed-factory).

## 2. Etapa 2: Configuración distribuida e identidad de máquina

- [x] 2.1 Add the optional strict `distributed` block to FactorySchema with its refinement and tests.
- [x] 2.2 Add src/machine.ts (machineIdentity, machineCapabilities) with tests.

## 3. Etapa 3: Protocolo de coordinación

- [ ] 3.1 Add src/coord/protocol.ts (CoordApi, CoordConflict, memoryCoord, claimJob, stillHolds, releaseJob, heartbeat, listMachines) with tests.
- [ ] 3.2 Add src/coord/github.ts (githubCoord over git refs, 422 mapped to CoordConflict) and the `coord` GithubPass, with stubbed-Octokit tests.

## 4. Etapa 4: Latido en el daemon, máquinas en el estado y zero unirse

- [ ] 4.1 Add the daemon coordination pass, gated on `distributed`, heartbeatSeconds and githubHalt, with DaemonOptions.coord and kv `coord:machines`, plus tests.
- [ ] 4.2 Show FactoryStatus.machines in formatStatus' `Máquinas:` block and the panel summary, with tests.
- [ ] 4.3 Add joinFactory in app.ts and the CLI `zero unirse`, with the public repository refused, plus tests.
- [ ] 4.4 Update README.md, README.es.md and AGENTS.md. Run typecheck, tests and openspec validate.
