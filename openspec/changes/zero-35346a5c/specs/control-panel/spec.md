# Spec Delta

## Purpose

El panel suma una sección nueva, "Pedidos" (/requests), en el menú. Arriba hay un formulario para pedir un trabajo con línea, tipo de pedido (función nueva, arreglo, seguridad, diseño, documentación, otro), título y descripción. El tipo viaja dentro del texto del pedido, así que la fábrica lo ve. Debajo aparece la lista de pedidos, del más nuevo al más viejo, con su estado, línea y antigüedad ("hace 3 h"). Se puede filtrar por línea y por estado. Cada pedido tiene sus acciones: ver detalle y traza, responder la pregunta pendiente si te está esperando, y frenarlo. Frenar primero te pide confirmación. Todo pasa por app.ts, igual que la terminal y el chat. Las prioridades (baja, media, alta, urgente, con el aviso para urgente) y el menú lateral con los colores de marca todavía no están en main. Por eso esta parte no los incluye y usa el diseño actual del panel; se suman cuando lleguen.

## ADDED Requirements

### Requirement: Sección Pedidos en el menú
The panel SHALL serve a page at `GET /requests` titled "Pedidos", linked as "Pedidos" from the menu built by `page()` in src/panel/html.ts. Like every other page, it MUST require a valid session: without one it answers 401 with the sign-in page and no factory data.

#### Scenario: Sin sesión
- **WHEN** GET /requests is requested without the session cookie, with a job in line `tienda`
- **THEN** the status is 401, the body contains "Panel de tu fábrica" and does not contain "tienda"

#### Scenario: Con sesión y enlace en el menú
- **WHEN** GET /requests and GET / are requested with a valid session
- **THEN** /requests answers 200 and contains "Pedidos"; the page at / contains a link `href="/requests"`

### Requirement: Formulario de pedido con tipo
The `/requests` page SHALL show a form posting to `/requests` with a line select listing every configured line, a type select with exactly the options función nueva (`feature`), arreglo (`fix`), seguridad (`security`), diseño (`design`), documentación (`docs`) and otro (`other`), a required title input and a description textarea.

#### Scenario: Campos del formulario
- **WHEN** GET /requests with lines `tienda` and `blog` configured
- **THEN** the HTML contains a form with action "/requests", options for `tienda` and `blog`, the six type values feature, fix, security, design, docs, other with their Spanish labels, an input named `title` and a textarea named `description`

### Requirement: El tipo viaja dentro del pedido
`requestWork` in src/app.ts SHALL accept optional `type`, `title` and `description` fields. When `type` is given, the stored request text MUST be the trimmed title, a blank line, `Tipo de pedido: <Spanish label>`, and then, if there is a description, a blank line and the trimmed description. An unknown type or an empty title MUST throw a Spanish error and create no job. Calls without `type` MUST keep today's behaviour exactly, using `text` as the request.

#### Scenario: Pedido tipado
- **WHEN** requestWork is called with type `fix`, title "Botón roto", description "El botón de pagar no responde" and line `tienda`
- **THEN** one queued job exists in `tienda` whose request equals "Botón roto\n\nTipo de pedido: arreglo\n\nEl botón de pagar no responde"

#### Scenario: Sin descripción
- **WHEN** requestWork is called with type `docs` and title "README" and no description
- **THEN** the job's request equals "README\n\nTipo de pedido: documentación"

#### Scenario: Tipo desconocido
- **WHEN** requestWork is called with type `x` and title "algo"
- **THEN** it throws an error and the store has no jobs

#### Scenario: Título vacío
- **WHEN** requestWork is called with type `feature` and title " "
- **THEN** it throws an error and the store has no jobs

#### Scenario: Compatibilidad
- **WHEN** requestWork is called with only text "agregá un descuento"
- **THEN** the job's request equals "agregá un descuento"

### Requirement: Enviar el formulario
`POST /requests` SHALL create the job through `requestWork` with the form's line, type, title and description, then redirect (303) to `/job/<id>` with a confirmation message. A validation error MUST redirect (303) back to `/requests` with the error in `msg` and create no job. The existing `POST /request` on the Resumen page MUST keep working unchanged.

#### Scenario: Alta desde el panel
- **WHEN** a session POSTs /requests with line `tienda`, type `security`, title "Revisar login" and description "x"
- **THEN** the status is 303, the location starts with `/job/<id>?msg=`, and the job's request contains "Tipo de pedido: seguridad"

