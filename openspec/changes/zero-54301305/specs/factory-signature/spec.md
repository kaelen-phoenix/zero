# Spec Delta

## Purpose

Todo lo que hace la fábrica va a llevar la firma de zero in the loop. Cada commit (en todas las líneas, incluidos los de especificación, los de cada intento y el merge de integración) termina con la línea 'Built-by: zero in the loop <https://zerointheloop.com>'. Los pull requests, los issues que abre la fábrica (propuestas e investigación) y sus comentarios terminan con '— Hecho con [zero in the loop](https://zerointheloop.com)'. La marca oculta con la que la fábrica reconoce sus propios comentarios sigue igual, así que nunca se va a contestar a sí misma. La firma se configura en zero.factory.yaml con `signature` (con el texto del pie y el del trailer), o se apaga con `signature: off`. Se puede poner para toda la fábrica y cada línea puede tener la suya. Si no ponés nada, queda encendida con esos textos. El sitio va a decir en el pie 'Este sitio lo construyó zero in the loop' en español y 'This site was built by zero in the loop' en inglés. Los dos README explican la opción nueva.

## ADDED Requirements

### Requirement: Signature configuration
zero.factory.yaml SHALL accept an optional top-level `signature` that is either the literal `off` or an object `{ text, trailer }`. `text` defaults to '— Hecho con [zero in the loop](https://zerointheloop.com)' and `trailer` defaults to 'Built-by: zero in the loop <https://zerointheloop.com>'. `trailer` MUST be a single line of the form `Token: value`, and unknown keys MUST be refused. When the key is absent the signature SHALL be on with both defaults.

#### Scenario: default on
- **WHEN** parseFactory is given a file with no `signature` key
- **THEN** lineSignature(config, line) returns { text: '— Hecho con [zero in the loop](https://zerointheloop.com)', trailer: 'Built-by: zero in the loop <https://zerointheloop.com>' }

#### Scenario: global off
- **WHEN** the file has `signature: off` and the line has no signature of its own
- **THEN** lineSignature returns undefined

#### Scenario: invalid trailer
- **WHEN** the file has `signature: { trailer: "no colon here" }` or a trailer with a newline
- **THEN** parseFactory throws ConfigError

#### Scenario: partial object
- **WHEN** the file has `signature: { text: "Firmado" }`
- **THEN** lineSignature returns text 'Firmado' and the default trailer

### Requirement: Per-line signature
Each line SHALL accept an optional `signature` with the same shape (`off` or `{ text, trailer }`). When it is present it MUST replace the global signature for that line entirely. When it is absent the line SHALL use the global one.

#### Scenario: line turns it off
- **WHEN** global signature is on (default) and lines[0] has `signature: off`
- **THEN** lineSignature(config, lines[0]) is undefined while another line without its own signature gets the global one

#### Scenario: line turns it on with own text
- **WHEN** global `signature: off` and a line has `signature: { text: "Hecho por la línea" }`
- **THEN** lineSignature for that line returns text 'Hecho por la línea' and the default trailer

### Requirement: Commit trailer
Every commit the factory makes on a line (the spec commit, each build attempt commit and the merge commit of `integrate: merge`) MUST end with the line's signature trailer as the last paragraph of the message, separated from the rest by a blank line, while the subject line stays unchanged. When the line's signature is off, the commits SHALL carry no trailer.

#### Scenario: attempt commit signed
- **WHEN** a job runs on a merge line with default config and fake agents
- **THEN** `git log -1 --format=%B zero/<job>` ends with 'Built-by: zero in the loop <https://zerointheloop.com>', `git log --format=%s` still shows 'zero(<job>): intento 1', and `git interpret-trailers --parse` on the message yields that trailer

#### Scenario: merge commit signed
- **WHEN** mergeIntoBase integrates a branch with a signature
- **THEN** the merge commit on the base branch has the trailer as its last line

