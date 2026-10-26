# Tasks

## 1. Secretos

- [ ] 1.1 Añadir `@napi-rs/keyring` y crear `src/secrets/` (llavero con índice de nombres, entorno primero) y verificar con tests sobre un llavero en memoria
- [ ] 1.2 Agregar `zero secret set|list|remove` (valor por stdin, rechazo como argumento) y verificar con tests de la CLI

## 2. Configuración y nivel efectivo

- [ ] 2.1 Agregar `box:` (runtime, límites) y `secrets` en motores personalizados al esquema, y `isolation: container` por defecto en `zero init`; verificar con tests
- [ ] 2.2 Hacer que `effectiveLevel` use la disponibilidad de la caja y las credenciales por motor, con motivos accionables; verificar con tests de cada escenario de la spec

## 3. Caja

- [ ] 3.1 Implementar la detección de runtime y la inspección de la caja (runtime, máquina, imagen) con caché en `kv`, y verificarla con tests sobre sondas falsas
- [ ] 3.2 Crear `box/Dockerfile` y la construcción de la imagen con etiqueta por contenido, y verificar el hash y el contexto con tests
- [ ] 3.3 Implementar la ejecución en la caja (argumentos de seguridad, montajes ro/rw, usuario por plataforma, credenciales por entorno, cancelación) y verificar los argumentos con tests
- [ ] 3.4 Implementar `src/box/agent.ts` (protocolo stdin → `ZERO-RESULT`) y verificarlo ejecutándolo como proceso con un motor personalizado
- [ ] 3.5 Implementar el plan de preparación por plataforma y `zero box status|setup` con confirmaciones, y verificar los planes con tests

## 4. Línea en modo caja

- [ ] 4.1 Implementar la copia por clon independiente con traída de la rama antes de integrar, guardar el modo de aislamiento en el trabajo, y verificar con repos temporales
- [ ] 4.2 Integrar el modo caja en el ejecutor (setup, agentes y verificación por la caja; descarte tras verificar) y verificarlo de punta a punta con un runtime simulado
- [ ] 4.3 Mostrar el estado de la caja en `zero status` y en el chat, y refrescarlo desde el daemon; verificar con tests

## 5. Prueba real y documentación

- [ ] 5.1 Agregar el job de CI con Docker que construye la imagen y entrega un trabajo dentro de la caja (montaje de solo lectura y aislamiento del directorio del usuario comprobados), y verificar que pasa en GitHub Actions
- [ ] 5.2 Actualizar README, AGENTS.md y el ADR, y verificar que los comandos documentados existen

## Workflow follow-up

- Archivar la change cuando todas las tareas estén completas.
- Probar la caja en Windows cuando el equipo tenga WSL2 y Podman.
