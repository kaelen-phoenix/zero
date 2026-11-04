# Tasks

## 1. Implementación

- [ ] 1.1 src/config.ts:275: add `.agents/**` to the `limits.protectedPaths` default, right after `.claude/**`: [".github/**", ".zero/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]. Do not touch ALWAYS_PROTECTED or the matching in src/line/verify.ts.
- [ ] 1.2 test/config.test.ts:16 ('fills safe defaults around a single line'): update the expected default list. In 'replaces the default protected paths with the owner's list' the existing toEqual already covers the replacement.
- [ ] 1.3 test/line-parts.test.ts, 'verification' describe, next to 'protects agent configuration by default': add a test that takes parseFactory's default limits.protectedPaths and checks that protectedTouched flags .agents/skills/x/SKILL.md but not src/x.ts, and that the allowed list lets it through.
- [ ] 1.4 README.md:188 and README.es.md:188: change the example line to ` protectedPaths: [".github/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]`, identical in both files.
- [ ] 1.5 Run npm run typecheck, npm test and npx openspec validate --all.
