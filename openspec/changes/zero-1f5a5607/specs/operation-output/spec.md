# Spec Delta

## Purpose

Zero va a hacer cumplir la regla por su cuenta, sin confiar en el agente: a un repositorio solo entra desarrollo para ese repositorio. Antes de integrar, revisa los archivos que agrega el trabajo. Si encuentra una base de datos, un log, archivos de ZERO_HOME, carpetas como plus-media o plus-cleanup, informes generados, o imágenes y videos que nada del repositorio menciona, el intento falla con un mensaje que nombra cada archivo y el motivo. Si tu proyecto sí versiona imágenes, podés permitir esas rutas en esa línea con `allowedArtifacts`. `zero informe <línea> --html` deja de imprimir el documento en pantalla: lo guarda en `reports` dentro de ZERO_HOME y te muestra la ruta. Las descargas del panel siguen funcionando y además guardan una copia ahí. Si ZERO_HOME quedara dentro del repositorio de una línea o de la carpeta actual, zero se niega a guardar y te lo explica. El principio queda escrito en los dos README y en AGENTS.md, con sus pruebas.

## ADDED Requirements

### Requirement: Producto de la operación rechazado en la verificación
La verificación MUST fallar el intento, sin preguntarle a nadie y antes de correr los comandos de la línea, cuando el diff `base...HEAD` agrega (estado A) un archivo con forma de producto de la operación. El mensaje MUST nombrar cada archivo con su motivo y mencionar `allowedArtifacts`.

#### Scenario: Base de datos agregada
- **WHEN** un trabajo agrega `data/state.db` y la línea tiene un comando de verificación
- **THEN** `verifyChange` devuelve `kind: failed`, su `feedback` contiene `data/state.db` y `allowedArtifacts`, y el comando no se ejecuta

#### Scenario: El intento se reintenta con el motivo
- **WHEN** el build de una línea en L3 agrega `debug.log` en el primer intento y lo quita en el segundo
- **THEN** el segundo build recibe el mensaje como feedback, el trabajo se entrega y no se crea ninguna pregunta

#### Scenario: Archivo que ya existía
- **WHEN** un trabajo modifica (estado M) un `app.log` que ya estaba versionado en la base
- **THEN** la verificación no lo rechaza por este motivo

### Requirement: Formas reconocidas por nombre y carpeta
zero MUST tratar como producto de la operación, sin distinguir mayúsculas, a los archivos con extensión `.db`, `.db-wal`, `.db-shm`, `.db-journal`, `.sqlite`, `.sqlite3` o `.log`; a los llamados `zero.factory.yaml`, `daemon.lock` o `secrets.enc`; a los que estén bajo `.zero/{townhall,worktrees,jobs,gate,bin,packages,reports}/`; a los que estén bajo una carpeta `plus-*` a cualquier profundidad; a los de extensión md, html, htm, pdf, csv, json, xlsx, txt o xml bajo una carpeta `report`, `reports`, `informe` o `informes`; y a los llamados `informe-*` o `briefing-*` con extensión md, html o pdf.

#### Scenario: Rutas rechazadas
- **WHEN** se evalúan `plus-media/a.txt`, `x/plus-cleanup/b.json`, `reports/2026-10.html`, `docs/Informes/oct.pdf`, `informe-tienda-2026-10.md`, `.zero/townhall/a.md`, `zero.factory.yaml` y `sub/App.LOG`
- **THEN** las ocho se señalan

#### Scenario: Código con nombres parecidos
- **WHEN** se evalúan `src/reports/table.ts`, `src/townhall/x.ts`, `packages/a/index.ts`, `jobs/run.ts`, `src/report.ts`, `plus-icon.tsx` y `.zero/agents/a.md`
- **THEN** ninguna se señala

### Requirement: Imágenes y videos sin referencia
zero MUST tratar como producto de la operación a una imagen o un video agregado (png, jpg, jpeg, gif, webp, avif, bmp, tif, tiff, heic, svg, ico, mp4, m4v, mov, webm, mkv, avi) cuando su nombre de archivo no aparece, sin distinguir mayúsculas, en ningún archivo de texto del árbol de HEAD. No cuentan el propio archivo ni lo que está bajo `openspec/`.

#### Scenario: Imagen sin referencia
- **WHEN** un trabajo agrega `media/post.png` y ningún archivo la nombra
- **THEN** la verificación falla y el `feedback` nombra `media/post.png`

#### Scenario: Imagen usada por el sitio
- **WHEN** un trabajo agrega `site/hero.png` y `site/index.html` contiene `hero.png`
- **THEN** la verificación no la rechaza

#### Scenario: Solo la mencionan el propio archivo o la especificación
- **WHEN** un trabajo agrega `a.svg`, cuyo contenido dice `a.svg`, y solo otra mención bajo `openspec/changes/`
- **THEN** la verificación la rechaza

### Requirement: Rutas permitidas por línea
Cada línea MAY declarar `allowedArtifacts`, una lista de globs con lista vacía por defecto, y zero MUST excluir del rechazo los archivos que coincidan, sin distinguir mayúsculas.

#### Scenario: Línea que versiona imágenes
- **WHEN** una línea con `allowedArtifacts: ["media/**"]` agrega `media/post.png` sin referencias
- **THEN** la verificación no lo rechaza

#### Scenario: Otra ruta en la misma línea
- **WHEN** esa misma línea agrega `otros/post.png` sin referencias
- **THEN** la verificación lo rechaza

