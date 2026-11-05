# Proposal

## Why

En zerointheloop.com, la sección Capacitaciones va a mostrar solo tres formatos: Charla abierta, Taller grupal y Mentoría individual. Se va la tarjeta «Empresas» con su botón «La quiero» y su traducción al inglés. El sitio ya no menciona empresas en ningún lado: el correo que abre el botón tampoco pide el dato «Empresa (opcional)». En inglés pasa lo mismo («Company (optional)»). Los tests del sitio se actualizan para comprobar que quedan exactamente esos tres formatos y que la palabra «empresa» no aparece en ningún archivo del sitio.

Pedido original: "Sitio (site/): sacar el formato «Empresas» de la sección Capacitaciones (section#training): su tarjeta, su botón «La quiero» y cualquier texto o traducción que lo mencione. Quedan tres formatos: charla abierta, taller grupal y mentoría individual. En ninguna parte del sitio se ofrecen capacitaciones para empresas. Actualizar test/site.test.ts."

## What Changes

- Sitio: sacar el formato «Empresas» de Capacitaciones
- Supuesto: Interpretation: 'cualquier texto que lo mencione' plus 'en ninguna parte del sitio se ofrecen capacitaciones para empresas' is read as also removing the optional 'Empresa' / 'Company' field from the mail body, since it invites company requests. If the owner wanted to keep that field, it is a two-line revert.
- Supuesto: The mentoring description 'Para una persona o un equipo' ('For a person or a team') is kept: a team is not a company, and the owner lists mentoría individual as one of the formats that stay as they are.
- Supuesto: The open OpenSpec change zero-fd46ec20 (project-site) still describes four formats including companies; this job's own change supersedes it, and both should be reconciled when they are archived.
- Supuesto: The regex /compan(y|ies)/i must not hit unrelated words; today the only site matches are the companies card, its EN keys and the mail field (checked with grep), but the build should rerun the scan after editing.

## Capabilities

### New Capabilities
- `project-site`: Sitio: sacar el formato «Empresas» de Capacitaciones

### Modified Capabilities

## Impact

Generado por zero para el trabajo 6e844ec0.
