# Spec Delta

## ADDED Requirements

### Requirement: Sin capacitaciones en el sitio
No text file directly under site/ (index.html, main.js, styles.css, the svg/txt/xml files) SHALL mention training: none MUST match /capacitaci|training|charla abierta|taller grupal|mentor[ií]a|mentoring|workshop|la quiero|i want this/i. index.html MUST NOT contain a section with id "training", any href="#training", or any data-training, data-training-channel or data-training-notice attribute.

#### Scenario: Archivos del sitio limpios
- **WHEN** the test scans every text file of site/ (textFiles)
- **THEN** none matches /capacitaci|training|charla abierta|taller grupal|mentor[ií]a|mentoring|workshop|la quiero|i want this/i

#### Scenario: Marcado sin restos
- **WHEN** the test reads site/index.html
- **THEN** it has no '<section id="training"', no 'href="#training"' and no 'data-training' attribute of any kind

### Requirement: Sin claves ni lógica de capacitaciones
site/main.js MUST NOT define any EN key starting with "training." or the key "nav.training", and the exported zeroSite object MUST NOT expose setTrainingLinks or copyTrainingMessage.

#### Scenario: EN y exportaciones
- **WHEN** the test loads main.js with runInNewContext and reads zeroSite
- **THEN** no key of zeroSite.EN starts with 'training.' or equals 'nav.training', and zeroSite has neither setTrainingLinks nor copyTrainingMessage

### Requirement: Sección de contacto
site/index.html SHALL have a `<section id="contact" aria-labelledby="contact-h">` after `compatibility` and before `links`, with no data-lang-only attribute, a label `<span data-i18n="contact.label">Contacto</span>` with its numbered marker, and an `<h2 id="contact-h" data-i18n="contact.title">`. EN MUST map contact.label to 'Contact' and contact.title to a non-empty English text.

#### Scenario: Orden y marcadores
- **WHEN** the test lists the `<section id>` values of site/index.html in document order and reads each section's marker
- **THEN** they equal hero, synopsis, line, autonomy, night-shift, guarantees, ci, install, workflow, compatibility, contact, links, and the markers after hero read 01..11 in order (contact 10, links 11)

#### Scenario: Rótulo y título traducidos
- **WHEN** the test reads section('contact') and EN from main.js
- **THEN** the section has data-i18n="contact.label" with text 'Contacto' and an h2 with data-i18n="contact.title"; EN['contact.label'] is 'Contact' and EN['contact.title'] is non-empty; the section tag has no data-lang-only

### Requirement: Solo WhatsApp e Instagram como medios de contacto
The contact section MUST contain exactly two `<a class="button">` links and no other `<a>`, `<button>`, `<form>` or `<noscript>`: first WhatsApp, with an href whose origin and path are https://wa.me/5491159813335 and whose decoded text parameter is 'Hola, quiero saber más sobre zero in the loop' in the markup, carrying data-i18n-href="href.whatsapp"; then Instagram, with href exactly https://ig.me/m/zerointheloop. Both MUST open in a new tab (target="_blank", rel including noopener) and show visible text 'WhatsApp' and 'Instagram'. The section MUST NOT contain mailto:, tel:, an email address or any other link destination.

#### Scenario: Dos enlaces en orden
- **WHEN** the test parses the `<a>` tags of section('contact')
- **THEN** there are exactly two, both with class="button", target="_blank" and rel including noopener; their visible text without the svg is ['WhatsApp','Instagram']; the first href is wa.me/5491159813335 with text 'Hola, quiero saber más sobre zero in the loop' and data-i18n-href="href.whatsapp", the second is exactly https://ig.me/m/zerointheloop

#### Scenario: Ningún otro medio
- **WHEN** the test reads section('contact')
- **THEN** it has no <button, <form, <noscript, mailto:, tel: and no text matching /@[a-z0-9-]+\.[a-z]/i

#### Scenario: WhatsApp sigue el idioma
- **WHEN** the test builds the fake document, calls applyLanguage(doc,'en',…) and then applyLanguage(doc,'es',…)
- **THEN** the contact WhatsApp link's decoded text is first 'Hi, I want to know more about zero in the loop' and then 'Hola, quiero saber más sobre zero in the loop', with origin and path https://wa.me/5491159813335 both times

