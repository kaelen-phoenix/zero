# Spec Delta

## ADDED Requirements

### Requirement: Base actualizada para pull requests
En las líneas que integran por `pull-request`, cada trabajo nuevo SHALL traer la rama base del remoto y arrancar desde ella, sin modificar la rama local del dueño. Si el remoto no responde, SHALL arrancar desde la rama local y registrarlo. Los cambios del trabajo SHALL medirse contra el punto de partida, aunque la rama del remoto avance después.

#### Scenario: Pull request aceptado en GitHub
- **WHEN** el dueño aceptó en GitHub un pull request que la rama local todavía no tiene, y pide otro trabajo
- **THEN** el nuevo trabajo parte de la rama base de GitHub, y su pull request solo contiene sus propios cambios
