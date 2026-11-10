# Tasks

## 1. Implementación

- [x] 1.1 `networkCreateArgs` in src/box/network.ts: `--disable-dns` for Podman only.
- [x] 1.2 `ensure` makes again a Podman network that has the name server, when only this factory's gate is on it; otherwise it logs a warning and goes on.
- [x] 1.3 Tests in test/egress.test.ts; the real check is `box (podman)` in CI (test/box.e2e.test.ts).
