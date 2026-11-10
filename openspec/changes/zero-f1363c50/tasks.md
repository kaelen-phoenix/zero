# Tasks

## 1. Etapa 1: Configuración, registros y sección del informe

- [x] 1.1 Add the optional strict `services` section to `LineSchema` with config tests.
- [x] 1.2 Create src/billing/ types, reader interface, registry and kv keys (no adapters yet).
- [x] 1.3 Extend `LineReport`, `monthlyReport` and the Markdown/HTML renderers with the Servicios section and the factory + services total, reading only stored kv records; lines without services render unchanged.
- [x] 1.4 Tests in test/report.test.ts and test/config.test.ts; run them focused plus typecheck.

## 2. Etapa 2: Adaptadores de GitHub, Vercel y Supabase

- [ ] 2.1 Implement the three readers with injected fetch, 10 s timeout, secrets from SecretStore (`GITHUB_BILLING_TOKEN` falling back to the factory GitHub token, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`), fixed sin-dato reasons and no token/body in logs.
- [ ] 2.2 Tests with fake fetch in test/billing.test.ts.

## 3. Etapa 3: Pasada diaria del daemon

- [ ] 3.1 Implement `billingPass` with the once-per-local-day mark and the previous-month closing read.
- [ ] 3.2 Wire it into src/daemon.ts with `DaemonOptions.billing`, off in `once` runs unless injected.
- [ ] 3.3 Tests with fake readers and a moving clock.

## 4. Etapa 4: Documentación

- [ ] 4.1 Document services, secrets, daily read and sin dato in README.md and README.es.md with identical structure and code blocks; update AGENTS.md.
- [ ] 4.2 Run test/docs.test.ts and test/wording.test.ts.
