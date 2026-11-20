# Proposal

## Why

Primera parte de la fábrica repartida en varias máquinas tuyas. Qué te queda: - **Un documento de decisión** (docs/adr/0007-fabrica-distribuida.md). Explica cómo funciona todo el diseño: - cómo una máquina toma un trabajo sin que otra tome el mismo; - cómo se detecta una máquina caída y cuándo se liberan sus trabajos; - qué pasa con lo que quedó sin subir y con los conflictos; - cómo se protege el repositorio privado de coordinación; - cómo se cuida la cuota de GitHub sin gastar Actions; - cómo se suma el presupuesto entre máquinas; - cómo se une una máquina nueva; - en qué etapas se construye. - **Una sección nueva y opcional, `distributed`, en el archivo de la fábrica.** Indica el repositorio de coordinación y los plazos del latido y del vencimiento. Si no la ponés, la fábrica de una sola máquina funciona igual que hoy y no hace ningún pedido nuevo a GitHub. - **Cada máquina tiene una identidad fija y declara qué puede hacer:** si tiene caja de aislamiento, qué motores tiene y en qué sistema corre. - **El mecanismo de coordinación sobre GitHub.** - Tomar un trabajo es atómico: si dos máquinas lo intentan a la vez, solo una gana. - Cada máquina deja un latido. Los trabajos de una máquina sin latido se pueden retomar cuando vence el plazo. - Una máquina que vuelve se entera de que su trabajo ya lo tomó otra, y no lo pisa. - **El comando `zero unirse <dueño/repositorio>`** suma la máquina a la fábrica. Rechaza un repositorio público. - **La lista de máquinas en `zero status` y en el panel:** cuál está viva, cuál se cayó, su último latido y sus trabajos. Lo que todavía no hace queda anotado para las próximas etapas: que las máquinas tomen trabajos de una cola común, que suban su avance en cada punto guardado, que una retome lo de otra, que el presupuesto se sume entre máquinas, que las líneas se clonen solas y que desde cualquier panel se pueda pedir y aprobar.

## What Changes

- Fábrica distribuida, primera parte: decisión, identidad de máquina, toma atómica y latidos
- Supuesto: Assumption: GitHub's git refs API answers 422 both for creating an existing ref and for a non-fast-forward update without force, which makes them a compare-and-swap. The ADR should record this as verified only by the stubbed tests until a real run confirms it.
- Supuesto: The daemon test for the pass needs `DaemonOptions.coord` injection. Without it, a `once` run could reach real GitHub, so the real adapter must only be built when nothing is injected and the run is not `once`.
- Supuesto: The hostname cleanup and the random id must stay deterministic in tests through injected deps.
- Supuesto: Renaming the self-update ADR changes a file that a pending branch (zero-433e7a34) may also touch. Merge order could reintroduce a duplicate prefix, which the new uniqueness test would catch.
- Supuesto: This stage does not make machines share jobs yet. The `claims/` protocol exists but the runner does not use it, so `zero unirse` alone gives visibility and heartbeats, not shared capacity. The summary says so.

## Capabilities

### New Capabilities
- `distributed-factory`: Fábrica distribuida, primera parte: decisión, identidad de máquina, toma atómica y latidos

### Modified Capabilities

## Impact

Generado por zero para el trabajo 537996a3.
