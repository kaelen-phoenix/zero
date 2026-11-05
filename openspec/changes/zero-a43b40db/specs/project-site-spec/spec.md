# Spec Delta

## Purpose

Vas a tener una única fuente de la verdad sobre el sitio: openspec/specs/project-site/spec.md. Los diez cambios del sitio que ya están en main pasan al archivo de OpenSpec, y sus requisitos quedan ajustados a lo que el sitio hace hoy. Sale lo que quedó viejo: el formato «Empresas», el campo de empresa, el correo, el botón «La quiero» que abría un mail y la nota de WhatsApp. Queda lo vigente: tres formatos con WhatsApp e Instagram, Capacitaciones solo en español, la sección de CI en el orden real y el nivel auto sin prometer despliegues. No cambia nada del sitio ni de su código: solo se toca openspec/.

## ADDED Requirements

### Requirement: Changes del sitio archivados
Los diez changes con delta de project-site (zero-0bd547ca, zero-fd46ec20, zero-3b42aa28, zero-6e844ec0, zero-ad4eff67, zero-943e22bf, zero-9b033ab7, zero-658a04c5, zero-9891a486, zero-961c82bc) MUST quedar bajo openspec/changes/archive/ y no en openspec/changes/, y ningún otro change activo SHALL moverse ni editarse.

#### Scenario: Los diez están archivados
- **WHEN** se listan openspec/changes/ y openspec/changes/archive/
- **THEN** cada uno de los diez nombres aparece en archive/ como <fecha>-<nombre>, y ninguno sigue como carpeta directa de openspec/changes/

#### Scenario: Los demás siguen activos
- **WHEN** se comparan los otros changes con main (por ejemplo zero-eb49c475, zero-3e948e4d y zero-a43b40db)
- **THEN** siguen en openspec/changes/; salvo zero-a43b40db, que es de este trabajo, sus archivos no cambiaron

### Requirement: Spec principal válido
openspec/specs/project-site/spec.md MUST existir con secciones Purpose y Requirements, y `npx openspec validate --all` MUST terminar sin errores.

#### Scenario: Validación
- **WHEN** se corre `npx openspec validate --all` en el repositorio
- **THEN** termina con código 0 y project-site figura entre los specs válidos

#### Scenario: Propósito vigente
- **WHEN** se lee la sección Purpose del spec
- **THEN** describe el sitio actual y no contiene «vuelve a entrar», «cuatro formatos», «TBD» ni «Empresas»

### Requirement: Sin Empresas ni datos de empresa
El spec MUST exigir exactamente tres formatos de capacitación (talk, workshop, mentoring) y MUST NOT describir el formato «Empresas», su clave de traducción ni un campo de empresa.

#### Scenario: Tres formatos
- **WHEN** se lee el requisito de formatos del spec
- **THEN** nombra talk, workshop y mentoring como la lista exacta, con Charla abierta, Taller grupal y Mentoría individual

#### Scenario: Sin rastros
- **WHEN** se busca en el spec
- **THEN** no aparecen «Empresas», «training.companies», «Empresa (opcional)», «Company (optional)» ni el requisito «Four formats on request, no prices»

#### Scenario: El sitio coincide
- **WHEN** se escanean los archivos de texto de site/ con /empresa|compan(y|ies)/i
- **THEN** no hay coincidencias, igual que exige el requisito «Ninguna mención de empresas en el sitio» del spec

### Requirement: Capacitaciones refleja los dos canales actuales
El spec MUST describir cada tarjeta de Capacitaciones como en site/index.html y site/main.js: el texto «La quiero» seguido de un enlace de WhatsApp y otro de Instagram, sin elementos button. MUST NOT conservar requisitos de correo, del aviso noscript, del enlace único a Instagram ni de la nota de WhatsApp.

#### Scenario: Requisitos vigentes
- **WHEN** se listan los encabezados del spec
- **THEN** están «Dos enlaces por tarjeta», «Íconos del pie», «Enlaces sin JavaScript», «Mensaje de WhatsApp según formato e idioma», «Instagram copia el mensaje y avisa», «Si el portapapeles falla», «Pantallas angostas» y «Sin nota de WhatsApp»

#### Scenario: Requisitos retirados
- **WHEN** se listan los encabezados del spec
- **THEN** no están «Real buttons that open a mailto», «Address not written whole in the site», «Fallback without JavaScript», «WhatsApp en el llamado a escribir», «Los botones de Capacitaciones son enlaces al chat de Instagram», «El texto del enlace sigue traducido y el destino no cambia con el idioma», «El enlace funciona sin JavaScript», «La nota de WhatsApp no cambia», «El README describe el nuevo destino» ni «README mentions training»

