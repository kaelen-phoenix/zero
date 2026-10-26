# Tasks

## 1. Reglas y configuración

- [x] 1.1 Agregar `egress:` (mode, allow, block) al esquema y `hosts` a los motores (adaptadores y personalizados); verificar con tests de configuración
- [x] 1.2 Implementar `judge()` y la política efectiva en `src/box/egress.ts` (orden de reglas, sitios con subdominios y puerto, sospechas por nombre y por dirección); verificar con tests de cada regla

## 2. La puerta

- [x] 2.1 Implementar el proxy (`CONNECT` y HTTP absoluto, pases, recarga de la política, bytes, registro por día, bloqueados escritos antes de responder) y verificarlo en proceso contra servidores locales
- [x] 2.2 Implementar la red interna, el contenedor de la puerta (endurecido, reinicio por imagen nueva, dirección por `inspect`) y los pases por ejecución; verificar la secuencia de comandos con un runtime falso
- [x] 2.3 Pasar las cajas a la red interna sin DNS y con las variables de proxy; verificar los argumentos con tests

## 3. Registro y efecto en los trabajos

- [x] 3.1 Agregar la tabla `egress`, la lectura transaccional de los registros con posiciones en `kv`, la limpieza (archivos leídos, 90 días) y verificarla con tests de idempotencia y líneas parciales
- [x] 3.2 Agregar el evento `egress-suspicious` a la política, la pregunta y su aprobación (`egressSeq`), y revisarlo después de `spec`, en cada intento y antes de integrar; verificar L3, L2 y bloqueos del dueño con tests del runner

## 4. Vistas

- [x] 4.1 Agregar `summarizeEgress` y las métricas de salidas, `zero egress` (informe y edición de reglas conservando comentarios), las salidas en `zero trace` y el resumen en el informe; verificar con tests
- [x] 4.2 Agregar `zero_egress` y `zero_egress_block` al servidor MCP y verificar que no hay forma de permitir desde el chat

## 5. Prueba real y documentación

- [x] 5.1 Ampliar el e2e de la caja: sin salida directa ni DNS, sitio normal por la puerta, sitio sospechoso bloqueado y registrado; correrlo en CI con Podman y con Docker
- [x] 5.2 Actualizar README, AGENTS.md y el ADR

## Workflow follow-up

- Archivar la change cuando todas las tareas estén completas.
