# Proposal

## Why

The factory will recover on its own when the machine restarts or the daemon dies without `zero shutdown`. 1. A new `autostart: true` option in the factory file starts the factory when you log in. You turn it on or off from the terminal (`zero autostart on|off`), by editing the file, or by accepting it in `zero setup`, which asks first. On Windows it adds an entry to your Startup folder; on macOS a LaunchAgent; on Linux a systemd user service. None of them needs administrator rights. Turning it off removes that entry. The chat cannot change it. 2. If the daemon dies on its own and leaves work in progress, any zero command (except `zero start` and `zero shutdown`) or the chat's MCP server starts it again and says so. The jobs that were in progress pick up from their checkpoint, as they already do. 3. `zero status` tells two cases apart: "apagada a propósito desde HH:MM" when someone shut the factory down, and "se cayó (último latido HH:MM)" when the daemon died while jobs were marked in progress.

## What Changes

- The factory starts again on its own after a reboot or a daemon crash
- Supuesto: Assumption: Windows uses a `.cmd` in the user's Startup folder instead of a scheduled task. `schtasks /SC ONLOGON` usually needs elevation, and the request rules out admin rights. A console window may flash briefly at login.
- Supuesto: Assumption: revival from the CLI and MCP does not depend on `autostart`. A crash is never a deliberate stop, and the MCP server already starts the daemon on requests. A factory stopped on purpose is never revived by commands, but it is started at the next login when `autostart` is true.
- Supuesto: Revival only covers the case where the dead daemon left its heartbeat record. A daemon from an earlier version that dies, or a crash before the first heartbeat, reads as stopped and is not revived.
- Supuesto: Leaving the heartbeat on an unexpected error exit changes what tests that make the loop throw expect. Runs with `once` must still delete it.
- Supuesto: With systemd, a `Type=oneshot` unit with `RemainAfterExit=yes` keeps the detached daemon in the unit's cgroup. Stopping the unit by hand (`systemctl --user stop`) would kill the daemon without a clean shutdown, so the factory would read as crashed.
- Supuesto: The login entry points at the current `process.execPath` and `dist/cli.js`. Moving the install or changing the Node version leaves a stale entry until `zero autostart on` runs again or the daemon re-syncs on its next start.
- Supuesto: `zero status` is a read command but will now start a process when it finds a crash. It prints the status before reviving, so the person still sees `se cayó`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: The factory starts again on its own after a reboot or a daemon crash

## Impact

Generado por zero para el trabajo 5df20f11.
