# Proposal

## Why

Vas a poder darles a los agentes de la fábrica (spec, build, review, security y reply) las skills que ya tenés instaladas en tu Claude Code: las personales de ~/.claude/skills y las de tus plugins. Las elegís por nombre, y si dos se llaman igual usás el nombre completo (plugin:skill). Las asignás para todas las líneas en `stations.<agente>.skills` o solo para un proyecto en `lines[].stations.<agente>.skills` (por ejemplo, el agente build de solilok suma nextjs y shadcn). Podés editarlas en zero.factory.yaml o con `zero skill add`, `zero skill remove` y `zero skill list`, que también muestra las disponibles. El chat no puede cambiarlas. Con Claude, el agente ve y activa solo las suyas. Con otros motores, zero agrega el texto de cada SKILL.md a sus instrucciones. Si una skill no existe, `zero status` lo avisa y el trabajo sigue sin ella. Las skills no les dan herramientas nuevas a los agentes: los de solo lectura las leen pero no pueden ejecutar sus scripts. Dentro de la caja se copian como solo lectura. Verlas en el panel y en las trazas queda para la parte 2.

Pedido original: "Skills para los agentes, parte 1: asignarlas y que los agentes las usen. - De dónde salen: de las skills que ya están instaladas en el Claude Code del dueño, que son las personales (~/.claude/skills) y las de los plugins instalados. Se eligen por nombre. Si dos tienen el mismo nombre, se usa el nombre completo (plugin:skill). Si una skill no existe, la fábrica lo avisa en `zero status` y el trabajo sigue sin ella. - Dónde se asignan: por agente, para todas las líneas, en `stations.<agente>.skills`; y por línea, sumando skills a un agente solo en ese proyecto (por ejemplo, el agente de construcción de solilok suma nextjs y shadcn). Los agentes son spec, build, review, security y reply. - Cómo se asignan: en zero.factory.yaml o con `zero skill add <skill> --station <agente> [--line <línea>]`, `zero skill remove …` y `zero skill list`, que muestra también las disponibles. El chat no las cambia. - Que no dependa del motor: con Claude, las skills asignadas se activan de forma nativa y el agente ve solo esas; con otros motores, zero agrega el texto del SKILL.md a las instrucciones del agente. - Seguridad: los agentes de solo lectura (spec, review, security y reply) leen la skill, pero no pueden ejecutar sus scripts; solo el agente de construcción puede hacerlo. Las skills no cambian la lista de herramientas de ningún agente. Si la fábrica trabaja dentro de la caja, las skills se copian adentro como solo lectura. La parte 2 (verlas en el panel y en las trazas) es otro pedido."

## What Changes

- Skills para los agentes (parte 1): asignarlas y usarlas
- Supuesto: Assumed shape for per-line config: `lines[].stations.<agent>.skills`, mirroring the global key; the request only says 'por línea'.
- Supuesto: `zero skill add` accepts a name that is not installed (status warns), so a later install works; it only refuses unknown agents or lines.
- Supuesto: Native activation relies on Agent SDK options `plugins` (local dir) and `skills` (enabled names). Staging as a local plugin may change how the names look (plugin-qualified). The builder should set `skills` to the names the SDK expects, and an e2e check with the real SDK is not part of the tests.
- Supuesto: The SDK says `skills` is a context filter, not a sandbox. Only the staged copy is mounted or loaded, and `allowed-tools` is stripped. Read-only stations still rely on the read tool list (restricted Bash) to stop scripts from running. In worktree isolation a read agent could still read ~/.claude through Read, as it can today.
- Supuesto: With settingSources ['project'], skills in the target repo's .claude/skills may still load natively for Claude; setting `skills` to the assigned list hides them. That changes current behaviour for repos that ship project skills.
- Supuesto: Plugin skills in installed_plugins.json may have several entries per plugin (scopes/versions); use the first/user-scope entry.
- Supuesto: Earlier builds of this same request ran out of budget. The build should stay focused and must not touch the panel or traces (part 2).

## Capabilities

### New Capabilities
- `agent-skills`: Skills para los agentes (parte 1): asignarlas y usarlas

### Modified Capabilities

## Impact

Generado por zero para el trabajo a9818ce9.
