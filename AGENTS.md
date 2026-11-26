# zero

A software factory that runs on its owner's machine. Agents of any vendor work on this repo, so keep this file and the area files under `docs/agents/` accurate. `CLAUDE.md` only points here.

## Commands
- `npm run typecheck`: TypeScript, strict, including tests
- `npm test`: Vitest (`test/`); uses real git in temp repos and fake agents, never a model
- `npm run build`: compiles `src/` to `dist/` (the MCP server and the daemon run from `dist/cli.js`)
- `npx openspec validate --all`: specs and changes under `openspec/`

## Areas
Where each part of the code lives and how it behaves, one file per area:
- [Core](docs/agents/core.md): commands and shared operations, the factory file, ZERO_HOME, state, telemetry, process spawning and the repository's documentation.
- [Daemon](docs/agents/daemon.md): the background loop, job priorities, the single-daemon lock, the chat's MCP server and the factory's share of the GitHub quota.
- [Production line](docs/agents/production-line.md): the line's state machine, its stations, verify, the dependency check, the regeneration drill and how a job ends.
- [Auto-merge](docs/agents/auto-merge.md): pull requests after delivery: automatic and requested merges, conflicts, failed checks, outages, billing, cancelled runs and trains.
- [Night shift](docs/agents/night-shift.md): what the factory does while idle: scout, research, unjam, and the reverts of what it integrated on its own.
- [Packages](docs/agents/packages.md): agent packages: manifests, stations, tabs, repositories, and packages installed from git.
- [Engines and agents](docs/agents/engines.md): the budget, the engine-agnostic agent runner and its adapters, custom agents, the agent catalog, the recruiter and skills.
- [Panel](docs/agents/panel.md): the control panel, the remote chat and its tunnel.
- [Reports](docs/agents/reports.md): the townhall, the monthly report and the billing of external services.
- [Box and egress](docs/agents/box-and-egress.md): Docker, the isolation box and the egress gate.
- [Intake](docs/agents/intake.md): where requests come from: GitHub issues and comments, proposals and research as issues, Linear, Jira and Dependabot alerts.
- [Distributed factory](docs/agents/distributed.md): several machines working as one factory: machine identity and capabilities, the coordination protocol, the heartbeat pass and joining.
- [Self-update](docs/agents/self-update.md): how far the installed copy is from what was merged, and the factory updating itself.
- [Site](docs/agents/site.md): the one-step installer and the brand files served by the site.

## Conventions
- What the factory produces while working (reports, briefings, proposals, notes, traces, media, panel exports, `state.db`, logs, any file of ZERO_HOME) stays only in ZERO_HOME, and only development for a repository enters it. Zero enforces it (`operationArtifacts`, `allowedArtifacts` per line, `saveReport`), so new output goes under `FactoryHome`, never in a repository or the current folder.
- ESM, Node 22, imports with the `.js` suffix. What zero shows the owner (CLI, panel, chat) is in Spanish; code, comments and agent instructions are in English.
- What a person reads says "vos" or "you"; in the third person (documentation, the site, issues, the monthly report) it says "la persona responsable", "quien está a cargo" or "the person in charge". Internal names, configuration, agent instructions and tests may say owner. `test/wording.test.ts` checks it.
- The README is kept in both languages: English in `README.md` and Spanish in `README.es.md`, with the same structure and the same code blocks (`test/docs.test.ts` checks it). Every documentation change is made in both; what zero shows the owner (CLI, panel, chat) stays in Spanish.
- Engine-specific behaviour stays in `src/engines/`; nothing else may assume a vendor.
- Guarantees are enforced by zero, never trusted to an engine: read-only stations, timeouts, schema validation, verify gate, protected paths, citation checks, isolation box, egress gate.
- The chat may only tighten egress rules (block); allowing a site or changing the mode is for the owner on the terminal or in the file.
- Nothing installs software or needs admin without the owner's explicit consent. Secrets never go in argv, files or logs.
- The line never blocks on the owner: questions park a job, carry a timeout and a default answer, and approvals resume from a checkpoint.
- No commit, branch, pull request or comment carries attribution to an AI tool (no `Co-Authored-By` of a vendor account, session trailers or links, "Generated with ..."), whichever engine or person worked; a person's co-authorship is kept. The list of what counts as AI attribution lives only in `src/attribution.ts`, and zero strips it from what it commits and publishes.
- Every job end goes through `finalizeJob`, so it gets a final status, a closed job span and a townhall report.
- The townhall must never break production: store failures are logged, not thrown.
- Behaviour changes start as an OpenSpec change under `openspec/changes/`.
- Each change documents its behaviour in the file of its area under `docs/agents/`, never here. AGENTS.md is edited only to add the link of a new area (a new file under `docs/agents/`) or to change the commands or the conventions.