#### Scenario: Error vuelve a la sección
- **WHEN** a session POSTs /requests with an empty title
- **THEN** the status is 303, the location starts with `/requests?msg=` and no job exists

#### Scenario: Origen ajeno
- **WHEN** POST /requests comes with `origin: https://evil.example`
- **THEN** the status is 403 and no job exists

### Requirement: Lista de pedidos
Below the form, the `/requests` page SHALL list jobs newest first, at most 200, taken from `requestsView` in src/app.ts. That function MUST read every job (`listJobs` with `limit: -1`), not only the first 1000. Each row MUST show the escaped `jobName`, its id, its line, its status in Spanish (`describeJobStatus`), its origin when `jobOrigin` gives one, and its age relative to now in Spanish ("hace N min", "hace N h" or "hace N días").

#### Scenario: Orden y datos
- **WHEN** two jobs are created, the second one later, and GET /requests is requested
- **THEN** the second job's id appears before the first one's, and each row contains its line, "en cola" and a text starting with "hace "

#### Scenario: Escapado
- **WHEN** a job's request is `<script>x</script>`
- **THEN** the page contains `&lt;script&gt;x&lt;/script&gt;` and not the raw tag

#### Scenario: Antigüedad
- **WHEN** requestsView is called with now 3 hours after a job's createdAt
- **THEN** that row's age text is "hace 3 h"

### Requirement: Filtros de la lista
The list SHALL accept the GET parameters `line` (a configured line name) and `estado` (`activos` = queued or running, `esperando` = waiting, `terminados` = delivered, failed or stopped, `todos`, the default) and show only matching jobs. The filter form MUST keep the selected values, and an unknown `estado` MUST be treated as `todos`.

#### Scenario: Filtrar por línea
- **WHEN** there is one job in `tienda` and one in `blog` and GET /requests?line=blog is requested
- **THEN** only the `blog` job's id appears in the list

#### Scenario: Filtrar por estado
- **WHEN** there is a queued job and a delivered job and GET /requests?estado=terminados is requested
- **THEN** only the delivered job's id appears in the list

#### Scenario: Estado desconocido
- **WHEN** GET /requests?estado=zzz is requested
- **THEN** the status is 200 and every job appears

### Requirement: Acciones por pedido
Each row SHALL link to `/job/<id>` (detail and trace). A row whose job is `waiting` with a question MUST show the question and approve/reject buttons posting to `/requests/<id>/answer`, which calls `answer` in app.ts and redirects (303) to `/requests`. A row whose job is not final MUST show a stop button posting to `/requests/<id>/stop`. Final jobs MUST show neither answer nor stop buttons.

#### Scenario: Detalle y traza
- **WHEN** GET /requests with one job
- **THEN** its row contains `href="/job/<id>"`

#### Scenario: Responder desde la lista
- **WHEN** a job is waiting on the question "¿Lo integro?" (askOwner before-integrate) and a session POSTs /requests/<id>/answer with decision approve
- **THEN** the list showed "¿Lo integro?", the response is 303 to a location starting with `/requests`, and the job is queued with approvals.integrate true

#### Scenario: Error de respuesta vuelve a la sección
- **WHEN** POST /requests/<id>/answer for a job that is not waiting
- **THEN** the response is 303 to a location starting with `/requests?msg=`

#### Scenario: Terminados sin acciones
- **WHEN** a job has status delivered
- **THEN** its row has no form posting to `/requests/<id>/stop` or `/requests/<id>/answer`

### Requirement: Frenar con confirmación
`POST /requests/<id>/stop` without `confirm=1` SHALL only answer 200 with a confirmation page naming the job and holding a form with `confirm=1` and a link back to `/requests`, without changing the job. With `confirm=1` it MUST call `stop(ctx, id)` from app.ts and redirect (303) to `/requests` with a message.

#### Scenario: Primer toque solo pregunta
- **WHEN** a session POSTs /requests/<id>/stop for a queued job without confirm
- **THEN** the status is 200, the body contains a hidden input `confirm` with value 1 and the job is still queued

#### Scenario: Confirmado frena
- **WHEN** a session POSTs /requests/<id>/stop with confirm=1 for a queued job
- **THEN** the status is 303 to a location starting with `/requests`, and the job's status is stopped
