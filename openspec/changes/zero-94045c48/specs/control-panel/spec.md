# Spec Delta

## Purpose

Los botones del panel (aprobar o rechazar propuestas, pedir trabajo, detener y demás) vuelven a funcionar, tanto en local como desde el celular por el túnel, sin el cartel "Pedido de otro sitio rechazado". Los pedidos que vienen de otros sitios se siguen rechazando, y el panel sigue sin mandar el Referer a otros sitios.

## ADDED Requirements

### Requirement: Política de referrer same-origin
Las respuestas y páginas del panel MUST declarar la política de referrer `same-origin`, tanto en el encabezado `Referrer-Policy` como en el meta `referrer`, y MUST NOT declarar `no-referrer`.

#### Scenario: Encabezado de la respuesta
- **WHEN** se pide `GET /` con una sesión válida
- **THEN** el encabezado `referrer-policy` de la respuesta es exactamente `same-origin`

#### Scenario: Meta de la página
- **WHEN** se lee el HTML de `GET /` con una sesión válida
- **THEN** contiene `<meta name="referrer" content="same-origin">` y no contiene `no-referrer`

### Requirement: Acciones del propio panel aceptadas
Una acción POST con sesión válida SHALL procesarse cuando su `Origin` coincide con el `Host`, o cuando su `Origin` es `null` y `Sec-Fetch-Site` es `same-origin`.

#### Scenario: Origin igual al Host
- **WHEN** se hace `POST /request` con la cookie de sesión y `Origin` igual a la dirección del panel
- **THEN** la respuesta es 303 y queda un trabajo creado

#### Scenario: Origin null del mismo sitio
- **WHEN** se hace `POST /request` con la cookie de sesión, `Origin: null` y `Sec-Fetch-Site: same-origin`
- **THEN** la respuesta es 303 y queda un trabajo creado

### Requirement: Pedidos de otros sitios rechazados
Una acción POST MUST responder 403 sin ejecutar nada cuando su `Origin` es de otro sitio, cuando `Sec-Fetch-Site` indica un origen distinto, o cuando su `Origin` es `null` y `Sec-Fetch-Site` no es `same-origin`.

#### Scenario: Origin null sin Sec-Fetch-Site
- **WHEN** se hace `POST /request` con la cookie de sesión y `Origin: null`, sin `Sec-Fetch-Site`
- **THEN** la respuesta es 403 y no se crea ningún trabajo

#### Scenario: Origin null con Sec-Fetch-Site none
- **WHEN** se hace `POST /request` con la cookie de sesión, `Origin: null` y `Sec-Fetch-Site: none`
- **THEN** la respuesta es 403 y no se crea ningún trabajo

#### Scenario: Origin de otro sitio
- **WHEN** se hace `POST /request` con la cookie de sesión y `Origin: https://evil.example`
- **THEN** la respuesta es 403 y no se crea ningún trabajo

#### Scenario: Origin de otro sitio aunque Sec-Fetch-Site diga same-origin
- **WHEN** se hace `POST /request` con la cookie de sesión, `Origin: https://evil.example` y `Sec-Fetch-Site: same-origin`
- **THEN** la respuesta es 403 y no se crea ningún trabajo

#### Scenario: Sec-Fetch-Site cross-site
- **WHEN** se hace `POST /request` con la cookie de sesión y `Sec-Fetch-Site: cross-site`, con o sin `Origin: null`
- **THEN** la respuesta es 403 y no se crea ningún trabajo
