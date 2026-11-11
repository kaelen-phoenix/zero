# Tasks

## 1. Etapa 1: Daemon state, status texts and crash revival

- [x] 1.1 OpenSpec change zero-5df20f11 with the factory-daemon and factory-config deltas for the whole request
- [x] 1.2 daemon.ts: stop record on clean exit, keep the heartbeat on error exit, clear the stop record on start
- [x] 1.3 app.ts: DaemonInfo.state/since in factoryStatus, and reviveDaemon with an injectable starter
- [x] 1.4 format.ts: texts for stopped and crashed
- [x] 1.5 cli.ts: revival after every command except start and shutdown (message on stderr)
- [x] 1.6 mcp/server.ts: revival in withFactory and at startup when autoStart is on, with an injectable starter
- [x] 1.7 Tests for states, error exit, reviveDaemon, formatStatus and MCP revival

## 2. Etapa 2: Login autostart registration

- [x] 2.1 config.ts: `autostart` boolean, default false
- [x] 2.2 src/autostart.ts: per-platform entries and an idempotent syncAutostart with injected fs, runner, platform and env; no-op in a container
- [x] 2.3 app.ts setAutostart and the CLI command `zero autostart on|off` (no MCP tool)
- [x] 2.4 daemon.ts: syncAutostart at start and when the config value changes, with failures only logged
- [x] 2.5 test/autostart.test.ts and config tests

## 3. Etapa 3: Setup wizard and documentation

- [ ] 3.1 setup.ts: consent question outside a container, written to the file, syncAutostart injectable through SetupDeps; cli.ts passes the real one
- [ ] 3.2 setup-wizard tests for yes, no and container
- [ ] 3.3 README.md and README.es.md sections in parallel, AGENTS.md updated; typecheck, tests and openspec validate pass
