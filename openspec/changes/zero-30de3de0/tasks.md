# Tasks

## 1. Implementación

- [ ] 1.1 Add an OpenSpec change under openspec/changes/ (capability work-intake) with a MODIFIED or ADDED requirement covering the disabled-alerts problem text and the permission message being kept only for real permission refusals. Validate it with `npx openspec validate --all`.
- [ ] 1.2 In src/intake/security-alerts.ts, make `readProblem(err, repository)` check, on a 403, whether `err.message` or `err.response?.data?.message` matches /dependabot alerts are disabled/i. If it does, return a Spanish text such as `las alertas de Dependabot están desactivadas en el repositorio <owner>/<repo>: activalas en https://github.com/<owner>/<repo>/settings/security_analysis`. Otherwise keep the current token-permission text. Pass `repository` from `pollSecurityAlerts`.
- [ ] 1.3 In test/security-alerts.test.ts, add tests for a 403 with the disabled message in err.message and one with it only in response.data.message. Each must check that the link is present and /permiso/ is not. Also check that the existing 403 'Resource not accessible by integration' test still matches /permiso/ and has no link, and add a formatStatus check that the link appears on the PROBLEMA line.
- [ ] 1.4 Update the security-alerts sentence in README.md and README.es.md the same way: the problem now says when Dependabot alerts are off in the repository, with the link to its settings/security_analysis page, and the permission message is only for a token without access. Keep both files' structure aligned for test/docs.test.ts and use 'you'/'vos' wording for test/wording.test.ts.
- [ ] 1.5 Run npm run typecheck and npm test.
