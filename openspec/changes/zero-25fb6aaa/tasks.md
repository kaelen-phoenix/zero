# Tasks

## 1. Implementación

- [x] 1.1 In `src/line/verify.ts`, change `protectedTouched` so the path and every pattern, from both `ALWAYS_PROTECTED` and the `patterns` argument, are lower-cased before `posix.matchesGlob`. Keep `allowed.includes(p)` exact, keep returning the original path, and do not change `ALWAYS_PROTECTED`.
- [x] 1.2 Update the comment in `protectedTouched` to say the whole list is compared case-insensitively because case-insensitive disks treat those spellings as the same folder, and that approvals stay exact.
- [x] 1.3 In the `verification` block of `test/line-parts.test.ts`, add cases for `.Claude/settings.json`, `.MCP.json` and `.Github/workflows/ci.yml` with the defaults from `parseFactory`, a pattern with upper case, unrelated paths, a list without the path, and exact approvals (same and different spelling).
- [x] 1.4 In `test/line-parts.test.ts`, import `filterProposals` from `src/line/scout.js` and `ALWAYS_PROTECTED` from `src/line/verify.js`. Add a case showing a proposal on `.Claude/settings.json` is dropped and one on `src/x.ts` is kept, and a case asserting `ALWAYS_PROTECTED` equals `[".zero/**"]`.
- [x] 1.5 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`.
