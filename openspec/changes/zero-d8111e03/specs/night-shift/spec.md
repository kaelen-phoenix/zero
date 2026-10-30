# Spec Delta

## Purpose

Cada propuesta nueva del turno nocturno queda registrada como issue en GitHub, en todas las líneas cuyo repositorio está en GitHub (zero, solilok, newoman), con la etiqueta `zero:propuesta`. La fábrica crea esa etiqueta si falta. El issue no lleva la etiqueta `zero`, así que no se convierte solo en trabajo. Cuando aprobás o rechazás una propuesta desde la terminal o el chat, la fábrica actualiza el issue en la siguiente pasada. Si la aprobás, le pone la etiqueta de trabajo y comenta qué trabajo abrió, y después el issue recibe los avisos de cómo va (en las líneas que toman issues). Si la rechazás, comenta el motivo y lo cierra. Los comentarios llevan la marca de la fábrica. El pull request que entrega una propuesta aprobada cierra su issue ("Closes #n"). En el texto publicado se tapan los secretos y las rutas de tu PC. Además, cada rechazo queda anotado en el townhall con tu motivo, si lo diste. `scout` recibe en su pedido las últimas 20 propuestas rechazadas de la línea, con su motivo, para no volver a proponer lo mismo ni algo parecido. Quedan para la próxima parte: aprobar o rechazar desde el propio issue (poniéndole la etiqueta o cerrándolo), que `scout` lea los issues sin etiqueta, detectar cambios del turno nocturno que revertiste y la pestaña "Propuestas" del panel. Esa pestaña no existe todavía en el código, aunque la parte 1 la mencionaba.

## ADDED Requirements

### Requirement: Publicar propuestas como issues
Para cada línea cuyo remoto es un repositorio de GitHub (lineRepository) y con acceso a GitHub, la fábrica SHALL publicar como issue cada propuesta pendiente o aprobada que todavía no tiene issue, sea cual sea la autonomía de la línea. El issue lleva la etiqueta `zero:propuesta` y nunca la etiqueta de trabajo de la línea. La fábrica crea la etiqueta `zero:propuesta` con ensureLabel si falta. Guarda el número y la URL del issue en la propuesta, así nunca publica la misma propuesta dos veces. Las propuestas rechazadas que nunca tuvieron issue no se publican.

#### Scenario: propuesta nueva publicada
- **WHEN** una línea con remoto https://github.com/kaelen/demo.git tiene una propuesta pendiente sin issue y corre syncProposalIssues con una IssueApi falsa
- **THEN** la API falsa recibe ensureLabel('zero:propuesta') y un createIssue con el título de la propuesta y solo la etiqueta 'zero:propuesta'; getProposal devuelve issueNumber y issueUrl; una segunda pasada no crea otro issue

#### Scenario: línea sin GitHub
- **WHEN** el remoto de la línea no es de GitHub
- **THEN** no se llama a la API y la propuesta queda sin issue

#### Scenario: rechazada sin issue
- **WHEN** una propuesta se rechazó antes de publicarse y corre la sincronización
- **THEN** no se crea ningún issue para ella

### Requirement: Nada privado en el issue
El título y el cuerpo de un issue de propuesta MUST pasar por redact (src/secrets.ts). Las rutas absolutas del repositorio de la línea y de la carpeta del usuario (os.homedir()) MUST quitarse antes de publicar. El cuerpo incluye el porqué, qué cambiaría, los archivos que tocaría, el costo estimado y el id de la propuesta.

#### Scenario: secreto y ruta tapados
- **WHEN** el campo why de una propuesta contiene un token reconocible por findSecret y el campo change contiene la ruta absoluta del repositorio de la línea
- **THEN** el cuerpo enviado a createIssue no contiene ni el token ni esa ruta absoluta, y sí contiene el id de la propuesta

