# Tasks

## 1. Implementación

- [x] 1.1 Confirmar que exista y sea válido el change de OpenSpec `openspec/changes/zero-b5186973` (lo genera la fábrica a partir de esta especificación, con formato de delta `ADDED` sobre `production-line`); completarlo solo si `npx openspec validate --all` lo pide.
- [x] 1.2 `src/engines/cli.ts`: agregar un helper chico que arme el resultado desde el texto y el stderr: si `text.trim()` está vacío devuelve `{ ok: false, text: '<motor> devolvió salida vacía' }`, con `: <stderr.trim().slice(-2000)>` cuando stderr tiene contenido; si no, `{ ok: true, text }`.
- [x] 1.3 `src/engines/cli.ts`: hacer que `execute` reciba un parámetro opcional que obtiene el texto final del `ProcessResult`, por defecto `finalText(r.stdout)`, y aplique el helper solo después de los chequeos de cancelación, tiempo vencido y código distinto de 0, cuyos mensajes no cambian.
- [x] 1.4 `src/engines/cli.ts`: en `codexEngine.run`, pasarle a `execute` una lectura de `files.lastMessage` con `.catch(() => finalText(r.stdout))` y `.trim()`, de modo que stdout vacío con un archivo escrito siga siendo un éxito y stderr llegue al mensaje de error. No tocar `codexInvocation`, `antigravityInvocation` ni `customInvocation`.
- [x] 1.5 `test/engines-empty-output.test.ts` (nuevo): para `agy` y `codex`, envolver `spawn` con `vi.mock('node:child_process', ...)` de modo que esos nombres lancen `process.execPath` con un script real que recibe los argumentos (el de codex encuentra la ruta después de `--output-last-message`). Un `.cmd` en PATH no sirve en Windows porque `spawn` va sin shell. Para los motores personalizados usar `customEngine` con `[process.execPath, '-e', script]`. Cubrir cada escenario de esta especificación con procesos reales, sin modelos.
- [x] 1.6 `AGENTS.md`: agregar en el párrafo de `src/agent.ts` + `src/engines/` una frase que diga que un motor CLI que termina con código 0 sin texto cuenta como fallo, y que en codex se evalúa el último mensaje y no stdout.
- [x] 1.7 Correr `npm run typecheck`, `npm test` y `npx openspec validate --all`; revisar que ninguna prueba existente dependa de un motor CLI mudo con código 0.
