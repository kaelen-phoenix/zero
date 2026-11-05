# Spec Delta

## Purpose

El sitio zerointheloop.com suma una sección «Capacitaciones» («Training» en inglés), con su enlace en el menú de arriba y en los dos idiomas. Muestra cuatro formatos: Charla abierta, Taller grupal, Mentoría individual y Empresas. Cada uno tiene una descripción corta y dice «a consultar», sin precios. Un párrafo aclara que los temas van más allá de zero: trabajar en serio con agentes de IA (Claude Code, especificaciones con OpenSpec, revisión y seguridad del código que escribe la IA, dónde entra la persona en el circuito), con zero como herramienta. Cada formato tiene un botón «La quiero» / «I want this» que abre el programa de correo del visitante con un mail a kaelen.dev@gmail.com. El asunto es «Capacitación: <formato>» y el cuerpo trae campos para completar: nombre, empresa (opcional), cuántas personas y qué busca. La dirección no aparece escrita entera en ningún archivo del sitio: el JavaScript la arma recién al tocar el botón. Si el navegador no tiene JavaScript, se muestra cómo escribir a mano. No hay formularios, cookies ni datos guardados. Los botones son accesibles y se ven bien en el teléfono. El README (inglés y español) menciona la sección. El sitemap queda igual, porque el sitio sigue siendo una sola página.

## ADDED Requirements

### Requirement: Training section in order
The site SHALL have a `<section id="training">` placed after `compatibility` and before `links`, with marker 09 (links becomes 10), a heading and a label under data-i18n keys, in the site's existing visual style (existing classes such as `label`, `marker`, `grid cards`).

#### Scenario: section order and markers
- **WHEN** the test lists the `<section id>` values of site/index.html
- **THEN** they equal hero, synopsis, line, autonomy, night-shift, guarantees, install, workflow, compatibility, training, links, and the markers after hero run 01..10 in order (training 09, links 10)

### Requirement: Menu link to the training section
The header nav MUST contain a link `href="#training"` whose text is under a data-i18n key, 'Capacitaciones' in the markup and 'Training' in EN.

#### Scenario: header link in both languages
- **WHEN** the test reads the `<header class="top">` markup and main.js EN
- **THEN** the header has an `<a href="#training" data-i18n="…">Capacitaciones</a>` and EN maps that key to 'Training'; the existing Docs and GitHub links are still there

### Requirement: Four formats on request, no prices
The training section SHALL list exactly four formats, in this order and identified by `data-training`: `talk` (Charla abierta, about 60 minutes, from asking AI for code to a factory that works on its own), `workshop` (Taller grupal, 2 to 4 hands-on sessions where each participant builds their own factory with zero on their projects), `mentoring` (Mentoría individual, for a person or a team, in their own repos), `companies` (Empresas, team training and getting zero running). Each SHALL have a title and a short description under data-i18n keys, and show 'a consultar' ('on request' in EN). The section MUST NOT show prices.

#### Scenario: formats listed
- **WHEN** the test collects `data-training` values in section('training')
- **THEN** they equal ['talk','workshop','mentoring','companies'] and the section contains 'Charla abierta', 'Taller grupal', 'Mentoría individual', 'Empresas'

#### Scenario: on request, no prices
- **WHEN** the test reads the section text and EN
- **THEN** 'a consultar' appears once per format, its EN value is 'on request', and the section text has no currency signs or price words ($, USD, ARS, €, 'precio', 'price')

### Requirement: Topics beyond zero
The training section SHALL contain a paragraph under a data-i18n key saying the topics are working with AI agents seriously: Claude Code, specifications with OpenSpec, review and security of AI-written code, and where the person enters the loop, with zero as the tool.

#### Scenario: topics named
- **WHEN** the test reads section('training')
- **THEN** it contains 'Claude Code', 'OpenSpec' and 'zero', and the paragraph's key has a non-empty EN translation

### Requirement: Real buttons that open a mailto
Each format SHALL have a `<button type="button" data-training="<format>">` labeled 'La quiero' ('I want this' in EN). When it is clicked, main.js MUST navigate to a mailto: URL addressed to kaelen.dev@gmail.com. The subject MUST be 'Capacitación: <format title>' in Spanish or 'Training: <format title>' in English, following the page's current language. The body MUST hold fill-in lines for name, company (optional), how many people and what they are looking for. Subject and body MUST be encoded with encodeURIComponent. main.js SHALL export the URL builder in `zeroSite` (`trainingMailto(doc, button)`) so it can be tested without a browser.

#### Scenario: buttons in markup
- **WHEN** the test reads section('training')
- **THEN** there are exactly four `<button type="button"` elements with data-training, each with label text 'La quiero' under a data-i18n key whose EN value is 'I want this'

#### Scenario: Spanish mailto
- **WHEN** trainingMailto runs with a fake document in lang es and a button with data-training="talk"
- **THEN** the result starts with 'mailto:kaelen.dev@gmail.com?subject=', the decoded subject is 'Capacitación: Charla abierta', and the decoded body contains 'Nombre:', 'Empresa (opcional):', 'Cuántas personas:' and 'Qué busca' (or equivalent Spanish labels)

#### Scenario: English mailto
- **WHEN** applyLanguage switches the fake document to en and trainingMailto runs for data-training="companies"
- **THEN** the decoded subject is 'Training: ' followed by EN's title for that format, and the decoded body has the English labels (Name, Company (optional), How many people, What you are looking for)

### Requirement: Address not written whole in the site
No file under site/ SHALL contain the literal string 'kaelen.dev@gmail.com' or a mailto: link with that address. main.js MUST build the address from separate parts only when the URL is built.

#### Scenario: no harvestable address
- **WHEN** the test scans every text file in site/
- **THEN** none contains 'kaelen.dev@gmail.com' nor matches /mailto:[^"'\s?]*@/

### Requirement: Fallback without JavaScript
The training section SHALL contain a `<noscript>` element whose text, under a data-i18n key, tells the visitor how to write by hand. It spells out the address without writing it whole (for example 'kaelen.dev arroba gmail.com'), along with the subject to use.

#### Scenario: noscript hint
- **WHEN** the test reads section('training')
- **THEN** it contains a `<noscript>` with a data-i18n element mentioning 'kaelen.dev' and 'gmail.com' but not 'kaelen.dev@gmail.com', and the key has a non-empty EN value

### Requirement: No data collection, translations complete
The training section MUST NOT add forms, cookies, storage or network requests. Every visible text it adds MUST be under a data-i18n key with an English version in EN, so the existing translation-completeness, visible-text, privacy, contrast and mobile tests keep passing.

#### Scenario: existing guarantees hold
- **WHEN** npm test runs test/site.test.ts
- **THEN** the tests 'cada clave traducible tiene su versión en inglés', 'todo el texto visible está bajo una clave traducible', 'no tiene formularios, cookies…', 'contraste AA' and 'los enlaces al README siguen el idioma elegido' (still 3 data-i18n-href links) pass

### Requirement: README mentions training
README.md and README.es.md SHALL each mention, in the paragraph about zerointheloop.com, that the site has a training section ('Training' / 'Capacitaciones') whose buttons open an email to the owner. The two READMEs MUST keep the same structure.

#### Scenario: both READMEs
- **WHEN** the test reads the zerointheloop.com paragraph of each README
- **THEN** README.md's mentions 'Training' and README.es.md's mentions 'Capacitaciones', and test/docs.test.ts still passes
