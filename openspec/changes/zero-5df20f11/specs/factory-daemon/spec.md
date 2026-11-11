# Spec Delta

## ADDED Requirements

### Requirement: Distinguir apagado a propósito de caída
`factoryStatus` SHALL report the daemon state as one of `running`, `unresponsive` (lock held, no fresh heartbeat), `stopped` (the last daemon ended through a shutdown request, a signal or a `once` run) or `crashed` (a heartbeat record is left whose beat is stale, its process is gone and the lock is free), with `since`: the time of the recorded stop for `stopped` and the last heartbeat's `beatAt` for `crashed`; `formatStatus` MUST show `apagada a propósito desde HH:MM` for `stopped` and `se cayó` with the last heartbeat time and the number of jobs left in `running` for `crashed`.

#### Scenario: Caída con trabajo en curso
- **WHEN** the kv `daemon` record has a pid that is not alive and a `beatAt` of 14:37, the lock is free, and one job is in `running`
- **THEN** `factoryStatus(ctx).daemon.state` is `crashed` with `since` equal to that `beatAt`, and the `Fábrica:` line of `formatStatus` contains `se cayó` and `14:37` and mentions 1 trabajo en curso

#### Scenario: Apagado con zero shutdown
- **WHEN** a daemon run ends because SHUTDOWN_KEY was set
- **THEN** the kv `daemon` record is gone, a stop record with the stop time exists, and `formatStatus` shows `apagada a propósito desde` with that time

### Requirement: El daemon que termina por error queda como caído
When `factoryLoop` ends because of an error rather than a shutdown request, a signal or a `once` run, the daemon MUST NOT delete its heartbeat record or write the stop record, so the state reads `crashed` once the heartbeat goes stale.

#### Scenario: Error dentro del bucle
- **WHEN** the daemon loop throws an unexpected error that is not a shutdown or signal (simulated in a test through an injected failing dependency)
- **THEN** after it returns, the kv `daemon` record is still present and the stop record was not written

### Requirement: Revivir la fábrica caída con trabajo pendiente
`reviveDaemon(ctx, start?)` in app.ts SHALL call the starter (by default `ensureDaemon`) and return true only when the daemon state is `crashed` and at least one job is `running` or `queued`; in every other state, including `stopped`, it MUST NOT start anything.

#### Scenario: Caída con trabajos
- **WHEN** the state is `crashed` and one job is `running`
- **THEN** the injected starter is called once and `reviveDaemon` returns true

#### Scenario: Apagada a propósito
- **WHEN** the state is `stopped` and jobs are `queued`
- **THEN** the starter is not called and `reviveDaemon` returns false

#### Scenario: Caída sin trabajo
- **WHEN** the state is `crashed` and no job is `running` or `queued`
- **THEN** the starter is not called

### Requirement: La CLI y el servidor MCP reviven la fábrica
Every CLI command that opens the factory, except `start` and `shutdown`, SHALL call `reviveDaemon` after doing its own work, and when it returns true SHALL print `La fábrica se había caído con trabajo pendiente: la volví a encender.` on stderr. The MCP server SHALL call `reviveDaemon` when it starts and in every tool call while its `autoStart` option is on.

#### Scenario: Herramienta MCP con la fábrica caída
- **WHEN** `createZeroMcpServer(home, { autoStart: true })` with an injected starter handles `zero_status` while the state is `crashed` with a `running` job
- **THEN** the starter is called

#### Scenario: MCP sin autoStart
- **WHEN** the same call is made with `autoStart: false`
- **THEN** the starter is not called

### Requirement: Opción autostart en el archivo
The factory file SHALL accept a top-level boolean `autostart` (default false). No chat tool MUST change it; it SHALL be changed only by `zero autostart on|off`, by `zero setup` or by editing the file.

#### Scenario: Valor por defecto
- **WHEN** a factory file without `autostart` is parsed
- **THEN** `config.autostart` is false

#### Scenario: Valor inválido
- **WHEN** a factory file has `autostart: "si"`
- **THEN** parsing fails with a validation error

### Requirement: Registro de arranque al iniciar sesión
`syncAutostart(home, enabled, deps)` in `src/autostart.ts` SHALL make the user-level login entry for this ZERO_HOME exist exactly when `enabled` is true, without administrator rights. On win32 that entry is a `.cmd` file in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`; on darwin a plist in `~/Library/LaunchAgents` with `RunAtLoad`; on linux a unit in `~/.config/systemd/user` enabled through `systemctl --user enable`. Each entry runs `<node> <dist/cli.js> start --detach` with `ZERO_HOME` set, and its name includes a short hash of the home's root. The function MUST be idempotent and MUST do nothing when `inContainer()` is true.

#### Scenario: Activar en Windows
- **WHEN** `syncAutostart` runs with enabled true, platform win32, and an injected fs and APPDATA
- **THEN** exactly one `zero-<hash>.cmd` is written in the Startup folder, containing the node path, the cli path, `start --detach` and the ZERO_HOME value

#### Scenario: Desactivar
- **WHEN** `syncAutostart` runs with enabled false after an entry was written (any platform)
- **THEN** the entry file is deleted, and on linux `systemctl --user disable` is run before the unit file is deleted

#### Scenario: Idempotencia
- **WHEN** `syncAutostart` runs twice with enabled true and the same inputs
- **THEN** the second run writes nothing new and reports `already`

#### Scenario: En contenedor
- **WHEN** `syncAutostart` runs with `ZERO_CONTAINER=1` in the injected env
- **THEN** nothing is written or run, and the result says that compose's restart policy covers this case

### Requirement: Comando zero autostart
`zero autostart on|off` SHALL write `autostart` to the factory file through `editFactory` and then call `syncAutostart`, printing in Spanish whether the login entry was created or removed and where. The daemon SHALL call `syncAutostart` when it starts and whenever a reloaded config changes `autostart`, logging failures without stopping.

#### Scenario: Activar desde la terminal
- **WHEN** `setAutostart(ctx, true, deps)` (the app.ts operation behind the command) runs with an injected fs
- **THEN** the factory file has `autostart: true` and the login entry exists

#### Scenario: Desactivar desde la terminal
- **WHEN** `setAutostart(ctx, false, deps)` runs afterwards
- **THEN** the file has `autostart: false` and the entry is gone

### Requirement: zero setup ofrece el arranque al iniciar sesión
Outside a container, `runSetup` SHALL ask through `deps.confirm` (default no) whether the factory should start at login, SHALL write `autostart` with the answer, and SHALL register or remove the entry through an injectable `syncAutostart` in `SetupDeps`. Inside a container it MUST NOT ask.

#### Scenario: Acepta
- **WHEN** the wizard runs outside a container and the person answers yes to the autostart question
- **THEN** the written file has `autostart: true` and the injected syncAutostart was called with true

#### Scenario: Rechaza
- **WHEN** the person answers no
- **THEN** the file has `autostart: false` and syncAutostart was called with false

#### Scenario: En contenedor
- **WHEN** the wizard runs with `ZERO_CONTAINER=1`
- **THEN** no autostart question is asked and syncAutostart is not called
