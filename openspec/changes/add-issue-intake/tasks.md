# Tasks

## 1. Base actualizada

- [x] 1.1 Traer la rama base del remoto al crear la copia de un trabajo `pull-request` y arrancar desde ella, en copias por worktree y por clon; verificar con un remoto local que avanzó
- [x] 1.2 Publicar el pull request desde el repositorio del dueño e incluir `Closes #N` para trabajos de issues

## 2. Issues

- [x] 2.1 Agregar `issues` por línea y `source` del trabajo (columna y migración)
- [x] 2.2 Implementar la revisión de issues (etiqueta, sin pull requests, permisos del autor y de quien etiquetó, un trabajo a la vez, re-etiquetado) y los comentarios por estado; verificar con una API falsa
- [x] 2.3 Revisar issues desde el daemon cada minuto, sin solaparse, y mostrar el estado en `zero status` y el panel
- [x] 2.4 Agregar `zero issues on|off [--line] [--label]`, que crea la etiqueta en GitHub si no existe

## 3. Prueba real y documentación

- [ ] 3.1 Probar con un issue real en el repositorio de zero
- [x] 3.2 Actualizar README, AGENTS.md y el ADR
