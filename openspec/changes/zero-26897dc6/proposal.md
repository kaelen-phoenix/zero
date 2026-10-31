# Proposal

## Why

El repositorio de zero suma dos herramientas de calidad gratuitas de GitHub. CodeQL busca problemas de seguridad en el código JavaScript/TypeScript en cada pull request y en cada push a main. Aparece en el pull request como un check más, así que la fusión automática (autoMerge) espera a que pase y no funde si falla. Dependabot revisa una vez por semana las dependencias de npm y las acciones de GitHub, y abre pull requests cuando hay versiones nuevas. SonarCloud no se agrega todavía, porque primero el dueño tiene que crear la cuenta. La sección del README sobre CI y herramientas de calidad, en inglés y en español, cuenta qué usa este repositorio. Unas pruebas automáticas comprueban los dos archivos de configuración y el texto.

Pedido original: "Calidad en el CI del repo de zero (público): sumar CodeQL (análisis de seguridad de GitHub, gratis en repos públicos) para JavaScript/TypeScript en cada pull request y en main, y Dependabot (.github/dependabot.yml) para npm y GitHub Actions, semanal. Que el check de CodeQL quede como un check más, así autoMerge espera que pase. No agregar SonarCloud todavía (necesita que el dueño cree la cuenta). Documentarlo en la sección del README sobre CI y herramientas de calidad (inglés y español)."

## What Changes

- CodeQL y Dependabot en el CI de zero
- Supuesto: The default protectedPaths include '.github/**' (src/config.ts:189). If this line keeps that default, the job's diff touches a protected path and the job will wait for the owner's approval before integrating. That is expected, not a failure.
- Supuesto: The CodeQL check only becomes a check autoMerge waits for once the workflow is on main and runs on the PR head. Making it required in branch protection is a GitHub setting the owner changes; this change does not touch it.
- Supuesto: Assumes 'build-mode: none' (no compile needed for JS/TS) and codeql-action v3. If GitHub has moved to a newer major version, the test should accept v3 or later.
- Supuesto: Once this is merged, Dependabot's weekly PRs will show up as ordinary pull requests in the repository. zero does not treat them specially.

## Capabilities

### New Capabilities
- `project-ci`: CodeQL y Dependabot en el CI de zero

### Modified Capabilities

## Impact

Generado por zero para el trabajo 26897dc6.
