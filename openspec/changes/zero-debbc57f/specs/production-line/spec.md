# Spec Delta

## ADDED Requirements

### Requirement: Esquema estricto para codex
Antes de escribir schema.json, el motor codex MUST convertir el JSON Schema de la estación al formato estricto de OpenAI: en cada objeto (raíz, anidados, items de arrays, ramas de anyOf/oneOf y entradas de $defs/definitions), additionalProperties es false y required lista todas las claves de properties.

#### Scenario: Objeto anidado con opcional en un array
- **WHEN** se convierte un esquema con `drafts: array de objetos {text requerido, image opcional}`
- **THEN** `drafts.items.required` contiene `text` e `image`, y `drafts.items.additionalProperties` es false

#### Scenario: Objetos dentro de uniones y defs
- **WHEN** se convierte un esquema con objetos dentro de anyOf, oneOf y $defs
- **THEN** todos esos objetos cumplen las mismas reglas, comprobado por un verificador de la prueba que recorre el esquema entero sin usar el código de la conversión

#### Scenario: Archivo que recibe codex
- **WHEN** codexEngine.run recibe un esquema con opcionales y un codex falso lee la ruta de --output-schema
- **THEN** el archivo contiene el esquema convertido, no el original

### Requirement: Opcionales nullable en el esquema estricto
Una propiedad que no estaba en required en el esquema original MUST aceptar null en el esquema convertido, sin duplicar null si ya lo aceptaba y sin perder sus valores permitidos, incluidos enum, const y $ref.

#### Scenario: Opcional de texto
- **WHEN** se convierte una propiedad opcional de tipo string
- **THEN** el esquema convertido acepta string y null

#### Scenario: Opcional enum
- **WHEN** se convierte una propiedad opcional con enum ["a","b"]
- **THEN** el esquema convertido acepta "a", "b" y null

#### Scenario: Opcional que ya era nullable
- **WHEN** se convierte `z.string().nullable().optional()`
- **THEN** null aparece una sola vez entre las alternativas

#### Scenario: Opcional con referencia
- **WHEN** se convierte una propiedad opcional definida con $ref
- **THEN** el resultado es un anyOf con el $ref y `{type: "null"}`, y no hay claves junto al $ref

### Requirement: Palabras clave no admitidas
La conversión MUST quitar lo que el modo estricto no admite (default, minLength, maxLength, pattern, examples, propertyNames, uniqueItems, los format fuera de la lista documentada por OpenAI y otras palabras clave fuera de esa lista), MUST cambiar oneOf por anyOf y MUST conservar description.

#### Scenario: Default y description
- **WHEN** se convierte una propiedad con default y description
- **THEN** el resultado no tiene default y conserva la description

#### Scenario: Description de un opcional
- **WHEN** se convierte una propiedad opcional con description
- **THEN** la description sigue en el esquema de esa propiedad

#### Scenario: Description junto a una referencia
- **WHEN** se convierte una propiedad requerida con $ref y description
- **THEN** ningún objeto del resultado tiene $ref junto a otra clave, y la description se conserva en un anyOf que envuelve el $ref

#### Scenario: oneOf y restricciones de texto
- **WHEN** se convierte un esquema con oneOf y con strings con minLength o format uri
- **THEN** el resultado no contiene oneOf, minLength ni format uri

#### Scenario: Restricciones documentadas
- **WHEN** se convierte un esquema con minimum, maximum y minItems
- **THEN** esas restricciones se conservan

### Requirement: Respuesta sin los null de opcionales
Cuando hay esquema y el último mensaje de codex es JSON, el motor MUST devolver en EngineResult.output ese JSON sin las propiedades con null que eran opcionales en el esquema original, recorriendo objetos anidados, arrays, uniones y referencias, y MUST conservar los null de las propiedades requeridas.

#### Scenario: Vuelve a validar con el esquema original
- **WHEN** codex responde con `image: null` en un elemento de `drafts`, y el esquema zod declara `image` como opcional
- **THEN** output no tiene la clave `image` en ese elemento y el esquema zod original lo valida

