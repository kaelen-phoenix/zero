# Spec Delta

## ADDED Requirements

### Requirement: Candado exclusivo del daemon
El daemon MUST tomar un candado exclusivo del sistema operativo sobre el archivo `daemon.lock` de ZERO_HOME antes de tocar cualquier estado de la fábrica, y SHALL conservarlo hasta terminar. Un daemon que no consigue el candado SHALL terminar con un error que diga que la fábrica ya está en marcha, sin modificar ningún estado.

#### Scenario: Segundo daemon con el candado tomado y sin señal de vida
- **WHEN** el candado está tomado, la clave `daemon` del kv no existe o está vencida, hay un trabajo en `running` y la clave `shutdown` está puesta, y se llama a `runDaemon`
- **THEN** la llamada falla con un mensaje que contiene "ya está en marcha", el trabajo sigue en `running`, la clave `shutdown` sigue puesta y la clave `daemon` no cambia

#### Scenario: Candado libre al terminar
- **WHEN** un `runDaemon` con `once: true` termina normalmente
- **THEN** `daemonLockHeld` devuelve false y otro `runDaemon` sobre la misma fábrica arranca sin error

#### Scenario: Candado libre tras una falla de arranque
- **WHEN** `runDaemon` consigue el candado pero se niega a seguir porque la clave `daemon` tiene una señal de vida reciente de otro proceso vivo
- **THEN** la llamada falla con "ya está en marcha" y `daemonLockHeld` devuelve false

#### Scenario: El sistema libera el candado si el proceso muere
- **WHEN** un proceso hijo real toma el candado y se lo termina a la fuerza
- **THEN** antes del hijo `daemonLockHeld` devuelve true desde el proceso de la prueba mientras vive, y después de terminarlo devuelve false

#### Scenario: Los procesos hijos no heredan el candado
- **WHEN** un proceso real toma el candado, lanza un proceso nieto que sigue vivo y se lo termina a la fuerza
- **THEN** `daemonLockHeld` devuelve false mientras el nieto sigue vivo

#### Scenario: Consultar el candado no lo crea ni lo toma
- **WHEN** se llama a `daemonLockHeld` en una fábrica sin archivo `daemon.lock`
- **THEN** devuelve false, el archivo no se crea y un `acquireDaemonLock` posterior lo consigue

### Requirement: Arranque rechazado con el candado tomado
`zero start`, `zero start --detach` y `ensureDaemon` MUST NOT lanzar un daemon mientras el candado esté tomado, aunque la señal de vida esté vencida o el proceso no responda.

#### Scenario: ensureDaemon con daemon colgado
- **WHEN** el candado está tomado y la clave `daemon` tiene una señal de vida vencida
- **THEN** `ensureDaemon` devuelve false sin lanzar ningún proceso

#### Scenario: start --detach con daemon que no responde
- **WHEN** otro proceso tiene el candado, la clave `daemon` guarda el pid 4242 con señal de vida vencida y se corre `zero start --detach`
- **THEN** el comando termina con código 1, su salida contiene 4242 y dice que el proceso no responde, y no contiene "Fábrica encendida en segundo plano"

#### Scenario: start --detach con daemon sano
- **WHEN** otro proceso tiene el candado, la señal de vida es reciente y se corre `zero start --detach`
- **THEN** el comando termina con código 0 y dice "La fábrica ya estaba en marcha."

#### Scenario: start en primer plano
- **WHEN** otro proceso tiene el candado y se corre `zero start`
- **THEN** el comando termina con código 1 y su salida contiene "ya está en marcha"

### Requirement: Apagado que espera al candado
`zero shutdown` MUST pedir el apagado y esperar a que el daemon libere el candado durante un tiempo máximo de 60 segundos. Si vence ese tiempo SHALL terminar con error y un mensaje que diga el pid del daemon que sigue vivo.

#### Scenario: El daemon se apaga a tiempo
- **WHEN** un `runDaemon` real está corriendo y se llama a `shutdownFactory`
- **THEN** el resultado es `stopped`, y al volver `daemonLockHeld` devuelve false

#### Scenario: El daemon no libera el candado
- **WHEN** el candado sigue tomado, la clave `daemon` guarda el pid 4242 y se llama a `shutdownFactory` con `timeoutMs` corto
- **THEN** el resultado es `timeout` con pid 4242, y la clave `shutdown` sigue puesta para que el daemon se apague cuando despierte

#### Scenario: Mensaje y código del comando al vencer
- **WHEN** otro proceso tiene el candado sin liberarlo, la clave `daemon` guarda el pid 4242 y `zero shutdown` agota su espera, con el tiempo máximo acortado para la prueba solo si `shutdownFactory` no alcanza a cubrirlo
- **THEN** el texto que arma la CLI para el resultado `timeout` contiene 4242 y dice que no se apagó, y el comando termina con código 1

#### Scenario: Nada que apagar
- **WHEN** el candado está libre, no hay señal de vida reciente y se llama a `shutdownFactory`
- **THEN** el resultado es `not-running` y la clave `shutdown` no queda puesta

#### Scenario: Daemon de una versión anterior sin candado
- **WHEN** el candado está libre, la clave `daemon` tiene una señal de vida reciente de un proceso vivo y se llama a `shutdownFactory` con `timeoutMs` corto
- **THEN** la clave `shutdown` queda puesta y el resultado es `timeout` con el pid de esa clave

### Requirement: Aviso de más de un proceso daemon
`zero status` SHALL avisar, con la lista de pids, cuando detecta más de un proceso daemon de zero en la máquina, y MUST seguir mostrando el estado normal si no puede listar los procesos.

#### Scenario: Dos daemons
- **WHEN** la lista de procesos trae dos procesos node sin relación entre sí, con comandos `node C:\zero\dist\cli.js start` y `node /opt/zero/dist/cli.js start`, y pids 11 y 22
- **THEN** `daemonProcesses` devuelve [11, 22] y `formatStatus` incluye un aviso con ambos pids

#### Scenario: Un daemon
- **WHEN** la lista de procesos trae un solo proceso daemon
- **THEN** `formatStatus` no incluye el aviso

#### Scenario: Procesos que no son daemons
- **WHEN** la lista trae `node dist/cli.js start --detach`, `node dist/cli.js status`, `node npm-cli.js run zero start` y `cmd /c zero start`
- **THEN** `daemonProcesses` devuelve una lista vacía

#### Scenario: Envoltorio de desarrollo
- **WHEN** la lista trae `node tsx/dist/cli.mjs src/cli.ts start` con pid 11 y su hijo `node --import loader src/cli.ts start` con pid 12 y padre 11
- **THEN** `daemonProcesses` cuenta un solo daemon

#### Scenario: Falla al listar
- **WHEN** el listador de procesos falla o vence su tiempo
- **THEN** `daemonProcesses` devuelve una lista vacía sin lanzar error y `zero status` muestra el estado sin aviso

### Requirement: Estado de un daemon que no responde
`zero status` MUST NOT decir que la fábrica está apagada mientras el candado esté tomado, y SHALL decir que el daemon no responde, con su pid, cuando la señal de vida está vencida.

#### Scenario: Candado tomado con señal de vida vencida
- **WHEN** el candado está tomado, la clave `daemon` guarda el pid 4242 con señal de vida vencida y se arma el estado con `factoryStatus` y `formatStatus`
- **THEN** la línea de la fábrica contiene "no responde" y 4242, y no contiene "apagada"

#### Scenario: Candado libre con señal de vida vencida
- **WHEN** el candado está libre y la señal de vida está vencida
- **THEN** la línea de la fábrica dice "apagada" como hasta ahora
