# Spec Delta

## Purpose

El repositorio va a tener un archivo corto, TRADEMARK.md, escrito en inglés como la licencia. Explica qué puede hacer cualquiera con el nombre «zero in the loop» y sus logos, y qué necesita permiso. Cualquiera puede bifurcar el código, decir que algo «funciona con zero in the loop» y hablar del proyecto. Sin permiso, nadie puede publicar un producto o servicio derivado con ese nombre o con el logo, ni presentarlo como oficial. El archivo no cambia la licencia Apache-2.0 y aclara que no reclama la palabra «zero» sola. Tampoco dice que la marca esté registrada, porque hoy no hay constancia de que lo esté. Los dos README van a tener una sección final, «Licencia y marca», que lo resume y lo enlaza. Es un borrador técnico y no asesoramiento legal: conviene que lo revise un abogado o un agente de propiedad industrial antes de apoyarse en él. El registro en el INPI no se hace con este cambio: esa decisión y ese trámite te quedan a vos.

## ADDED Requirements

### Requirement: Archivo de política de marca
The repository MUST contain a file `TRADEMARK.md` at its root, in English, that names the covered marks: the name "zero in the loop" and the project's logos, which it locates in `site/brand/`.

#### Scenario: El archivo existe y nombra las marcas
- **WHEN** se lee `TRADEMARK.md` de la raíz del repositorio
- **THEN** tiene un título de primer nivel y contiene "zero in the loop", "logo" y `site/brand/`

### Requirement: Marca y licencia separadas
`TRADEMARK.md` MUST state that the code's license is Apache-2.0, that its section 6 grants no permission to use the marks, and that the policy does not change or restrict the rights the license gives over the code.

#### Scenario: La política remite a la licencia
- **WHEN** se lee `TRADEMARK.md`
- **THEN** contiene "Apache-2.0", un enlace a `LICENSE`, menciona "section 6" y dice que la política no cambia la licencia del código

#### Scenario: La licencia queda como estaba
- **WHEN** se leen `LICENSE` y `package.json` después del cambio
- **THEN** `LICENSE` conserva su sección "6. Trademarks" y `package.json` sigue declarando `"license": "Apache-2.0"`

### Requirement: Usos permitidos sin pedir permiso
`TRADEMARK.md` MUST list under its own heading the uses allowed without permission: forking and modifying the code; naming the project to describe it, its origin or compatibility with it (for example "works with zero in the loop"); redistributing unmodified copies under the name; keeping technical identifiers such as the `zero` command for compatibility; and the "built with" signature zero adds to what it builds, without that meaning endorsement.

#### Scenario: Los usos permitidos son una lista
- **WHEN** se lee la sección de usos permitidos de `TRADEMARK.md`
- **THEN** tiene una lista con viñetas que nombra los forks, "works with zero in the loop", las copias sin modificar, el comando `zero` y la firma

### Requirement: Usos que necesitan permiso
`TRADEMARK.md` MUST list under its own heading the uses that need prior written permission: using "zero in the loop", a confusingly similar name or the logos as the name or branding of a derived product, fork or service (including hosted services and training), and suggesting an official edition, endorsement or affiliation; it MUST also say that whoever distributes a modified version uses another name and removes the logos.

#### Scenario: Los usos con permiso son una lista separada
- **WHEN** se lee la sección de usos que necesitan permiso de `TRADEMARK.md`
- **THEN** está bajo un encabezado distinto del de los usos permitidos, tiene viñetas que nombran productos, servicios administrados (hosted), capacitaciones (training), logos y aval oficial (official), y dice que una versión modificada que se distribuye usa otro nombre

### Requirement: Sin promesas de más
`TRADEMARK.md` MUST say that it claims no exclusivity over the generic word "zero" on its own and that it is not legal advice, and MUST NOT present the marks as registered.

#### Scenario: La palabra genérica queda afuera
- **WHEN** se lee `TRADEMARK.md`
- **THEN** dice que no reclama exclusividad sobre la palabra "zero" sola y que no es asesoramiento legal ("not legal advice")

#### Scenario: No dice que haya registro
- **WHEN** se busca en `TRADEMARK.md`
- **THEN** no aparece el símbolo ® ni la expresión "registered trademark"

### Requirement: Cómo pedir permiso
`TRADEMARK.md` MUST say how to ask for permission by pointing to the contact section of https://zerointheloop.com, without publishing an email address or a phone number.

#### Scenario: El contacto es el del sitio
- **WHEN** se lee `TRADEMARK.md`
- **THEN** contiene `https://zerointheloop.com/#contact` y no contiene `mailto:`, ninguna dirección de correo ni `wa.me`

### Requirement: Resumen en los dos README
`README.md` and `README.es.md` MUST end with a second-level section ("## License and trademark" and "## Licencia y marca" respectively) that links `LICENSE` and `TRADEMARK.md` and summarizes that the code is Apache-2.0 and that the name and logos are covered by the policy.

#### Scenario: La sección está al final de los dos
- **WHEN** se leen los encabezados `## ` de los dos README
- **THEN** el último es `## License and trademark` en inglés y `## Licencia y marca` en español, y cada sección contiene `](LICENSE)`, `](TRADEMARK.md)` y "Apache-2.0"

#### Scenario: La estructura sigue igual en los dos
- **WHEN** corren los tests existentes de los README
- **THEN** los niveles de encabezado y los bloques de código siguen coincidiendo, y las secciones de próximas etapas siguen siendo listas

### Requirement: Redacción para personas
`TRADEMARK.md` MUST follow the repository's wording: it does not use the word owner and it does not mention the company outside the repository's GitHub address.

#### Scenario: Sin palabras prohibidas
- **WHEN** se lee `TRADEMARK.md` quitando `github.com/kaelen-phoenix/zero`
- **THEN** no coincide con `/\bowner/i` ni con `/kaelen/i`

### Requirement: Guía para agentes
`docs/agents/site.md` MUST say, in its entry about `site/brand/`, that the use of the logos is governed by `TRADEMARK.md`.

#### Scenario: La entrada de los logos remite a la política
- **WHEN** se lee la viñeta de `site/brand/` en `docs/agents/site.md`
- **THEN** contiene `TRADEMARK.md`
