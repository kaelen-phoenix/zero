# Spec Delta

## ADDED Requirements

### Requirement: Una corrida de checks a la vez por repositorio
La fábrica MUST NOT actualizar un pull request con su rama base ni volver a correr sus checks fallidos mientras conozca otra corrida de checks en marcha en ese repositorio. El pull request que espera MUST quedar trabado con el motivo «espera su turno» y volver a mirarse a los 5 minutos, sin gastar su actualización ni su segunda corrida.

#### Scenario: Qué cuenta como corrida en marcha
- **WHEN** algún check de ese pull request sigue corriendo, otro pull request del repositorio que la fábrica actualizó o volvió a correr no terminó todos sus checks (como mucho 2 horas), u otro entregado en las últimas 2 horas sigue esperando sus checks
- **THEN** la fábrica no empieza nada en ese repositorio

#### Scenario: Un check falla rápido y otro sigue corriendo
- **WHEN** en un pull request falla `ci` y `e2e` todavía corre
- **THEN** la fábrica no actualiza ni vuelve a correr nada, no avisa en el pull request y lo deja esperando los demás checks

#### Scenario: Dos pull requests con checks fallidos sobre la base actual
- **WHEN** dos pull requests del mismo repositorio, al día con su base, tienen corridas fallidas
- **THEN** la fábrica vuelve a correr las del primero y el segundo espera su turno hasta que terminan todos los checks del primero

#### Scenario: Un pull request recién entregado
- **WHEN** un pull request entregado hace minutos espera sus primeros checks y otro del mismo repositorio tiene corridas fallidas
- **THEN** el segundo espera su turno hasta que el primero deja de esperar sus checks
