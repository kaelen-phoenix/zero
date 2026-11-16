# Proposal

## Why

Con este cambio, la fábrica aprende de la traba de Yalope del 15/11: - Una corrida de CI cancelada porque otra más nueva le ganó en el mismo grupo de concurrencia ya no cuenta como fallo del código. La fábrica la relanza sola, de a una por repositorio y en orden. Tampoco funde un pull request mientras otro pull request del mismo repositorio tiene un check en cola sin arrancar, porque la corrida de main que dispara la fusión se lo cancelaría. - Cuando mezcla main en una rama, la fábrica resuelve sin llamar a ningún modelo los conflictos simples: unir líneas de import, o quedarse con los dos lados cuando ambos solo agregan líneas en el mismo lugar. Después pasa igual por verify. Lo que no es simple sigue yendo a la estación build, como hasta ahora. - Llega el tren de integración: `zero tren <línea> [números de pull request]`. La fábrica ordena los pull requests trabados de la línea y funde uno solo a la vez, recién con todos los checks en verde. Después actualiza el siguiente con main, resuelve sus conflictos en la rama del mismo pull request, espera sus checks y sigue. Los demás esperan su turno. El tren también toma pull requests que la fábrica no abrió, de la línea o tuyos. Los funde solo en el commit que verificó y nunca en rojo. `zero fusionar` también va a fundir un pull request verde de la línea aunque no lo haya entregado la fábrica. - La estación de destrabe también corre de día, aunque haya trabajos en marcha, cuando un pull request lleva bloqueado más de 2 horas (configurable). Para eso tiene que haber un lugar libre, ningún pedido tuyo esperando, presupuesto y una vez por línea en ese plazo. Puede decidir arrancar el tren de la línea. - Cuando la fábrica no puede, `zero status` y el panel dicen exactamente qué falta y quién tiene que hacerlo: vos, quien abrió el pull request, GitHub o la fábrica. No pude investigar en la web los agentes que nombraste (pr-babysitter, aieng-bot, pr-fix, Pullfrog, gh-fix-ci) porque esta corrida no tiene acceso a internet. Por eso el cambio no copia código de terceros, y esa evaluación queda como tarea pendiente.

## What Changes

- Destrabe que arma trenes de integración, resuelve conflictos simples y relanza corridas canceladas
- Supuesto: No hubo acceso a la web: no se verificó la licencia ni el estado de pr-babysitter, aieng-bot, pr-fix (githubnext/agentics), Pullfrog ni gh-fix-ci. Por eso no se copia código de terceros y no se crea THIRD-PARTY-NOTICES.md. Las ideas (relanzar de a una, fundir en orden) se implementan con código propio.
- Supuesto: Los grupos de concurrencia se reconocen por la conclusión `cancelled` de GitHub, no leyendo `.github/workflows`. Una cancelación manual también se relanza, como mucho 3 veces por tip.
- Supuesto: Supuesto: un pull request en el tren autoriza a la fábrica a fundirlo aunque la línea no tenga autoMerge, porque quien está a cargo lo pidió con `zero tren` o lo decidió el destrabe en build/auto. Y solo cuando `mergeDecision` da `merge`.
- Supuesto: La resolución mecánica puede dar un archivo que compila mal, por ejemplo con imports duplicados por alias. Verify y los checks lo atajan, pero cuesta un intento de verify.
- Supuesto: Que `zero fusionar` acepte pull requests verdes no entregados por la fábrica amplía lo que puede fundir el chat. En el chat remoto, `zero_merge` ya queda retenido hasta que se confirme.
- Supuesto: Al pasar a ser cabeza del tren, se reinician los contadores de resolución y de refresco. Eso puede gastar más intentos en un pull request que nunca va a cerrar. Lo acotan el tope del destrabe y `maxAttempts`.
- Supuesto: Las etapas 3 a 6 tocan `watch`, que ya es una función grande. Hay riesgo de romper los tests de automerge existentes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Destrabe que arma trenes de integración, resuelve conflictos simples y relanza corridas canceladas

## Impact

Generado por zero para el trabajo 2547f9dc.
