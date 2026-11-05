# project-site Specification

## Purpose
Este spec es la fuente de la verdad sobre el sitio del proyecto, zerointheloop.com, que vive en site/. Son HTML, CSS y un poco de JavaScript, sin dependencias ni paso de build, así que Vercel lo publica tal cual con site/ como carpeta raíz. Le cuenta a quien llega qué es zero: una fábrica de software que corre en su máquina y se suma al circuito al lado de la persona, que sigue decidiendo qué se hace y dónde entra. Las secciones van en este orden: título y figura de la línea de montaje, sinopsis, la línea y sus estaciones, niveles L0–L3 y autonomía por línea, turno nocturno, garantías, CI y herramientas de calidad, instalación, flujo de trabajo, compatibilidad, Capacitaciones y enlaces. Capacitaciones ofrece tres formatos, cada uno con enlaces a WhatsApp e Instagram, y se ve solo en español; todo lo demás está en español y en inglés. El pie muestra GitHub, Instagram, WhatsApp, la versión, la licencia y el selector de tema. Vos no ves formularios, cookies ni analítica, y el sitio no publica nada privado. Lo que dice sale de lo que zero hace hoy; lo que todavía no existe dice «en camino».

## Requirements

### Requirement: Static site without dependencies
The project site MUST live under site/ as plain static files (index.html, CSS, plain JS), with no package.json, no build step and no external script, stylesheet or font loaded from another origin, so Vercel can serve site/ as its root directory.

#### Scenario: Entry and no build
- **WHEN** the site/ directory is inspected
- **THEN** site/index.html exists and site/ contains no package.json, node_modules or build configuration

