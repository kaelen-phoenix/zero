# Tasks

## 1. Implementación

- [x] 1.1 Create the OpenSpec change under `openspec/changes/<job>/` (proposal.md, tasks.md, specs/production-line/spec.md with ADDED Requirements in Spanish, following the format of earlier changes such as `openspec/changes/zero-27c58cd5`). Run `npx openspec validate --all`.
- [x] 1.2 In `src/engines/cli.ts` `codexInvocation`, add `"-c", "mcp_servers={}"` to the args in both sandbox modes. Put it after the sandbox/approval flags, so that `args.indexOf("-c")` in `test/codex-sandbox.test.ts` (`pairAt`) still finds `approval_policy="never"` first, and keep `-` as the last argument. Optionally add a one-line comment that it keeps the user's MCP servers (zero's own chat server included) away from factory agents.
- [x] 1.3 In `test/engines.test.ts` (describe "codex"), add a test that checks the `-c` / `mcp_servers={}` adjacent pair for read, web and write with sandbox on, and for sandbox off (`codexInvocation(req, files, "off")`).
- [x] 1.4 In `test/codex-sandbox.test.ts`, extend the sandbox-off engine run test (fake.runs) and the inside-the-box test so both assert that the args contain the `-c` `mcp_servers={}` pair.
- [x] 1.5 Update `docs/adr/0004-servidores-mcp.md`. In «Qué carga cada motor hoy», add a Codex bullet saying it runs with `-c mcp_servers={}` in `codexInvocation` (sandbox on and off, and inside the box), and narrow the existing bullet to opencode and agy (still not verified). Reword the first «Próximos pedidos» item to opencode and agy only, and add an item to confirm with a real codex run that the override empties the user's servers. Adjust «Consecuencias» accordingly. Keep the sections and words that `test/adr-mcp.test.ts` checks.
- [x] 1.6 Extend `test/adr-mcp.test.ts` with an assertion that the ADR contains `mcp_servers={}`.
- [x] 1.7 Run `npm run typecheck` and `npm test`.
