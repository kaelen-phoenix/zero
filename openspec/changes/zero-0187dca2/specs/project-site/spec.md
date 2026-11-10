# Spec Delta

## ADDED Requirements

### Requirement: Principio del tiempo liberado en los README
README.md and README.es.md MUST each carry, as a bullet of the principles list in the 'How it works' / 'Cómo funciona' section, the principle that zero automates software development with AI and frees people's time. The English text SHALL be exactly "zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration." and the Spanish text exactly "zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional." Both READMEs MUST keep the same heading structure.

#### Scenario: Principio en el README en inglés
- **WHEN** the '## How it works' section of README.md is read, up to the next '## ' heading
- **THEN** one line starting with '- ' contains "zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration."

#### Scenario: Principio en el README en español
- **WHEN** the '## Cómo funciona' section of README.es.md is read, up to the next '## ' heading
- **THEN** one line starting with '- ' contains 'zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional.'

#### Scenario: Misma estructura
- **WHEN** the existing docs tests run (same heading levels in the same order, same code blocks)
- **THEN** they pass

### Requirement: Principio del tiempo liberado en el sitio
site/index.html SHALL have, in the synopsis section, a paragraph under the translatable key synopsis.time placed right after synopsis.loop. Its Spanish markup text MUST be exactly 'zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional.' EN['synopsis.time'] in site/main.js MUST be exactly "zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration."

#### Scenario: Párrafo en la sinopsis en español
- **WHEN** the synopsis section of site/index.html is searched for the element data-i18n="synopsis.time"
- **THEN** it exists, its text equals the Spanish principle, and it contains 'las personas'

#### Scenario: Después del relato de la delegación
- **WHEN** the positions of data-i18n="synopsis.loop" and data-i18n="synopsis.time" in the synopsis section are compared
- **THEN** synopsis.time comes after synopsis.loop

#### Scenario: Versión en inglés
- **WHEN** EN['synopsis.time'] is read from site/main.js
- **THEN** it equals the English principle

#### Scenario: Traducción completa y sin frases prohibidas
- **WHEN** the existing site tests run: every key has its English entry, EN has no extra keys, switching to English and back to Spanish restores the text, and the forbidden replacement phrases are absent
- **THEN** they pass with synopsis.time included
