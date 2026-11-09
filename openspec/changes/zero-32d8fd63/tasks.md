# Tasks

## 1. Implementación

- [ ] 1.1 Create openspec/changes/zero-32d8fd63/ with proposal.md (Spanish Why, What Changes, Capabilities: Modified `production-line`), tasks.md and specs/production-line/spec.md with the three requirements above under `## ADDED Requirements` (new names, not MODIFIED); check `npx openspec validate --all`.
- [ ] 1.2 In src/engines/cli.ts add an exported constant or regex for the OpenAI out-of-credit texts (`insufficient_quota`, `You exceeded your current quota`, case-insensitive) and an exported pure helper, e.g. `codexOutOfCredit(stdout, stderr)`. It returns true when stderr or `codexError(stdout)` matches.
- [ ] 1.3 Extend `codexQuota` with an optional fourth parameter (the failure's out-of-credit flag, or stdout/stderr). When `!ok`, the flag is set and the session is not `subscription`, it returns `{ billing: "api", windows: [], limited: true }`; everything else stays as it is. Update its doc comment.
- [ ] 1.4 In `runCodex`, change the `quota` hook to pass `r.stdout` and `r.stderr` (through the helper) to `codexQuota`.
- [ ] 1.5 Add tests to test/engines.test.ts (import `codexQuota` and the helper) with sample JSONL outputs: turn.failed with insufficient_quota, stderr with `You exceeded your current quota`, top-level error event with unknown session, common error, success whose answer mentions the text, subscription with an exhausted window, unknown billing.
- [ ] 1.6 Add a test to test/budget.test.ts: a codex reading `{ billing: "api", windows: [], limited: true }` at 15:00 pauses codex at 15:05 until 15:15 with the reason `la clave de API se quedó sin saldo`, and no longer at 15:16.
- [ ] 1.7 Add a short mention to AGENTS.md's `src/agent.ts + src/engines/` paragraph (the codexQuota sentence): a failed call whose stderr or last error event says insufficient_quota / You exceeded your current quota counts as `api` and `limited`.
- [ ] 1.8 Run npm run typecheck, npm test and npx openspec validate --all.
