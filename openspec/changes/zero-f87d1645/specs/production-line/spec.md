# Spec Delta

## ADDED Requirements

### Requirement: Motor Claude: herramientas negadas con acceso read
Para el acceso `read`, `claudeOptions` SHALL pasar `disallowedTools` con exactamente `Agent`, `Workflow`, `WebFetch`, `RemoteTrigger`, `CronCreate`, `ScheduleWakeup`, `SendMessage` y `PushNotification`.

#### Scenario: Lista del acceso read
- **WHEN** se construye `claudeOptions` para un pedido con acceso `read`
- **THEN** `disallowedTools`, sin importar el orden, es exactamente `Agent`, `Workflow`, `WebFetch`, `RemoteTrigger`, `CronCreate`, `ScheduleWakeup`, `SendMessage` y `PushNotification`

### Requirement: Motor Claude: herramientas negadas con acceso web
Para el acceso `web`, `claudeOptions` SHALL pasar en `disallowedTools` la misma lista que para `read`, y `WebSearch` MUST seguir en `allowedTools`.

#### Scenario: Lista del acceso web
- **WHEN** se construye `claudeOptions` para un pedido con acceso `web`
- **THEN** `disallowedTools` es igual a la del acceso `read`, no contiene `WebSearch`, y `allowedTools` contiene `WebSearch`

### Requirement: Motor Claude: acceso write sin herramientas negadas
Para el acceso `write`, `claudeOptions` MUST NOT pasar `disallowedTools` y SHALL conservar sus `allowedTools`.

#### Scenario: build no cambia
- **WHEN** se construye `claudeOptions` para un pedido con acceso `write`
- **THEN** `disallowedTools` es undefined y `allowedTools` es `Read`, `Glob`, `Grep`, `Edit`, `Write` y `Bash`

### Requirement: Motor Claude: las skills no cambian las herramientas negadas
Las skills asignadas MUST NOT cambiar `disallowedTools` en ningún acceso.

#### Scenario: Con y sin skills
- **WHEN** se construye `claudeOptions` para cada acceso `read`, `web` y `write`, con skills preparadas y sin ellas
- **THEN** en cada acceso, `disallowedTools` es igual en los dos casos

### Requirement: Motor Claude: lista de negación en lugar de opción cerrada
`claudeOptions` MUST NOT pasar la opción `tools` en ningún acceso, y SHALL conservar `permissionMode: dontAsk` y los `allowedTools` actuales de `read` y `web`.

#### Scenario: El resto de las opciones de lectura sigue igual
- **WHEN** se construye `claudeOptions` para los accesos `read`, `web` y `write`
- **THEN** `tools` es undefined en los tres, `permissionMode` es `dontAsk`, `allowedTools` de `read` es `Read`, `Glob`, `Grep`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(git show:*)` y `Bash(ls:*)`, y el de `web` es esa misma lista más `WebSearch`
