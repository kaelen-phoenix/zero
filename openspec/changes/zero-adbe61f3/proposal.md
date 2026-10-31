# Proposal

## Why

Las revisiones (review, security y los agentes revisores propios) van a dar una confianza del 1 al 10 en cada hallazgo. Zero, no el motor, decide: un hallazgo grave con confianza menor que 8 ya no devuelve el trabajo a build ni gasta un intento. Igual queda registrado: el span de la estación (lo que se ve en `zero trace`) cuenta cuántos hallazgos se dejaron de lado por baja confianza, así como hoy cuenta las citas inválidas. La estación security además recibe una lista explícita de cosas que no debe reportar porque casi siempre son ruido: denegación de servicio, rate limiting, agotamiento de CPU o memoria, open redirect y validación genérica sin impacto demostrado. La excepción es cuando el cambio quita una protección que ya existía. Todo empieza con un change de OpenSpec y lleva tests del filtro.

Pedido original: "Security y review: confianza por hallazgo y exclusiones de falsos positivos, impuestas por zero Por qué: La nota de investigación 51b67981 (fuentes: https://github.com/anthropics/claude-code-security-review y su wiki) describe la metodología de /security-review de Anthropic: cada hallazgo lleva una confianza y una segunda pasada descarta clases de ruido (DoS, rate limiting, open redirect, validación sin impacto demostrado). Hoy src/line/review.ts:10 solo valida `severity` y la cita (citationValid). agents/security.md:15 no pide ninguna confianza ni lista exclusiones. Por eso un hallazgo especulativo de severidad alta puede devolver un trabajo y gastar intentos. En el digest ya hay trabajos con varios intentos (bcb38c2e, 6c008475). Qué cambiaría: Empezar con un change de OpenSpec. Añadir al esquema de hallazgos de review.ts un campo `confidence` entero de 1 a 10. Zero, no el motor, deja de contar como bloqueante cualquier hallazgo con confianza menor que 8: se registra en el span y en el informe, pero no devuelve el trabajo. Es el mismo criterio que ya se aplica a las citas inválidas. En agents/security.md y agents/review.md, pedir la confianza. En agents/security.md, añadir la lista explícita de exclusiones (DoS, rate limiting, agotamiento de CPU o memoria, open redirect, validación genérica sin impacto demostrado), salvo cuando el cambio quite una protección existente. Tests en test/ para el filtro por confianza. No se instala nada de terceros: es una implementación propia."

## What Changes

- Confianza por hallazgo y exclusiones de falsos positivos en review y security
- Supuesto: The request says the low-confidence findings are recorded 'en el span y en el informe'. Today zero keeps no per-finding report: invalid citations are only counted on the span. This spec reads 'informe' as the station span seen in `zero trace` (attribute zero.findings.low_confidence) and records nothing in the townhall. If the owner meant a written report, that is a follow-up.
- Supuesto: Confidence is required in the schema. An engine that leaves it out fails schema validation, and the review counts as 'could not complete', which costs an attempt. This is the strict choice: treating a missing confidence as low would let a non-compliant engine get around blocking.
- Supuesto: Custom agents also use ReviewSchema, so their findings now need confidence too, and a blocking custom agent's findings below 8 stop blocking. That is consistent, but the owner's own instructions for those agents may not mention confidence. The schema's describe() text is the only thing that tells them.
- Supuesto: The exclusions only steer the engine: zero cannot check whether a finding falls into an excluded class. What zero enforces is the confidence threshold.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Confianza por hallazgo y exclusiones de falsos positivos en review y security

## Impact

Generado por zero para el trabajo adbe61f3.
