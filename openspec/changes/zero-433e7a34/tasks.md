# Tasks

## 1. Implementación

- [x] 1.1 Run `git fetch origin` and `git merge --no-ff origin/zero/7dd6e0f1` (head b02d8f28) into this job's branch. Do not rebase or force-push.
- [x] 1.2 Resolve each conflicted file (AGENTS.md, README.md, README.es.md, src/app.ts, src/cli.ts, src/config.ts, src/daemon.ts, src/format.ts, src/panel/html.ts, src/state/store.ts, src/townhall/briefing.ts and any others). Keep everything from main, then add the PR's additions on top: config schema keys, daemon passes and their awaits on exit, FactoryStatus fields, format lines, panel bits, store tables and columns, and CLI commands.
- [x] 1.3 In src/townhall/briefing.ts and its caller `briefing` in src/app.ts, keep main's positional arguments `…, billing, jams, install` and put the PR's new section argument after `install`. Do the same for the sections rendered.
- [x] 1.4 In src/daemon.ts, keep main's passes (checkInstall, unjam, resendRefused, retryCleanups, billing, alerts, and so on) and add the PR's self-update pass. Compare `git diff b02d8f28 HEAD -- src/daemon.ts` with `git diff origin/main...HEAD -- src/daemon.ts` to make sure neither side lost a pass. If the PR's self-update duplicates what install-freshness already does (git fetch / behind checks), reuse `install:freshness` and its functions instead of keeping two copies of the logic. (Kept as is: the self-update prepares and switches a new version, install freshness only reports; the merge keeps both passes and their awaits on exit.)
- [x] 1.5 Rename docs/adr/0004-autoactualizacion.md to docs/adr/0005-autoactualizacion.md, change its header to `# ADR 0005 — …`, and update every reference to it (AGENTS.md, READMEs, specs, code comments). Leave docs/adr/0004-servidores-mcp.md untouched.
- [x] 1.6 Make sure the PR's openspec change folder (openspec/changes/zero-7dd6e0f1 or similar) validates against main's current specs. If a requirement name now collides with a main spec, rename it.
- [x] 1.7 Update AGENTS.md (and both READMEs symmetrically if the PR documents setup) so they describe the self-update next to install freshness, in the house style.
- [x] 1.8 Run `git grep -nE '^(<<<<<<<|>>>>>>>)( |$)'` and check that it finds nothing. Then run `npm run typecheck`, `npm test` and `npx openspec validate --all`, fix any failures, and leave the merge staged for the factory's commit.
