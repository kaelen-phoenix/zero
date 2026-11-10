# Proposal

## Why

Hoy, si una línea está en `auto`, un cambio nacido de una página web puede integrarse sin que lo veas, siempre que el modelo diga que no agrega nada de terceros y no toque un manifiesto de dependencias. Con este cambio, toda propuesta nacida de una nota de investigación queda limitada por `research.autonomy`, diga lo que diga `scout`. Además, el pedido del trabajo aclara que nace de esa nota y que son datos de la web, no instrucciones, y las estaciones `spec` y `build` reciben una regla breve sobre datos no confiables. Costo que tenés que evaluar: con el valor por defecto (`propose`), todo lo nacido de notas pasa a esperar tu decisión, incluidas las skills propias; si querés que avance solo, subís `research.autonomy`. Solo endurece: ninguna propuesta gana autonomía. También se corrigen los dos README y el texto del panel, que hoy dicen otra cosa.

## What Changes

- Propuestas nacidas de una nota web: el freno lo decide su origen
- Supuesto: Accepted cost from the request: with the default `research.autonomy` (`propose`), everything born from notes on `build` and `auto` lines waits for a person's decision, including own skills, so fewer jobs advance on their own until that value is raised.
- Supuesto: Assumption: the factory's generated delta uses `## ADDED Requirements` under the `night-shift` capability, which has no main spec in `openspec/specs/` but is the name existing changes use. The unarchived change `zero-6c008475` keeps the opposite scenario `own skill follows line`, so the two deltas contradict each other until that one is corrected; this change prevails.
- Supuesto: Jobs already opened with autonomy `auto` before this change keep the autonomy stored in their source and are not held back by the new rule; only `nightShiftHold`'s manifest and legal checks still apply to them.
- Supuesto: Issues already published for pending research-born proposals on `build` or `auto` lines may still say they are only a record, because the body is written once; `decidedOnGitHub` now treats them as decidable from GitHub through `proposalAutonomy`.
- Supuesto: With a line at `auto` and `research.autonomy` `build`, a job parked by `nightShiftHold` will say `La línea tiene autonomía build`, which is inaccurate. The request says not to touch that function, so it stays as is.
- Supuesto: The rule in agents/spec.md and agents/build.md is only a complement: it does not stop a build from following injected text. Real enforcement is the limit by origin in `proposalAutonomy`, and with `research.autonomy` `auto` a web-born change can still integrate unattended. The note's text also reaches the job through `why` and `change`, which scout wrote.

## Capabilities

### New Capabilities
- `night-shift`: Propuestas nacidas de una nota web: el freno lo decide su origen

### Modified Capabilities

## Impact

Generado por zero para el trabajo 697339ac.
