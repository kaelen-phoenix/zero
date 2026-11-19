# Proposal

## Why

La página zerointheloop.com deja de hablar de capacitaciones. Se van la sección Capacitaciones con sus tres formatos (Charla abierta, Taller grupal, Mentoría individual), el enlace «Capacitaciones» del menú, los mensajes que se copiaban o prellenaban por formato y cualquier texto relacionado, en español y en inglés. En su lugar queda una sección «Contacto» sencilla, visible en los dos idiomas, con solo dos botones: WhatsApp e Instagram. El menú enlaza a esa sección y no se nombran capacitaciones en ninguna parte. El README, en inglés y en español, deja de mencionar Capacitaciones y dice que el sitio tiene un contacto por WhatsApp e Instagram. El pie de página sigue como está, con sus íconos de Instagram y WhatsApp.

## What Changes

- Quitar Capacitaciones del sitio y dejar solo un contacto por WhatsApp e Instagram
- Supuesto: I read «Dejá solo un contacto» as a single contact section that replaces Capacitaciones, visible in both languages, plus a «Contacto» link in the menu. I keep the existing footer icons for Instagram (instagram.com profile) and WhatsApp, because they are the same two channels and other requirements already describe them. If you wanted those footer icons gone as well, that is a small follow-up.
- Supuesto: The contact section's Instagram button uses https://ig.me/m/zerointheloop, which opens a direct-message chat, as the training cards did. The footer keeps the instagram.com profile link. The WhatsApp button uses the generic prefilled message and follows the language through href.whatsapp, like the footer.
- Supuesto: The archived Purpose paragraph of openspec/specs/project-site/spec.md still mentions Capacitaciones. OpenSpec deltas cannot change Purpose, so it stays outdated until someone edits it by hand.
- Supuesto: The unarchived change zero-a43b40db has a delta for a 'project-site-spec' capability that requires the spec to describe Capacitaciones. If that change is archived later, it creates a spec that contradicts this change.
- Supuesto: The forbidden-word scan only covers text files directly under site/ (textFiles is not recursive). site/brand/ has no training text today, and og.png shows only the line figure.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-site`: Quitar Capacitaciones del sitio y dejar solo un contacto por WhatsApp e Instagram

## Impact

Generado por zero para el trabajo 91625266.
