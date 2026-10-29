# Proposal

## Why

Vas a poder ver qué skills tiene cada agente sin abrir zero.factory.yaml. En el panel, la pestaña Agentes muestra en la tarjeta de cada agente sus skills generales y, aparte, las que suma cada línea. Cada skill aparece con su nombre y su descripción corta. Si una skill asignada no está instalada en tu Claude Code, aparece marcada como faltante con el motivo. El panel solo las muestra: no tiene botones ni formularios para cambiarlas. En el chat, la herramienta de proyectos (zero_lines) muestra las skills de cada agente, las generales y las de cada línea, y tampoco puede cambiarlas. En la traza de cada trabajo (zero trace o zero_trace), cada ejecución de un agente dice qué skills tuvo y cuáles le faltaron. Para asignar o quitar skills se sigue usando `zero skill` o el archivo.

Pedido original: "Skills para los agentes, parte 2: verlas en el panel, el chat y las trazas. Depende de la parte 1 (skills asignables por agente y por línea con `stations.<agente>.skills` y `zero skill`), que ya tiene que estar fundida; si no está, esperar. - Panel: la pestaña Agentes muestra, en cada agente, sus skills generales y, aparte, las que suma cada línea, con el nombre y la descripción corta de cada skill. Las skills que no existen se marcan como faltantes. El panel solo las muestra, no las cambia. - Chat: la herramienta MCP de líneas o de estado muestra las skills de cada agente, sin poder cambiarlas. - Trazas: la traza de cada trabajo registra qué skills tuvo cada agente en cada ejecución."

## What Changes

- Skills de los agentes, parte 2: panel, chat y trazas
- Supuesto: Interpretation: 'la herramienta MCP de líneas o de estado' is implemented in zero_lines only; zero_status keeps its current text (it already warns about missing skills). zero_lines output changes from a bare JSON array to an object with lines and agent skills; no test or code parses the old shape, but external chat prompts might.
- Supuesto: Panel and chat call discoverSkills on every request; that reads the owner's ~/.claude on each page load. It is cheap but not cached.
- Supuesto: Descriptions come from third-party SKILL.md files and are shown in the panel and the chat: they must be HTML-escaped in the panel, and the chat output is data the model reads (possible prompt-injection text); they are limited to 200 chars to reduce this.
- Supuesto: factoryGuide's tests and the panel's 'never shows secrets' test must stay green; skills views must expose only name, full name, description and missing reason, never the skill directory path.
- Supuesto: Span attributes are scalars (Attrs), so skill lists are stored as comma-separated strings; a skill name containing ', ' would be ambiguous in the trace (unlikely: names are directory names).

## Capabilities

### New Capabilities
- `agent-skills`: Skills de los agentes, parte 2: panel, chat y trazas

### Modified Capabilities

## Impact

Generado por zero para el trabajo cb5f0202.
