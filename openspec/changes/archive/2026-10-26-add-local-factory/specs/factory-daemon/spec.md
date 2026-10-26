# Spec Delta

## Purpose

Mantiene la fábrica trabajando sola en la máquina del dueño: ejecuta los trabajos en segundo plano, sobrevive a reinicios y no depende de que el chat esté abierto.

## ADDED Requirements

### Requirement: Ejecución en segundo plano
El daemon SHALL tomar trabajos en `queued` y ejecutarlos sin intervención, con como máximo un trabajo a la vez por línea y un máximo global configurable.

#### Scenario: Dos trabajos en la misma línea
- **WHEN** hay dos trabajos en cola para la misma línea
- **THEN** el segundo empieza solo cuando el primero sale de `running`

### Requirement: Una sola instancia
MUST NOT haber dos daemons activos sobre la misma fábrica. El daemon SHALL publicar una señal de vida periódica.

#### Scenario: Segundo daemon
- **WHEN** se inicia un daemon y ya hay otro con señal de vida reciente
- **THEN** el segundo termina indicando que la fábrica ya está en marcha

### Requirement: Reanudación tras interrupción
Al iniciar, el daemon SHALL devolver a la cola los trabajos que quedaron en `running` y SHALL continuarlos desde la última estación completada.

#### Scenario: Reinicio a mitad de un trabajo
- **WHEN** el daemon se detiene mientras un trabajo está en `build` con la especificación ya aprobada
- **THEN** al reiniciar el trabajo continúa en `build` sin repetir `spec`

### Requirement: Arranque automático
Cuando se recibe un pedido y no hay daemon activo, zero SHALL iniciarlo en segundo plano.

#### Scenario: Pedido con la fábrica apagada
- **WHEN** llega un pedido desde el chat y no hay señal de vida reciente
- **THEN** se inicia un daemon en segundo plano y el pedido queda en cola