#### Scenario: Configuración por defecto
- **WHEN** se lee un archivo de la fábrica con una línea sin el campo
- **THEN** `allowedArtifacts` de esa línea es `[]`

### Requirement: Especificación del propio trabajo
zero MUST NOT señalar los archivos Markdown bajo `openspec/changes/<cambio del trabajo>/`, y MUST seguir señalando cualquier otro archivo con forma de producto en esa carpeta.

#### Scenario: Capacidad con nombre parecido
- **WHEN** la especificación de un trabajo agrega `openspec/changes/zero-x/specs/reports/spec.md`
- **THEN** la verificación no lo rechaza

#### Scenario: Producto escondido en la especificación
- **WHEN** un trabajo agrega `openspec/changes/zero-x/state.db`
- **THEN** la verificación lo rechaza

### Requirement: Control inmediato antes de integrar
El runner MUST repetir el control sobre el diff completo del trabajo justo antes de integrar, antes de preguntar por la integración y en cualquier modo de integración. Si encuentra producto de la operación, MUST terminar el trabajo como fallido con un motivo que nombre los archivos, sin integrar ni publicar la rama.

#### Scenario: Commit posterior a la verificación
- **WHEN** un agente de revisión falso hace commit de `state.db` en la copia de trabajo después de que verify pasó, en una línea de modo merge
- **THEN** el trabajo termina `failed`, el motivo contiene `state.db` y la rama base no cambia

#### Scenario: Trabajo limpio
- **WHEN** el diff no tiene producto de la operación
- **THEN** el trabajo se integra como hasta ahora

### Requirement: Rutas con caracteres especiales
`changedFiles` MUST devolver las rutas reales, sin el entrecomillado de git, para que ningún control se esquive con un nombre que tenga caracteres no ASCII.

#### Scenario: Nombre no ASCII
- **WHEN** un trabajo agrega `informé.log`
- **THEN** `changedFiles` devuelve `{status: "A", path: "informé.log"}` y la verificación lo rechaza

#### Scenario: Ruta protegida no ASCII
- **WHEN** un trabajo agrega `.github/café.yml`
- **THEN** `protectedTouched` con los valores por defecto la señala

### Requirement: Informe HTML dentro de ZERO_HOME
`zero informe <línea> --html` MUST escribir el documento en `<ZERO_HOME>/reports/` con el nombre de `reportFileName` e imprimir por la salida estándar solo la ruta escrita.

#### Scenario: Exportación por terminal
- **WHEN** se corre `zero informe tienda --mes 2026-10 --html` con la carpeta actual dentro de un repositorio de git
- **THEN** sale con código 0, existe `<ZERO_HOME>/reports/informe-tienda-2026-10.html` con el contenido de `reportHtml`, la salida contiene esa ruta y no contiene `<html`, y `git status` del repositorio no muestra archivos nuevos

#### Scenario: Markdown sin cambios
- **WHEN** se corre `zero informe tienda --mes 2026-10`
- **THEN** el Markdown se imprime igual que hoy y no se escribe ningún archivo

### Requirement: Exportaciones del panel dentro de ZERO_HOME
`/report/export` MUST guardar una copia en `<ZERO_HOME>/reports/` y además responder con la misma descarga de hoy.

#### Scenario: Descarga de Markdown
- **WHEN** se pide `/report/export?line=tienda&mes=2026-10&format=md` con sesión
- **THEN** la respuesta es la descarga actual y `<ZERO_HOME>/reports/informe-tienda-2026-10.md` tiene el mismo contenido

#### Scenario: Pedido inválido
- **WHEN** se pide con `format=pdf` o sin sesión
- **THEN** no se escribe ningún archivo

### Requirement: Nunca guardar dentro de un repositorio
Guardar un informe MUST fallar, con un mensaje que explique el motivo y sin escribir nada, cuando `<ZERO_HOME>/reports` queda dentro del repositorio de una línea o del repositorio de git de la carpeta actual.

#### Scenario: ZERO_HOME dentro de una línea
- **WHEN** ZERO_HOME está dentro del `repo` de una línea y se exporta el informe en HTML
- **THEN** la exportación falla con un mensaje que nombra la línea y el repositorio queda sin archivos nuevos

#### Scenario: ZERO_HOME dentro del repositorio actual
- **WHEN** ZERO_HOME está dentro del repositorio de la carpeta actual, que no es una línea, y se guarda un informe
- **THEN** falla sin escribir nada

#### Scenario: Carpeta actual dentro de ZERO_HOME
- **WHEN** la carpeta actual es una copia de trabajo bajo `<ZERO_HOME>/worktrees/...`
- **THEN** el informe se guarda en `<ZERO_HOME>/reports/`

### Requirement: Principio documentado
`README.md`, `README.es.md` y `AGENTS.md` MUST enunciar que lo que la fábrica produce trabajando queda solo en ZERO_HOME y que a un repositorio solo entra desarrollo para ese repositorio. Los dos README MUST documentar `allowedArtifacts` y dónde se guardan los informes.

#### Scenario: Documentación presente
- **WHEN** corre `test/docs.test.ts`
- **THEN** cada README contiene `allowedArtifacts` y `ZERO_HOME` en su sección nueva (`## What stays on your machine` y `## Lo que queda en tu máquina`), y `AGENTS.md` contiene `allowedArtifacts` y `operationArtifacts`
