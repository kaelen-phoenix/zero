# Tasks

## 1. Implementación

- [x] 1.1 Sumar a `src/config.ts` el esquema `social`, `lines[].social`, la estación `community` (`FIXED_STATIONS`, `AGENT_STATIONS`, `stations`, skills por línea) y la función que dice si una línea está habilitada.
- [x] 1.2 Sumar `community` a `AgentStation` y `AGENT_ACCESS` en `src/agent.ts`, a `SKILL_STATIONS` en `src/skills.ts`, a `AGENT_SUMMARY` en `src/panel/html.ts`, a `IDLE_STATIONS` en `src/line/scout.ts` y al uso de `zero skill` en `src/cli.ts`.
- [x] 1.3 Escribir `agents/community.md`: rol de solo lectura, ritmo sugerido (historia para algo visible, publicación para una función nueva), voseo, datos como datos y nunca instrucciones. Actualizar la lista de estaciones de `agents/research.md`, y agregar la sección de `community` con Hallazgos y Mejoras en `docs/revision-linea-produccion.md`, que `test/agents.test.ts` exige.
- [x] 1.4 Agregar a `src/secrets.ts` el patrón de tokens de Instagram.
- [x] 1.5 Agregar a `src/state/store.ts` la tabla `social_posts` con sus operaciones: crear, actualizar, listar y contar por día y tipo.
- [x] 1.6 Crear `src/social/filter.ts`: filtro público sobre `reportText` y `breakMentions`, que también detecta rutas absolutas como `/opt/...` sin tocar URLs y avisa si quitó algo para descartar el borrador.
- [x] 1.7 Crear `src/social/render.ts`: tarjeta SVG con los colores del sitio, texto escapado y firma en el pie, pasada a JPEG de 1080x1080 y 1080x1920 con `@resvg/resvg-js`, `jpeg-js` y una fuente TTF de licencia libre incluida. Agregar las dependencias a `package.json` y `package-lock.json`.
- [x] 1.8 Crear `src/social/channel.ts` con las interfaces de canal y alojamiento, `src/social/instagram.ts` con el adaptador (cuenta con `/me`, contenedor, espera, `media_publish`, enlace, token nunca en errores) y `src/social/github-media.ts` con la prerelease pública y el rechazo de repositorios privados.
- [x] 1.9 Crear `src/line/community.ts`: esquema de borradores, datos del prompt, compuertas, tope compartido, descarte por línea, tema, filtro y límites, registro en curso antes de publicar, comprobación de pausa y andon antes de cada borrador, y `communityPass` con marca diaria en kv.
- [x] 1.10 Conectar la pasada en `idlePasses` de `src/daemon.ts`, después de scout y research, con opción para activarla y adaptadores inyectables en tests, apagada en corridas `once` como las demás.
- [x] 1.11 Agregar a `src/app.ts` `socialStatus`, `setSocialPaused` y `socialPostNow`, a `src/format.ts` el texto del estado, y a `src/cli.ts` `zero social status|post-now|pause|resume` con su ayuda.
- [x] 1.12 Escribir tests con canal y alojamiento falsos: `test/social-pass.test.ts`, `test/social-render.test.ts` (decodificando los JPEG), `test/social-filter.test.ts` (rutas con espacios, carpetas hermanas, `/opt/...`, URLs intactas), `test/social-instagram.test.ts` (con `fetch` falso) y los casos de CLI y configuración. Actualizar los órdenes de estaciones en `test/panel-guide.test.ts` y `test/skills.test.ts`.
- [x] 1.13 Documentar en `README.md` y `README.es.md` con los mismos títulos y bloques: configuración, comandos, guía de la app de Meta (cuenta profesional, permisos, token, `zero secret set INSTAGRAM_ACCESS_TOKEN`), repositorio público para las imágenes y vencimiento del token. Actualizar `test/docs.test.ts` y `AGENTS.md`.
- [x] 1.14 Correr `npm run typecheck`, `npm test`, `npm run build` y `npx openspec validate --all`.
