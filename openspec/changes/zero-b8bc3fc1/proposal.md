# Proposal

## Why

Quien configura la fábrica va a poder sumar agentes que hacen trabajo en la línea, por ejemplo de traducciones, accesibilidad o documentación, y no solo revisores. En zero.factory.yaml, un agente con `type: build` escribe en la copia de trabajo. Corre después de build y antes de verify, en el orden configurado, así que lo que toca pasa por verify, rutas protegidas, review y security como el resto. Tiene las mismas garantías que build: tiempo límite, caja de aislamiento, motor de su cadena y su propia traza. Sus instrucciones nunca se leen de la copia de trabajo. Con `files` (patrones) corre solo cuando el cambio toca esos archivos. Si falla, falla el intento y el trabajo vuelve a build. `zero agent add --tipo build`, `zero agent list` y el panel /agents muestran el tipo. Los agentes que ya tenés siguen siendo revisores y se comportan igual. Se documenta en los dos READMEs.

Pedido original: "Agentes propios que escriben, no solo revisores. Hoy los agentes propios (`agents` global y `lines[].agents`, CustomAgentSchema) son solo revisores de lectura que corren después de review y security. Quiero que quien configura la fábrica pueda sumar agentes que hagan trabajo en la línea, por ejemplo uno de traducciones, uno de accesibilidad o uno de documentación: - En CustomAgentSchema, un tipo o acceso: `review` (como hoy, solo lectura) o `build` (escribe en la copia de trabajo). - Los que escriben corren después de build y antes de verify, en el orden configurado, para que todo lo que tocan pase por verify, rutas protegidas, review y security igual que el resto. Nunca pueden ir después de verify. - Mismas garantías que la estación build: timeouts, rutas protegidas, la caja de aislamiento cuando está, motor elegido con customAgentChain/pickAgentEngine, sus instrucciones leídas de line.repo o de la carpeta de la fábrica (nunca de la copia de trabajo), su span con su propio nombre. - Opcional: que un agente que escribe se active solo cuando el cambio toca ciertos archivos (patrones), para no correr en cada trabajo. - Si un agente que escribe falla, falla el intento como falla build. - `zero agent add` y el panel /agents muestran el tipo. Empieza como un change de OpenSpec; tests con agentes falsos; documentarlo en README.md y README.es.md. Si el pedido de paralelo en la misma línea sigue en curso, construir esto después para no chocar en daemon.ts/runner.ts."

## What Changes

- Agentes propios que escriben en la línea (type: build)
- Supuesto: Supuesto: el pedido dice "tipo o acceso". Elegí un campo nuevo `type`, y `access`/`after` quedan derivados. Los valores válidos que ya existan en archivos de la fábrica siguen parseando.
- Supuesto: Supuesto: `blocking: false` con `type: build` se rechaza, porque un agente que escribe siempre falla el intento si falla. Los hallazgos no aplican a estos agentes y no usan ReviewSchema, así que no publican aprendizajes en el townhall.
- Supuesto: Supuesto: si falta el archivo de instrucciones de un agente que escribe, el trabajo falla como con un agente bloqueante, en vez de consumir intentos por un error de configuración.
- Supuesto: Supuesto: con ok false se descartan los cambios sin commitear del agente, aunque build los conserva cuando falla. Si se conservaran, el commit siguiente de build mezclaría trabajo a medias de otro agente.
- Supuesto: Supuesto: si la señal aborta (parada de la fábrica o apagado), los cambios sin commitear del agente quedan en la copia como con build, y al retomar corre otra vez ese agente.
- Supuesto: Supuesto: los agentes también corren de nuevo en cada intento, sobre sus commits anteriores, y reciben el feedback del intento previo. Esto puede encarecer los reintentos, y un agente mal escrito puede gastar los intentos del trabajo.
- Supuesto: Riesgo de gasto: cada agente que escribe suma una llamada por intento, y el tope por trabajo es el mismo. `files` lo limita; los patrones se comparan con distinción de mayúsculas.
- Supuesto: Paralelo: el código de esta base (src/) no tiene trabajo en paralelo, y este cambio no toca daemon.ts. No pude revisar las ramas sin fundir porque el permiso de shell fue denegado, así que no puedo confirmar si ese pedido sigue en curso. Si está en curso, puede chocar en runner.ts, en buildLoop.
- Supuesto: La sección de chat `zero_lines` no muestra agentes a medida; queda fuera de este pedido.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Agentes propios que escriben en la línea (type: build)

## Impact

Generado por zero para el trabajo b8bc3fc1.
