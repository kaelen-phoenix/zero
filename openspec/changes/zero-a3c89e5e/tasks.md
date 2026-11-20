# Tasks

## 1. Etapa 1: Tomar un pull request existente y actualizarlo en el runner

- [ ] 1.1 Extend `PullRequestState` with `headRef` and `headRepository` in src/line/automerge.ts and fill them in `githubMerges.pullRequest`.
- [ ] 1.2 Add source kind `pull-request` to `JobSource` and fix the switches typecheck flags (format.ts, report.ts, briefing, priority.ts).
- [ ] 1.3 Implement `adoptPullRequest` in src/app.ts: refusals first, then fetch, backup branch, job with the zero-written spec, branch, base, delivery and the `prRefreshKey` mark.
- [ ] 1.4 Add the `pull-request` case to `requestBlock` and the branch's OpenSpec folders to `conflictFeedback` for adopted jobs in src/line/runner.ts.
- [ ] 1.5 Write test/adopt-pr.test.ts covering adoption, backups, conflict resolution with the push to the same branch and no new pull request, a moved remote branch, the OpenSpec in the feedback, the header, and the refusals. Keep typecheck and the suite passing.

## 2. Etapa 2: Comando de terminal y documentación

- [ ] 2.1 Add `zero actualizar-pr <línea> <número>...` with its help line to src/cli.ts, one output line per pull request and exit 1 when any is refused, plus a test.
- [ ] 2.2 Document the command in README.md and README.es.md with the same structure, and add the new function and source kind to AGENTS.md.
- [ ] 2.3 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`.
