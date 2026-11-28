# Proposal

## Why

Vas a poder sumar otra PC o una máquina Linux en la nube y que trabajen como una sola fábrica: - **Líneas:** al unirse una máquina, o cuando aparece una línea nueva, los proyectos se clonan solos dentro de ZERO_HOME, sin secretos ni datos de otra máquina. Los que esa máquina no puede atender, por plataforma o motores, se muestran así y no se clonan. - **Presupuesto:** el gasto de todas las máquinas cuenta contra los mismos límites (por día, por trabajo, por noche, tu reserva y el cupo de la suscripción). - **Control:** desde el chat, la CLI o el panel de cualquiera podés pedir trabajos, responder, aprobar y ver la fábrica entera. Lo que delegás en otra máquina le llega en su próximo latido, no al instante. - **Paquetes:** podés fijar las estaciones de un paquete a una máquina. Por ejemplo, el CM corre solo en la PC de casa. - **Guía:** los dos README explican cómo instalar zero en Linux en la nube, sin puertos abiertos. - **Repositorio de coordinación:** la creación automática de repositorios todavía no existe, así que `zero unirse` muestra el comando exacto para crear el repositorio privado. Con una sola máquina o sin `distributed`, todo sigue igual. Está partido en ocho etapas chicas.

## What Changes

- Fábrica distribuida, tercera parte: líneas, presupuesto común y control desde cualquier máquina
- Supuesto: Clonar una línea trae comandos setup y verify que esta máquina va a ejecutar. Quien escribe en el repositorio de coordinación puede hacer correr comandos en las máquinas unidas. Es una excepción a la regla del ADR 0007 de que un registro no cambia la configuración, acotada a agregar líneas nuevas de GitHub, y se documenta.
- Supuesto: Las líneas con integrate merge o branch entregan en el clon de la máquina que hizo el trabajo. Para líneas compartidas conviene pull-request: se documenta y no se cambia sola.
- Supuesto: autoMerge se copia como parte de la integración. Cada máquina vigila solo los pull requests que entregó.
- Supuesto: El gasto ajeno llega con hasta un latido de atraso, así que varias máquinas a la vez pueden pasarse un poco del tope. Los relojes desfasados mueven los tramos de 15 minutos.
- Supuesto: La suma supone que todas las máquinas usan la misma cuenta por motor, como dice el pedido.
- Supuesto: Cada registro nuevo gasta cuota de GitHub. Por eso se escriben solo cuando cambian y con el pase coord. Las referencias claims/ y queue/ ya crecen sin limpieza.
- Supuesto: Las aprobaciones de gasto extra no viajan con el avance: un trabajo retomado en otra máquina puede volver a preguntar.
- Supuesto: La caja, el llavero y el servicio en un Linux sin escritorio no se prueban de punta a punta. Si el llavero queda bloqueado tras reiniciar, el panel y las credenciales no funcionan hasta desbloquearlo.
- Supuesto: loginctl enable-linger y la instalación de Podman piden administrador: la guía los deja en manos de quien instala.
- Supuesto: platforms es un campo nuevo, necesario porque hoy una línea no declara en qué plataforma corre.
- Supuesto: Los paquetes no se copian entre máquinas: la fijación se escribe en el archivo de cada una que los tenga.

## Capabilities

### New Capabilities
- `distributed-factory`: Fábrica distribuida, tercera parte: líneas, presupuesto común y control desde cualquier máquina

### Modified Capabilities

## Impact

Generado por zero para el trabajo fe4b7d95.