#### Scenario: off means no trailer
- **WHEN** the same job runs with `signature: off`
- **THEN** no commit message on the job's branch or the merge commit contains 'Built-by:'

### Requirement: Pull request signature
The body of a pull request the factory opens or updates SHALL end with the line's signature text as its own final paragraph, after the existing body (spec, 'Closes #N', cost footer). With the signature off the body MUST stay as before.

#### Scenario: signed body
- **WHEN** deliveryBody(spec, job, store, signature) is called with the default signature
- **THEN** the result ends with '\n\n— Hecho con [zero in the loop](https://zerointheloop.com)' and still contains 'Closes #N' when the job has an issue

#### Scenario: unsigned body
- **WHEN** deliveryBody is called without a signature
- **THEN** the result is identical to the current output

### Requirement: Issue and comment signature
Every issue the factory creates (proposal and research issues) and every comment it posts on an issue or pull request (intake replies, status reports, proposal decisions, automatic merge messages) SHALL end with the line's signature text, placed before the hidden FACTORY_MARK. FACTORY_MARK MUST remain in every factory comment, so `isFactory` keeps recognising them. When the signature is off, the bodies SHALL be unchanged.

#### Scenario: wrapped comment
- **WHEN** signedIssues(fake, signature).comment(7, 'Hola') is called
- **THEN** the fake receives body 'Hola\n\n— Hecho con [zero in the loop](https://zerointheloop.com)'

#### Scenario: wrapped issue creation
- **WHEN** signedIssues(fake, signature).createIssue('t', 'cuerpo', ['zero:propuesta'])
- **THEN** the fake receives body 'cuerpo\n\n— Hecho con [zero in the loop](https://zerointheloop.com)' with the same title and labels; other IssueApi methods are passed through unchanged

#### Scenario: no signature
- **WHEN** signedIssues(fake, undefined) is used
- **THEN** comment and createIssue bodies reach the fake unchanged

#### Scenario: merges wrapped
- **WHEN** signedMerges(fake, signature).comment(10, 'x')
- **THEN** the fake receives 'x\n\n— Hecho con [zero in the loop](https://zerointheloop.com)'

#### Scenario: detection intact
- **WHEN** a comment body built as signed text followed by '\n\n<!-- zero -->' is in an issue thread
- **THEN** answerComments treats it as the factory's own and does not answer it

### Requirement: Daemon wiring per line
The daemon's real GitHub adapters SHALL be signed with the signature of the line they act for. Each pass MUST give the line to its api factory: pollIssues, syncProposalIssues and syncResearchIssues call `api(repository, line)`, and pollMerges calls `api(repository, line)` with the job's line. Fakes that ignore the second argument MUST keep working.

#### Scenario: line passed to api
- **WHEN** pollIssues, syncProposalIssues, syncResearchIssues or pollMerges run with a spy api factory
- **THEN** the spy is called with the repository and the LineConfig of the line being processed (for pollMerges, the line named by job.line)

### Requirement: Site footer credit
The site footer (site/index.html) SHALL contain the text 'Este sitio lo construyó zero in the loop', with 'zero in the loop' linking to https://zerointheloop.com, as a data-i18n element. site/main.js's EN table MUST translate it as 'This site was built by zero in the loop', so that test/site.test.ts key parity keeps passing.

#### Scenario: both languages
- **WHEN** test/site.test.ts parses the footer and EN
- **THEN** the footer contains 'Este sitio lo construyó' with a link to zerointheloop.com, and EN has the matching key whose value contains 'This site was built by'

### Requirement: README documents the signature
README.md and README.es.md SHALL document `signature` (defaults, `off`, per-line override, where it appears: commits as trailer, pull requests, issues and comments). They MUST have the same structure and identical yaml blocks, so that test/docs.test.ts passes.

#### Scenario: docs mention
- **WHEN** the docs test reads both READMEs
- **THEN** both contain 'signature:' in the factory yaml example and 'Built-by: zero in the loop', and docs.test.ts passes
