# Proposal

## Why

The READMEs and the site get a new principle in both languages: "zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional." In English: "zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration." In the README (English and Spanish), it is a new bullet in the principles list of "How it works" / "Cómo funciona". On the site, it is a new translatable paragraph in the Synopsis section, right after the paragraph about delegation, written in the site's third-person voice ("las personas").

## What Changes

- Principle: zero frees people's time
- Supuesto: The site has no section literally called 'principles'. I treated the synopsis, where synopsis.loop already holds the delegation principle, as the place for the site's principles, and the bullet list under 'How it works' as the README's.
- Supuesto: The bullet's bold lead-in ('Time for people.' / 'Tiempo para las personas.') is an assumption to match the list's style. The tests check only the exact principle sentence.
- Supuesto: test/site.test.ts forbids 'trabajo de las personas' and 'work of the people'. The requested texts avoid both, so they must be copied exactly, with no rewording.
- Supuesto: test/wording.test.ts forbids 'owner' in the English README and site, and checks the Spanish wording. The new texts use 'people' and 'las personas', so they comply.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-site`: Principle: zero frees people's time

## Impact

Generado por zero para el trabajo 0187dca2.
