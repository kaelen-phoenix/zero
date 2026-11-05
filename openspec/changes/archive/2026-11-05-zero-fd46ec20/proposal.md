# Proposal

## Why

El sitio zerointheloop.com suma una sección «Capacitaciones» («Training» en inglés), con su enlace en el menú de arriba y en los dos idiomas. Muestra cuatro formatos: Charla abierta, Taller grupal, Mentoría individual y Empresas. Cada uno tiene una descripción corta y dice «a consultar», sin precios. Un párrafo aclara que los temas van más allá de zero: trabajar en serio con agentes de IA (Claude Code, especificaciones con OpenSpec, revisión y seguridad del código que escribe la IA, dónde entra la persona en el circuito), con zero como herramienta. Cada formato tiene un botón «La quiero» / «I want this» que abre el programa de correo del visitante con un mail a kaelen.dev@gmail.com. El asunto es «Capacitación: <formato>» y el cuerpo trae campos para completar: nombre, empresa (opcional), cuántas personas y qué busca. La dirección no aparece escrita entera en ningún archivo del sitio: el JavaScript la arma recién al tocar el botón. Si el navegador no tiene JavaScript, se muestra cómo escribir a mano. No hay formularios, cookies ni datos guardados. Los botones son accesibles y se ven bien en el teléfono. El README (inglés y español) menciona la sección. El sitemap queda igual, porque el sitio sigue siendo una sola página.

Pedido original: "Sitio (site/): pestaña Capacitaciones con un botón que le manda un mail al dueño. - Nueva sección/pestaña 'Capacitaciones' ('Training' en inglés) en el menú del sitio, en los dos idiomas, con el mismo estilo del sitio. - Cuatro formatos, cada uno con una descripción corta y 'a consultar' (sin precios): 1) Charla abierta (unos 60 minutos: de pedirle código a la IA a tener una fábrica que trabaja sola); 2) Taller grupal (2 a 4 encuentros prácticos: cada participante arma su propia fábrica con zero en sus proyectos); 3) Mentoría individual (para una persona o un equipo, en sus propios repos); 4) Empresas (capacitación del equipo y puesta en marcha de zero). Los temas no son solo zero: trabajar con agentes de IA en serio (Claude Code, especificaciones con OpenSpec, revisión y seguridad del código que escribe la IA, dónde entra la persona en el circuito), con zero como herramienta. - Cada formato tiene un botón 'La quiero' / 'I want this' que abre el correo del visitante (mailto) hacia kaelen.dev@gmail.com, con asunto 'Capacitación: <formato>' ('Training: <format>' en inglés) y un cuerpo con campos para completar: nombre, empresa (opcional), cuántas personas, qué busca. La dirección no se escribe entera en el HTML: se arma con JS recién al tocar el botón, para que no la levanten los recolectores de spam; sin JS, el botón muestra cómo escribir. - Sin formularios, sin cookies, sin guardar datos. Accesible (botones de verdad, foco visible, contraste AA) y bien en el teléfono. - Actualizar el sitemap y el README (inglés y español) si corresponde."

## What Changes

- Sitio: sección Capacitaciones con pedido por correo
- Supuesto: The request asks for a 'pestaña' (tab), but the site is one page. This spec reads it as a section with an anchor link in the header menu, not a separate page. A separate page would also need a sitemap entry and its own head metadata.
- Supuesto: The request says 'sin JS, el botón muestra cómo escribir'. A plain button cannot do anything without JS, so this spec uses a `<noscript>` hint in the section that spells out the address ('kaelen.dev arroba gmail.com'). The exact wording is a judgment call.
- Supuesto: The sitemap is left unchanged because no new URL exists. That reading of 'si corresponde' is an assumption.
- Supuesto: Spam protection is only obfuscation. A JS-executing crawler can still get the address.
- Supuesto: Rendered contrast and the mobile layout can only be checked by tests at the token and CSS level, not visually.

## Capabilities

### New Capabilities
- `project-site`: Sitio: sección Capacitaciones con pedido por correo

### Modified Capabilities

## Impact

Generado por zero para el trabajo fd46ec20.
