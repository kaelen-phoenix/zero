# Spec Delta

## ADDED Requirements

### Requirement: Control de dependencias apagado por defecto
Each line MUST have a `checkDependencies` boolean in the factory file that defaults to false. While it is false, zero SHALL make no request to OSV or deps.dev for that line's jobs, and the attempt SHALL go from verify to review exactly as before.

#### Scenario: Valor por defecto
- **WHEN** the factory file is parsed with a line that does not set checkDependencies
- **THEN** that line's `checkDependencies` is false

#### Scenario: Línea apagada no consulta
- **WHEN** a job on a line with checkDependencies false adds a dependency to package.json and package-lock.json, and the runner is given a fake fetch
- **THEN** the fake fetch is never called and review runs

### Requirement: Dependencias nuevas contra la base
With `checkDependencies` on, zero SHALL compare every package.json and package-lock.json the branch adds or modifies (in any folder) with the same file at the merge base of `copy.base` and HEAD, read with git and never from the working tree. The new dependencies MUST be: (a) the `name@version` pairs in a lock's `packages` map (lockfileVersion 2 or 3) that are missing from the base lock, using the entry's `name` when present and otherwise the part after the last `node_modules/` of the key; and (b) the names added to `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` of a package.json, when their spec is a registry range. A change that touches neither file SHALL make no request.

#### Scenario: Solo lo agregado
- **WHEN** the base lock has left-pad@1.3.0 and the branch's lock has left-pad@1.3.0 and is-odd@3.0.1
- **THEN** only is-odd@3.0.1 is queried

#### Scenario: Sin manifiestos
- **WHEN** the branch only changes src/index.ts
- **THEN** the fake fetch is never called and the check passes

#### Scenario: Versión cambiada cuenta como nueva
- **WHEN** the base lock has left-pad@1.3.0 and the branch's lock has left-pad@1.3.1
- **THEN** left-pad@1.3.1 is queried

#### Scenario: Nombre agregado sin lock
- **WHEN** the branch adds "foo": "^1.0.0" to dependencies in package.json and there is no package-lock.json
- **THEN** the package foo is looked up on deps.dev by name

### Requirement: Lo resuelto fuera del registro público no se consulta
zero MUST NOT query OSV or deps.dev for a lock entry whose `resolved` does not start with `https://registry.npmjs.org/`, that has `link: true` or that has no `resolved`. It MUST NOT query them for a package.json spec that is not a registry range either: `file:`, `link:`, `workspace:`, `git`, `git+`, `github:`, `http(s):`, a path, or an `owner/repo` shorthand.

#### Scenario: Lock a git o a otro registro
- **WHEN** the branch's lock adds one entry resolved from git+https://github.com/a/b.git and one from https://npm.example.com/x/-/x-1.0.0.tgz
- **THEN** the fake fetch receives no query naming either package

#### Scenario: Spec local en package.json
- **WHEN** package.json adds "local": "file:../local"
- **THEN** no request names local

### Requirement: Aviso de malware falla el intento
When OSV reports a vulnerability whose id starts with `MAL-` for a new `name@version`, the check SHALL fail the attempt and the feedback MUST name the package, the version and the advisory id. Other advisory ids MUST NOT fail the attempt on their own.

#### Scenario: MAL- en OSV
- **WHEN** the fake OSV querybatch answers vulns [{id: "MAL-2026-1234"}] for evil-pkg@1.0.0
- **THEN** the check result is not ok and its feedback contains evil-pkg, 1.0.0 and MAL-2026-1234

#### Scenario: Aviso común no bloquea
- **WHEN** OSV answers only GHSA-xxxx for a new package
- **THEN** the check passes

#### Scenario: El intento vuelve a build
- **WHEN** a runner job on a line with checkDependencies true gets a MAL- answer from the fake fetch after verify passed
- **THEN** review and security are not called for that attempt and the next build prompt contains the advisory id in its feedback

### Requirement: Paquete inexistente falla el intento
When deps.dev answers 404 for a new package's name (GET /v3/systems/npm/packages/<name>, with the name URL-encoded), or the name does not follow npm's package name rules, the check SHALL fail the attempt with feedback that names the package and says it does not exist in the public npm registry.

#### Scenario: 404 en deps.dev
- **WHEN** the fake fetch answers 404 for the package hallucinated-pkg
- **THEN** the check is not ok and the feedback names hallucinated-pkg as nonexistent

#### Scenario: Nombre con alcance codificado
- **WHEN** the new package is @scope/name
- **THEN** the deps.dev request URL contains %40scope%2Fname

#### Scenario: Nombre inválido
- **WHEN** the lock adds an entry named "../../etc"
- **THEN** the check is not ok without sending a request for it, and the feedback shows the name cleaned of control characters

### Requirement: Versión reciente o primera versión como dato para security
When deps.dev shows that a new version was published less than 7 days before the check, or that the package has only one version, zero SHALL NOT fail the attempt. It MUST add a note for that package to the security station's prompt only, under a heading that presents it as data from OSV and deps.dev and not as instructions. The review prompt and custom agents' prompts MUST NOT receive it.

#### Scenario: Versión de hace dos días
- **WHEN** deps.dev reports that fresh-pkg@2.0.0 was published 2 days before the injected now
- **THEN** the check passes, and the prompt the fake security agent receives names fresh-pkg@2.0.0 as recent while the review prompt does not

#### Scenario: Sin versiones anteriores
- **WHEN** deps.dev lists exactly one version for solo-pkg
- **THEN** the security prompt names solo-pkg as having no earlier versions

### Requirement: Sin red: no verificado y la línea sigue
When a request to OSV or deps.dev throws, times out (10 seconds per request), or answers with a status other than 2xx (and other than 404 for a deps.dev package), the check SHALL NOT fail the attempt and MUST NOT let the error reach `runJob`'s network-retry catch. It MUST record the affected packages as unverified: as a `zero.dependencies.unverified` attribute on its span, with a log warning, and with a 'no verificado' line in the security prompt.

#### Scenario: fetch rechaza
- **WHEN** the fake fetch throws an error with code ECONNRESET for every call
- **THEN** the check returns ok with every new package listed as unverified, the job is not put back in the queue, and review runs

#### Scenario: 500 de OSV
- **WHEN** OSV answers 500
- **THEN** the packages are unverified and the attempt goes on

### Requirement: Agentes de security conocen el dato
agents/security.md MUST have a line saying that, when the prompt has a dependency check block from zero, it is objective data (malware and existence have already been checked) and that recent or first-version packages call for judging whether the dependency is needed and well known, with unverified ones judged as before.

#### Scenario: Instrucción presente
- **WHEN** agents/security.md is read in a test
- **THEN** it mentions the dependency check block, recent versions and unverified packages

### Requirement: Documentado en los dos idiomas
README.md and README.es.md MUST describe the check (off by default, `checkDependencies` per line, which names are sent to OSV and deps.dev, what fails and what only informs, npm only) in matching sections, and both factory-file code blocks MUST include the `checkDependencies` key.

#### Scenario: Clave en los bloques
- **WHEN** test/docs.test.ts reads both READMEs
- **THEN** the code blocks of each contain "checkDependencies:" and the structure check still passes
