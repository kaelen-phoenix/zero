# ADR 0010 — Canales de actualización

- **Estado:** aceptado
- **Fecha:** 2026-11-25

## Contexto

La autoactualización (ADR 0006) toma todo lo que entra en la rama. Eso sirve para la fábrica principal, donde se desarrolla zero, pero no para una instalación de producción, por ejemplo la que solo corre un paquete para clientes y no tiene líneas: esa tiene que quedarse en una versión probada y cambiar cuando lo decide quien está a cargo. Lo mismo vale para los paquetes instalados desde git, que siguen una rama o quedan fijos en una etiqueta que nadie podía mover.

## Decisión

### Una versión liberada es una etiqueta de git

Una versión liberada es una etiqueta llamada exactamente `vX.Y.Z` en el remoto, leída con `git ls-remote` y ordenada por número. Las demás se ignoran. No se usa la página de releases de GitHub: una etiqueta se publica y se lee con las credenciales de git que cada máquina ya tiene, sin token de la API, y funciona con cualquier remoto. Las etiquetas con esa forma que ya existan cuentan como liberadas, aunque no las haya publicado zero.

### Liberar es de la terminal y solo hacia adelante

`zero liberar` publica la etiqueta de un commit que ya está en la rama base del remoto, después de mostrarla y con un sí. Con `--line` libera el repositorio de una línea, que es como se libera un paquete. Se niega si la versión existe o no es mayor, o si el commit no desciende de la última liberada, y nunca fuerza ni mueve una etiqueta: una instalación que ya la tomó no puede quedar con otro código bajo el mismo nombre. No crea etiquetas ni ramas en el repositorio local. Ninguna herramienta del chat ni ruta del panel libera, porque esa decisión alcanza a todas las instalaciones.

### El canal dice hacia dónde; `enabled`, si lo hace sola

`selfUpdate.channel` acepta `estable` o `ultimo` y no tiene valor por defecto: ausente, todo sigue como antes del cambio, también lo que se muestra. Separarlo de `enabled` da el caso que se buscaba, `selfUpdate: { channel: estable }`, en el que la fábrica solo mira y espera un pedido. Solo el archivo de la fábrica lo cambia.

En `estable` el único destino es la última versión liberada, que además tiene que estar en la rama seguida y ser un avance rápido; si HEAD ya la contiene, está al día. No se vuelve a una versión anterior, igual que antes del cambio: las instalaciones solo avanzan. Como nada que vea la fábrica anuncia una versión, en `estable` se mira una vez por hora. Una versión preparada para otro canal se descarta, así un cambio en el archivo nunca termina instalando lo que ya no se quiere. Y lo que todavía no se liberó no cuenta como instalación atrasada.

### Un pedido por el mismo camino seguro

`zero actualizar`, `zero_update` en el chat y "Actualizar ahora" en el panel anotan el mismo pedido, que el daemon toma en su pasada: prepara aparte, espera a que no haya trabajos y cambia con la vuelta atrás de siempre, diga lo que diga `enabled`. Un pedido se consume una sola vez y deja un registro de cómo terminó. Puede volver a probar un commit que falló, porque lo pide una persona; las comprobaciones automáticas lo siguen salteando. Desde el chat remoto queda retenido hasta que se confirma.

### Paquetes de git: canal o etiqueta

Una entrada de git acepta `channel: estable`, que toma solo la última versión liberada de su remoto, o queda fija en la `#referencia` de su fuente, que se mueve con `zero package update <nombre> --etiqueta <etiqueta>`. Las dos juntas se rechazan, porque dirían cosas distintas. Los del canal estable se actualizan solos únicamente con `enabled: true`, con un proceso aparte (el mismo `zero package update`) que no tiene terminal: un paquete que pide más que antes no se aplica. Cada versión se intenta una sola vez, para que una que falla no apague la fábrica cada día.

## Consecuencias

- Una instalación de producción corre solo lo que se liberó y cambia cuando se lo piden, o sola al liberarse una versión si se enciende `enabled`.
- Corregir una versión liberada con un error es liberar una posterior: no hay vuelta a una anterior.
- El cambio espera a los trabajos y no a las estaciones de los paquetes, que se cortan como en cualquier apagado.
- Los paquetes se revisan una vez por día, así que una versión puede tardar hasta un día en aplicarse sola; `zero package update` la toma en el momento.
- En Docker la instalación no es un repositorio de git: ahí se actualiza la imagen, y los paquetes no se actualizan solos.