### Requirement: Decisión en la fábrica actualiza el issue
Cuando una propuesta con issue se aprueba o se rechaza desde la terminal, el chat o app.ts, la siguiente sincronización SHALL avisar al issue una sola vez. Si se aprobó, comenta (con FACTORY_MARK, vía comment) el id del trabajo creado y le agrega la etiqueta de trabajo de la línea (line.issues?.label, o 'zero' si la línea no toma issues). Antes de etiquetar, guarda en el kv issueKey un IssueState con ese trabajo, y después guarda como labeledAt la hora de lastLabeled, así la toma de issues nunca abre un segundo trabajo por ese issue. Si se rechazó, comenta el motivo (o que no se dio motivo) y cierra el issue.

#### Scenario: aprobada
- **WHEN** una propuesta con issue #5 se aprueba con approveProposal y corre la sincronización dos veces
- **THEN** el issue #5 recibe exactamente un comentario que menciona el id del trabajo y una vez la etiqueta 'zero'; el kv issue:kaelen/demo#5 tiene job igual a ese trabajo; pollIssues con la etiqueta 'zero' sobre ese issue no crea un segundo trabajo

#### Scenario: rechazada
- **WHEN** una propuesta con issue #6 se rechaza con la nota 'ya lo hicimos a mano' y corre la sincronización dos veces
- **THEN** el issue #6 recibe exactamente un comentario que contiene 'ya lo hicimos a mano' y se cierra una sola vez

#### Scenario: aprobada antes de publicarse
- **WHEN** una propuesta se aprueba antes de tener issue y después corre la sincronización
- **THEN** se crea el issue y en la misma pasada recibe el comentario de aprobación y la etiqueta

### Requirement: El pull request cierra el issue de la propuesta
El cuerpo de la entrega (deliveryBody) de un trabajo con source night-shift cuya propuesta tiene issue SHALL incluir 'Closes #<número>'.

#### Scenario: closes en la entrega
- **WHEN** se llama a deliveryBody para un trabajo con source {kind:'night-shift', proposal} y esa propuesta tiene issueNumber 5
- **THEN** el texto contiene 'Closes #5'

#### Scenario: sin issue
- **WHEN** la propuesta del trabajo no tiene issue
- **THEN** el texto no contiene 'Closes'

### Requirement: Fallas de GitHub aisladas
Una falla de GitHub al sincronizar una línea MUST quedar en el log sin lanzar error ni frenar la sincronización de las otras líneas. Lo que no se pudo hacer se reintenta en la pasada siguiente.

#### Scenario: createIssue falla
- **WHEN** createIssue lanza un error en la primera línea y la segunda línea tiene una propuesta pendiente
- **THEN** syncProposalIssues resuelve sin lanzar, la segunda línea obtiene su issue y la propuesta de la primera sigue sin issue

### Requirement: El rechazo queda en el townhall
rejectProposal SHALL publicar en el townhall de la línea un post de tipo lesson con el título de la propuesta y el motivo del dueño, o la indicación de que no dio motivo. Una falla del townhall MUST NOT impedir el rechazo.

#### Scenario: rechazo con motivo
- **WHEN** se rechaza con la nota 'no tocar el checkout'
- **THEN** townhall.recall({line}) incluye un post lesson cuyo cuerpo contiene el título de la propuesta y 'no tocar el checkout'

#### Scenario: rechazo sin motivo
- **WHEN** se rechaza sin nota
- **THEN** se publica igual un post lesson con el título y la propuesta queda rejected

### Requirement: scout recuerda los rechazos
El prompt de scout para una línea SHALL incluir las últimas 20 propuestas rechazadas de esa línea, las más recientes primero, cada una con el motivo del dueño si lo dio, y la instrucción de no volver a proponer lo mismo ni algo parecido.

#### Scenario: últimas 20
- **WHEN** la línea tiene 25 propuestas rechazadas (con notas) y corre scoutLine con un agente falso que captura el prompt
- **THEN** el prompt contiene los títulos y las notas de las 20 decididas más recientemente y no contiene los 5 títulos más antiguos en esa sección
