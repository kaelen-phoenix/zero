# Tasks

## 1. Implementación

- [x] 1.1 En `src/panel/server.ts`, cambiar `Referrer-Policy` a `same-origin` en `headers`.
- [x] 1.2 En `src/panel/html.ts`, cambiar el meta de `page` a `<meta name="referrer" content="same-origin">`.
- [x] 1.3 En `sameOrigin` (`src/panel/server.ts`), cuando `Origin` es exactamente `null`, devolver true solo si `Sec-Fetch-Site` es `same-origin`. El resto de la función queda igual: el rechazo por `Sec-Fetch-Site` y la comparación de `Origin` con `Host`. Ajustar su comentario.
- [x] 1.4 Corregir el comentario de `returnTo` en `src/panel/server.ts`, que dice que el panel no manda Referer: ahora lo manda dentro del mismo sitio, y la función sigue sin usarlo.
- [x] 1.5 En `test/panel.test.ts`, cambiar la expectativa de `referrer-policy` a `same-origin` y agregar la comprobación del meta.
- [x] 1.6 En `test/panel.test.ts`, agregar los tests de POST de cada escenario: Origin igual al Host, Origin null con same-origin, Origin null sin Sec-Fetch-Site, Origin null con none, Origin de otro sitio (con y sin same-origin) y cross-site (con y sin Origin null). Comprobar el estado y si se creó un trabajo.
- [x] 1.7 Actualizar la línea de `Referrer-Policy` en `openspec/changes/add-control-panel/design.md` a `same-origin`.
- [x] 1.8 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
