# Proposal

## Why

En la sección Capacitaciones de la web, los tres botones «La quiero» (charla, taller y mentoría) dejan de abrir un correo y abren el chat de Instagram de zero in the loop (https://ig.me/m/zerointheloop) en una pestaña nueva. Pasan a ser enlaces de verdad, con el mismo aspecto de botón, así que funcionan también sin JavaScript; por eso desaparece el aviso que explicaba cómo escribir por correo a mano, y la dirección de correo ya no queda en ningún archivo del sitio. El texto del botón sigue traducido («La quiero» / «I want this») y el enlace es el mismo en los dos idiomas. La nota de WhatsApp queda como está. También se actualizan las pruebas del sitio y la frase de los README que decía que cada botón abre un correo.

## What Changes

- Capacitaciones: los botones «La quiero» abren el chat de Instagram
- Supuesto: Assumption: 'en ambos idiomas' means the link text stays translated and the destination is the same in both. The Capacitaciones section stays visible only in Spanish, as a previous change decided; this change does not show it in English.
- Supuesto: Assumption: the `<noscript>` notice is removed rather than rewritten, because the links work without JavaScript and it would have nothing left to explain.
- Supuesto: Instagram cannot receive a preloaded message, so the chat no longer tells whoever answers which format the person chose; they will have to ask.
- Supuesto: With this change the site no longer offers any email contact for training: only Instagram and WhatsApp.
- Supuesto: The tests check the markup, not the destination: none of them opens https://ig.me/m/zerointheloop, so a wrong or disabled Instagram account would not be detected.
- Supuesto: Assumption: the `data-training` attribute stays in the markup with no JavaScript use, as the format's name on each link and the tests' way of finding them.

## Capabilities

### New Capabilities
- `project-site`: Capacitaciones: los botones «La quiero» abren el chat de Instagram

### Modified Capabilities

## Impact

Generado por zero para el trabajo 9891a486.
