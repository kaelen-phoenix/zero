# Spec Delta

## Purpose

El README (en inglés y en español) y el sitio (en los dos idiomas) suman una sección corta que dice qué hace zero y qué no hace. zero hace el trabajo de las personas en el circuito: especificar, programar, probar en local, revisar e integrar. No reemplaza a GitHub Actions ni a ningún otro CI/CD. Tampoco reemplaza el análisis estático, la cobertura, los quality gates ni el escaneo de dependencias o de secretos (SonarQube/SonarCloud, CodeQL, Dependabot, Snyk). Esas herramientas siguen siendo la autoridad. zero corre la verificación de la línea en local antes de entregar. Con integrate pull-request y autoMerge, solo funde cuando todos los checks de GitHub terminaron bien. Si el repositorio no tiene ningún check, funde igual después de unos minutos, contando solo con su propia verificación y sus revisiones. Los hallazgos de esas herramientas son una segunda mirada, independiente de la revisión de los agentes. Los despliegues los sigue haciendo la plataforma (Vercel, workflows de GitHub). La sección recomienda tener CI y al menos un análisis estático en cada repo, e incluye un diagrama del recorrido: pedido → zero (spec, build, verify, review, security) → pull request → CI y checks de calidad de GitHub → merge → despliegue de la plataforma.

## ADDED Requirements

### Requirement: README section in both languages
README.md MUST contain a section with the heading '## zero, your CI and your quality tools' and README.es.md MUST contain a section with the heading '## zero, tu CI y tus herramientas de calidad'. In both files the section is placed right after the '### Auto-merge' / '### Fusión automática' subsection and before '## Browser panel' / '## Panel en el navegador', so the heading levels stay parallel.

#### Scenario: heading present and placed
- **WHEN** the test reads README.md and README.es.md
- **THEN** README.md has the line '## zero, your CI and your quality tools' after '### Auto-merge' and before '## Browser panel'; README.es.md has '## zero, tu CI y tus herramientas de calidad' after '### Fusión automática' and before '## Panel en el navegador'; the existing heading-level parity test still passes

### Requirement: README states what zero does not replace
In both languages the README section MUST say that zero does the work of the people in the loop (specify, build, test locally, review, integrate). It MUST also say that zero does not replace GitHub Actions or any CI/CD, or static analysis, coverage, quality gates, or dependency and secret scanning, and that those tools remain the authority. The section MUST name GitHub Actions, SonarQube, SonarCloud, CodeQL, Dependabot and Snyk.

#### Scenario: tools named
- **WHEN** the test extracts the new section from each README
- **THEN** each section contains 'GitHub Actions', 'CI/CD', 'SonarQube', 'SonarCloud', 'CodeQL', 'Dependabot' and 'Snyk'

#### Scenario: not a replacement
- **WHEN** the test reads the English section and the Spanish section
- **THEN** the English one contains 'does not replace' and the Spanish one contains 'no reemplaza'

### Requirement: README describes how zero works with those tools, accurately
The README section MUST explain, in both languages, that zero runs the line's verification locally before delivering. It MUST explain that with integrate `pull-request` plus `autoMerge` zero merges only once every GitHub check on the pull request has finished successfully, including Sonar, CodeQL and any other tool configured as a check. It MUST say that if the repository has no checks, auto-merge waits a few minutes for them to appear and then merges with only zero's own verification and reviews (matching CHECKS_GRACE_MS in src/line/automerge.ts). It MUST call those tools' findings a second look, independent of zero's agent reviews. It MUST say that deployments are still done by the platform (for example Vercel or GitHub workflows), not by zero.

#### Scenario: auto-merge and checks
- **WHEN** the test extracts the new section from each README
- **THEN** both contain '`pull-request`', '`autoMerge`' and 'Vercel'; the English one contains 'checks' and 'verification'; the Spanish one contains 'checks' and 'verificación'

#### Scenario: no-checks caveat
- **WHEN** the test extracts the new section from each README
- **THEN** the English section contains 'no checks' and the Spanish section contains 'ningún check'

### Requirement: README recommendation
The README section MUST recommend, in both languages, having CI and at least one static analysis on every repository, and MUST say that without them zero has only its local verification and its own reviews.

#### Scenario: recommendation present
- **WHEN** the test extracts the new section from each README
- **THEN** the English section contains 'static analysis' and 'Recommendation'; the Spanish section contains 'análisis estático' and 'Recomendación'

### Requirement: README path diagram
Each README section MUST include one untagged fenced block (a diagram) showing, in this order: the request, zero with spec, build, verify, review and security, the pull request, GitHub's CI and quality checks, the merge, and the platform's deployment. The block's position in the list of code blocks MUST be the same in both files, so the code-block parity test keeps passing.

#### Scenario: diagram order
- **WHEN** the test takes the first fenced block with an empty info string inside the new section of each README
- **THEN** it contains 'spec', 'build', 'verify', 'review', 'security', 'pull request' and 'merge', and the first occurrences appear in that order; the English diagram contains 'deploy' and the Spanish one contains 'despliegue'

### Requirement: Site section in both languages
site/index.html MUST add a section with id 'ci', placed right after 'guarantees', with marker 06. The sections after it are renumbered (install 07, workflow 08, compatibility 09, links 10). The new section MUST carry the same message as the README section (not a replacement for CI/CD or quality tools, which remain the authority; local verification; auto-merge only when every GitHub check passes, with the no-checks caveat; a second look; deployments by the platform; the recommendation). Every visible text MUST be under a data-i18n key with its English value in EN in site/main.js.

#### Scenario: section order and markers
- **WHEN** the site test collects the section ids and their markers
- **THEN** the ids are hero, synopsis, line, autonomy, night-shift, guarantees, ci, install, workflow, compatibility, links, and the markers are 01..10 in order

#### Scenario: content in Spanish
- **WHEN** the test reads section('ci')
- **THEN** it contains 'GitHub Actions', 'SonarQube', 'SonarCloud', 'CodeQL', 'Dependabot', 'Snyk', '<code>autoMerge</code>', 'no reemplaza' and 'análisis estático'

#### Scenario: content in English
- **WHEN** applyLanguage(doc, 'en') runs on the fake document
- **THEN** the ci keys in EN contain 'does not replace', 'static analysis', 'Sonar' and 'Vercel', and the existing key-parity and visible-text tests still pass

### Requirement: Site path diagram
The site's ci section MUST include an ordered list with class 'path' whose items show, in order: the request, zero (spec, build, verify, review, security), the pull request, GitHub's CI and quality checks, the merge, and the platform's deployment. Each item's text MUST be translatable through data-i18n.

#### Scenario: path steps
- **WHEN** the test extracts the <ol class="path"> list from section('ci')
- **THEN** it has 6 <li> items; the second contains '<code>spec</code>' and '<code>security</code>'; the items' Spanish text includes 'pull request', 'merge' and 'despliegue' in that order, and each item carries a data-i18n key present in EN
