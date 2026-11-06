# Proposal

## Why

Zero va a hacer cumplir la regla por su cuenta, sin confiar en el agente: a un repositorio solo entra desarrollo para ese repositorio. Antes de integrar, revisa los archivos que agrega el trabajo. Si encuentra una base de datos, un log, archivos de ZERO_HOME, carpetas como plus-media o plus-cleanup, informes generados, o imágenes y videos que nada del repositorio menciona, el intento falla con un mensaje que nombra cada archivo y el motivo. Si tu proyecto sí versiona imágenes, podés permitir esas rutas en esa línea con `allowedArtifacts`. `zero informe <línea> --html` deja de imprimir el documento en pantalla: lo guarda en `reports` dentro de ZERO_HOME y te muestra la ruta. Las descargas del panel siguen funcionando y además guardan una copia ahí. Si ZERO_HOME quedara dentro del repositorio de una línea o de la carpeta actual, zero se niega a guardar y te lo explica. El principio queda escrito en los dos README y en AGENTS.md, con sus pruebas.

## What Changes

- Lo que la fábrica produce trabajando no entra a los repositorios
- Supuesto: Supuesto: las `exportaciones del panel` son descargas del navegador y zero no controla dónde las guarda el navegador. Mantengo la descarga y agrego una copia en ZERO_HOME; la copia del navegador sigue en la carpeta de descargas de quien la pide.
- Supuesto: Supuesto: `zero informe --html` deja de imprimir el HTML, así que `zero informe x --html > archivo` ya no sirve y hay que cambiar una prueba existente. No agrego una bandera para elegir otra ruta: para llevar el archivo a otro lado se copia desde `reports`.
- Supuesto: Supuesto: el Markdown por terminal y `zero_monthly_report` siguen sin escribir archivos, porque no generan ninguno. Redirigir la salida a un repositorio queda en manos de quien lo hace.
- Supuesto: Supuesto: las rutas `jobs/`, `bin/`, `packages/`, `gate/` y `townhall/` solo cuentan bajo `.zero/`, porque fuera de ahí son nombres comunes de proyectos (el propio zero tiene `src/townhall/`). Los archivos de ZERO_HOME con nombres comunes, fuera de `.zero/` y sin una extensión reconocida, no se detectan.
- Supuesto: El control trabaja por forma de archivo, así que hay falsos positivos y falsos negativos. Un `fixtures/sample.db`, un `reports/template.html` o una imagen cuyo nombre se arma en tiempo de ejecución fallan hasta agregarlos a `allowedArtifacts`. Un informe con otro nombre y otra carpeta pasa. Las carpetas `plus-*` son una generalización de los dos ejemplos del pedido.
- Supuesto: La referencia se busca por nombre de archivo en HEAD, y cuenta una mención hecha en el mismo cambio. Un agente puede pasar el control nombrando la imagen en un README, y un `logo.png` ya mencionado cubre a otro `logo.png` en otra carpeta. La revisión es la que tiene que notar ese caso.
- Supuesto: El control solo mira archivos agregados: un producto que ya está versionado y se modifica no se señala. Mover un archivo cuenta como agregado, por `--no-renames`.
- Supuesto: En el control previo a integrar, el trabajo falla sin más intentos: en ese punto ya pasó la verificación, y esto solo ocurre si algo hizo commit después.
- Supuesto: Cambiar `changedFiles` a `-z` también afecta a `protectedTouched`, `testTampering`, los `files` de los agentes y `nightShiftHold`: rutas que antes llegaban entrecomilladas ahora coinciden con sus reglas. Es una corrección, pero un trabajo con nombres no ASCII puede pasar a preguntar por una ruta protegida.
- Supuesto: La protección contra guardar dentro de un repositorio solo mira las líneas y el repositorio de la carpeta actual. Un ZERO_HOME dentro de otro repositorio, como un repositorio de dotfiles en la carpeta personal, sigue guardando ahí salvo que git lo ignore.
- Supuesto: No pude listar los archivos versionados de zero con `git ls-files`, porque Bash está denegado en esta estación. Con Glob solo encontré imágenes en `site/` y ningún `*.db`, `*.log` ni `plus-*` en la raíz, sin confirmación de git.

## Capabilities

### New Capabilities
- `operation-output`: Lo que la fábrica produce trabajando no entra a los repositorios

### Modified Capabilities

## Impact

Generado por zero para el trabajo 1f5a5607.
