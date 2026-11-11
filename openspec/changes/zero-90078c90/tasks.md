# Tasks

## 1. Implementación

- [ ] 1.1 En site/index.html, reemplazar <circle class="owner" cx="360" cy="46" r="7"/> por un <g class="owner"> centrado en (360, 46). Por ejemplo, la cabeza <circle cx="360" cy="39" r="6"/> y los hombros <path d="M348 56 Q348 46 360 46 Q372 46 372 56 Z"/>, o un trazo equivalente. Sin atributos fill ni stroke de color. Va después de los owner-path, para que tape el nacimiento de los arcos.
- [ ] 1.2 Mover el <text class="owner-label"> (sin cambiar el orden de atributos: class primero, data-i18n="fig.owner", contenido «vos») a una y por encima de la cabeza, por ejemplo y="22".
- [ ] 1.3 En site/styles.css, cambiar .line-fig .owner a fill: var(--accent). Opcional: un stroke: var(--bg) fino como halo. Mantener animation: pulse 3s ease-in-out infinite y transform-origin: 360px 46px. Si hace falta, suavizar el @keyframes pulse (por ejemplo a scale(1.12)) sin pasar de 1.35.
- [ ] 1.4 En site/styles.css, darle a .line-fig .owner-label un font-size de 15–16px y font-weight 700, con fill: var(--accent). Agregar dentro de @media (max-width: 40rem) una regla .line-fig .owner-label { font-size: 22px; } o similar, de al menos 20px.
- [ ] 1.5 En test/site.test.ts (describe «sitio del proyecto: FIG. 1»), cambiar la expectativa class="owner" para exigir un <g class="owner"> con <circle> y <path>, sin <circle class="owner">. Agregar tests de: tamaño y peso del rótulo, regla móvil de al menos 20px, pulso con transform-origin y escala ≤ 1.35, y rótulo por encima de la cabeza. Comprobar que test/wording.test.ts sigue pasando.
- [ ] 1.6 Correr npm run typecheck y npm test.
