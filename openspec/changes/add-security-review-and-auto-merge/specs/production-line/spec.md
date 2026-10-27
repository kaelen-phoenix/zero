# Spec Delta

## ADDED Requirements

### Requirement: Revisión de seguridad
Después de `review`, cada trabajo SHALL pasar por la estación `security`, de solo lectura, con instrucciones propias centradas en seguridad. Sus hallazgos SHALL verificarse como los de `review`: zero SHALL descartar los que citen archivos o líneas inexistentes, y SHALL rechazar el intento si queda algún hallazgo verificado `high` o `critical`, devolviéndolo a `build` como retroalimentación. El motor de `security` SHALL poder configurarse aparte del de las otras estaciones.

#### Scenario: Secreto en el código
- **WHEN** el cambio agrega una credencial escrita en el código y `security` lo reporta como `critical` citando el archivo y la línea
- **THEN** el intento se rechaza y el siguiente `build` recibe el hallazgo

#### Scenario: Seguridad modifica archivos
- **WHEN** el agente de `security` crea o modifica archivos
- **THEN** esos cambios se descartan antes de continuar

### Requirement: Fusión automática
En una línea `pull-request` con `autoMerge: true`, la fábrica SHALL fundir el pull request de cada trabajo cuando todos sus checks de GitHub terminaron con éxito y GitHub lo declara fundible, y SHALL borrar su rama. MUST NOT fundirlo si algún check falla, si hay conflictos o si el pull request ya no está abierto: en esos casos SHALL dejarlo como está y avisarlo una vez. Si el trabajo vino de un issue, el issue SHALL recibir un comentario al fundirse.

#### Scenario: Checks en verde
- **WHEN** el pull request de un trabajo tiene todos sus checks en verde y no tiene conflictos
- **THEN** la fábrica lo funde, borra la rama y comenta en el issue que se fundió

#### Scenario: Check fallido
- **WHEN** un check del pull request termina con error
- **THEN** la fábrica no lo funde, lo deja abierto y avisa una vez cuál check falló

#### Scenario: Línea sin fusión automática
- **WHEN** la línea es `pull-request` sin `autoMerge`
- **THEN** la fábrica abre el pull request y no lo funde

## MODIFIED Requirements

### Requirement: Estaciones de la línea
Cada trabajo SHALL recorrer en orden las estaciones `spec`, `build`, `verify`, `review`, `security` e `integrate`, en una copia de trabajo propia del repositorio de la línea y en una rama propia del trabajo.

#### Scenario: Copia aislada por trabajo
- **WHEN** empieza un trabajo
- **THEN** se crea una copia de trabajo separada en una rama `zero/<trabajo>` a partir de la rama base de la línea, sin tocar la copia del dueño

### Requirement: Estaciones de solo lectura
Las estaciones `spec`, `review` y `security` MUST NOT modificar la copia de trabajo. Si un motor la modifica igualmente, zero SHALL descartar esos cambios.

#### Scenario: Motor que escribe en review
- **WHEN** el agente de `review` crea o modifica archivos
- **THEN** esos cambios se descartan antes de continuar
