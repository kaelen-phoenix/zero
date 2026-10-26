# production-line Specification

## Purpose
Define la línea de producción que convierte un pedido en un cambio integrado: estaciones con entradas y salidas verificables, y garantías que zero impone sin confiar en el motor que trabaje en cada una.

## Requirements

### Requirement: Estaciones de la línea
Cada trabajo SHALL recorrer en orden las estaciones `spec`, `build`, `verify`, `review` e `integrate`, en una copia de trabajo propia del repositorio de la línea y en una rama propia del trabajo.

#### Scenario: Copia aislada por trabajo
- **WHEN** empieza un trabajo
- **THEN** se crea una copia de trabajo separada en una rama `zero/<trabajo>` a partir de la rama base de la línea, sin tocar la copia del dueño

### Requirement: Especificación estructurada
La estación `spec` SHALL producir una especificación con título, resumen y requisitos, cada requisito con al menos un escenario WHEN/THEN, o declarar el pedido inviable con un motivo. La especificación SHALL guardarse en formato OpenSpec válido y, si el repositorio usa OpenSpec, incluirse en el cambio.

#### Scenario: Pedido inviable
- **WHEN** la estación `spec` declara que el pedido requiere credenciales que la fábrica no tiene
- **THEN** el trabajo termina en `failed` con ese motivo, sin ejecutar `build`

#### Scenario: Formato OpenSpec
- **WHEN** la especificación se escribe en disco
- **THEN** `openspec validate` la acepta

### Requirement: Estaciones de solo lectura
Las estaciones `spec` y `review` MUST NOT modificar la copia de trabajo. Si un motor la modifica igualmente, zero SHALL descartar esos cambios.

#### Scenario: Motor que escribe en review
- **WHEN** el agente de `review` crea o modifica archivos
- **THEN** esos cambios se descartan antes de continuar

### Requirement: Verificación
La estación `verify` SHALL ejecutar los comandos de verificación de la línea y SHALL fallar si alguno termina con error, si el cambio borra archivos de test o si agrega marcas que desactivan tests existentes.

#### Scenario: Tests borrados
- **WHEN** el cambio elimina un archivo de test
- **THEN** la verificación falla indicando el archivo

#### Scenario: Comando fallido
- **WHEN** un comando de verificación termina con código distinto de cero
- **THEN** la verificación falla e incluye el final de su salida como retroalimentación

### Requirement: Rutas protegidas
Si el cambio toca una ruta protegida de la configuración, en `L3` el intento SHALL fallar con retroalimentación para no tocarla, y en `L0`–`L2` el trabajo SHALL pasar a `waiting` pidiendo aprobación.

#### Scenario: Ruta protegida en L3
- **WHEN** en L3 el cambio modifica `.github/workflows/ci.yml` y `.github/**` está protegida
- **THEN** el intento falla y la retroalimentación pide no modificar esa ruta

### Requirement: Revisión con citas verificadas
La estación `review` SHALL devolver hallazgos con gravedad, archivo y línea. zero SHALL descartar los hallazgos cuya cita no exista en la copia de trabajo y SHALL rechazar el cambio solo si queda algún hallazgo verificado de gravedad `high` o `critical`.

#### Scenario: Cita inventada
- **WHEN** un hallazgo `high` cita un archivo que no existe
- **THEN** el hallazgo se descarta, se registra como cita inválida y no bloquea la entrega

#### Scenario: Hallazgo grave verificado
- **WHEN** un hallazgo `critical` cita un archivo y línea existentes
- **THEN** el intento se rechaza y el hallazgo vuelve como retroalimentación

### Requirement: Reintentos con retroalimentación
Si `verify` o `review` fallan, `build` SHALL reintentarse con la retroalimentación concreta del fallo, hasta el máximo de intentos de la línea.

#### Scenario: Segundo intento
- **WHEN** el primer intento falla en `verify`
- **THEN** el segundo intento de `build` recibe la salida del fallo

### Requirement: Límites de costo
Cada trabajo SHALL tener un presupuesto. Si el costo acumulado lo supera, en `L3` el trabajo SHALL terminar en `failed` y en `L0`–`L2` SHALL pasar a `waiting` pidiendo ampliar el presupuesto. La fábrica MUST NOT iniciar trabajos nuevos cuando el gasto del día alcanza el límite diario.

#### Scenario: Presupuesto diario agotado
- **WHEN** el gasto del día alcanza el límite diario
- **THEN** los trabajos en cola esperan y el estado de la fábrica lo indica

### Requirement: Integración
La estación `integrate` SHALL aplicar el modo de la línea: `merge` integra la rama en la rama base, `branch` deja la rama lista y `pull-request` la publica y abre una solicitud de cambio. Si la integración `merge` no es posible sin riesgo (cambios sin guardar del dueño o conflicto), el trabajo SHALL quedar en `waiting` con la rama intacta.

#### Scenario: Merge limpio
- **WHEN** la verificación y la revisión pasan y el modo es `merge`
- **THEN** la rama base contiene el cambio y el trabajo queda `delivered`

#### Scenario: Copia del dueño con cambios sin guardar
- **WHEN** el modo es `merge` y la rama base está abierta en la copia del dueño con cambios sin guardar
- **THEN** no se modifica esa copia y el trabajo pasa a `waiting` explicando el motivo

### Requirement: Salidas sospechosas
Si la puerta bloqueó una salida sospechosa de un trabajo, el trabajo MUST NOT integrarse sin el dueño:
- en `L3` SHALL terminar en `failed`, explicando qué sitios se bloquearon y cómo permitirlos si son legítimos;
- en `L0`–`L2` SHALL pasar a `waiting` con la lista de sitios.

zero SHALL revisarlo después de `spec`, al comienzo de cada intento de `build` y antes de integrar.

#### Scenario: Sospecha en L3
- **WHEN** en L3 un agente de `build` intentó conectarse a `pastebin.com` y la revisión pasó
- **THEN** el trabajo termina en `failed` sin integrarse y el motivo nombra `pastebin.com` y `zero egress allow`

#### Scenario: Sospecha en L2
- **WHEN** en L2 el setup de un trabajo intentó conectarse a una dirección IP sin nombre
- **THEN** el trabajo pasa a `waiting` con la lista de sitios y, al aprobarse, continúa y se integra

### Requirement: Qué sospechas cuentan
Aprobar SHALL aceptar las sospechas registradas hasta ese momento; una sospecha posterior SHALL volver a preguntar. Los bloqueos por la lista del dueño o por el modo `allowlist` MUST NOT afectar al trabajo.

#### Scenario: Bloqueo por la lista del dueño
- **WHEN** el dueño bloqueó `example.com` y un agente intentó conectarse a ese sitio
- **THEN** el trabajo sigue su curso normal
