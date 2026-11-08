# Proposal

## Why

El simulacro de regeneración (`zero simulacro`) deja en ZERO_HOME una carpeta `drills/<id>/` con una copia del repositorio, un `informe.md` y un `resultado.json`. Hoy, si un trabajo mete eso en el repositorio de una línea, la verificación lo deja pasar. Con este cambio, la verificación rechaza el intento y nombra cada archivo con el motivo «simulacro de regeneración» (o «carpeta de ZERO_HOME» si está bajo `.zero/drills/`). Se rechaza en tres casos: cuando aparece una carpeta `drills/<id>/` con el informe o el resultado (incluida la copia del repositorio que va con ellos), cuando aparecen juntos `informe.md` y `resultado.json` en la misma carpeta, y cuando algo está bajo `.zero/drills/`. Un `informe.md` suelto sigue pasando, igual que el código que se llame parecido. Si una línea versiona esos archivos a propósito, se pueden permitir con `allowedArtifacts`.

## What Changes

- Verify: tratar como producto de la fábrica lo que deja el simulacro de regeneración
- Supuesto: Interpretation: the request offered 'resultado.json junto a informe.md' or 'any path under drills/<id>/ holding informe.md or resultado.json'. This spec does both, since both are cheap and the second covers the repository copy a drill leaves. A repository that really versions a `drills/<id>/informe.md` or an `informe.md` + `resultado.json` pair will now fail verify until the line sets `allowedArtifacts`.
- Supuesto: The delta is ADDED under `operation-output`, which has no main spec until `zero-1f5a5607` is archived. If this change is archived first, openspec creates the capability with only these requirements. That is valid, but the order of the specs differs from what was intended.
- Supuesto: Only the paths of added files are looked at, not their contents, so a renamed drill output (for example `informe-final.md` outside `drills/`) still passes unless another shape catches it.

## Capabilities

### New Capabilities
- `operation-output`: Verify: tratar como producto de la fábrica lo que deja el simulacro de regeneración

### Modified Capabilities

## Impact

Generado por zero para el trabajo 192305f7.