### Requirement: Íconos de contacto iguales a los del pie
Each contact link MUST carry the same decorative inline SVG as the footer link of that network (aria-hidden="true", following currentColor), and styles.css MUST give the svg inside the contact links an explicit width and height.

#### Scenario: Mismo ícono y tamaño
- **WHEN** the test compares, with whitespace squashed, the svg of each contact link with the svg of the footer link to wa.me and to instagram.com, and reads the `.contact .button svg` rule of styles.css
- **THEN** the WhatsApp and Instagram svgs equal their footer counterparts and have aria-hidden="true"; the CSS rule declares width and height with a unit

### Requirement: Menú enlaza el contacto
The header nav MUST contain `<a href="#contact" data-i18n="nav.contact">Contacto</a>` without data-lang-only, before the Docs and GitHub links, and EN MUST map nav.contact to 'Contact'.

#### Scenario: Enlace del menú
- **WHEN** the test reads the `<header class="top">` markup and EN
- **THEN** it contains '<a href="#contact" data-i18n="nav.contact">Contacto</a>', the Docs and GitHub links are still there, no header link has data-lang-only, and EN['nav.contact'] is 'Contact'

### Requirement: Todo el sitio en los dos idiomas
No element of site/index.html SHALL carry data-lang-only, so every section is shown in Spanish and in English, and the section markers MUST read 01..11 in document order in the markup and after applyLanguage to either language.

#### Scenario: Numeración en los dos idiomas
- **WHEN** the test builds the fake document and calls applyLanguage with 'es', then 'en', then 'es'
- **THEN** the markers after hero read 01..11 each time, the links marker reads 11 and the contact marker 10, and no element has the hidden attribute

#### Scenario: Sin data-lang-only
- **WHEN** the test searches index.html for data-lang-only
- **THEN** there is no match

### Requirement: README sin capacitaciones
The zerointheloop.com paragraph of README.md and of README.es.md MUST NOT mention Training/Capacitaciones and MUST say that the site has a contact section with WhatsApp and Instagram, keeping the same structure in both languages.

#### Scenario: Los dos README
- **WHEN** the test reads the paragraph containing zerointheloop.com in README.md and README.es.md
- **THEN** neither matches /training|capacitaci/i; both contain 'WhatsApp', 'Instagram', 'site/' and 'Vercel'; README.md contains 'contact' and README.es.md contains 'contacto' (case-insensitive); neither contains 'email' or 'correo'

## MODIFIED Requirements

### Requirement: Content sections in order
site/index.html MUST present, in this order, sections for: title and tagline ('zero in the loop', with the tagline that «Lema del hero: zero se suma al circuito» asks for), synopsis, production line and stations, autonomy levels L0–L3 and per-line autonomy, night shift, guarantees, CI and quality tools, install and first steps, workflow, compatibility, contact and links. Each section MUST carry a stable id, and each section after the hero MUST carry a numbered marker (01, 02…).

#### Scenario: Section order
- **WHEN** the section ids are read from index.html in document order
- **THEN** they appear in the order hero, synopsis, line, autonomy, night-shift, guarantees, ci, install, workflow, compatibility, contact, links

#### Scenario: Numbered markers
- **WHEN** the sections after the hero are read in the markup
- **THEN** their markers read 01 to 11 in increasing order, with contact 10 and links 11

