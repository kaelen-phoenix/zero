# Tasks

## 1. Implementación

- [x] 1.1 Create the OpenSpec change openspec/changes/zero-26897dc6/ (proposal.md, tasks.md, specs/project-ci/spec.md) using these requirements, and make sure `npx openspec validate --all` passes.
- [x] 1.2 Add .github/workflows/codeql.yml: name 'codeql'; on push branches [main] and pull_request; permissions contents: read, security-events: write (actions: read is allowed); job 'analyze' on ubuntu-latest with actions/checkout@v4, github/codeql-action/init@v3 (languages: javascript-typescript, build-mode: none), github/codeql-action/analyze@v3 (category '/language:javascript-typescript').
- [x] 1.3 Add .github/dependabot.yml: version 2; updates for package-ecosystem npm and github-actions, directory '/', schedule interval weekly.
- [x] 1.4 Add a bullet or short paragraph about this repository to the CI section of README.md and the same in README.es.md (CodeQL on every PR and main as one more check autoMerge waits for; Dependabot weekly for npm and GitHub Actions; SonarCloud not yet, needs the owner's account). Add no headings or code blocks, or add the same ones to both files.
- [x] 1.5 Add test/quality.test.ts (or a describe block in test/docs.test.ts) that parses both YAML files with the 'yaml' package and checks the triggers, language, step order, permissions, no continue-on-error or path filters, Dependabot ecosystems and schedule, no sonar references, and the new README text in both languages.
- [x] 1.6 Run npm run typecheck, npm test and npx openspec validate --all.
