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
- `src/budget.ts`: the single answer to "can the factory start more work?". Subscription plans are limited by their usage windows, read from each agent call's span (`quotaAttrs` in `src/agent.ts`); per-use billing by the dollar caps, each engine on its own. `pickEngine` chooses each call's engine from the station's chain (`stationChain` in `src/config.ts`: its engine, then the owner's `fallback` list); the factory pauses only when a line station has every engine of its chain paused. Engines report plan usage as `EngineResult.quota`.
- `src/state/store.ts`: SQLite state (jobs, spans, kv). `src/telemetry/`: tracer and the single definition of every metric.
- `src/line/`: the production line. `runner.ts` is the state machine (checkpoints, attempts, policy). Each station has a module (`spec`, `verify`, `review`, `integrate`); `security` reuses `review.ts` with its own instructions. `automerge.ts` merges pull requests of `autoMerge` lines once GitHub reports them ready (polled by the daemon). `policy.ts` is the only place that decides when the owner is asked. `finish.ts` is the only way a job ends.
- `src/line/scout.ts`: the night shift. While the factory is idle (no queued or running jobs, andon off, budget left, inside the optional `nightShift.hours`), the daemon runs `scoutPass` in the background: the read-only `scout` station (`agents/scout.md`) looks at each line once per period (the day, or the window) and zero keeps only the proposals that pass `filterProposals` (no protected paths, no new credentials, no repeated titles, at most 3). On per-use billing the scout spends at most `limits.usdPerNight` per period. Proposals live in the `proposals` table of `state.db`. `approveProposal`/`rejectProposal` in `app.ts` decide them; approving opens a normal job with source `{kind: 'night-shift'}`. Per-line `nightShift.autonomy` (`lineAutonomy`) is parsed but, for now, every proposal waits for the owner.
- `src/daemon.ts`: background loop. `src/mcp/server.ts`: chat tools. `src/install.ts`: client registration.
- `src/agent.ts` + `src/engines/`: engine-agnostic agent runner and one adapter per engine. `agents/*.md` holds the per-station instructions, shared by every engine.
- `src/skills.ts`: the owner's Claude Code skills (personal and plugin) assigned per agent (`stations.<agent>.skills`) and per line (`lines[].stations.<agent>.skills`): discovery, resolution, and the per-run staged copy (without `allowed-tools`) that the Claude engine loads as a local plugin, other engines get appended to their instructions, and the box mounts read-only at /skills. `agentSkills` in `app.ts` is the single read-only view (with each SKILL.md's short description) behind the panel's `/agents` cards and the chat's `zero_lines`; each agent span records `zero.skills` and `zero.skills.missing`.
- `src/townhall/`: collective memory and the owner briefing.
- `src/box/`: the isolation box. `runtime.ts` detects Podman/Docker, `status.ts` inspects and caches readiness, `image.ts` and `box/Dockerfile` build the image, `run.ts` holds every hardening flag, `executor.ts` routes shell commands and agents into the box, `agent.ts` is the entry point inside it, and `setup.ts` walks the per-platform plan with consent. `src/keychain.ts` stores credentials in the OS keychain.
- The egress gate: boxes run on an internal network with no DNS and leave only through zero's proxy. `src/box/egress.ts` holds the rules (pure), `gate.ts` is the proxy (runs in its own container via `gate-main.ts`), and `network.ts` starts it, issues one pass per box run and moves its records into `state.db`. Only `suspicious` refusals affect a job.
- `src/intake/github.ts`: GitHub issues as requests (polled by the daemon). Only issues written and labeled by people with write access; the issue hears back per job status. `src/intake/comments.ts` answers later comments from people with write access through the read-only `reply` station (no repository; zero computes where the change is), which may open a follow-up job or answer a waiting question. Factory comments carry `FACTORY_MARK`, since they are posted as the owner. Pull-request lines start each job from the remote's base (`startingBase` in the runner).
- `src/panel/`: the control panel the daemon serves on 127.0.0.1. `server.ts` (session from the key in the link's fragment, Origin checks, actions through `app.ts`), `html.ts` (server-rendered pages, including the production line view at `/line`, which refreshes its rows from a fragment pushed on the `/line/events` stream, polling as a fallback, and the read-only `/about` and `/agents` pages built from `factoryGuide` in `app.ts`), `key.ts` (key in the keychain), `tunnel.ts` (optional cloudflared quick tunnel, downloaded with consent and kept by the daemon).
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
