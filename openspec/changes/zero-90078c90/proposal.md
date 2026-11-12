# Proposal

## Why

En el dibujo de la línea de producción del sitio (FIG. 1), el puntito de color que te representa pasa a ser un ícono simple de persona: una cabeza y hombros, en el color de acento y con el mismo pulso suave de antes. La etiqueta «vos» (en inglés, «you») va más grande y en negrita, y en celular crece un poco más para leerse bien. Funciona en modo claro y oscuro, porque usa los colores del sitio. El panel no tiene este dibujo, así que ahí no cambia nada.

## What Changes

- FIG. 1 del sitio: «vos» con ícono de persona y rótulo más visible
- Supuesto: La figura escala con su viewBox (720 de ancho): en un celular de 360px, 20px de SVG se ven como unos 10px reales. Se eligió un mínimo de 20px en móvil como equilibrio, para que no tape los arcos; puede quedar algo chico en pantallas muy angostas.
- Supuesto: La regex de test/wording.test.ts (heroLabel) exige que class sea el primer atributo del <text> del rótulo. No hay que reordenar atributos.
- Supuesto: El test «Sin colores fijos» prohíbe fill="…" y stroke="…" en el SVG, así que el ícono tiene que pintarse solo desde CSS.
- Supuesto: El pedido dice que, si el panel tiene el mismo dibujo, se aplique ahí también. No lo tiene (src/panel no usa line-fig ni la figura), así que no se toca.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-site`: FIG. 1 del sitio: «vos» con ícono de persona y rótulo más visible

## Impact

Generado por zero para el trabajo 90078c90.
