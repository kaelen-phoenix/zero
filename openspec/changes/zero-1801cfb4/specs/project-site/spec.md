# Spec Delta

## MODIFIED Requirements

### Requirement: Factual content only
The site content MUST come from what zero does today according to the README. It MUST name the stations spec, build, verify, review, security and integrate; the levels L0, L1, L2 and L3; the per-line autonomies propose, build and auto; the scout and research stations; and the guarantees (protected paths, verification, secrets outside files, isolation box). It MUST contain no metrics, star counts, customers or testimonials. Future items MUST be labelled 'en camino' / 'coming'; the requests from Linear are available today and MUST be labelled 'disponible' / 'available', while the requests from Jira stay 'en camino'.

#### Scenario: Facts present
- **WHEN** index.html is read
- **THEN** it contains spec, build, verify, review, security, integrate, L0, L1, L2, L3, propose, auto, scout and research

#### Scenario: Future items labelled
- **WHEN** an item from the site's 'Próximas etapas' list (e.g. the requests from Jira) appears
- **THEN** it is marked with an element carrying the text 'en camino' (ES) / 'coming' (EN)

#### Scenario: Available features are not labelled
- **WHEN** the lines of index.html that carry class="soon" are read
- **THEN** none of them mentions OTLP, since sending traces to a collector is available today

#### Scenario: Linear available
- **WHEN** the 'Próximas etapas' list of index.html is read
- **THEN** no line with class="soon" mentions Linear, its Linear item carries a 'disponible' mark whose EN translation is 'available', and a line with class="soon" mentions Jira
