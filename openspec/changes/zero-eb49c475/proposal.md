# Proposal

## Why

El README (en inglés y en español) y el sitio (en los dos idiomas) suman una sección corta que dice qué hace zero y qué no hace. zero hace el trabajo de las personas en el circuito: especificar, programar, probar en local, revisar e integrar. No reemplaza a GitHub Actions ni a ningún otro CI/CD. Tampoco reemplaza el análisis estático, la cobertura, los quality gates ni el escaneo de dependencias o de secretos (SonarQube/SonarCloud, CodeQL, Dependabot, Snyk). Esas herramientas siguen siendo la autoridad. zero corre la verificación de la línea en local antes de entregar. Con integrate pull-request y autoMerge, solo funde cuando todos los checks de GitHub terminaron bien. Si el repositorio no tiene ningún check, funde igual después de unos minutos, contando solo con su propia verificación y sus revisiones. Los hallazgos de esas herramientas son una segunda mirada, independiente de la revisión de los agentes. Los despliegues los sigue haciendo la plataforma (Vercel, workflows de GitHub). La sección recomienda tener CI y al menos un análisis estático en cada repo, e incluye un diagrama del recorrido: pedido → zero (spec, build, verify, review, security) → pull request → CI y checks de calidad de GitHub → merge → despliegue de la plataforma.

Pedido original: "Documentación: explicar que zero no reemplaza el pipeline de GitHub (CI/CD) ni las herramientas de calidad como SonarQube/SonarCloud, CodeQL, Dependabot o Snyk (reemplaza al trabajo c15ec13a). En el README (inglés y español) y en el sitio (site/, los dos idiomas), una sección corta y clara: zero hace el trabajo de las personas en el circuito (especificar, programar, probar en local, revisar, integrar), pero no reemplaza a GitHub Actions ni a ningún CI/CD, ni al análisis estático, la cobertura, los quality gates, el escaneo de dependencias o de secretos. Esas herramientas siguen siendo la autoridad y zero trabaja con ellas: corre la verificación de la línea en local antes de entregar, y con integrate pull-request + autoMerge solo funde cuando todos los checks de GitHub pasan, incluidos los de Sonar, CodeQL y cualquier otro que esté configurado como check. Sus hallazgos son una segunda mirada independiente de la revisión de los agentes de zero. Los despliegues los sigue haciendo la plataforma (Vercel, los workflows de GitHub, etc.). Recomendación: tener CI y al menos un análisis estático en cada repo; sin eso, zero solo tiene su verificación local y sus propias revisiones. Incluir un diagrama simple del recorrido: pedido → zero (spec, build, verify, review, security) → pull request → CI y checks de calidad de GitHub → merge → despliegue de la plataforma. Nada inventado: describir solo lo que zero hace hoy."

## What Changes

- Docs: zero works alongside CI/CD and quality tools, it does not replace them
- Supuesto: Accuracy: auto-merge reads every check run and commit status on the PR head. 'neutral' and 'skipped' count as passed. With no checks at all it merges after 5 minutes. The text must not promise 'never merges without CI'. That is why the spec requires the no-checks caveat.
- Supuesto: Only pull-request lines go through GitHub's checks before merging. On 'merge' or 'branch' delivery zero does not wait for any GitHub check. The section should say auto-merge applies to pull-request lines and must not claim more.
- Supuesto: Adding a site section breaks the hard-coded section-id list and the marker numbering in test/site.test.ts. Both must be updated together.
- Supuesto: The visible-text test in site.test.ts fails on any word outside data-i18n or <code>. The diagram items must be fully translatable.
- Supuesto: Heading names were chosen by the spec station. The owner did not prescribe them.

## Capabilities

### New Capabilities
- `project-docs`: Docs: zero works alongside CI/CD and quality tools, it does not replace them

### Modified Capabilities

## Impact

Generado por zero para el trabajo eb49c475.
