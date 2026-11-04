# Spec Delta

## Purpose

El pie de zerointheloop.com va a tener un ícono simple y de un solo color que abre el WhatsApp de zero in the loop (+54 9 11 5981-3335) en una pestaña nueva, con el mensaje inicial ya escrito. Los lectores de pantalla lo anuncian como "WhatsApp de zero in the loop". En inglés, tanto ese texto como el mensaje inicial aparecen en inglés. La sección de Capacitaciones, que es el único lugar del sitio que invita a escribir, suma una línea con el número. Esa sección solo se ve en español. No se agrega el teléfono a datos estructurados porque el sitio no tiene JSON-LD, y vos lo pediste solo si existía.

## ADDED Requirements

### Requirement: Enlace de WhatsApp en el pie
El pie del sitio (`<footer class="foot">` en `site/index.html`) MUST contener, junto a los demás enlaces, un enlace a https://wa.me/5491159813335 con el mensaje inicial prellenado, que se abra en una pestaña nueva con `target="_blank"` y `rel="noopener"`.

#### Scenario: El pie enlaza a WhatsApp con el mensaje en español
- **WHEN** se lee el elemento footer de site/index.html
- **THEN** contiene un <a> con target="_blank", un rel que incluye noopener y un href cuyo origen y ruta son https://wa.me/5491159813335 y cuyo parámetro text, decodificado, es exactamente "Hola, quiero saber más sobre zero in the loop"

#### Scenario: El enlace queda junto a los otros
- **WHEN** se recorre el contenido del footer en orden
- **THEN** el enlace de WhatsApp viene después del enlace de GitHub (y del de Instagram, si el pie ya lo tiene) y antes de la versión y del selector de tema

### Requirement: Ícono monocromo
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

### Requirement: Texto accesible en los dos idiomas
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

### Requirement: WhatsApp en el llamado a escribir
La sección de Capacitaciones (`#training`) MUST ofrecer WhatsApp como forma de escribir, con el número visible +54 9 11 5981-3335 y un enlace al mismo destino que se abra en una pestaña nueva con `rel="noopener"`, bajo una clave traducible.

#### Scenario: La línea aparece en español
- **WHEN** se lee la sección training de site/index.html
- **THEN** hay un elemento con data-i18n="training.whatsapp" cuyo contenido incluye el texto +54 9 11 5981-3335 y un <a> a https://wa.me/5491159813335 con target="_blank", un rel que incluye noopener y el mensaje en español

#### Scenario: La línea tiene versión en inglés
- **WHEN** se lee EN["training.whatsapp"] en site/main.js
- **THEN** incluye +54 9 11 5981-3335, target="_blank", un rel que incluye noopener y un enlace a https://wa.me/5491159813335 cuyo parámetro text, decodificado, es "Hi, I want to know more about zero in the loop"

#### Scenario: Los botones de correo siguen igual
- **WHEN** se lee la sección training de site/index.html
- **THEN** sigue teniendo los tres botones con data-training talk, workshop y mentoring, en ese orden
