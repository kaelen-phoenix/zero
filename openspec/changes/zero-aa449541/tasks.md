# Tasks

## 1. Implementación

- [ ] 1.1 Run `npx openspec archive zero-7ab160a7 --yes` (non-interactive) from the repository root. It merges the ADDED requirements into openspec/specs/production-line/spec.md and moves the folder to openspec/changes/archive/<date>-zero-7ab160a7/.
- [ ] 1.2 If the CLI can't run without prompting or fails, do the same by hand. Append the six '### Requirement:' blocks from openspec/changes/zero-7ab160a7/specs/production-line/spec.md verbatim under '## Requirements' in openspec/specs/production-line/spec.md. Then `git mv` the folder to openspec/changes/archive/2026-11-27-zero-7ab160a7 (or use today's date).
- [ ] 1.3 Check that no requirement name is duplicated in openspec/specs/production-line/spec.md. If one is, merge the two blocks and keep every scenario.
- [ ] 1.4 Run `npx openspec validate --all` and `npm run typecheck`. Check that src/ and test/ are unchanged.
