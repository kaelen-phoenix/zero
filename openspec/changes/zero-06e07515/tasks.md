# Tasks

## 1. Implementación

- [x] 1.1 src/config.ts:192: change the protectedPaths default to [".github/**", ".zero/**", ".claude/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"].
- [x] 1.2 test/config.test.ts ('fills safe defaults around a single line'): assert the full default list with toEqual. Add a check that an owner-set protectedPaths replaces the defaults.
- [x] 1.3 test/line-parts.test.ts ('verification' describe): add a test that takes parseFactory's default limits.protectedPaths and checks that protectedTouched flags .claude/settings.json and .mcp.json but not src/x.ts, and that the allowed list lets them through. Add a verifyChange test on a real git work copy (copyOf(gitRepo()), writeTree, commitAll) that adds .claude/settings.json and expects kind 'protected'.
- [x] 1.4 README.md:163 and README.es.md:163: change the example line to `protectedPaths: [".github/**", ".claude/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]`, identical in both files so the code blocks stay equal.
- [x] 1.5 Run npm run typecheck, npm test and npx openspec validate --all.
