# Proposal

## Why

Hoy la verificación solo ignora mayúsculas para `.zero/**`. Con este cambio, también las ignora en todas las rutas de `limits.protectedPaths`, así que un cambio en `.Claude/settings.json`, `.MCP.json` o `.Github/workflows/ci.yml` ya no pasa como si fuera un archivo cualquiera. Esto importa en discos que no distinguen mayúsculas, como el de Windows donde corre esta fábrica, porque ahí son las mismas carpetas que carga el motor. El turno noche hereda el arreglo: no acepta propuestas que toquen esas rutas, escritas como sea. La aprobación de una ruta sigue siendo exacta, y vos seguís decidiendo qué hay en tu lista: nada pasa a la lista fija `ALWAYS_PROTECTED`.

## What Changes

- Rutas protegidas sin distinguir mayúsculas en toda la lista
- Supuesto: Assumption: `.agents/**` is not hardened in the sense the request means, so it is not moved to `ALWAYS_PROTECTED`. While it stays in a line's list, the new comparison also covers `.Agents/...`, because the rule applies to the whole list; a line whose owner removed it from the list is unaffected.
- Supuesto: Assumption: patterns are lower-cased as well as paths, as requested. A list that uses upper case to tell two paths apart, such as `Docs/**` but not `docs/**`, will now protect both spellings.
- Supuesto: Case-sensitive disks: `.Claude/` and `.claude/` are different folders there, and a change to `.Claude/` will now also stop as protected. This is intended, and it can be approved like any protected path.
- Supuesto: Lower-casing uses JavaScript `toLowerCase`, which does not cover every file system's case folding for non-ASCII characters. The current defaults are ASCII only.
- Supuesto: An approval stays exact, so approving `.claude/settings.json` does not approve `.Claude/settings.json`; that path produces a new question or a failed attempt.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Rutas protegidas sin distinguir mayúsculas en toda la lista

## Impact

Generado por zero para el trabajo 25fb6aaa.
