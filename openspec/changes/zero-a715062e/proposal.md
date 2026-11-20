# Proposal

## Why

El catálogo de agentes acepta un tercer tipo, `conflict`: agentes que resuelven conflictos cuando zero trae la rama base y la resolución sin modelo no alcanza. El reclutador va a poder proponerlos. Vos los vas a ver en `zero agent catalog` y en la página `/agents` del panel con su tipo explicado, y los vas a poder sumar a una línea desde el catálogo como cualquier otro agente. Se suman siempre como bloqueantes, sin filtro de archivos y con la plantilla de resolución de conflictos cuando no traen instrucciones propias. Antes de sumar nada se te sigue pidiendo confirmación, igual que hoy.

## What Changes

- Catálogo de agentes: aceptar agentes de tipo conflict
- Supuesto: The `agent_catalog` table stores `type` as free TEXT without a CHECK, so no migration is needed. Older rows only hold review or build.
- Supuesto: A conflict agent has write access and its instructions come from a third party. The existing screen (`screenAgentText`) and owner confirmation stay the only safeguards. Since conflict agents only run during base merges and `judgeResolution` checks their output, this is assumed acceptable.
- Supuesto: The README and AGENTS.md wording tests (test/docs.test.ts, test/wording.test.ts) may constrain the edited sentences. Keep "vos"/"you" style and both README structures identical.
- Supuesto: AGENTS.md is long. The townhall says it should stay under 16000 bytes in some checkouts, but here it holds the full Layout. Keep the addition to a few words.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Catálogo de agentes: aceptar agentes de tipo conflict

## Impact

Generado por zero para el trabajo a715062e.
