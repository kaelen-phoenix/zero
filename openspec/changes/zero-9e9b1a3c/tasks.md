# Tasks

## 1. Implementación

- [x] 1.1 Escribir en test/ (docs.test.ts o un trademark.test.ts nuevo) los tests de cada escenario, con el helper `read` que normaliza los saltos de línea.
- [x] 1.2 Crear `TRADEMARK.md` en la raíz, corto y en inglés llano, con redacción propia y sin copiar texto de las políticas citadas. Secciones: marcas cubiertas, relación con la licencia, usos permitidos, usos que necesitan permiso (incluye que los forks distribuidos cambien nombre y logos), la palabra «zero» sola, cómo pedir permiso y la aclaración de que no es asesoramiento legal.
- [x] 1.3 Agregar al final de `README.md` la sección `## License and trademark` y al final de `README.es.md` la sección `## Licencia y marca`, con el mismo contenido, sin bloques de código y con enlaces a `LICENSE` y `TRADEMARK.md`. En español, usar «vos» y no usar la palabra que prohíbe test/wording.test.ts.
- [x] 1.4 Actualizar la viñeta de `site/brand/` en `docs/agents/site.md` para decir que el uso de los logos se rige por `TRADEMARK.md`. No tocar `AGENTS.md`, `LICENSE` ni `site/`.
- [x] 1.5 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
