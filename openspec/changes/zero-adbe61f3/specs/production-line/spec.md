# Spec Delta

## ADDED Requirements

### Requirement: Confianza obligatoria en cada hallazgo
The review schema (`ReviewSchema` in src/line/review.ts) MUST require every finding to carry a `confidence` field that is an integer from 1 to 10. Output whose findings lack it, or carry a non-integer or out-of-range value, SHALL fail schema validation.

#### Scenario: Confianza válida
- **WHEN** ReviewSchema parses a finding with severity, file, line, problem, fix and confidence 9
- **THEN** parsing succeeds and the finding keeps confidence 9

#### Scenario: Confianza ausente o fuera de rango
- **WHEN** ReviewSchema parses a finding without confidence, or with confidence 0, 11 or 7.5
- **THEN** parsing fails

### Requirement: Solo bloquean hallazgos con confianza alta
zero SHALL count a finding as blocking only when its citation is valid, its severity is `high` or `critical` and its confidence is 8 or more. A verified high or critical finding with confidence below 8 MUST NOT reject the attempt.

#### Scenario: Grave pero especulativo
- **WHEN** blockingFindings receives verified findings: critical with confidence 7, high with confidence 8, high with confidence 10, low with confidence 10
- **THEN** it returns only the two high findings with confidence 8 and 10

#### Scenario: Trabajo no devuelto
- **WHEN** in a runner test the review station returns one verified critical finding with confidence 5 and security returns no findings
- **THEN** the job is delivered on attempt 1 and build is called only once

#### Scenario: Trabajo devuelto con confianza alta
- **WHEN** in a runner test the review station returns, on the first call, a verified critical finding with confidence 9
- **THEN** attempt 1 is rejected and build's second prompt contains that finding's problem

### Requirement: Hallazgos de baja confianza registrados
For each review, security or custom-agent run, zero SHALL record on the station span the attribute `zero.findings.low_confidence`: the number of verified high or critical findings that were not counted as blocking because their confidence was below 8. The existing `zero.findings` and `zero.citations.invalid` attributes MUST keep their current meaning.

#### Scenario: Conteo en el span
- **WHEN** the review station returns two verified high findings with confidence 3 and 6 and one invented citation
- **THEN** the zero.station.review span has zero.findings.low_confidence 2, zero.findings 2 and zero.citations.invalid 1

### Requirement: Retroalimentación con confianza
The feedback build receives for blocking findings (`findingsFeedback`) SHALL include each finding's confidence, and it MUST list only blocking findings, never low-confidence ones.

#### Scenario: Texto de retroalimentación
- **WHEN** findingsFeedback receives a high finding at src/a.ts:3 with confidence 9
- **THEN** the text contains 'src/a.ts:3' and the confidence 9 (e.g. '[high, confianza 9]')

### Requirement: Instrucciones piden la confianza
agents/review.md and agents/security.md MUST tell the station to give each finding a `confidence` from 1 to 10, and state that zero blocks only on findings with confidence 8 or more.

#### Scenario: Texto presente
- **WHEN** a test reads agents/review.md and agents/security.md
- **THEN** both contain the word `confidence` and the number 8

### Requirement: Exclusiones de seguridad
agents/security.md MUST list explicit exclusions that the station must not report: denial of service, rate limiting, CPU or memory exhaustion, open redirect, and generic input validation without demonstrated impact. It SHALL make an exception when the change removes or weakens an existing protection.

#### Scenario: Lista de exclusiones
- **WHEN** a test reads agents/security.md
- **THEN** it mentions denial of service (DoS), rate limiting, memory/CPU exhaustion, open redirect and validation without demonstrated impact, plus the exception for removed existing protections
