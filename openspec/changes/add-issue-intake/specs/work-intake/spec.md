# Spec Delta

## ADDED Requirements

### Requirement: Issues de GitHub como pedidos
Para cada línea con `issues` configurado, el daemon SHALL revisar periódicamente los issues abiertos con la etiqueta configurada (`zero` por defecto) en el repositorio de GitHub del remoto de la línea, y SHALL convertir cada uno en un trabajo con su título y su cuerpo. Los pull requests MUST NOT tomarse como issues. Un issue MUST NOT generar más de un trabajo a la vez; volver a ponerle la etiqueta después de que su trabajo terminó SHALL generar un trabajo nuevo.

#### Scenario: Issue etiquetado por el dueño
- **WHEN** el dueño abre un issue y le pone la etiqueta `zero`
- **THEN** en la siguiente revisión la fábrica crea un trabajo en esa línea con el título y el cuerpo del issue, y comenta en el issue el identificador del trabajo

#### Scenario: Revisión repetida
- **WHEN** la fábrica revisa de nuevo un issue que ya tiene un trabajo en curso
- **THEN** no crea otro trabajo

### Requirement: Solo issues de personas con permiso
La fábrica SHALL tomar un issue solo si su autor y quien le puso la etiqueta tienen permiso de escritura en el repositorio (`write`, `maintain` o `admin`). Si no, MUST NOT crear el trabajo y SHALL explicarlo una vez en el issue. Los comentarios del issue MUST NOT formar parte del pedido.

#### Scenario: Issue de un desconocido
- **WHEN** alguien sin permiso de escritura abre un issue y el dueño le pone la etiqueta
- **THEN** la fábrica no crea el trabajo y comenta que solo toma issues escritos por personas con permiso de escritura

### Requirement: El issue muestra su trabajo
La fábrica SHALL comentar en el issue cuando el trabajo pasa a esperar al dueño (con la pregunta y cómo responderla) y cuando termina (entregado con el enlace al pull request, fallido o detenido con el motivo), una sola vez por estado. El pull request del trabajo SHALL incluir `Closes #N`.

#### Scenario: Trabajo entregado
- **WHEN** el trabajo de un issue abre su pull request
- **THEN** el issue recibe un comentario con el enlace, y el pull request incluye `Closes #N`
