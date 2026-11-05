# Spec Delta

## Purpose

En la sección Capacitaciones de la web, los tres botones «La quiero» (charla, taller y mentoría) dejan de abrir un correo y abren el chat de Instagram de zero in the loop (https://ig.me/m/zerointheloop) en una pestaña nueva. Pasan a ser enlaces de verdad, con el mismo aspecto de botón, así que funcionan también sin JavaScript; por eso desaparece el aviso que explicaba cómo escribir por correo a mano, y la dirección de correo ya no queda en ningún archivo del sitio. El texto del botón sigue traducido («La quiero» / «I want this») y el enlace es el mismo en los dos idiomas. La nota de WhatsApp queda como está. También se actualizan las pruebas del sitio y la frase de los README que decía que cada botón abre un correo.

## ADDED Requirements

### Requirement: Los botones de Capacitaciones son enlaces al chat de Instagram
In `<section id="training">` of site/index.html, each of the three formats (talk, workshop, mentoring) MUST offer its call to action as an `<a>` with class `button`, `href="https://ig.me/m/zerointheloop"`, `target="_blank"` and a `rel` containing `noopener`, and the section SHALL contain no `<button>` element.

#### Scenario: Tres enlaces con el destino correcto
- **WHEN** the test reads section("training") of site/index.html and lists its `<a>` tags carrying `data-training`
- **THEN** their data-training values are exactly talk, workshop, mentoring in that order, and each tag has class `button`, href `https://ig.me/m/zerointheloop` with no query string, target `_blank` and a rel containing `noopener`

#### Scenario: Sin elementos button
- **WHEN** the test searches section("training") for `<button`
- **THEN** there is no match

### Requirement: El texto del enlace sigue traducido y el destino no cambia con el idioma
Each call-to-action link MUST keep the visible text `La quiero` under the `data-i18n` key `training.cta`, whose EN value SHALL be `I want this`, and its `href` MUST be the same in both languages, so it SHALL NOT carry `data-i18n-href`.

#### Scenario: Texto en los dos idiomas
- **WHEN** the test reads each call-to-action link in the markup and looks up its data-i18n key in the EN map of main.js
- **THEN** the markup text is `La quiero`, the key is `training.cta` and its EN value is `I want this`

#### Scenario: El destino es independiente del idioma
- **WHEN** the test reads the opening tag of each call-to-action link
- **THEN** no tag has a `data-i18n-href` attribute and all have the href `https://ig.me/m/zerointheloop`

### Requirement: El enlace funciona sin JavaScript
site/main.js MUST NOT build, intercept or redirect the training call to action: `trainingMailto`, the address parts and the mail subject and body texts SHALL be removed, and no click listener SHALL be attached to the training links.

#### Scenario: Sin función de correo
- **WHEN** the test loads main.js with loadSite()
- **THEN** `zeroSite.trainingMailto` is undefined

#### Scenario: Sin código de correo en main.js
- **WHEN** the test reads the text of site/main.js
- **THEN** it does not contain `trainingMailto`, `MAIL_PARTS`, `mailto:` or `data-training`

### Requirement: Sin aviso de correo ni dirección en el sitio
The `<noscript>` notice about email and its `training.noscript` key MUST be removed from site/index.html and from the EN map, and no text file under site/ SHALL contain `mailto:`, the former training address, or its mail user or domain parts.

#### Scenario: Sin noscript en la sección
- **WHEN** the test reads section("training") and the EN map
- **THEN** the section has no `<noscript>` element and EN has no `training.noscript` property

#### Scenario: Sin rastro de la dirección
- **WHEN** the test reads every text file under site/
- **THEN** none contains `mailto:`, `kaelen.dev` or `gmail.com`

#### Scenario: Las claves siguen coincidiendo
- **WHEN** the existing translation-completeness test runs over the markup and the EN map
- **THEN** it passes, with no EN key missing or left over

### Requirement: El enlace conserva el aspecto de botón
The training call-to-action links MUST keep looking as the former buttons did: the base `.training .button` rule in site/styles.css SHALL center their text, so it stays centered when the link stretches to full width on narrow screens, and SHALL keep the monospace font of 500 weight that the `<button>` element gave them.

#### Scenario: Regla de estilo
- **WHEN** the test extracts the first `.training .button { ... }` rule from site/styles.css
- **THEN** the rule contains `text-align: center` and declares a font using weight 500 and `var(--mono)`

### Requirement: La nota de WhatsApp no cambia
The `training.whatsapp` note below the formats MUST stay unchanged in both languages: same number, same WhatsApp link and message, new tab and `noopener`.

#### Scenario: Nota en español e inglés
- **WHEN** the existing WhatsApp tests read the `training.whatsapp` line of the markup and of the EN map
- **THEN** they pass without changes, finding the number, a single anchor to wa.me with the message in its language, target `_blank` and `noopener`

### Requirement: El README describe el nuevo destino
The zerointheloop.com paragraph of README.md and of README.es.md MUST say that each Training / Capacitaciones button opens the Instagram chat of zero in the loop, and SHALL NOT say it opens an email, keeping the same structure in both files.

#### Scenario: README en inglés
- **WHEN** the test reads the zerointheloop.com paragraph of README.md
- **THEN** it contains `Training`, `Spanish` and `Instagram` and does not contain `email`

#### Scenario: README en español
- **WHEN** the test reads the zerointheloop.com paragraph of README.es.md
- **THEN** it contains `Capacitaciones`, `español` and `Instagram` and does not contain `correo`
