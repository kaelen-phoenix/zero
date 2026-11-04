# Proposal

## Why

Vas a poder extender zero con agentes propios o de terceros instalando un paquete: una carpeta local o un paquete npm con un manifiesto `zero-package.yaml`. Lo declarás en `packages` del archivo de la fábrica, o lo instalás con `zero package add`, y zero carga de ahí agentes con sus instrucciones, skills y, solo si lo autorizás con `allowCode: true`, estaciones con código propio. Cada estación tiene su pasada en el daemon mientras la fábrica está libre, su configuración y sus secretos. Un paquete roto no frena la fábrica: queda fuera y lo ves en `zero status` y en `zero package list`. El formato, la versión de la interfaz y un ejemplo mínimo que los tests cargan de verdad quedan documentados en README.md y README.es.md. Un paquete con código corre con los permisos de tu usuario, así que instalá solo lo que confiás.

Pedido original: "Cargador de paquetes de agentes, genérico y gratis. El archivo de la fábrica declara paquetes de agentes instalados (una carpeta local o un paquete npm) y zero carga de ahí agentes, sus instrucciones, skills y, si los traen, estaciones con código propio: una estación con su pasada en el daemon, su configuración y sus secretos, igual que hoy funciona la estación community por dentro. Definir y documentar el formato del paquete (manifiesto, versión de la interfaz) y cómo se instala uno, con un ejemplo mínimo en la documentación. README en los dos idiomas. Empezar como cambio de OpenSpec. Importante para el texto público (docs, ADR, README, commits, PR): presentarlo solo como una forma de extender zero con agentes de terceros o propios. No mencionar ningún producto, edición, repositorio ni paquete comercial concreto, ni planes de mover estaciones existentes. No tocar todavía la estación community: sigue igual."

## What Changes

- Paquetes de agentes: extender zero con agentes propios o de terceros
- Supuesto: El código de una estación corre dentro del proceso del daemon, con los permisos de tu usuario. `allowCode` es un permiso y `ctx.secrets` un contrato, no un aislamiento: ese código podría leer el entorno o el llavero por su cuenta. La documentación lo tiene que decir sin rodeos.
- Supuesto: Los agentes que llama una estación corren en el host, como las demás pasadas de tiempo libre, no en la caja de aislamiento. El acceso `read` y la carpeta vacía no los confinan del todo. Si una estación publica afuera lo que un agente escribe, el filtro de esa salida queda a cargo del paquete.
- Supuesto: Si un paquete queda rechazado, también se van sus agentes bloqueantes y sus trabajos siguen sin esa revisión. Se eligió no frenar la fábrica y mostrar el problema en `zero status`, en `zero package list` y en el registro.
- Supuesto: Interpretación: los agentes de un paquete valen para todas las líneas, porque el pedido no habla de elegir líneas. `engine` y `model` se fijan en tu entrada y no en el manifiesto, para que un tercero no elija motor.
- Supuesto: Interpretación: en la interfaz 1 las estaciones tienen solo acceso `read` para sus agentes y validan la salida con `ctx.z`, la instancia de zod de zero, para no depender de que el paquete traiga la misma versión.
- Supuesto: Node guarda en caché los módulos importados: un cambio en el código de una estación necesita reiniciar el daemon. El `config` y el manifiesto se releen en cada vuelta.
- Supuesto: `npm install` no se pudo probar en esta corrida y los tests usan un instalador falso, así que la primera instalación real desde npm es la prueba verdadera, sobre todo en Windows, donde `npm` es un `.cmd`. `--ignore-scripts` evita los scripts de instalación, pero un paquete que los necesite no va a quedar completo.
- Supuesto: Antes de fundir: zero genera el commit de especificación citando el pedido textual en `proposal.md`. Build puede cambiar ese párrafo en el resultado final, pero el commit sigue en el historial de la rama, y una fusión normal lo conserva. Si no querés que quede en el historial público, fundí esta solicitud de cambio con squash y no con fusión automática.

## Capabilities

### New Capabilities
- `agent-packages`: Paquetes de agentes: extender zero con agentes propios o de terceros

### Modified Capabilities

## Impact

Generado por zero para el trabajo 0a8f9a17.
