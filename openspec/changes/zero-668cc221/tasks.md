# Tasks

## 1. Etapa 1: Box and install noise

- [x] 1.1 Create the OpenSpec change openspec/changes/zero-668cc221 with all requirements.
- [x] 1.2 collectJams: single box jam on the first non-package line; install jam text with the real selfUpdate setting.
- [x] 1.3 jamViews: dedupe machine causes with the same title across lines.
- [x] 1.4 install-freshness: staleBuild false when HEAD is the last self-updated commit and src is clean; recheck after an update.
- [x] 1.5 Tests in test/unjam.test.ts and test/install-freshness.test.ts; document in docs/agents/night-shift.md and docs/agents/self-update.md.

## 2. Etapa 2: Discard operation and CLI

- [ ] 2.1 MergeApi.close (optional) in githubMerges and signedMerges.
- [ ] 2.2 src/line/discard.ts discardJob with PR close, comment, local and remote branch deletion, finalizeJob(stopped); discardedByYou in finish.ts.
- [ ] 2.3 jamViews drops causes whose jobs are all closed.
- [ ] 2.4 `zero descartar <trabajo> [--motivo]` in src/cli.ts.
- [ ] 2.5 test/discard.test.ts with real git temp repos and a fake MergeApi; docs/agents/production-line.md and both READMEs.

## 3. Etapa 3: Discard in the chat and the panel

- [ ] 3.1 zero_discard MCP tool through delicate, RemoteAction variant and its description.
- [ ] 3.2 Panel POST /job/<id>/discard and a 'Descartar' form on the job page.
- [ ] 3.3 Tests modelled on test/mcp-remote.test.ts and test/panel.test.ts; docs/agents/panel.md.

## 4. Etapa 4: Automatic cleanup of resolved failed jobs

- [ ] 4.1 discardResolved in src/line/discard.ts (PR merged, branch in base, same content in base).
- [ ] 4.2 Call it at the start of unjamPass/urgentUnjamPass and as a throttled daemon pass.
- [ ] 4.3 Tests for merged, cherry-picked, PR merged, real failure, and unjam skipping resolved work; docs in docs/agents/production-line.md and night-shift.md; full typecheck, tests and openspec validate.
