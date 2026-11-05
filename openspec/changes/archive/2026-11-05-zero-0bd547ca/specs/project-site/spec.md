# Spec Delta

## Purpose

Vas a tener el sitio del proyecto para zerointheloop.com en la carpeta site/ del repo. Son HTML, CSS y un poco de JavaScript, sin dependencias ni paso de build, así que Vercel lo publica tal cual si ponés site/ como carpeta raíz. El estilo es técnico y editorial (inspirado en openspec.dev, sin copiarlo): - mucho espacio en blanco, sans-serif para el texto y monoespaciada para la terminal; - etiquetas chicas en mayúsculas, marcadores 01, 02… y rótulos tipo "FIG. 1 / LÍNEA"; - en el encabezado, una figura SVG de la línea de producción: estaciones, el trabajo pasando y el dueño como el punto que vuelve a entrar. Las secciones van en este orden: 1. título y bajada; 2. sinopsis; 3. la línea y sus estaciones; 4. niveles L0–L3 y la autonomía por línea (propose, build, auto); 5. el turno nocturno (scout y research); 6. las garantías; 7. instalación, con botón de copiar; 8. el flujo de trabajo con sus comandos; 9. la grilla de motores y clientes de chat; 10. los enlaces. El pie muestra GitHub, la versión, la licencia y el selector de tema auto, claro u oscuro. Está en español (primero) e inglés, con selector. Es accesible, se lee bien en el celular y es liviano. Trae metadatos para compartir con su imagen, favicon, robots.txt y sitemap.xml. No tiene formularios, cookies ni analítica, y no publica nada privado. Todo sale del README: lo que todavía no existe dice "en camino". Unos tests automáticos cuidan esas reglas, y el README suma una línea con el sitio y cómo se publica.

## ADDED Requirements

### Requirement: Static site without dependencies
The project site MUST live under site/ as plain static files (index.html, CSS, plain JS), with no package.json, no build step and no external script, stylesheet or font loaded from another origin, so Vercel can serve site/ as its root directory.

#### Scenario: Entry and no build
- **WHEN** the site/ directory is inspected
- **THEN** site/index.html exists and site/ contains no package.json, node_modules or build configuration

#### Scenario: No third-party resources
- **WHEN** every <script src>, <link href> and CSS url()/@import in site/ is listed
- **THEN** each one is a relative path inside site/ (no http(s):// or // origins), except plain <a href> links

### Requirement: Content sections in order
site/index.html MUST present, in this order, sections for: title and tagline ('zero in the loop', the factory takes the human's place in the loop and the owner decides where to step back in), synopsis, production line and stations, autonomy levels L0–L3 and per-line autonomy, night shift, guarantees, install and first steps, workflow, compatibility and links. Each section MUST carry a stable id and a numbered marker (01, 02…).

#### Scenario: Section order
- **WHEN** the section ids are read from index.html in document order
- **THEN** they appear in the order hero, synopsis, line, autonomy, night-shift, guarantees, install, workflow, compatibility, links

#### Scenario: Numbered markers
- **WHEN** the sections after the hero are inspected
- **THEN** each contains a marker 01, 02, … in increasing order

### Requirement: Factual content only
The site content MUST come from what zero does today according to the README. It MUST name the stations spec, build, verify, review, security and integrate; the levels L0, L1, L2 and L3; the per-line autonomies propose, build and auto; the scout and research stations; and the guarantees (protected paths, verification, secrets outside files, isolation box). It MUST contain no metrics, star counts, customers or testimonials. Future items MUST be labelled 'en camino' / 'coming'.

#### Scenario: Facts present
- **WHEN** index.html is read
- **THEN** it contains spec, build, verify, review, security, integrate, L0, L1, L2, L3, propose, auto, scout and research

#### Scenario: Future items labelled
- **WHEN** an item from the README's 'Próximas etapas' (e.g. the installer or OTLP export) appears
- **THEN** it is marked with an element carrying the text 'en camino' (ES) / 'coming' (EN)

### Requirement: Production line figure
The header MUST include an inline SVG figure of the production line labelled 'FIG. 1 / LÍNEA'. It MUST show the stations as nodes, the work moving through them and the owner as a point that re-enters where they decide. It MUST have an accessible name (role=img with aria-label or <title>) in the active language, and its animation MUST stop under prefers-reduced-motion: reduce.

#### Scenario: Accessible figure
- **WHEN** the header SVG is inspected
- **THEN** it has role="img" and a <title> or aria-label, its caption contains 'FIG. 1', and it has one node per station

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

### Requirement: Header and footer
The header MUST be minimal, with links to Docs (https://github.com/kaelen-phoenix/zero#readme) and GitHub (https://github.com/kaelen-phoenix/zero). The footer MUST show GitHub, the version equal to package.json's version, the license (Apache-2.0) and a theme selector with auto, light and dark.

#### Scenario: Version matches
- **WHEN** the footer version is read from index.html and compared to package.json
- **THEN** they are equal

#### Scenario: Links and license
- **WHEN** the header and footer are inspected
- **THEN** the Docs and GitHub hrefs match those URLs and the footer contains Apache-2.0

### Requirement: Theme selector
The theme selector MUST offer auto, light and dark. Auto MUST follow prefers-color-scheme, and an explicit choice MUST be applied through a data attribute on <html> and remembered only in localStorage (no cookies).

#### Scenario: Theme choice
- **WHEN** the site script sets the theme to dark
- **THEN** document.documentElement has data-theme="dark" and localStorage stores the choice; choosing auto removes the attribute

#### Scenario: Auto follows system
- **WHEN** the CSS is inspected
- **THEN** it has a @media (prefers-color-scheme: dark) rule applied when no explicit theme is set

### Requirement: Spanish and English
The site MUST be available in Spanish (default) and English with a language selector. Every visible text element MUST have both versions, the selector MUST update <html lang>, and the choice MUST be remembered only in localStorage.

#### Scenario: Default Spanish
- **WHEN** index.html is loaded without a stored choice
- **THEN** <html lang="es"> and the visible texts are Spanish

#### Scenario: Switch to English
- **WHEN** the site script switches to en
- **THEN** <html lang> becomes en and every translatable element shows its English text, with no translation key missing in either language

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
