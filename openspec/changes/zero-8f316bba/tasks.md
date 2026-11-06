# Tasks

## 1. Implementación

- [x] 1.1 Crear el cambio OpenSpec en `openspec/changes/zero-8f316bba/` (proposal.md, tasks.md, specs/night-shift/spec.md) con estos requisitos. El proposal.md debe indicar el límite conocido: un dato aún puede viajar en la ruta de una URL y los enlaces normales siguen, aunque requieren un clic. Validar con `npx openspec validate --all`.
- [x] 1.2 En `src/line/research.ts`, hacer que `webUrl` vacíe `search` y `hash` antes de devolver `href`. La deduplicación con `Set` de `sanitizeNotes` ya opera sobre ese resultado; actualizar el comentario de la función.
- [x] 1.3 Crear `src/intake/inert-media.ts`, sin imports, con la función pura `inertMedia(text)`: reemplazar `![` por `!\[` en todo el texto, y `<` por `&lt;` cuando le sigue `/` opcional más un nombre de la lista (`img`, `picture`, `source`, `video`, `audio`, `iframe`, sin distinguir mayúsculas) y luego espacio, `/`, `>` o el final del texto. No intentar reconocer bloques de código ni contexto Markdown.
- [x] 1.4 En `src/intake/research.ts`, aplicar `inertMedia` como último paso de `publicText`, que usan `researchIssueTitle` y `researchIssueBody`. Actualizar el comentario del módulo.
- [x] 1.5 En `src/intake/proposals.ts`, aplicar `inertMedia` como último paso a lo que van a publicar `publish` (título), `proposalIssueBody`, `tellApproved` y `tellRejected`, sin cambiar qué otra limpieza hace cada uno. Verificar que no se cree un ciclo de imports.
- [x] 1.6 Agregar `test/inert-media.test.ts` con cada forma de los requisitos: directa, de referencia (completa, colapsada y abreviada), anidada, varias líneas, mayúsculas, cada etiqueta, cierre, sin `>`, bloque HTML, texto que no cambia e idempotencia.
- [x] 1.7 En `test/research.test.ts`, agregar los casos de fuente con query y fragmento y de duplicados. En `test/research-issues.test.ts`, agregar la publicación con imágenes, el título y el caso en que quitar la ruta del repositorio podría volver a formar una imagen. En `test/proposal-issues.test.ts`, agregar título, cuerpo, rutas y los comentarios de aprobación y rechazo.
- [x] 1.8 Agregar en `agents/research.md`, junto a `sources`, que zero descarta el query string y el fragmento, para que la estación prefiera URLs que identifiquen la página por su ruta.
- [x] 1.9 Documentar en `README.md` y `README.es.md`, en el párrafo que describe los issues `zero:investigacion` (línea 628), que las imágenes y etiquetas de recursos se publican como texto, que las fuentes se guardan sin query string, y el límite conocido. Actualizar en `AGENTS.md` las notas de `src/intake/research.ts` y `src/intake/proposals.ts`.
- [x] 1.10 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
