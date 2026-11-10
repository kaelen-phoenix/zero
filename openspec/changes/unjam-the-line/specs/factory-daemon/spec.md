# Spec Delta

## ADDED Requirements

### Requirement: Un registro que no se puede escribir no detiene la fábrica
Cuando una línea del registro no se puede escribir (sin memoria, disco lleno, salida cerrada), la fábrica SHALL descartarla y contarla. MUST NOT lanzar el error a quien registraba ni terminar el proceso por un evento de error de la salida.

#### Scenario: Falla la escritura
- **WHEN** una pasada registra un aviso y la escritura falla con `UNKNOWN: unknown error, write`
- **THEN** la pasada sigue y la fábrica sigue en marcha

#### Scenario: Error diferido de la salida
- **WHEN** la salida de errores del daemon emite un evento `error`
- **THEN** el daemon no termina
