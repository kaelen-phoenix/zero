# Tasks

## 1. Estación de seguridad

- [x] 1.1 Agregar `agents/security.md` y la estación `security` después de `review` (solo lectura, citas verificadas, hallazgos graves vuelven a `build`), con `stations.security` en la configuración; verificar con agentes falsos
- [x] 1.2 Mostrar la estación en la traza, el panel y las métricas

## 2. Fusión automática

- [x] 2.1 Agregar `autoMerge` por línea (solo válido con `pull-request`)
- [x] 2.2 Seguir los pull requests de esas líneas desde el daemon cada minuto: fundir con checks en verde, no fundir y avisar una vez si algo falla; verificar con una API falsa
- [x] 2.3 Comentar en el issue al fundir y mostrar los pendientes en `zero status`, el panel y el informe

## 3. Prueba real y documentación

- [ ] 3.1 Probar con un issue real en el repositorio de zero
- [x] 3.2 Actualizar README, AGENTS.md y el ADR
