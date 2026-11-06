# Tasks

## 1. Implementación

- [x] 1.1 Escribir primero `test/windows-exec.test.ts` con los casos del binario plantado (`it.runIf(process.platform === "win32")`). Usar una copia de `process.execPath` como binario falso, porque `-p process.execPath` dice qué copia corrió, y cambiar PATH con `vi.stubEnv`. Comprobar que fallan antes del arreglo y dejar constancia del resultado. Resultado: antes del arreglo `git` corrió la copia plantada (`Cannot find module ...\rev-parse`) y `runProcess` la del cwd en lugar de la del PATH, así que la vulnerabilidad queda confirmada. Eso ocurre solo si `NoDefaultCurrentDirectoryInExePath` no está en el entorno del propio zero; con esa variable Windows no mira el cwd y las pruebas pasaban sin arreglo, por eso la quitan.
- [x] 1.2 En `src/shell.ts`: mover `findOnPath` y `TRUSTED_CWD` desde `src/package-install.ts`, que los importa y sigue exportando `findOnPath` porque `test/package-git.test.ts` lo usa desde ahí.
- [x] 1.3 En `src/shell.ts`: agregar `resolveBin(name, platform = process.platform)`. En win32, los nombres con separador de carpeta o rutas absolutas se devuelven sin cambios. Para un nombre pelado se llama a `findOnPath` con `['.com', '.exe']`, sumando `''` si el nombre ya trae extensión. Caché `Map` con clave nombre + valor de PATH, que guarda solo lo encontrado.
- [x] 1.4 En `src/shell.ts`: agregar un ayudante que, dados nombre y cwd, devuelva el binario y el cwd a usar: en win32, si el nombre pelado no se resolvió, el cwd pasa a `TRUSTED_CWD` y el spawn termina en el ENOENT de hoy. Agregar `spawnGit(args, cwd, opts)` sobre `spawnSync`, y usarlo en `git` y `tryGit`.
- [x] 1.5 Reemplazar las llamadas directas a git por `spawnGit`: `src/line/integrate.ts:27,89`, `src/line/runner.ts:362`, `src/line/reverts.ts:50` y `src/intake/comments.ts:45,47`. Conservar opciones, `env` y `timeout`.
- [x] 1.6 En `runProcess` de `src/engines/cli.ts`, usar el ayudante para binario y cwd. Conservar el `bin` original en el mensaje `cannot start`.
- [x] 1.7 Ajustar el mock de `test/engines-empty-output.test.ts` para reconocer `agy` y `codex` también con ruta absoluta (por `basename` sin extensión), de modo que la prueba no lance un `codex.exe` real de la máquina.
- [x] 1.8 Agregar las pruebas portables: `resolveBin` con plataforma distinta de win32, sin procesos auxiliares, y el recorrido de `src/` que no admite `spawn("git"` ni `spawnSync("git"` fuera de `shell.ts`.
- [x] 1.9 Actualizar `AGENTS.md` con la regla: `resolveBin`/`spawnGit` en `src/shell.ts` son la única forma de lanzar git y motores con cwd en contenido no confiable.
- [x] 1.10 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`.
