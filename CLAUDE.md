# zero

Orchestrator of Kaelen's autonomous agent network. Agents (including zero's own) work on this repo, so keep this file accurate.

## Commands
- `npm run typecheck` — TypeScript, strict
- `npm test` — Vitest (`test/`)
- `npm run build` — compiles `src/` to `dist/`
- `npm run dev -- tick` — run locally with tsx (needs `ANTHROPIC_API_KEY`, `GH_TOKEN`, `GITHUB_REPOSITORY`)

## Layout
- `src/pipeline.ts` — task state machine (plan → code → verify → review → PR). Pure orchestration; all I/O is injected.
- `src/agent.ts` — Claude Agent SDK wrapper; per-role tool allowlists live here.
- `src/tracker.ts` — GitHub Issues/PRs. `src/workspace.ts` — git + verify commands.
- `agents/*.md` — role system prompts appended to the Claude Code preset.
- `zero.config.json` — per-repo config, validated by `src/config.ts`.

## Conventions
- ESM, Node 22, imports with `.js` suffix.
- New I/O goes behind an interface so `pipeline.ts` stays testable with fakes.
- Every pipeline exit must leave the issue in a terminal label state with a comment.
