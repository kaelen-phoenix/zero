# Tasks

## 1. Implementación

- [x] 1.1 En `site/index.html`, dentro de `<footer class="foot">` e inmediatamente después del enlace de GitHub, agregar `<a class="social" href="https://www.instagram.com/zerointheloop/" target="_blank" rel="noopener" data-i18n-label="foot.instagram" aria-label="Instagram de zero in the loop">` con un SVG en línea simple (cuadrado redondeado, círculo y punto) con `aria-hidden="true"`, `focusable="false"`, `stroke`/`fill` en `currentColor`.
- [x] 1.2 En `site/main.js`, agregar `"foot.instagram": "zero in the loop on Instagram"` al objeto `EN`, junto a las otras claves del pie.
- [x] 1.3 En `site/styles.css`, en la sección Footer, darle al SVG de `.foot .social` ancho y alto explícitos (por ejemplo 1.1em) y alinear el enlace con `display: inline-flex`, sin colores nuevos.
- [x] 1.4 En `test/site.test.ts`, agregar pruebas de cada escenario: href, target, rel y posición en el pie; SVG monocromo y decorativo; regla de tamaño en el CSS; aria-label en español y cambio de idioma con `applyLanguage`.
- [x] 1.5 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
