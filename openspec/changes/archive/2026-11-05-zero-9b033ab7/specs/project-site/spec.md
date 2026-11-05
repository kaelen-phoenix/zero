# Spec Delta

## Purpose

El pie de zerointheloop.com va a mostrar, junto a GitHub, un ícono simple y de un solo color que lleva a la cuenta de Instagram de zero in the loop. El enlace se abre en una pestaña nueva y los lectores de pantalla lo anuncian como "Instagram de zero in the loop", o en inglés cuando el sitio está en inglés. El sitio tiene una sola página, así que el cambio queda en ese único pie. El sitio no tiene datos estructurados JSON-LD, por lo que no hay ninguna lista sameAs que actualizar.

## ADDED Requirements

### Requirement: Enlace de Instagram en el pie
El pie del sitio (`<footer class="foot">` en `site/index.html`) MUST contener, junto a los demás enlaces, un enlace a https://www.instagram.com/zerointheloop/ que se abra en una pestaña nueva con `target="_blank"` y `rel="noopener"`.

#### Scenario: El pie enlaza a Instagram en una pestaña nueva
- **WHEN** se lee el elemento footer de site/index.html
- **THEN** contiene un <a> con href exactamente https://www.instagram.com/zerointheloop/, target="_blank" y un rel que incluye noopener

#### Scenario: El enlace queda junto a los otros
- **WHEN** se recorren los enlaces del footer en orden
- **THEN** el enlace de Instagram viene inmediatamente después del enlace de GitHub y antes del selector de tema

### Requirement: Ícono monocromo
El enlace de Instagram MUST mostrar un ícono SVG en línea, decorativo, de un solo color que hereda el color del texto (`currentColor`), sin colores fijos, sin recursos externos y sin texto visible adicional.

#### Scenario: El ícono sigue el tema del sitio
- **WHEN** se lee el SVG dentro del enlace de Instagram
- **THEN** tiene aria-hidden="true", usa currentColor para pintar, no contiene colores hexadecimales ni rgb() y no tiene atributos href ni src ni elementos image o script

#### Scenario: El ícono tiene tamaño definido
- **WHEN** se lee site/styles.css
- **THEN** hay una regla para el SVG del enlace del pie que le da ancho y alto explícitos, de modo que el SVG no se expanda al ancho disponible

### Requirement: Texto accesible en los dos idiomas
El enlace de Instagram MUST tener el nombre accesible "Instagram de zero in the loop" en español y su traducción al inglés cuando el sitio está en inglés, usando el mecanismo `data-i18n-label` del sitio.

#### Scenario: Español por defecto
- **WHEN** se lee el enlace en site/index.html
- **THEN** tiene aria-label="Instagram de zero in the loop" y data-i18n-label="foot.instagram"

#### Scenario: Cambio de idioma
- **WHEN** se aplica applyLanguage con 'en' y después con 'es' sobre el documento de prueba
- **THEN** el aria-label del enlace pasa a ser "zero in the loop on Instagram" (valor de EN["foot.instagram"] en site/main.js) y vuelve a "Instagram de zero in the loop"
