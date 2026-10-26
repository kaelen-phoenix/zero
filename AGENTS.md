# zero

A software factory that runs on its owner's machine. Agents of any vendor work on this repo, so keep this file accurate. `CLAUDE.md` only points here.

## Commands
- `npm run typecheck`: TypeScript, strict, including tests
- `npm test`: Vitest (`test/`); uses real git in temp repos and fake agents, never a model
- `npm run build`: compiles `src/` to `dist/` (the MCP server and the daemon run from `dist/cli.js`)
- `npx openspec validate --all`: specs and changes under `openspec/`

## Layout
- `src/cli.ts`: commands. `src/app.ts`: operations shared by the CLI, the MCP server and the daemon (request, status, answer, stop, briefing, trace). Never duplicate logic between interfaces; add it here.
- `src/config.ts`: `zero.factory.yaml` schema, effective level. `src/init.ts`: `zero init`, `zero line add`. `src/home.ts`: `ZERO_HOME` layout.
- `src/state/store.ts`: SQLite state (jobs, spans, kv). `src/telemetry/`: tracer and the single definition of every metric.
- `src/line/`: the production line. `runner.ts` is the state machine (checkpoints, attempts, policy). Each station has a module (`spec`, `verify`, `review`, `integrate`). `policy.ts` is the only place that decides when the owner is asked. `finish.ts` is the only way a job ends.
- `src/daemon.ts`: background loop. `src/mcp/server.ts`: chat tools. `src/install.ts`: client registration.
- `src/agent.ts` + `src/engines/`: engine-agnostic agent runner and one adapter per engine. `agents/*.md` holds the per-station instructions, shared by every engine.
- `src/townhall/`: collective memory and the owner briefing.
- `src/box/`: the isolation box. `runtime.ts` detects Podman/Docker, `status.ts` inspects and caches readiness, `image.ts` and `box/Dockerfile` build the image, `run.ts` holds every hardening flag, `executor.ts` routes shell commands and agents into the box, `agent.ts` is the entry point inside it, and `setup.ts` walks the per-platform plan with consent. `src/keychain.ts` stores credentials in the OS keychain.
- The egress gate: boxes run on an internal network with no DNS and leave only through zero's proxy. `src/box/egress.ts` holds the rules (pure), `gate.ts` is the proxy (runs in its own container via `gate-main.ts`), and `network.ts` starts it, issues one pass per box run and moves its records into `state.db`. Only `suspicious` refusals affect a job.
- `src/panel/`: the control panel the daemon serves on 127.0.0.1. `server.ts` (session from the key in the link's fragment, Origin checks, actions through `app.ts`), `html.ts` (server-rendered pages), `key.ts` (key in the keychain), `tunnel.ts` (optional cloudflared quick tunnel, downloaded with consent and kept by the daemon).
- `openspec/`: specs (`specs/`) and changes (`changes/`). `docs/adr/`: decisions.

## Conventions
- ESM, Node 22, imports with the `.js` suffix. User-facing text is in Spanish; code, comments and agent instructions are in English.
- Engine-specific behaviour stays in `src/engines/`; nothing else may assume a vendor.
- Guarantees are enforced by zero, never trusted to an engine: read-only stations, timeouts, schema validation, verify gate, protected paths, citation checks, isolation box, egress gate.
- The chat may only tighten egress rules (block); allowing a site or changing the mode is for the owner on the terminal or in the file.
- Nothing installs software or needs admin without the owner's explicit consent. Secrets never go in argv, files or logs.
- The line never blocks on the owner: questions park a job, carry a timeout and a default answer, and approvals resume from a checkpoint.
- Every job end goes through `finalizeJob`, so it gets a final status, a closed job span and a townhall report.
- The townhall must never break production: store failures are logged, not thrown.
- Behaviour changes start as an OpenSpec change under `openspec/changes/`.
