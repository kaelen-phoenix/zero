# Spec Delta

## Purpose

En zerointheloop.com, la sección Capacitaciones va a mostrar solo tres formatos: Charla abierta, Taller grupal y Mentoría individual. Se va la tarjeta «Empresas» con su botón «La quiero» y su traducción al inglés. El sitio ya no menciona empresas en ningún lado: el correo que abre el botón tampoco pide el dato «Empresa (opcional)». En inglés pasa lo mismo («Company (optional)»). Los tests del sitio se actualizan para comprobar que quedan exactamente esos tres formatos y que la palabra «empresa» no aparece en ningún archivo del sitio.

## ADDED Requirements

### Requirement: Tres formatos de capacitación
The training section (section#training in site/index.html) SHALL list exactly three formats, in this order and identified by data-training: talk (Charla abierta), workshop (Taller grupal), mentoring (Mentoría individual). Each MUST keep its title, short description, 'a consultar' label and 'La quiero' button exactly as today. The section MUST NOT contain a 'companies' format, its card, its button or the title 'Empresas'.

#### Scenario: formatos listados
- **WHEN** the test collects the data-training values in section('training')
- **THEN** they equal ['talk','workshop','mentoring'], the section contains 'Charla abierta', 'Taller grupal' and 'Mentoría individual', and it does not contain 'Empresas'

#### Scenario: a consultar por formato
- **WHEN** the test filters the section's translatable elements whose text is 'a consultar'
- **THEN** there are exactly 3 and each maps to 'on request' in EN; the section text still has no prices ($, USD, ARS, €, precio, price)

#### Scenario: botones
- **WHEN** the test collects <button type="button" ... data-training ... data-i18n ...> elements in section('training')
- **THEN** there are exactly three, for talk, workshop and mentoring, each labeled 'La quiero' with EN value 'I want this'

### Requirement: Sin traducciones del formato Empresas
site/main.js MUST NOT contain the EN keys training.companies.title and training.companies, and site/index.html MUST NOT contain data-i18n keys starting with training.companies, so the EN keys keep matching the markup's translatable keys exactly.

#### Scenario: claves eliminadas
- **WHEN** the test loads main.js and reads EN
- **THEN** EN has no key 'training.companies.title' nor 'training.companies', and the existing test 'cada clave traducible tiene su versión en inglés' passes

### Requirement: Ninguna mención de empresas en el sitio
No text file under site/ SHALL mention companies: none MUST match /empresa|compan(y|ies)/i. This includes the training mail body, which MUST NOT carry the 'Empresa (opcional):' / 'Company (optional):' field.

#### Scenario: archivos del sitio limpios
- **WHEN** the test scans every text file in site/ (textFiles)
- **THEN** none matches /empresa|compan(y|ies)/i

#### Scenario: correo en español sin campo empresa
- **WHEN** trainingMailto runs with the Spanish fake document and a button with data-training="talk"
- **THEN** the decoded subject is 'Capacitación: Charla abierta', the body contains 'Nombre:', 'Cuántas personas:' and 'Qué busca', and it does not contain 'Empresa'

#### Scenario: correo en inglés sin campo company
- **WHEN** applyLanguage switches the fake document to en and trainingMailto runs for data-training="mentoring"
- **THEN** the address is the training address, the decoded subject is 'Training: ' + EN['training.mentoring.title'] ('One-on-one mentoring'), the body contains 'Name', 'How many people' and 'What you are looking for', and it does not contain 'Company'

### Requirement: El resto de Capacitaciones sigue igual
Removing the format MUST NOT change anything else in the training section or the site: the menu link, data-lang-only behaviour, section order and numbering, topics paragraph, noscript hint, hidden address and every other site test MUST keep passing.

#### Scenario: suite del sitio
- **WHEN** npm test runs test/site.test.ts and test/docs.test.ts
- **THEN** all tests pass, including section order (training still marker 10 in Spanish), numbering in both languages, translation completeness, visible text, privacy and the address checks
