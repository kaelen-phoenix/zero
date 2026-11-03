# Spec Delta

## Purpose

En zerointheloop.com, la explicación del nivel de autonomía `auto` deja de decir que el trabajo "se integra o despliega solo", porque zero no despliega nada: los despliegues los hace después la plataforma (Vercel, GitHub Actions, etc.). El texto nuevo, en español: "Se construye y se integra sola, según la línea, sin preguntar (en líneas de pull request con autoMerge, también se funde)." La versión en inglés dice lo mismo. Se agrega un test del sitio para que la promesa de despliegue no vuelva a aparecer en ninguno de los dos idiomas.

## ADDED Requirements

### Requirement: El nivel auto no promete despliegues (español)
The Spanish text of the `autonomy.auto` element in site/index.html MUST say that the work is built and integrated on its own according to the line, without asking, and that on pull-request lines with autoMerge it is also merged; it MUST NOT mention deploying (no 'despliega' / 'despliegue').

#### Scenario: Texto español sin despliegue
- **WHEN** the test reads the inner text of the element with data-i18n="autonomy.auto" in site/index.html
- **THEN** it contains 'se integra', 'autoMerge' and 'pull request', and does not match /despleg|desplieg/i

### Requirement: El nivel auto no promete despliegues (inglés)
The English value `EN["autonomy.auto"]` in site/main.js SHALL carry the same meaning as the Spanish text (built and integrated on its own as the line says, without asking; on pull-request lines with autoMerge also merged) and MUST NOT mention deploying.

#### Scenario: Texto inglés sin despliegue
- **WHEN** the test loads site/main.js and reads site.EN['autonomy.auto']
- **THEN** it contains 'integrated', 'autoMerge' and 'pull request', and does not match /deploy/i

#### Scenario: Cambio de idioma
- **WHEN** the test calls applyLanguage(doc, 'en', storage) on the fake document
- **THEN** the autonomy.auto element shows the new English text, with no 'deploy'

### Requirement: Sin romper el sitio
The change MUST keep the same data-i18n key `autonomy.auto` and the existing site and docs tests SHALL keep passing.

#### Scenario: Suite del sitio
- **WHEN** npm test runs test/site.test.ts and test/docs.test.ts
- **THEN** all tests pass, including translation completeness and the visible-text allowlist