#### Scenario: Null legítimo
- **WHEN** una propiedad requerida y nullable llega con null, como `researchNote` e `issue` de scout
- **THEN** output conserva el null y el esquema zod lo acepta

#### Scenario: Rama de una unión
- **WHEN** la respuesta trae `{k: "y", v: null}`, y la unión tiene las ramas `{k: "x"}` y `{k: "y", v?: number}`
- **THEN** se elige la primera rama cuya forma estricta acepta el valor, output es `{k: "y"}` y valida

#### Scenario: Referencia recursiva
- **WHEN** un esquema recursivo con $ref a la raíz o a $defs trae null en un opcional anidado
- **THEN** ese null se quita en todos los niveles

#### Scenario: Valor presente
- **WHEN** una propiedad opcional llega con un valor distinto de null
- **THEN** output conserva ese valor

### Requirement: Respuesta que no es JSON
Cuando el último mensaje de codex no es JSON, el motor MUST devolver el texto sin output, para que la validación del runner decida como hasta ahora, y MUST NOT lanzar una excepción.

#### Scenario: Texto libre
- **WHEN** hay esquema y el último mensaje es `no pude`
- **THEN** el resultado es `{ok: true, text: "no pude"}` sin output

#### Scenario: Sin esquema
- **WHEN** no hay esquema y el último mensaje es JSON con null
- **THEN** no se pasa --output-schema, el resultado no tiene output y el texto queda igual

### Requirement: Esquemas reales de las estaciones
Los esquemas ScoutOutput, ReviewSchema y ResearchOutput, generados con toEngineSchema, MUST cumplir las reglas estrictas una vez convertidos, y una respuesta válida con null MUST validar con su esquema zod original después de pasar por el motor.

#### Scenario: Scout
- **WHEN** se convierte ScoutOutput y una propuesta vuelve con researchNote e issue en null
- **THEN** el esquema convertido pasa el verificador, no contiene default ni minLength, y ScoutOutput valida la respuesta

#### Scenario: Review
- **WHEN** se convierte ReviewSchema y vuelve una respuesta con findings y learnings
- **THEN** el esquema convertido pasa el verificador, conserva las description y ReviewSchema valida la respuesta

#### Scenario: Research
- **WHEN** se convierte ResearchOutput y vuelve una respuesta con notes
- **THEN** el esquema convertido pasa el verificador y ResearchOutput valida la respuesta

### Requirement: Esquemas sin equivalente estricto
Cuando un esquema no se puede expresar en modo estricto (raíz que no es objeto, additionalProperties con un esquema no vacío, objeto abierto sin properties, array sin items, prefixItems, allOf o subesquema vacío), el motor codex MUST devolver ok false con un mensaje que nombre la ruta del problema, y MUST NOT iniciar el proceso codex.

#### Scenario: Diccionario
- **WHEN** una estación pide `z.object({m: z.record(z.string(), z.number())})`
- **THEN** el resultado es ok false, el texto nombra `m`, y el codex falso no se ejecutó

#### Scenario: Raíz que no es objeto
- **WHEN** el esquema raíz es un array o una unión
- **THEN** el resultado es ok false y el codex falso no se ejecutó

#### Scenario: Valor libre
- **WHEN** una propiedad es `z.unknown()`
- **THEN** el resultado es ok false y el texto nombra esa propiedad

#### Scenario: Objeto suelto con propiedades
- **WHEN** se convierte `z.looseObject({a: z.string()})`, con additionalProperties vacío y properties declaradas
- **THEN** la conversión lo acepta y deja additionalProperties en false

### Requirement: Otros motores sin cambios
La conversión MUST aplicarse solo en el motor codex: el esquema de EngineRequest MUST NOT modificarse, y Claude, Antigravity y los motores propios MUST seguir recibiendo el esquema original.

#### Scenario: Sin mutación
- **WHEN** codexEngine.run termina con un esquema con opcionales
- **THEN** el objeto req.schema es igual a una copia profunda tomada antes de la llamada

#### Scenario: Antigravity
- **WHEN** createAgentRunner corre una estación con esquema y un motor sin nativeSchema
- **THEN** el prompt contiene el esquema original, con los opcionales fuera de required
