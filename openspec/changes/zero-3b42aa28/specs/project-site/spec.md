# Spec Delta

## Purpose

En zerointheloop.com, la sección Capacitaciones (con sus cuatro formatos y sus botones «La quiero») y su entrada «Capacitaciones» en el menú de arriba se ven solo cuando el sitio está en español. Al pasar a inglés desaparecen, y al volver a español reaparecen. Los números de las secciones siguen sin saltos en los dos idiomas: en español van del 01 al 11 (Capacitaciones 10, Enlaces 11) y en inglés del 01 al 10 (Enlaces pasa a ser 10). Los tests del sitio se actualizan para comprobarlo, y el README aclara en los dos idiomas que esa sección está solo en la versión en español.

## ADDED Requirements

### Requirement: Capacitaciones solo en español
Elements marked `data-lang-only="es"` (the header link `href="#training"` and `<section id="training">`, which contains the 'La quiero' buttons) MUST carry the `hidden` attribute after applyLanguage(doc, 'en', …) and MUST NOT carry it after applyLanguage(doc, 'es', …). The markup itself SHALL NOT have `hidden` on them, so the Spanish page (and the page without JavaScript) shows them.

#### Scenario: Se oculta en inglés
- **WHEN** the test builds the fake document from index.html and calls applyLanguage(doc, 'en', storage)
- **THEN** every fake element with data-lang-only="es" (the nav link to #training and the training section) has the hidden attribute

#### Scenario: Reaparece en español
- **WHEN** after switching to en, the test calls applyLanguage(doc, 'es', storage)
- **THEN** no data-lang-only="es" element has the hidden attribute

#### Scenario: Marcado
- **WHEN** the test reads index.html
- **THEN** the header has `<a href="#training" data-lang-only="es" …>Capacitaciones</a>`, `<section id="training"` carries data-lang-only="es", and neither has a hidden attribute in the markup; exactly those two elements carry data-lang-only

### Requirement: Numeración correlativa en los dos idiomas
Every section marker (`<span class="marker" data-marker>`) MUST be renumbered by applyLanguage so that the markers of the visible sections, in document order, read 01, 02, … without gaps; markers inside a section hidden for the language SHALL be skipped. In the markup, the markers SHALL keep reading 01..11 in order (training 10, links 11).

#### Scenario: Español
- **WHEN** the test reads the markup, and also after applyLanguage(doc, 'es', …) on the fake document
- **THEN** the markers after hero read 01..11 in order, training 10 and links 11

#### Scenario: Inglés
- **WHEN** the test calls applyLanguage(doc, 'en', …) on the fake document and collects the markers not belonging to a hidden element
- **THEN** they read 01..10 in order and the links marker reads 10

#### Scenario: Ida y vuelta
- **WHEN** the test switches es → en → es
- **THEN** the links marker reads 11 again and the training marker reads 10

### Requirement: Sin romper lo existente
The change MUST NOT add cookies, storage keys, forms or network requests, and the existing site tests (translation completeness, visible text, privacy, contrast, mailto tests, README links) SHALL keep passing; styles.css SHALL make `[hidden]` render as display:none even where a class sets display.

#### Scenario: Suite del sitio
- **WHEN** npm test runs test/site.test.ts and test/docs.test.ts
- **THEN** all tests pass, and styles.css contains a `[hidden]` rule with `display: none`

### Requirement: README aclara el idioma
README.md and README.es.md SHALL each say, in the zerointheloop.com paragraph, that the Training / Capacitaciones section is only in the Spanish version of the site, keeping the same structure in both.

#### Scenario: README
- **WHEN** the test reads the zerointheloop.com paragraph of each README
- **THEN** README.md contains 'Training' and 'Spanish', README.es.md contains 'Capacitaciones' and 'español'
