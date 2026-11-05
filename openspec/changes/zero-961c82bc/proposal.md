# Proposal

## Why

En la sección Capacitaciones de la web, cada tarjeta (Charla abierta, Taller grupal, Mentoría individual) deja de tener el único botón «La quiero» y pasa a mostrar ese texto seguido de dos botones lado a lado, con los mismos íconos del pie: WhatsApp e Instagram. WhatsApp abre el chat con un mensaje ya cargado según el formato y el idioma, listo para completar la cantidad de personas y la fecha. Instagram abre el chat y, como no permite cargar un mensaje, lo copia al portapapeles y avisa junto a los botones «Copiamos el mensaje: pegalo en el chat»; si no se puede copiar, el chat se abre igual y el mensaje queda a la vista para copiarlo a mano. Sin JavaScript los dos enlaces siguen andando, y WhatsApp lleva un mensaje genérico. En pantallas angostas los botones no se desbordan. Se quita la nota de WhatsApp del final de la sección y se actualizan las pruebas del sitio y los README.

## What Changes

- Capacitaciones: «La quiero» con botones de WhatsApp e Instagram
- Supuesto: Supuesto: la sección Capacitaciones sigue visible solo en español (data-lang-only="es"), como decidió un cambio anterior. Los mensajes y avisos en inglés se implementan y prueban, pero no se ven en la página en inglés mientras eso no cambie.
- Supuesto: Supuesto: el mensaje genérico sin JavaScript es el mismo que ya usa el pie («Hola, quiero saber más sobre zero in the loop»), porque el pedido no da otro texto. Queda fijo en español en el href hasta que corre JavaScript.
- Supuesto: Supuesto: el pedido solo da el texto en español de la Charla abierta; los otros mensajes, los textos en inglés y el texto del aviso de fallo son redacción de esta especificación. Se usa «el Taller grupal» por concordancia.
- Supuesto: Supuesto: Mentoría individual usa la misma frase «Somos [cantidad] personas», aunque pueda ser una sola persona, porque el pedido dice «lo equivalente». Quien escribe puede editarla en el chat.
- Supuesto: Supuesto: «aviso breve» se refiere a un texto corto, no a que desaparezca solo: el aviso queda hasta el próximo clic o cambio de idioma, para que siga ahí al volver de la pestaña de Instagram y para que el mensaje de fallo se pueda copiar.
- Supuesto: Abrir la pestaña nueva le saca el foco a la página durante la copia, y algunos navegadores rechazan writeText sin foco. Por eso la copia se pide de forma síncrona en el clic, y si igual falla queda el mensaje a la vista. Las pruebas usan un portapapeles falso, así que esto no se comprueba en un navegador real.
- Supuesto: El ajuste en pantallas angostas se verifica leyendo el CSS, no midiendo en un navegador.
- Supuesto: WhatsApp e Instagram pasan a ser nombres de marca sin clave de traducción, permitidos en la lista de la prueba de texto visible, porque las claves de EN deben coincidir con el HTML y estos nombres no cambian entre idiomas.
- Supuesto: Los tres enlaces de cada red se leen igual para un lector de pantalla fuera de contexto, porque el pedido no pide etiquetas por formato.

## Capabilities

### New Capabilities
- `project-site`: Capacitaciones: «La quiero» con botones de WhatsApp e Instagram

### Modified Capabilities

## Impact

Generado por zero para el trabajo 961c82bc.
