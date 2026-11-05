# Proposal

## Why

Vas a tener una única fuente de la verdad sobre el sitio: openspec/specs/project-site/spec.md. Los diez cambios del sitio que ya están en main pasan al archivo de OpenSpec, y sus requisitos quedan ajustados a lo que el sitio hace hoy. Sale lo que quedó viejo: el formato «Empresas», el campo de empresa, el correo, el botón «La quiero» que abría un mail y la nota de WhatsApp. Queda lo vigente: tres formatos con WhatsApp e Instagram, Capacitaciones solo en español, la sección de CI en el orden real y el nivel auto sin prometer despliegues. No cambia nada del sitio ni de su código: solo se toca openspec/.

## What Changes

- Consolidar los cambios del sitio en openspec/specs/project-site
- Supuesto: No pude correr `openspec validate` ni `openspec archive` en esta estación: la ejecución de npx estaba denegada. Que el archive falla con los nombres repetidos sale de leer node_modules/@fission-ai/openspec/dist/core/specs-apply.js, no de probarlo.
- Supuesto: Supuesto: se usa la capacidad `project-site-spec` y no `project-site` para este trabajo. Sus requisitos hablan del contenido del spec, no del sitio. Con `project-site` este change sería otro delta suelto, y al archivarlo metería esos requisitos en el spec del sitio.
- Supuesto: Supuesto: se amplía lo que nombra el pedido. El pedido cita dos changes, pero en main ya hay diez deltas de project-site, y el correo, el botón único y la nota de WhatsApp también quedaron superados. Por eso se archivan los diez y se retiran esos requisitos.
- Supuesto: Supuesto: se incluye la sección ci en project-site, aunque sus requisitos originales están en zero-eb49c475 (capacidad project-docs, que sigue sin archivar). Sin ella, el orden de secciones del spec no coincidiría con el sitio. Ese requisito queda duplicado hasta consolidar project-docs.
- Supuesto: Los archivos archivados conservan texto viejo como historia, y el delta archivado de zero-658a04c5 queda con dos encabezados renombrados. Los escenarios se aplican solo a openspec/specs/project-site/spec.md.
- Supuesto: No se agrega una prueba automática porque el pedido dice que solo se toca openspec/. Los escenarios sobre el texto del spec se comprueban con búsquedas y con revisión; nada evita que el spec se desactualice más adelante.
- Supuesto: Si la verificación de la línea no corre sin dependencias o la caja no tiene node_modules, `npx openspec` necesita las dependencias del repositorio ya instaladas.

## Capabilities

### New Capabilities
- `project-site-spec`: Consolidar los cambios del sitio en openspec/specs/project-site

### Modified Capabilities

## Impact

Generado por zero para el trabajo a43b40db.
