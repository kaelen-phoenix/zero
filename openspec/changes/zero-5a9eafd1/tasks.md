# Tasks

## 1. Etapa 1: Configuración y túnel con nombre en el daemon

- [x] 1.1 OpenSpec change zero-5a9eafd1 with the control-panel delta.
- [x] 1.2 `panel.tunnel.hostname` in src/config.ts with validation and tests.
- [x] 1.3 Named mode in `tunnelKeeper` (env token, registration line, stable URL, backoff, fallback without the token, `panel.tunnelState` kv) and its wiring in src/daemon.ts, with tests in test/panel.test.ts.

## 2. Etapa 2: Estado, mensajes y documentación

- [ ] 2.1 `RemoteChatView.stable`, `FactoryStatus.tunnel`, the `Túnel:` line in src/format.ts and the CLI messages, with tests.
- [ ] 2.2 ADR 0008 (manual action, deployment, recovery, security, «no verificado»), the ADR 0007 pointer and the AGENTS.md line, with an ADR test; typecheck and the full test suite pass.