### Requirement: Header and footer
The header MUST be minimal, with links to Contacto (see «Menú enlaza el contacto»), Docs and GitHub (https://github.com/kaelen-phoenix/zero). The Docs link MUST follow the language: its href in the markup is https://github.com/kaelen-phoenix/zero/blob/main/README.es.md, and English replaces it with https://github.com/kaelen-phoenix/zero#readme through data-i18n-href="href.readme". The footer MUST show GitHub, the Instagram and WhatsApp links (see «Enlace de Instagram en el pie» and «Enlace de WhatsApp en el pie»), the version equal to package.json's version, the license (Apache-2.0), the line saying zero in the loop built the site, and a theme selector with auto, light and dark.

#### Scenario: Version matches
- **WHEN** the footer version is read from index.html and compared to package.json
- **THEN** they are equal

#### Scenario: Links and license
- **WHEN** the header and footer are inspected
- **THEN** the Docs and GitHub hrefs in the markup match those URLs and the footer contains Apache-2.0, the Instagram link and the WhatsApp link

#### Scenario: Docs in English
- **WHEN** applyLanguage switches the fake document to en and then back to es
- **THEN** the elements with data-i18n-href="href.readme" (header, hero and links) point first to the #readme URL and then back to README.es.md

### Requirement: Spanish and English
The site MUST be available in Spanish (default) and English with a language selector. Every visible text element MUST have both versions, with no exception. The selector MUST update <html lang>, and the choice MUST be remembered only in localStorage.

#### Scenario: Default Spanish
- **WHEN** index.html is loaded without a stored choice
- **THEN** <html lang="es"> and the visible texts are Spanish

#### Scenario: Switch to English
- **WHEN** the site script switches to en
- **THEN** <html lang> becomes en and every translatable element shows its English text, with no translation key missing in either language, and no element is hidden

### Requirement: Numeración correlativa en los dos idiomas
The section markers (`<span class="marker" data-marker>`) of the sections after the hero MUST read 01, 02, … without gaps in document order, in the markup and after applyLanguage to either language (contact 10, links 11).

#### Scenario: Español
- **WHEN** the test reads the markup, and also after applyLanguage(doc, 'es', …) on the fake document
- **THEN** the markers after hero read 01..11 in order, contact 10 and links 11

#### Scenario: Inglés
- **WHEN** the test calls applyLanguage(doc, 'en', …) on the fake document
- **THEN** the markers after hero read 01..11 in order and the links marker reads 11

#### Scenario: Ida y vuelta
- **WHEN** the test switches es → en → es
- **THEN** the links marker reads 11 and the contact marker reads 10

### Requirement: Sin aviso de correo ni dirección en el sitio
The contact section MUST NOT have a `<noscript>` notice, and no text file under site/ SHALL contain `mailto:` or an email address.

#### Scenario: Sin noscript en la sección
- **WHEN** the test reads section("contact")
- **THEN** the section has no `<noscript>` element

#### Scenario: Sin rastro de correo
- **WHEN** the test reads every text file under site/
- **THEN** none contains `mailto:` or matches /[\w.+-]+@[\w-]+\.[\w.-]+/

#### Scenario: Las claves siguen coincidiendo
- **WHEN** the existing translation-completeness test runs over the markup and the EN map
- **THEN** it passes, with no EN key missing or left over

## REMOVED Requirements

### Requirement: Training section in order
**Reason**: The site no longer offers training; the contact section takes its place.
**Migration**: See «Sección de contacto».

### Requirement: Menu link to the training section
**Reason**: There is no training section to link.
**Migration**: See «Menú enlaza el contacto».

### Requirement: Topics beyond zero
**Reason**: The training topics went with the training section.
**Migration**: None.

### Requirement: Capacitaciones solo en español
**Reason**: Nothing on the site is shown in one language only.
**Migration**: See «Todo el sitio en los dos idiomas».

### Requirement: README aclara el idioma
**Reason**: No section of the site is Spanish-only any more.
**Migration**: See «README sin capacitaciones».

### Requirement: Tres formatos de capacitación
**Reason**: The training formats are gone.
**Migration**: None.

### Requirement: Dos enlaces por tarjeta
**Reason**: There are no training cards.
**Migration**: See «Solo WhatsApp e Instagram como medios de contacto».

### Requirement: Íconos del pie
**Reason**: It described the training cards' icons.
**Migration**: See «Íconos de contacto iguales a los del pie».

### Requirement: Enlaces sin JavaScript
**Reason**: It described the training cards' links.
**Migration**: The contact links work without JavaScript as plain links; see «Solo WhatsApp e Instagram como medios de contacto».

### Requirement: Mensaje de WhatsApp según formato e idioma
**Reason**: There are no formats; the contact link carries the generic message.
**Migration**: See «Solo WhatsApp e Instagram como medios de contacto» and «Mensaje inicial según el idioma».

### Requirement: Instagram copia el mensaje y avisa
**Reason**: The per-format message no longer exists, so nothing is copied.
**Migration**: None.

### Requirement: Si el portapapeles falla
**Reason**: Nothing is copied to the clipboard on the contact links.
**Migration**: None.

### Requirement: Pantallas angostas
**Reason**: It described the training cards' layout.
**Migration**: The contact buttons keep a narrow-screen rule in styles.css.

### Requirement: Sin nota de WhatsApp
**Reason**: It described the training section.
**Migration**: None.

### Requirement: README al día
**Reason**: It described the training formats in the README.
**Migration**: See «README sin capacitaciones».