#### Scenario: No third-party resources
- **WHEN** every <script src>, <link href> and CSS url()/@import in site/ is listed
- **THEN** each one is a relative path inside site/ (no http(s):// or // origins), except plain <a href> links

### Requirement: Content sections in order
site/index.html MUST present, in this order, sections for: title and tagline ('zero in the loop', with the tagline that «Lema del hero: zero se suma al circuito» asks for), synopsis, production line and stations, autonomy levels L0–L3 and per-line autonomy, night shift, guarantees, CI and quality tools, install and first steps, workflow, compatibility, training and links. Each section MUST carry a stable id, and each section after the hero MUST carry a numbered marker (01, 02…).

#### Scenario: Section order
- **WHEN** the section ids are read from index.html in document order
- **THEN** they appear in the order hero, synopsis, line, autonomy, night-shift, guarantees, ci, install, workflow, compatibility, training, links

#### Scenario: Numbered markers
- **WHEN** the sections after the hero are read in the markup
- **THEN** their markers read 01 to 11 in increasing order, with training 10 and links 11

### Requirement: Factual content only
The site content MUST come from what zero does today according to the README. It MUST name the stations spec, build, verify, review, security and integrate; the levels L0, L1, L2 and L3; the per-line autonomies propose, build and auto; the scout and research stations; and the guarantees (protected paths, verification, secrets outside files, isolation box). It MUST contain no metrics, star counts, customers or testimonials. Future items MUST be labelled 'en camino' / 'coming'.

#### Scenario: Facts present
- **WHEN** index.html is read
- **THEN** it contains spec, build, verify, review, security, integrate, L0, L1, L2, L3, propose, auto, scout and research

#### Scenario: Future items labelled
- **WHEN** an item from the site's 'Próximas etapas' list (e.g. the installer or the requests from Linear and Jira) appears
- **THEN** it is marked with an element carrying the text 'en camino' (ES) / 'coming' (EN)

#### Scenario: Available features are not labelled
- **WHEN** the lines of index.html that carry class="soon" are read
- **THEN** none of them mentions OTLP, since sending traces to a collector is available today

### Requirement: Production line figure
The hero MUST include an inline SVG figure of the production line with the caption 'FIG. 1 / LÍNEA'. It MUST show the stations as nodes, the work moving through them and the person beside the line, where they decide, as «Figura del hero como línea de montaje» details. It MUST have an accessible name (role=img with aria-labelledby or <title>) in the active language, and its animation MUST stop under prefers-reduced-motion: reduce.

#### Scenario: Accessible figure
- **WHEN** the hero SVG is inspected
- **THEN** it has role="img" and a <title>, its caption contains 'FIG. 1', and it has one node per station

#### Scenario: Reduced motion
- **WHEN** the CSS is inspected
- **THEN** a @media (prefers-reduced-motion: reduce) rule disables animations and transitions

### Requirement: Install block with copy
The install section MUST show the real commands from the README (git clone of https://github.com/kaelen-phoenix/zero, npm install && npm run build, node dist/cli.js init, install and box setup) in a monospace code box with a copy button. The button MUST be a keyboard-focusable <button> that copies the command text to the clipboard and announces the result through an aria-live region.

#### Scenario: Copy button
- **WHEN** the install section is inspected
- **THEN** it contains a <pre>/<code> with 'npm install && npm run build' and a <button> referencing it, and an aria-live element exists

#### Scenario: Copy behaviour
- **WHEN** the site script's copy handler runs with a stubbed navigator.clipboard
- **THEN** writeText is called with the code block's text

### Requirement: Workflow list
The workflow section MUST be a vertical numbered list (<ol>) where each step shows its command in monospace and one line of description. It MUST include at least zero request, zero status, zero approve, zero proposals, zero trace, zero briefing and zero stop.

#### Scenario: Workflow commands
- **WHEN** the workflow <ol> is read
- **THEN** its items contain <code> elements with each of those commands, each followed by a description

### Requirement: Compatibility grid
The compatibility section MUST show a dense grid of what zero supports today and nothing else. The engines are Claude (Agent SDK), Codex, Antigravity and any CLI declared in the configuration. The chat clients are Claude Code (automatic registration), Codex and OpenCode (manual configuration) and the terminal.

#### Scenario: Grid entries
- **WHEN** the compatibility section is read
- **THEN** it lists Claude, Codex, Antigravity, custom CLI, Claude Code, OpenCode and terminal, and no other engine or client

### Requirement: Sección de CI y recorrido
site/index.html MUST have a `<section id="ci">` right after `guarantees`, with marker 06, whose texts are all under data-i18n keys with their English value in EN. It MUST say that zero does not replace CI/CD or quality tools (GitHub Actions, SonarQube, SonarCloud, CodeQL, Dependabot, Snyk), which remain the authority; that zero runs the line's verification locally before delivering; that with integrate `pull-request` and `autoMerge` it merges only once every GitHub check has finished well, and that with no checks it waits a few minutes and merges with its own verification and reviews; that those tools' findings are a second look; that deployments are still done by the platform; and it MUST recommend having CI and at least one static analysis on every repository. The section MUST include an `ol.path` list of 6 steps: the request; zero with spec, build, verify, review and security; the pull request; GitHub's CI and quality checks; the merge; and the platform's deploy.

#### Scenario: Posición
- **WHEN** the test lists the section ids and their markers
- **THEN** ci comes right after guarantees and its marker reads 06

#### Scenario: Contenido en español
- **WHEN** the test reads section('ci')
- **THEN** it contains 'GitHub Actions', 'SonarQube', 'SonarCloud', 'CodeQL', 'Dependabot', 'Snyk', '<code>autoMerge</code>', 'no reemplaza', 'análisis estático' and 'ningún check'

#### Scenario: Contenido en inglés
- **WHEN** the test reads the ci keys of EN
- **THEN** they contain 'does not replace', 'static analysis', 'Sonar', 'Vercel' and 'no checks'

#### Scenario: Recorrido
- **WHEN** the test extracts the `<ol class="path">` list from section('ci')
- **THEN** it has 6 `<li>` items, each with a data-i18n key present in EN; the second contains '<code>spec</code>' and '<code>security</code>', and the Spanish text has 'pull request', 'merge' and 'despliegue' in that order

### Requirement: Header and footer
The header MUST be minimal, with links to Capacitaciones (see «Menu link to the training section»), Docs and GitHub (https://github.com/kaelen-phoenix/zero). The Docs link MUST follow the language: its href in the markup is https://github.com/kaelen-phoenix/zero/blob/main/README.es.md, and English replaces it with https://github.com/kaelen-phoenix/zero#readme through data-i18n-href="href.readme". The footer MUST show GitHub, the Instagram and WhatsApp links (see «Enlace de Instagram en el pie» and «Enlace de WhatsApp en el pie»), the version equal to package.json's version, the license (Apache-2.0), the line saying zero in the loop built the site, and a theme selector with auto, light and dark.

#### Scenario: Version matches
- **WHEN** the footer version is read from index.html and compared to package.json
- **THEN** they are equal

#### Scenario: Links and license
- **WHEN** the header and footer are inspected
- **THEN** the Docs and GitHub hrefs in the markup match those URLs and the footer contains Apache-2.0, the Instagram link and the WhatsApp link

#### Scenario: Docs in English
- **WHEN** applyLanguage switches the fake document to en and then back to es
- **THEN** the elements with data-i18n-href="href.readme" (header, hero and links) point first to the #readme URL and then back to README.es.md

### Requirement: Theme selector
The theme selector MUST offer auto, light and dark. Auto MUST follow prefers-color-scheme, and an explicit choice MUST be applied through a data attribute on <html> and remembered only in localStorage (no cookies).

#### Scenario: Theme choice
- **WHEN** the site script sets the theme to dark
- **THEN** document.documentElement has data-theme="dark" and localStorage stores the choice; choosing auto removes the attribute

#### Scenario: Auto follows system
- **WHEN** the CSS is inspected
- **THEN** it has a @media (prefers-color-scheme: dark) rule applied when no explicit theme is set

### Requirement: Spanish and English
The site MUST be available in Spanish (default) and English with a language selector. Every visible text element MUST have both versions, except those marked data-lang-only, which show only in that language (see «Capacitaciones solo en español»). The selector MUST update <html lang>, and the choice MUST be remembered only in localStorage.

#### Scenario: Default Spanish
- **WHEN** index.html is loaded without a stored choice
- **THEN** <html lang="es"> and the visible texts are Spanish

#### Scenario: Switch to English
- **WHEN** the site script switches to en
- **THEN** <html lang> becomes en and every translatable element shows its English text, with no translation key missing in either language, and the elements with data-lang-only="es" are hidden

### Requirement: Accessibility and mobile
The site MUST meet WCAG AA text contrast in both themes and be usable by keyboard (skip link, visible :focus-visible styles, native buttons and links). Every image MUST have alt text, and the site MUST read well on a phone (viewport meta and a layout that does not overflow at 360 px).

#### Scenario: Contrast
- **WHEN** the text and background color pairs declared for light and dark themes in the CSS custom properties are checked
- **THEN** each has a contrast ratio of at least 4.5:1

#### Scenario: Keyboard and alt
- **WHEN** index.html and the CSS are inspected
- **THEN** a skip link to the main content exists, a :focus-visible rule exists, every <img> has a non-empty alt, and a viewport meta tag is present

### Requirement: Sharing metadata and crawl files
The site MUST include title, meta description, Open Graph and Twitter card tags with an image inside site/, a canonical URL https://zerointheloop.com/, a favicon, robots.txt and sitemap.xml pointing to https://zerointheloop.com.

#### Scenario: Meta tags
- **WHEN** index.html's head is read
- **THEN** it has og:title, og:description, og:image (absolute https://zerointheloop.com/... URL whose file exists in site/), og:url, a canonical link and a favicon link to an existing file

#### Scenario: Crawl files
- **WHEN** site/robots.txt and site/sitemap.xml are read
- **THEN** robots allows crawling and references https://zerointheloop.com/sitemap.xml; the sitemap lists https://zerointheloop.com/

### Requirement: No data collection or private leaks
The site MUST contain no forms, no cookies, no third-party analytics and no data collection. It MUST NOT publish keys or tokens, panel links (127.0.0.1, localhost, #key fragments), local machine paths or zero.factory.yaml contents.

#### Scenario: No collection
- **WHEN** all files in site/ are scanned
- **THEN** there is no <form>, no document.cookie, no fetch/XMLHttpRequest/sendBeacon, and no analytics domain

#### Scenario: No private data
- **WHEN** all files in site/ are scanned
- **THEN** there are no 127.0.0.1 or localhost references, no Windows drive or /Users/ or /home/ paths, and no credential-shaped strings (sk-…, ghp_…, CLAUDE_CODE_OAUTH_TOKEN values)

### Requirement: README mentions the site
README.md MUST contain a line naming https://zerointheloop.com and explaining that it lives in site/ and that Vercel publishes it with site/ as the root directory.

#### Scenario: README line
- **WHEN** README.md is read
- **THEN** it contains 'zerointheloop.com' and 'site/' in the same paragraph or list item

### Requirement: Training section in order
The site SHALL have a `<section id="training">` placed after `compatibility` and before `links`, with marker 10 in the markup (links 11), a heading and a label under data-i18n keys, in the site's existing visual style (existing classes such as `label`, `marker`, `grid cards`).

#### Scenario: section order and markers
- **WHEN** the test lists the `<section id>` values of site/index.html
- **THEN** they equal hero, synopsis, line, autonomy, night-shift, guarantees, ci, install, workflow, compatibility, training, links, and the markers after hero run 01..11 in order (training 10, links 11)

### Requirement: Menu link to the training section
The header nav MUST contain a link `href="#training"` marked `data-lang-only="es"` whose text is under a data-i18n key, 'Capacitaciones' in the markup and 'Training' in EN.

#### Scenario: header link
- **WHEN** the test reads the `<header class="top">` markup and main.js EN
- **THEN** the header has an `<a href="#training" data-lang-only="es" data-i18n="nav.training">Capacitaciones</a>` and EN maps that key to 'Training'; the Docs and GitHub links are still there

### Requirement: Topics beyond zero
The training section SHALL contain a paragraph under a data-i18n key saying the topics are working with AI agents seriously: Claude Code, specifications with OpenSpec, review and security of AI-written code, and where the person enters the loop, with zero as the tool.

#### Scenario: topics named
- **WHEN** the test reads section('training')
- **THEN** it contains 'Claude Code', 'OpenSpec' and 'zero', and the paragraph's key has a non-empty EN translation

### Requirement: Capacitaciones solo en español
Elements marked `data-lang-only="es"` (the header link `href="#training"` and `<section id="training">`) MUST carry the `hidden` attribute after applyLanguage(doc, 'en', …) and MUST NOT carry it after applyLanguage(doc, 'es', …). The markup itself SHALL NOT have `hidden` on them, so the Spanish page (and the page without JavaScript) shows them. styles.css MUST have a `[hidden]` rule with `display: none`, so they stay hidden even where a class sets display.

#### Scenario: Se oculta en inglés
- **WHEN** the test builds the fake document from index.html and calls applyLanguage(doc, 'en', storage)
- **THEN** every fake element with data-lang-only="es" (the nav link to #training and the training section) has the hidden attribute

#### Scenario: Reaparece en español
- **WHEN** after switching to en, the test calls applyLanguage(doc, 'es', storage)
- **THEN** no data-lang-only="es" element has the hidden attribute

#### Scenario: Marcado
- **WHEN** the test reads index.html
- **THEN** the header has `<a href="#training" data-lang-only="es" …>Capacitaciones</a>`, `<section id="training"` carries data-lang-only="es", and neither has a hidden attribute in the markup; exactly those two elements carry data-lang-only

#### Scenario: Regla de CSS
- **WHEN** the test reads site/styles.css
- **THEN** it contains a `[hidden]` rule with `display: none`

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

### Requirement: README aclara el idioma
README.md and README.es.md SHALL each say, in the zerointheloop.com paragraph, that the Training / Capacitaciones section is only in the Spanish version of the site, keeping the same structure in both.

#### Scenario: README
- **WHEN** the test reads the zerointheloop.com paragraph of each README
- **THEN** README.md contains 'Training' and 'Spanish', README.es.md contains 'Capacitaciones' and 'español'

### Requirement: Tres formatos de capacitación
The training section (section#training in site/index.html) SHALL list exactly three formats, in this order and identified by data-training: talk (Charla abierta, about 60 minutes, from asking AI for code to a factory that works on its own), workshop (Taller grupal, 2 to 4 hands-on sessions where each participant builds their own factory with zero on their projects), mentoring (Mentoría individual, for a person or a team, in their own repos). Each MUST have a title and a short description under data-i18n keys, show 'a consultar' ('on request' in EN) and offer the action that «Dos enlaces por tarjeta» describes. The section MUST NOT show prices.

#### Scenario: formatos listados
- **WHEN** the test collects the data-training values in section('training')
- **THEN** they equal ['talk','workshop','mentoring'], and the section contains 'Charla abierta', 'Taller grupal' and 'Mentoría individual'

#### Scenario: a consultar por formato
- **WHEN** the test filters the section's translatable elements whose text is 'a consultar'
- **THEN** there are exactly 3 and each maps to 'on request' in EN; the section text has no prices ($, USD, ARS, €, precio, price)

### Requirement: Ninguna mención de empresas en el sitio
No text file under site/ SHALL mention companies: none MUST match /empresa|compan(y|ies)/i.

#### Scenario: archivos del sitio limpios
- **WHEN** the test scans every text file in site/ (textFiles)
- **THEN** none matches /empresa|compan(y|ies)/i

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

### Requirement: Figura del hero como línea de montaje
El SVG del hero (svg.line-fig) SHALL mostrar una cinta o riel con las seis estaciones en fila, en el orden spec, build, verify, review, security, integrate (cada una un <g class="node" data-station="…">), y SHALL mostrar al menos dos piezas de trabajo (elementos con class "work") en posiciones distintas de la línea. También SHALL mostrar a la persona (elemento con class "owner") al lado de la línea.

#### Scenario: Estaciones en orden
- **WHEN** se extraen los g.node del SVG del hero en index.html
- **THEN** sus data-station son exactamente [spec, build, verify, review, security, integrate]

#### Scenario: Varios trabajos en la línea
- **WHEN** se cuentan los elementos con class que contiene "work" dentro del SVG
- **THEN** hay al menos 2 y no comparten la misma posición (x/cx/transform)

#### Scenario: Cinta presente
- **WHEN** se busca en el SVG un elemento de cinta o riel (class "rail" o "belt")
- **THEN** existe al menos uno

### Requirement: Figura liviana, accesible y con la paleta del sitio
El SVG del hero MUST seguir siendo inline, con role="img", aria-labelledby que apunte a un <title id="fig-title"> y a un <desc id="fig-desc"> traducibles. MUST NOT tener colores fijos (hex, rgb o nombres de color en atributos fill/stroke o style dentro del SVG): los colores salen de las variables CSS del sitio (--fg, --bg, --muted, --accent, --rail, --rule), así que funciona en claro y en oscuro. MUST NOT cargar recursos externos ni scripts (sin <script>, <image>, href ni src externos), y el sitio MUST NOT sumar librerías ni archivos de build.

#### Scenario: Accesible
- **WHEN** se lee el SVG del hero
- **THEN** tiene role="img", aria-labelledby incluye fig-title y fig-desc, y los dos elementos existen con data-i18n fig.title y fig.desc no vacíos

#### Scenario: Sin colores fijos
- **WHEN** se busca en el SVG del hero /#[0-9a-f]{3,8}\b|rgb\(|fill="(?!none)|stroke="/i
- **THEN** no hay coincidencias; los estilos de .line-fig en styles.css usan solo var(--…) o none

#### Scenario: Sin recursos externos
- **WHEN** se busca en el SVG <script, <image, href= o src=
- **THEN** no hay coincidencias

#### Scenario: Respeta reduced-motion
- **WHEN** se lee el bloque @media (prefers-reduced-motion: reduce) de styles.css
- **THEN** sigue teniendo animation: none y transition: none (test existente)

### Requirement: Descripción de la figura acorde
fig.desc SHALL describir la figura en español (markup) y en inglés (EN): las seis estaciones en fila sobre una cinta, varios trabajos avanzando y la persona al lado de la línea, decidiendo. MUST NOT decir que la persona «vuelve a entrar» ni «steps back in».

#### Scenario: Descripción en los dos idiomas
- **WHEN** se leen fig.desc del markup y EN['fig.desc']
- **THEN** las dos nombran las seis estaciones y ninguna contiene 'vuelve a entrar' ni 'step back in'/'steps back in'

### Requirement: Lema del hero: zero se suma al circuito
El lema del hero (hero.tagline) SHALL decir que zero se suma al circuito al lado de la persona, que no sale de él, y que la persona decide qué se hace y dónde entra, en español (markup) y en inglés (EN). MUST NOT decir que la fábrica ocupa el lugar del humano.

#### Scenario: Lema en español
- **WHEN** se lee el elemento data-i18n="hero.tagline" de index.html
- **THEN** no contiene 'ocupa el lugar' ni 'vuelve a entrar', y contiene 'zero' y 'persona'

#### Scenario: Lema en inglés
- **WHEN** se lee EN['hero.tagline']
- **THEN** no contiene "place" ni 'step back in', y contiene 'zero' y 'person' o 'people'

#### Scenario: Título intacto
- **WHEN** se lee la sección hero
- **THEN** sigue conteniendo '<h1>zero in the loop</h1>'

### Requirement: Relato de la delegación
El sitio SHALL contar, en español y en inglés, que la persona no se queda sin trabajo: tiene muchas tareas y, según lo que sabe y la confianza que tenga, delega más o menos en la fábrica, y sigue decidiendo qué se hace y dónde entra ella. El texto MUST estar bajo la clave traducible synopsis.loop en la sinopsis, con su versión en EN.

#### Scenario: Párrafo en la sinopsis
- **WHEN** se busca en la sección synopsis un elemento data-i18n="synopsis.loop"
- **THEN** existe, no está vacío, menciona 'delega' (o 'delegás') y 'confianza', y EN['synopsis.loop'] menciona 'delegate' y 'trust'

### Requirement: Delegación y niveles de autonomía
La sección de autonomía SHALL tener, antes de la tabla de niveles, un párrafo traducible (autonomy.intro) que conecte la delegación con L0 a L3: cuanto más delegás, más hace sola la fábrica, y en L0 la persona aprueba más que en L3. MUST estar en español (markup) y en inglés (EN).

#### Scenario: Intro antes de la tabla
- **WHEN** se lee la sección autonomy
- **THEN** el elemento data-i18n="autonomy.intro" aparece antes de <table> y contiene 'L0' y 'L3'; EN['autonomy.intro'] también contiene 'L0' y 'L3'

### Requirement: Sin textos de reemplazo de personas
Ningún texto del sitio, ni en el markup en español ni en EN, MUST decir que zero hace el trabajo de las personas o que ocupa su lugar. La intro de CI (ci.intro) SHALL describir lo que zero toma cuando se lo delegan (especificar, programar, probar en local, revisar, integrar) y seguir diciendo que no reemplaza al CI ni a las herramientas de calidad. La descripción de la página (meta description y og:description) SHALL quedar en el mismo tono, sin 'vuelve a entrar'.

#### Scenario: Frases prohibidas
- **WHEN** se busca en index.html y en los valores de EN (sin distinguir mayúsculas)
- **THEN** no aparecen 'lugar del humano', 'ocupa el lugar', 'trabajo de las personas', "human's place", 'takes the place', 'work of the people'

#### Scenario: CI sigue diciendo que no reemplaza
- **WHEN** se corre el test existente de la sección ci
- **THEN** sigue pasando ('no reemplaza', 'análisis estático', 'does not replace', 'static analysis', etc.)

#### Scenario: Meta en el mismo tono
- **WHEN** se leen meta name=description y og:description de index.html
- **THEN** ninguna contiene 'vuelve a entrar'

### Requirement: Traducción completa
Toda clave data-i18n MUST tener su entrada en EN en site/main.js, y EN MUST NOT tener claves que sobren. Cambiar a inglés y volver a español SHALL restaurar los textos del markup.

#### Scenario: Claves completas
- **WHEN** se corren los tests existentes 'cada clave traducible tiene su versión en inglés' y 'cambia a inglés y vuelve a español'
- **THEN** pasan, con synopsis.loop y autonomy.intro incluidas

#### Scenario: Texto visible traducible
- **WHEN** se corre el test 'todo el texto visible está bajo una clave traducible'
- **THEN** pasa: las etiquetas del SVG o son nombres de estación permitidos por el test o están bajo data-i18n

### Requirement: Enlace de Instagram en el pie
El pie del sitio (`<footer class="foot">` en `site/index.html`) MUST contener, junto a los demás enlaces, un enlace a https://www.instagram.com/zerointheloop/ que se abra en una pestaña nueva con `target="_blank"` y `rel="noopener"`.

#### Scenario: El pie enlaza a Instagram en una pestaña nueva
- **WHEN** se lee el elemento footer de site/index.html
- **THEN** contiene un <a> con href exactamente https://www.instagram.com/zerointheloop/, target="_blank" y un rel que incluye noopener

#### Scenario: El enlace queda junto a los otros
- **WHEN** se recorren los enlaces del footer en orden
- **THEN** el enlace de Instagram viene inmediatamente después del enlace de GitHub y antes del selector de tema

### Requirement: Ícono monocromo de Instagram
El enlace de Instagram MUST mostrar un ícono SVG en línea, decorativo, de un solo color que hereda el color del texto (`currentColor`), sin colores fijos, sin recursos externos y sin texto visible adicional.

#### Scenario: El ícono sigue el tema del sitio
- **WHEN** se lee el SVG dentro del enlace de Instagram
- **THEN** tiene aria-hidden="true", usa currentColor para pintar, no contiene colores hexadecimales ni rgb() y no tiene atributos href ni src ni elementos image o script

#### Scenario: El ícono tiene tamaño definido
- **WHEN** se lee site/styles.css
- **THEN** hay una regla para el SVG del enlace del pie que le da ancho y alto explícitos, de modo que el SVG no se expanda al ancho disponible

### Requirement: Texto accesible de Instagram en los dos idiomas
El enlace de Instagram MUST tener el nombre accesible "Instagram de zero in the loop" en español y su traducción al inglés cuando el sitio está en inglés, usando el mecanismo `data-i18n-label` del sitio.

#### Scenario: Español por defecto
- **WHEN** se lee el enlace en site/index.html
- **THEN** tiene aria-label="Instagram de zero in the loop" y data-i18n-label="foot.instagram"

#### Scenario: Cambio de idioma
- **WHEN** se aplica applyLanguage con 'en' y después con 'es' sobre el documento de prueba
- **THEN** el aria-label del enlace pasa a ser "zero in the loop on Instagram" (valor de EN["foot.instagram"] en site/main.js) y vuelve a "Instagram de zero in the loop"

### Requirement: Enlace de WhatsApp en el pie
El pie del sitio (`<footer class="foot">` en `site/index.html`) MUST contener, junto a los demás enlaces, un enlace a https://wa.me/5491159813335 con el mensaje inicial prellenado, que se abra en una pestaña nueva con `target="_blank"` y `rel="noopener"`.

#### Scenario: El pie enlaza a WhatsApp con el mensaje en español
- **WHEN** se lee el elemento footer de site/index.html
- **THEN** contiene un <a> con target="_blank", un rel que incluye noopener y un href cuyo origen y ruta son https://wa.me/5491159813335 y cuyo parámetro text, decodificado, es exactamente "Hola, quiero saber más sobre zero in the loop"

#### Scenario: El enlace queda junto a los otros
- **WHEN** se recorre el contenido del footer en orden
- **THEN** el enlace de WhatsApp viene después del enlace de GitHub (y del de Instagram, si el pie ya lo tiene) y antes de la versión y del selector de tema

### Requirement: Ícono monocromo de WhatsApp
El enlace de WhatsApp del pie MUST mostrar solo un ícono SVG en línea, decorativo y de un solo color que hereda el color del texto (`currentColor`), sin colores fijos, sin recursos externos y sin texto visible adicional.

#### Scenario: El ícono sigue el tema del sitio
- **WHEN** se lee el SVG dentro del enlace de WhatsApp del pie
- **THEN** tiene aria-hidden="true", pinta con currentColor, no contiene colores hexadecimales ni rgb(), y no tiene atributos href ni src ni elementos image o script

#### Scenario: El ícono tiene tamaño definido
- **WHEN** se lee site/styles.css
- **THEN** hay una regla para el SVG de los enlaces con ícono del pie (`.foot .social svg`) que le da ancho y alto explícitos

#### Scenario: El enlace no agrega texto visible
- **WHEN** se quita el marcado del enlace de WhatsApp del pie
- **THEN** no queda texto

### Requirement: Texto accesible de WhatsApp en los dos idiomas
El enlace de WhatsApp del pie MUST tener el nombre accesible "WhatsApp de zero in the loop" en español y "zero in the loop on WhatsApp" en inglés, usando el mecanismo `data-i18n-label` del sitio.

#### Scenario: Español por defecto
- **WHEN** se lee el enlace en site/index.html
- **THEN** tiene aria-label="WhatsApp de zero in the loop" y data-i18n-label="foot.whatsapp"

#### Scenario: Cambio de idioma del nombre accesible
- **WHEN** se aplica applyLanguage con 'en' y después con 'es' sobre el documento de prueba
- **THEN** el aria-label pasa a ser "zero in the loop on WhatsApp" (EN["foot.whatsapp"] en site/main.js) y vuelve a "WhatsApp de zero in the loop"

### Requirement: Mensaje inicial según el idioma
El mensaje prellenado del enlace de WhatsApp del pie MUST seguir el idioma elegido en el sitio, usando el mecanismo `data-i18n-href`.

#### Scenario: Mensaje en inglés
- **WHEN** se aplica applyLanguage con 'en' sobre el documento de prueba
- **THEN** el href del elemento con data-i18n-href="href.whatsapp" apunta a https://wa.me/5491159813335 y su parámetro text, decodificado, es exactamente "Hi, I want to know more about zero in the loop"

#### Scenario: Vuelta al español
- **WHEN** se aplica applyLanguage con 'en' y después con 'es' sobre el documento de prueba
- **THEN** el href vuelve a ser el del marcado, con el mensaje "Hola, quiero saber más sobre zero in the loop"

#### Scenario: Los enlaces al README no cambian
- **WHEN** se aplica applyLanguage con 'en' y después con 'es' sobre el documento de prueba
- **THEN** los tres elementos con data-i18n-href="href.readme" siguen pasando a la URL en inglés y volviendo a la URL en español

### Requirement: Sin aviso de correo ni dirección en el sitio
The training section MUST NOT have a `<noscript>` notice, and no text file under site/ SHALL contain `mailto:` or an email address.

#### Scenario: Sin noscript en la sección
- **WHEN** the test reads section("training")
- **THEN** the section has no `<noscript>` element

#### Scenario: Sin rastro de correo
- **WHEN** the test reads every text file under site/
- **THEN** none contains `mailto:` or matches /[\w.+-]+@[\w-]+\.[\w.-]+/

#### Scenario: Las claves siguen coincidiendo
- **WHEN** the existing translation-completeness test runs over the markup and the EN map
- **THEN** it passes, with no EN key missing or left over

### Requirement: Dos enlaces por tarjeta
Cada una de las tres tarjetas de #training (talk, workshop, mentoring) MUST mostrar el texto traducible «La quiero» (clave training.cta, en inglés «I want this») como texto, no como enlace, seguido de exactamente dos elementos <a class="button">, primero WhatsApp y después Instagram, sin ningún elemento <button> en la sección.

#### Scenario: Estructura de la tarjeta
- **WHEN** se analiza el HTML de cada tarjeta de #training en site/index.html
- **THEN** hay un elemento con data-i18n="training.cta" y texto «La quiero» que no es un <a>, y después dos <a class="button"> con texto visible «WhatsApp» e «Instagram», en ese orden; los valores de data-training son exactamente talk, workshop y mentoring, una vez cada uno; la sección no contiene <button

#### Scenario: Traducción del texto
- **WHEN** se aplica el idioma inglés con applyLanguage
- **THEN** los elementos training.cta muestran «I want this»; las claves de EN coinciden exactamente con las del HTML

### Requirement: Íconos del pie
Cada enlace de WhatsApp e Instagram de las tarjetas MUST llevar el mismo ícono SVG decorativo que el enlace de esa red en el pie (aria-hidden, sigue currentColor) con ancho y alto explícitos en styles.css.

#### Scenario: Mismo ícono
- **WHEN** se compara el <svg> de cada enlace de las tarjetas con el del enlace de la misma red en el footer, normalizando espacios
- **THEN** son idénticos y tienen aria-hidden="true"

#### Scenario: Tamaño del ícono
- **WHEN** se lee en site/styles.css la regla que da tamaño al svg dentro de los enlaces de #training
- **THEN** declara width y height con unidad

### Requirement: Enlaces sin JavaScript
Sin ejecutar JavaScript, los enlaces de las tarjetas MUST funcionar como <a> en pestaña nueva con rel noopener: WhatsApp a https://wa.me/5491159813335 con el mensaje genérico «Hola, quiero saber más sobre zero in the loop» en text, e Instagram a https://ig.me/m/zerointheloop.

#### Scenario: Marcado de WhatsApp
- **WHEN** se lee el href de cada enlace de WhatsApp de #training en el HTML sin ejecutar main.js
- **THEN** origen y ruta son https://wa.me/5491159813335, el parámetro text decodificado es «Hola, quiero saber más sobre zero in the loop», y el tag tiene target="_blank" y rel con noopener

#### Scenario: Marcado de Instagram
- **WHEN** se lee cada enlace de Instagram de #training en el HTML
- **THEN** su href es exactamente https://ig.me/m/zerointheloop y el tag tiene target="_blank" y rel con noopener

#### Scenario: Sin noscript
- **WHEN** se analiza #training
- **THEN** no hay <noscript> ni dirección de correo

### Requirement: Mensaje de WhatsApp según formato e idioma
Con JavaScript, el href de cada enlace de WhatsApp de las tarjetas MUST llevar en text el mensaje de su formato en el idioma de la página, desde que la página carga y tras cada cambio de idioma. En español: «Hola, quiero la Charla abierta de zero in the loop. Somos [cantidad] personas, nos interesa [fecha aproximada].», «Hola, quiero el Taller grupal de zero in the loop. Somos [cantidad] personas, nos interesa [fecha aproximada].», «Hola, quiero la Mentoría individual de zero in the loop. Somos [cantidad] personas, nos interesa [fecha aproximada].». En inglés: «Hi, I want the Open talk from zero in the loop. We are [number] people, we are interested in [approximate date].», «Hi, I want the Group workshop from zero in the loop. We are [number] people, we are interested in [approximate date].», «Hi, I want the One-on-one mentoring from zero in the loop. We are [number] people, we are interested in [approximate date].».

#### Scenario: Al cargar en español
- **WHEN** main.js corre con un documento falso de idioma español, sin que nadie cambie de idioma
- **THEN** el parámetro text de cada enlace de WhatsApp de las tarjetas decodifica exactamente al mensaje en español de su formato

#### Scenario: Cambio a inglés y vuelta
- **WHEN** se llama applyLanguage con en y luego con es
- **THEN** el text de cada enlace es primero el mensaje en inglés de su formato y luego de nuevo el mensaje en español; origen y ruta siguen siendo https://wa.me/5491159813335

#### Scenario: El pie no cambia
- **WHEN** se aplica cualquier idioma
- **THEN** el enlace de WhatsApp del pie conserva su mensaje genérico en ese idioma (href.whatsapp)

### Requirement: Instagram copia el mensaje y avisa
Al hacer clic en un enlace de Instagram de una tarjeta, zero MUST pedir la copia al portapapeles del mismo mensaje que WhatsApp lleva para ese formato e idioma durante el propio clic, sin cancelar la navegación del enlace, y al lograrla MUST mostrar en la región aria-live visible de esa tarjeta, junto a los botones, «Copiamos el mensaje: pegalo en el chat» (en inglés «We copied the message: paste it in the chat»).

#### Scenario: Copia exitosa
- **WHEN** se dispara el clic del enlace de Instagram del Taller grupal con un portapapeles falso que resuelve
- **THEN** writeText ya fue llamado con el mensaje en español del Taller grupal cuando el manejador retorna, preventDefault no se llamó, y al resolver el aviso de esa tarjeta dice «Copiamos el mensaje: pegalo en el chat» y el de las otras tarjetas sigue vacío

#### Scenario: Región accesible
- **WHEN** se analiza el HTML de cada tarjeta
- **THEN** hay un elemento de aviso propio con aria-live="polite", vacío en el marcado, después de los enlaces, y styles.css no lo saca del árbol de accesibilidad cuando está vacío (sin display: none ni visibility: hidden)

#### Scenario: Inglés
- **WHEN** se hace clic con el idioma inglés aplicado y el portapapeles resuelve
- **THEN** se copia el mensaje en inglés del formato y el aviso dice «We copied the message: paste it in the chat»

### Requirement: Si el portapapeles falla
Si el portapapeles no existe, rechaza o lanza un error, el enlace de Instagram MUST abrirse igual y el aviso de la tarjeta MUST mostrar el mensaje completo como texto plano para copiarlo a mano.

#### Scenario: Rechazo
- **WHEN** se dispara el clic con un writeText que rechaza
- **THEN** preventDefault no se llamó y el aviso de esa tarjeta contiene el mensaje completo del formato y la indicación «No pudimos copiar. Copiá este mensaje y pegalo en el chat:» (en inglés «We could not copy it. Copy this message and paste it in the chat:»)

#### Scenario: Sin portapapeles
- **WHEN** se dispara el clic con navigator sin clipboard
- **THEN** preventDefault no se llamó y el aviso contiene el mensaje completo

#### Scenario: Error síncrono
- **WHEN** se dispara el clic con un writeText que lanza una excepción
- **THEN** el manejador no propaga el error, preventDefault no se llamó y el aviso contiene el mensaje completo

#### Scenario: Cambio de idioma
- **WHEN** hay un aviso visible y se aplica otro idioma
- **THEN** el aviso queda vacío

### Requirement: Pantallas angostas
Los dos enlaces de cada tarjeta MUST ir lado a lado cuando entran y pasar a otra fila cuando no, sin desbordar la tarjeta, y el aviso con el mensaje completo MUST partirse dentro de la tarjeta.

#### Scenario: Reglas de CSS
- **WHEN** se lee en site/styles.css la regla del contenedor de los dos enlaces y la del aviso
- **THEN** el contenedor declara display: flex y flex-wrap: wrap, y el aviso declara overflow-wrap: anywhere

#### Scenario: Aspecto del botón
- **WHEN** se lee la regla .training .button
- **THEN** conserva text-align: center y la fuente monoespaciada de peso 500

### Requirement: Sin nota de WhatsApp
La sección #training MUST dejar de tener la nota de WhatsApp del final y la clave training.whatsapp MUST dejar de existir en el HTML y en EN.

#### Scenario: Nota quitada
- **WHEN** se analiza #training y se carga EN de main.js
- **THEN** no hay elemento con data-i18n="training.whatsapp" ni class="note" en la sección, el número +54 9 11 5981-3335 no aparece en ella y EN no tiene training.whatsapp

### Requirement: README al día
El párrafo del sitio en README.md y README.es.md MUST decir que cada formato de Capacitaciones ofrece WhatsApp e Instagram.

#### Scenario: Los dos idiomas
- **WHEN** se lee el párrafo que menciona zerointheloop.com en cada README
- **THEN** contiene «WhatsApp» e «Instagram», y no contiene «email» ni «correo»
