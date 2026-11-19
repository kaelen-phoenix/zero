# Proposal

## Why

AGENTS.md pasa a ser un índice corto. Trae qué es zero, los comandos, las convenciones y una lista de enlaces a un archivo por área en docs/agents/: núcleo, daemon, línea de producción, fusión automática, turno nocturno, paquetes, motores, panel, informes, caja y egress, intake, autoactualización y sitio. Todo el texto actual se reparte entre esos archivos sin perder nada, en inglés y con el mismo tono. CLAUDE.md sigue diciendo `@AGENTS.md`. Las convenciones y las pruebas cambian: cada trabajo documenta en el archivo de su área, y el índice se toca solo cuando aparece un área nueva. Con eso, dos pull requests de áreas distintas ya no editan los mismos párrafos. En los dos README hay dos renglones que casi todo cambio edita: la lista de herramientas del chat y la de próximas etapas. Las dos pasan a ser listas con un elemento por renglón, así agregar o sacar algo toca una sola línea.

## What Changes

- Partir AGENTS.md en un índice y un archivo por área bajo docs/agents/
- Supuesto: Supuesto: los archivos por área van en inglés, como el AGENTS.md actual, con nombres de archivo en inglés. La lista de áreas sigue los ejemplos del pedido, y se agregan núcleo, daemon, informes y sitio para que todo tenga dónde ir.
- Supuesto: Claude Code carga CLAUDE.md, y Codex carga AGENTS.md, de forma automática. Los archivos de área solo se leen si el agente los abre. Los agentes que hoy reciben toda la guía en su contexto pasan a recibir el índice y tienen que seguir los enlaces.
- Supuesto: Varios cambios OpenSpec sin archivar tienen tareas abiertas que dicen 'update AGENTS.md'. Si otro trabajo en paralelo edita la sección Layout antes de que se integre este, va a haber un conflicto grande, y la resolución tiene que llevar ese texto al archivo del área que corresponda.
- Supuesto: Las especificaciones archivadas o abiertas que exigen que AGENTS.md describa algo (por ejemplo zero-433e7a34, zero-b8bc3fc1 y zero-f2f8ef65) siguen nombrando AGENTS.md. Se interpreta que la guía es AGENTS.md más docs/agents/, y esos registros no se reescriben.
- Supuesto: test/wording.test.ts revisa docs/** de forma recursiva buscando la palabra prohibida, y test/docs.test.ts busca 'kaelen' en docs/**. El texto movido no debe tener ninguna de las dos, salvo la dirección github.com/kaelen-phoenix/zero.

## Capabilities

### New Capabilities
- `project-docs`: Partir AGENTS.md en un índice y un archivo por área bajo docs/agents/

### Modified Capabilities

## Impact

Generado por zero para el trabajo 1d23365f.
