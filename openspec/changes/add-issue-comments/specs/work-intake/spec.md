# Spec Delta

## ADDED Requirements

### Requirement: Comentarios del issue
En los issues que tienen un trabajo de la fábrica, la fábrica SHALL leer los comentarios nuevos de personas con permiso de escritura y SHALL atenderlos cuando el trabajo terminó o está esperando al dueño. Los comentarios de la propia fábrica y de personas sin permiso de escritura MUST NOT atenderse. La fábrica SHALL responder en el issue una vez por tanda de comentarios.

#### Scenario: Comentario de un desconocido
- **WHEN** alguien sin permiso de escritura comenta en el issue
- **THEN** la fábrica no lo atiende ni responde

#### Scenario: Comentario mientras trabaja
- **WHEN** el dueño comenta mientras el trabajo está en curso
- **THEN** la fábrica lo atiende cuando el trabajo termina o le consulta

### Requirement: Decisión sobre un comentario
Una estación de solo lectura, sin acceso al repositorio, SHALL decidir con los hechos del trabajo que calcula zero si responde, si pide un cambio o si aprueba o rechaza la consulta pendiente. Un pedido de cambio SHALL crear un trabajo nuevo sobre el mismo issue; aprobar o rechazar SHALL valer solo si el trabajo está esperando.

#### Scenario: Pregunta después de entregar
- **WHEN** el trabajo de un issue terminó integrado solo en la rama local y el dueño comenta "No lo veo desplegado"
- **THEN** la fábrica responde en el issue que el cambio quedó en la PC del dueño sin subir y cómo publicarlo

#### Scenario: Pedido de ajuste
- **WHEN** el trabajo terminó y el dueño comenta que falta traducir el pie de página
- **THEN** la fábrica crea un trabajo nuevo sobre el mismo issue con el pedido original, lo entregado y el comentario, y lo dice en el issue

#### Scenario: Respuesta a una consulta
- **WHEN** el trabajo está esperando al dueño y el dueño comenta "aprobado"
- **THEN** la fábrica aprueba la consulta y el trabajo continúa
