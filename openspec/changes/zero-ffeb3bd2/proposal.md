# Proposal

## Why

Vas a poder instalar un paquete de agentes desde un repositorio git con un solo comando, por ejemplo `zero package add github:acme/hola-zero#v1` o con una URL https o ssh. zero usa las credenciales de git que ya tenés: nunca te pide ni guarda tokens. Antes de instalar te muestra qué trae el paquete y te pide confirmación. `zero package update [nombre]` trae lo nuevo, te muestra los commits y si cambian los secretos o permisos declarados, y te vuelve a preguntar si se amplían. Para aplicar el cambio apaga la fábrica, actualiza y reinstala dependencias. Si el paquete queda inválido vuelve al commit anterior, y al final enciende una sola fábrica si estaba en marcha. También actualiza paquetes de carpeta y de npm. `zero package list` muestra la fuente, el commit o la versión instalada y si hay una actualización disponible, sin usar la red; la fábrica revisa esto una vez por día. Es el pedido anterior, con el defecto que lo frenó ya corregido: un paquete fijado a un tag anotado ya no avisa "hay una actualización" todos los días cuando nada cambió.

## What Changes

- Instalar y actualizar paquetes de agentes desde git, sin falso aviso con tags anotados
- Supuesto: Se reutiliza la rama `zero/f4a8c689`, que está solo en este repositorio local. Las pruebas no ven esa rama: si no está disponible en la copia de trabajo, hay que reimplementar desde estos requisitos, lo que no entra en el presupuesto de una corrida.
- Supuesto: No se pudo simular el merge porque esta estación no tuvo permiso para `git merge-tree`. Los choques previstos en `src/daemon.ts` y `AGENTS.md` salen de comparar los dos diffs a mano, y podría haber alguno más en `test/docs.test.ts` o los README.
- Supuesto: La rama fallida pasó tres intentos de revisión con el defecto de tags como último bloqueo, pero la revisión de este trabajo vuelve a mirar todo el cambio (unas 2.300 líneas) y podría encontrar otros defectos.
- Supuesto: El comportamiento de `git ls-remote` con el patrón `<ref>^{}` no se probó en esta estación: se apoya en el informe de la revisión anterior y en el pedido. La prueba contra el repositorio real con `git tag -a` es la que lo confirma.
- Supuesto: El requisito de documentación se renombró a 'Documentación de fuentes git y actualización' porque 'Documentación' ya existe en dos deltas de `agent-packages` y chocaría al archivar. El comportamiento pedido no cambia.
- Supuesto: Siguen valiendo los supuestos del trabajo anterior: la confirmación al agregar desde git se pide siempre; `--yes` cuenta como confirmación; se agrega un pase diario de la fábrica; el código nuevo de una estación ya permitida no cuenta como ampliación; los submódulos no se traen; un tag movido se trata como novedad; en npm no hay vuelta atrás automática; y si `shutdownFactory` agota su espera, la fábrica se apaga más tarde sin que nadie la vuelva a encender, y la salida lo dice.

## Capabilities

### New Capabilities
- `agent-packages`: Instalar y actualizar paquetes de agentes desde git, sin falso aviso con tags anotados

### Modified Capabilities

## Impact

Generado por zero para el trabajo ffeb3bd2.
