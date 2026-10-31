# Proposal

## Why

Cada línea (y la fábrica entera) va a poder sumar sus propios agentes revisores en zero.factory.yaml: por ejemplo uno de accesibilidad, de traducciones, de SEO o de documentación. Cada uno tiene su archivo de instrucciones (.zero/agents/<nombre>.md en el repo de la línea, o en la carpeta de la fábrica para los globales), su motor, modelo, tiempo y skills, y corre después de review y security, sobre el mismo cambio. Si es bloqueante, sus hallazgos graves (con citas verificadas) frenan el trabajo y vuelven a build como pasa con review. Si es informativo, solo deja constancia. En esta primera parte estos agentes son siempre de solo lectura: si escriben algo, zero lo descarta. Además, cada línea puede sumar instrucciones a las estaciones fijas con un archivo .zero/agents/<estación>.md en su repo (por ejemplo build.md), que se agrega a las instrucciones de zero sin reemplazarlas. Zero lee esos archivos de la copia del dueño, nunca de lo que escribió el propio trabajo ni de la web. Comandos nuevos: `zero agent list [--line]`, `zero agent add <nombre> --line <línea>` (crea el archivo con una plantilla y lo suma a la configuración) y `zero agent remove <nombre> --line <línea>`. El README (inglés y español) trae un ejemplo completo. Quedan para después: agentes que escriben, otros puntos de la línea, el panel, el briefing, las propuestas del turno nocturno y el sitio.

Pedido original: "Agentes a medida por proyecto: que cada línea pueda sumar agentes propios (estaciones nuevas) y ajustar los que ya existen. Hoy las estaciones son fijas (spec, build, review, security, reply, scout, research) y solo se les pueden sumar skills. - Agentes nuevos por línea: en zero.factory.yaml, lines[].agents (y global agents para todas las líneas), cada uno con: nombre, instrucciones (un archivo .md en el repo de la línea, por ejemplo .zero/agents/<nombre>.md, o en la carpeta de la fábrica), en qué punto de la línea corre (después de spec, después de build, después de review, antes de integrar…), si es de solo lectura o puede escribir, si su resultado frena el trabajo (bloqueante, como review) o solo informa, motor/modelo/tiempo como cualquier estación, y skills. Ejemplos de uso: un agente de accesibilidad para Yalope, uno de traducciones que revise que cada texto esté en todos los idiomas, uno de SEO para newoman, uno de documentación. - Ajustar los existentes por línea: instrucciones extra para una estación fija en esa línea (por ejemplo .zero/agents/build.md en el repo se suma a agents/build.md), sin reemplazar las garantías. - Garantías que sigue imponiendo zero, nunca el agente: un agente de solo lectura no puede escribir (si escribe se descarta); todo lo que escribe un agente nuevo vuelve a pasar por verify, review y security; ningún agente puede apagar ni saltear las estaciones fijas, las rutas protegidas ni la verificación; las instrucciones de un agente vienen del repo o de la fábrica, nunca de la web. - Comandos: zero agent list [--line], zero agent add <nombre> --line <línea> (crea el archivo de instrucciones con una plantilla y lo agrega a la configuración), zero agent remove. El panel muestra los agentes de cada línea, en orden, en la vista de la línea y en la guía; las trazas, el briefing y el estado los muestran como a cualquier estación. - Turno nocturno: scout y la investigación ya pueden sugerir agentes nuevos; que esas propuestas se puedan aprobar y se conviertan en un agente de la línea (archivo de instrucciones + configuración), esperando siempre al dueño. - README en inglés y en español, con un ejemplo completo de agente a medida, y el sitio (site/) lo menciona."

## What Changes

- Agentes a medida por línea (primera parte: revisores propios e instrucciones extra)
- Supuesto: Supuesto: las instrucciones de línea se leen del árbol de trabajo de la copia del dueño (line.repo), no de la rama base. Así `zero agent add` sirve enseguida, y lo que escribe un trabajo nunca cuenta antes de integrarse. Un cambio ya integrado en ese árbol sí puede editar instrucciones, pero solo después de pasar verify, review y security.
- Supuesto: Supuesto: los agentes globales leen sus instrucciones relativas a la carpeta de zero.factory.yaml (ZERO_HOME).
- Supuesto: Si falta el archivo de un agente bloqueante, el trabajo falla recién después de build. Una validación previa (en spec) ahorraría gasto, pero se dejó fuera para mantener el cambio chico.
- Supuesto: Ampliar AgentStation y Station puede romper lugares que usan Record<AgentStation,…> o config.stations[station] con nombres de agentes a medida. La generalización tiene que proteger esos accesos (por ejemplo `custom` aparte en lugar de ampliar AgentStation).
- Supuesto: Los agentes a medida no forman parte de LINE_AGENTS en budgetState: si el motor de un agente a medida está en pausa, la fábrica no se detiene, y el trabajo vuelve a la cola cuando ese agente corre.
- Supuesto: La guía del panel (/agents), zero_lines y factoryGuide no muestran todavía los agentes a medida. Puede verse incompleto hasta el seguimiento.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Agentes a medida por línea (primera parte: revisores propios e instrucciones extra)

## Impact

Generado por zero para el trabajo bcb38c2e.
