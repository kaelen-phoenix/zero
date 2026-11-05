# Spec Delta

## Purpose

En la sección Capacitaciones de la web, cada tarjeta (Charla abierta, Taller grupal, Mentoría individual) deja de tener el único botón «La quiero» y pasa a mostrar ese texto seguido de dos botones lado a lado, con los mismos íconos del pie: WhatsApp e Instagram. WhatsApp abre el chat con un mensaje ya cargado según el formato y el idioma, listo para completar la cantidad de personas y la fecha. Instagram abre el chat y, como no permite cargar un mensaje, lo copia al portapapeles y avisa junto a los botones «Copiamos el mensaje: pegalo en el chat»; si no se puede copiar, el chat se abre igual y el mensaje queda a la vista para copiarlo a mano. Sin JavaScript los dos enlaces siguen andando, y WhatsApp lleva un mensaje genérico. En pantallas angostas los botones no se desbordan. Se quita la nota de WhatsApp del final de la sección y se actualizan las pruebas del sitio y los README.

## ADDED Requirements

### Requirement: Dos enlaces por tarjeta
Cada una de las tres tarjetas de #training (talk, workshop, mentoring) MUST mostrar el texto traducible «La quiero» (clave training.cta, en inglés «I want this») como texto, no como enlace, seguido de exactamente dos elementos <a class="button">, primero WhatsApp y después Instagram, sin ningún elemento <button> en la sección.

#### Scenario: Estructura de la tarjeta
- **WHEN** se analiza el HTML de cada tarjeta de #training en site/index.html
- **THEN** hay un elemento con data-i18n="training.cta" y texto «La quiero» que no es un <a>, y después dos <a class="button"> con texto visible «WhatsApp» e «Instagram», en ese orden; los valores de data-training siguen siendo exactamente talk, workshop y mentoring, una vez cada uno; la sección no contiene <button

#### Scenario: Traducción del texto
- **WHEN** se aplica el idioma inglés con applyLanguage
- **THEN** los elementos training.cta muestran «I want this»; las claves de EN siguen coincidiendo exactamente con las del HTML

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
El párrafo del sitio en README.md y README.es.md MUST decir que cada formato de Capacitaciones ofrece WhatsApp e Instagram, en lugar de decir que cada botón abre el chat de Instagram.

#### Scenario: Los dos idiomas
- **WHEN** se lee el párrafo que menciona zerointheloop.com en cada README
- **THEN** contiene «WhatsApp» e «Instagram», y no contiene «email» ni «correo»
