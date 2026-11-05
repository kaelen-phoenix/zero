# Proposal

## Why

Cada trabajo nuevo va a escribir sus requisitos con nombres que no chocan con los que ya existen en esa capacidad, ni entre sí. Si un nombre ya está en uso, zero le agrega ` (<id del trabajo>)` sin volver a llamar al modelo, así que un trabajo desatendido no se cae por esto. Con eso, `openspec archive` deja de fallar con `ADDED failed ... already exists` por estos trabajos y ya no hace falta renombrar títulos a mano al consolidar. Los changes que ya están repetidos no se tocan.

## What Changes

- Nombres de requisito únicos en la estación spec
- Supuesto: Supuesto: el pedido no dice qué hacer cuando el sufijo ` (<id>)` también está tomado, por ejemplo con tres requisitos iguales. Se usa ` (<id>-<n>)` como desempate porque sin él el choque seguiría.
- Supuesto: Supuesto: dentro del pedido, el primer requisito conserva su nombre si no choca con la capacidad, y solo los siguientes reciben el sufijo.
- Supuesto: Límite: la función solo ve lo que está en la copia de trabajo. Dos trabajos con ramas o pull requests sin integrar todavía pueden repetir un nombre entre sí y chocar al archivar.
- Supuesto: Límite: el delta sigue siendo siempre `ADDED`. Un requisito que en realidad quería modificar a uno existente queda como otro requisito con sufijo, en lugar de fallar al archivar.
- Supuesto: Supuesto: se cuentan todos los encabezados `### Requirement:`, también los de secciones MODIFIED o REMOVED y los de bloques de código. Puede agregar un sufijo de más, pero no deja pasar un choque. Las líneas `TO:` de RENAMED no se cuentan porque hoy ningún change de este repositorio las usa.
- Supuesto: Los títulos con sufijo también aparecen en lo que ve la persona a cargo, como `plainSpec`.
- Supuesto: Estas verificaciones no se pudieron ejecutar en esta estación porque no tenía permiso para correr comandos. El comportamiento de `openspec archive` sale de leer `specs-apply.js`, y lo confirma la prueba con el binario real.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Nombres de requisito únicos en la estación spec

## Impact

Generado por zero para el trabajo 2ca47fdc.
