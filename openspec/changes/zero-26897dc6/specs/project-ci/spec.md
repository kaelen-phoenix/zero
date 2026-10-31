# Spec Delta

## Purpose

El repositorio de zero suma dos herramientas de calidad gratuitas de GitHub. CodeQL busca problemas de seguridad en el código JavaScript/TypeScript en cada pull request y en cada push a main. Aparece en el pull request como un check más, así que la fusión automática (autoMerge) espera a que pase y no funde si falla. Dependabot revisa una vez por semana las dependencias de npm y las acciones de GitHub, y abre pull requests cuando hay versiones nuevas. SonarCloud no se agrega todavía, porque primero el dueño tiene que crear la cuenta. La sección del README sobre CI y herramientas de calidad, en inglés y en español, cuenta qué usa este repositorio. Unas pruebas automáticas comprueban los dos archivos de configuración y el texto.

## ADDED Requirements

### Requirement: CodeQL workflow on pull requests and main
The repository MUST contain .github/workflows/codeql.yml, a GitHub Actions workflow that runs CodeQL analysis for the language 'javascript-typescript' on every pull_request event and on push to the 'main' branch, using github/codeql-action init and analyze steps (major version v3 or later) after actions/checkout.

#### Scenario: triggers
- **WHEN** a test parses .github/workflows/codeql.yml with the yaml package
- **THEN** its 'on' has a 'pull_request' key and 'push.branches' contains 'main'

#### Scenario: language and steps
- **WHEN** the test inspects the workflow's jobs
- **THEN** one job has steps whose 'uses' start with 'actions/checkout@', 'github/codeql-action/init@' and 'github/codeql-action/analyze@' in that order, and the init step's 'with.languages' is 'javascript-typescript'

### Requirement: CodeQL permissions are minimal
The CodeQL workflow MUST declare explicit permissions with 'security-events: write' and 'contents: read', and MUST NOT grant write access to anything else (no 'write-all', no other ': write' permission).

#### Scenario: permissions
- **WHEN** the test reads the permissions declared in codeql.yml (top-level or on the analyze job)
- **THEN** security-events is 'write', contents is 'read', and no other permission has the value 'write'

### Requirement: CodeQL is an ordinary pull-request check
The CodeQL workflow MUST run as a normal job on pull_request without continue-on-error and without path filters, so it reports a check run on every pull request head that zero's autoMerge (mergeDecision in src/line/automerge.ts) waits for like any other check.

#### Scenario: no bypasses
- **WHEN** the test inspects codeql.yml
- **THEN** the pull_request trigger has no 'paths' or 'paths-ignore' and no job or step sets 'continue-on-error: true'

### Requirement: Dependabot weekly for npm and GitHub Actions
The repository MUST contain .github/dependabot.yml with 'version: 2' and exactly two update entries, one with package-ecosystem 'npm' and one with 'github-actions', each with directory '/' and schedule.interval 'weekly'.

#### Scenario: ecosystems and schedule
- **WHEN** a test parses .github/dependabot.yml with the yaml package
- **THEN** version is 2, the set of package-ecosystem values is exactly {'npm','github-actions'}, and every entry has directory '/' and schedule.interval 'weekly'

### Requirement: No SonarCloud yet
The change MUST NOT add SonarCloud: no workflow under .github/workflows/ may reference 'sonar' (case-insensitive) and no sonar-project.properties file may exist.

#### Scenario: no sonar
- **WHEN** the test reads every file in .github/workflows/
- **THEN** none matches /sonar/i, and sonar-project.properties does not exist at the repository root

### Requirement: README documents this repository's quality tools in both languages
The section '## zero, your CI and your quality tools' in README.md and '## zero, tu CI y tus herramientas de calidad' in README.es.md MUST each add a paragraph or bullet about this repository: CodeQL (JavaScript/TypeScript) runs on every pull request and on main and is one more check that autoMerge waits for; Dependabot checks npm and GitHub Actions weekly; SonarCloud is not set up yet because it needs the owner to create an account. Both READMEs MUST keep the same heading levels and the same code blocks, and the existing docs tests MUST keep passing.

#### Scenario: English text
- **WHEN** the test extracts the English CI section
- **THEN** it contains 'CodeQL', 'Dependabot', 'npm', 'GitHub Actions', 'weekly', 'every pull request', 'SonarCloud' and 'account'

#### Scenario: Spanish text
- **WHEN** the test extracts the Spanish CI section
- **THEN** it contains 'CodeQL', 'Dependabot', 'npm', 'GitHub Actions', 'semanal', 'cada pull request', 'SonarCloud' and 'cuenta'

#### Scenario: parity kept
- **WHEN** npm test runs test/docs.test.ts
- **THEN** the heading-level and code-block parity tests and the existing CI section tests pass
