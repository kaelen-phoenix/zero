# Proposal

## Why

Desde ahora, cuando la fábrica se actualiza sola, el cambio de versión sale entero o no se hace. La versión nueva se arma primero en una carpeta temporal dentro de la instalación, en el mismo disco, y se revisa que haya quedado completa. La versión vieja se aparta con un renombrado, que en Windows sale entero o no sale: nunca se copia de un disco a otro ni se borra a medias. Si algún archivo está abierto por otro proceso (por ejemplo el servidor del chat que usa el módulo nativo de keyring), la fábrica reintenta unos segundos. Si sigue trabado, deja la instalación como estaba y anota el motivo. Antes de dar la actualización por buena corre `node dist/cli.js --version` desde la carpeta instalada. Si eso falla, pone de vuelta la versión anterior y lo anota como fallido, con el error. Pase lo que pase, incluso un error inesperado, queda result.json y la fábrica lo pasa al historial de autoactualización, así podés ver qué pasó. No hace falta tocar tu instalación actual.

## What Changes

- Atomic self-update switch: all-or-nothing swap, retries on locked folders and a result that is always written
- Supuesto: Most likely cause of the incident, inferred from the code: ZERO_HOME (C:) and the install (G:) are on different volumes, so `move` fell back to copy plus `rm` for node_modules. The copy to previous succeeded, `rm` left the locked keyring .node behind and threw, and the half-moved part was never in `moved`, so restore did not bring it back. Why no result.json or history entry appeared is not explained by the code: the switch process may have died, been killed with its parent's job object, or hung. The new design writes the result on every path the code controls, but it cannot cover a killed process; there, importSwitchResult's 30-minute stale entry remains the fallback.
- Supuesto: Staging inside the install folder (`.zero-switch`) puts temporary files in the install repository, which is untracked and git-ignored. This bends the 'output only in ZERO_HOME' convention for the install's own build, like dist. An install whose .gitignore predates this change still works, because the status check uses `--untracked-files=no`.
- Supuesto: Renaming a directory with a file open inside it, on Windows: the assumption is that it fails as a whole (EPERM/EACCES/EBUSY) instead of moving partway. Tests can only simulate this with injected errors.
- Supuesto: Staging needs free disk space for a second copy of node_modules on the install volume.
- Supuesto: The `--version` check loads the whole module graph through cli.ts's static imports (keyring included). If cli.ts later loads modules lazily, this check would catch less.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Atomic self-update switch: all-or-nothing swap, retries on locked folders and a result that is always written

## Impact

Generado por zero para el trabajo e824f044.
