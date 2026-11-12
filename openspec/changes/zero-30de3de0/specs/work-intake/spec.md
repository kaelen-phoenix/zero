# Spec Delta

## ADDED Requirements

### Requirement: Alertas de Dependabot desactivadas en el repositorio
When reading a line's Dependabot alerts fails with status 403 and the error's message or its `response.data.message` contains "Dependabot alerts are disabled" (case-insensitive), the pass SHALL record as the line's problem (kv `security-alerts.problem.<line>`) a Spanish text saying that Dependabot alerts are disabled in the repository, including the link `https://github.com/<owner>/<repo>/settings/security_analysis` for that line's repository, and it MUST NOT mention the token's permission.

#### Scenario: 403 with alerts disabled
- **WHEN** the fake AlertApi for line demo (repository kaelen/demo) throws an Error('Dependabot alerts are disabled for this repository.') with status 403 and pollSecurityAlerts runs
- **THEN** the kv securityAlertsProblemKey('demo') contains 'desactivadas' and 'https://github.com/kaelen/demo/settings/security_analysis' and does not match /permiso/

#### Scenario: Message only in the response body
- **WHEN** the fake AlertApi throws an error with status 403, message 'Forbidden' and response.data.message 'Dependabot alerts are disabled for this repository.'
- **THEN** the stored problem contains 'https://github.com/kaelen/demo/settings/security_analysis' and does not match /permiso/

#### Scenario: Shown in zero status
- **WHEN** pollSecurityAlerts has stored the disabled-alerts problem for line demo and formatStatus(factoryStatus(ctx)) renders
- **THEN** the output has a line containing 'Alertas de seguridad', 'PROBLEMA' and 'settings/security_analysis'

### Requirement: Mensaje de permisos solo para permisos
A 403 that does not say Dependabot alerts are disabled (and is not a rate limit) MUST keep recording the existing problem that says the token needs read permission for Dependabot alerts. 404 and other errors SHALL keep their current messages, and a rate limit SHALL still end the pass without recording a problem.

#### Scenario: Real permission refusal
- **WHEN** the fake AlertApi throws Error('Resource not accessible by integration') with status 403
- **THEN** the stored problem matches /permiso/ and does not contain 'settings/security_analysis'

#### Scenario: Rate limit unchanged
- **WHEN** the fake AlertApi throws a 403 with header x-ratelimit-remaining '0'
- **THEN** pollSecurityAlerts rejects and no problem is stored
