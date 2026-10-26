# zero

Orchestrator of Kaelen's autonomous agent network. Agents of any vendor (Claude Code, Codex, Antigravity, ...) work on this repo, so keep this file accurate. `CLAUDE.md` only points here.

## Commands
- `npm run typecheck` — TypeScript, strict
- `npm test` — Vitest (`test/`)
- `npm run build` — compiles `src/` to `dist/`
- `npm run dev -- tick` — run locally with tsx (needs the engine's API key, `GH_TOKEN`, `GITHUB_REPOSITORY`)

## Layout
- `src/pipeline.ts` — task state machine (plan → code → verify → review → PR). Pure orchestration; all I/O is injected.
- `src/agent.ts` — engine-independent agent runner: role instructions, structured output (zod → JSON Schema, validated), JSON extraction for engines without native schemas.
- `src/engines/` — one adapter per agent: `claude.ts` (Agent SDK), `cli.ts` (codex, antigravity, custom CLIs from config). `types.ts` is the contract.
- `src/tracker.ts` — GitHub Issues/PRs. `src/workspace.ts` — git + verify commands.
- `agents/*.md` — role instructions, shared by every engine.
- `zero.config.json` — per-repo config, validated by `src/config.ts`.

## Conventions
- ESM, Node 22, imports with `.js` suffix.
- New I/O goes behind an interface so `pipeline.ts` stays testable with fakes.
- Engine-specific behaviour stays in `src/engines/`; nothing else may assume a vendor.
- Guarantees that matter (read-only roles, timeouts, schema validation, verify gate) are enforced by zero itself, not trusted to the engine.
- Every pipeline exit must leave the issue in a terminal label state with a comment.