#### Scenario: Sin función de correo
- **WHEN** se busca en el spec
- **THEN** no aparecen «trainingMailto», «MAIL_PARTS» ni «training.noscript»

### Requirement: Capacitaciones solo en español
El spec MUST conservar que Capacitaciones y su enlace del menú se ven solo en español, con la numeración real: 01 a 11 en español (training 10, links 11) y 01 a 10 en inglés.

#### Scenario: Idioma
- **WHEN** se lee el requisito «Capacitaciones solo en español»
- **THEN** exige data-lang-only="es" en el enlace del menú y en la sección, con hidden solo después de aplicar inglés, y exige la regla `[hidden]` con `display: none` en styles.css

#### Scenario: Numeración
- **WHEN** se leen los requisitos de orden y numeración del spec
- **THEN** dicen training 10 y links 11 en español, links 10 en inglés, y ningún requisito dice «marker 09» para training

### Requirement: Orden real de las secciones
El spec MUST exigir el orden de secciones de site/index.html: hero, synopsis, line, autonomy, night-shift, guarantees, ci, install, workflow, compatibility, training, links. También MUST describir la sección ci con su recorrido del pedido al despliegue.

#### Scenario: Orden
- **WHEN** se comparan los escenarios de orden del spec con los ids de `<section>` de site/index.html
- **THEN** la lista del spec es idéntica, incluidos ci y training, y no queda ninguna lista de orden sin ellos

#### Scenario: Sección de CI
- **WHEN** se leen los requisitos del spec
- **THEN** uno exige la sección ci después de guarantees, que diga que zero no reemplaza el CI ni las herramientas de calidad, y su lista `ol.path` de 6 pasos

### Requirement: Relato y figura actuales
El spec MUST NOT pedir un lema en el que la fábrica ocupe el lugar de la persona ni una figura en la que la persona vuelva a entrar; los requisitos del hero y de la figura SHALL coincidir con el lema y el SVG actuales.

#### Scenario: Requisitos de contenido y figura
- **WHEN** se leen los textos de «Content sections in order» y «Production line figure»
- **THEN** no contienen «human's place», «step back in» ni «re-enters», y no contradicen «Lema del hero: zero se suma al circuito» ni «Figura del hero como línea de montaje»

### Requirement: Nivel auto sin despliegues
El spec MUST conservar que el texto de `autonomy.auto`, en español y en inglés, dice que el trabajo se integra solo según la línea y se funde en líneas de pull request con autoMerge, y MUST NOT prometer despliegues.

#### Scenario: Requisitos presentes
- **WHEN** se listan los encabezados del spec
- **THEN** están «El nivel auto no promete despliegues (español)» y «El nivel auto no promete despliegues (inglés)», con escenarios que rechazan /despleg|desplieg/i y /deploy/i

#### Scenario: El sitio coincide
- **WHEN** se leen `autonomy.auto` en site/index.html y EN['autonomy.auto'] en site/main.js
- **THEN** cumplen esos escenarios

### Requirement: Encabezado, pie, idiomas y futuro al día
El spec MUST describir los enlaces a Docs según el idioma (README.es.md en español, #readme en inglés), los enlaces de Instagram y WhatsApp del pie, la excepción de Capacitaciones a la regla de los dos idiomas, y MUST NOT dar la exportación OTLP como algo en camino.

#### Scenario: Docs por idioma
- **WHEN** se lee el requisito «Header and footer»
- **THEN** pide README.es.md en el marcado y https://github.com/kaelen-phoenix/zero#readme en inglés mediante data-i18n-href, y no pide #readme en el marcado español

#### Scenario: Idiomas
- **WHEN** se lee el requisito «Spanish and English»
- **THEN** exceptúa lo marcado con data-lang-only de verse en los dos idiomas

#### Scenario: OTLP
- **WHEN** se lee el requisito «Factual content only»
- **THEN** no pone la exportación OTLP como ejemplo de algo en camino, y sus ejemplos están en la lista «Próximas etapas» de site/index.html

### Requirement: Solo cambia openspec
El cambio MUST tocar únicamente archivos bajo openspec/, y las pruebas existentes MUST seguir pasando.

#### Scenario: Alcance del diff
- **WHEN** se listan los archivos cambiados de la rama respecto de main
- **THEN** todas las rutas empiezan con openspec/

#### Scenario: Pruebas
- **WHEN** se corren `npm run typecheck` y `npm test`
- **THEN** pasan sin editar test/ ni site/
