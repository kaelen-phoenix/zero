# Spec Delta

## Purpose

Packages like zero-plus get four generic pieces to build "entregas express" on top of: 1. **Cost per job.** When a package's station asks for a job, it can set a cost cap. The cap can never be above `limits.usdPerJob`. The station can then read the state and real cost of its own jobs. 2. **Downloads from package tabs.** A package tab can offer files from the package's data folder for download, in addition to http/https links. Only files that the tab itself lists can be downloaded, and only if they really are inside that folder (links that lead out are not followed). 3. **Uploads.** From the panel (and from the terminal with `zero package upload`), you can send a file, for example a zip, to a package station that accepts uploads. - The file is stored in the package's data folder with a size limit. - The station receives it in its next run. - zero gives the station a safe way to unzip it: no symbolic links, no paths that leave the folder, and limits on size and number of files. 4. **Local repositories without GitHub.** A station with permission can ask zero to create a git repository inside ZERO_HOME, optionally starting from a zip. - zero adds the line on its own (nobody edits `zero.factory.yaml` by hand). - The station can ask for a job there. The job goes through spec, build, verify and review, and is delivered as a commit on that repository, with no pull request. - The station can then export the result as a zip into its data folder, for a tab to offer as a download. The current rules still hold: everything stays in ZERO_HOME, the panel runs no package code, and third-party text and files are treated as data.

## ADDED Requirements

### Requirement: Package job cost cap
`ctx.requestJob` SHALL accept an optional `maxUsd`. When `maxUsd` is a finite positive number no greater than `limits.usdPerJob`, the new job's `budgetUsd` MUST be `maxUsd`. Any other value MUST be refused with a `reason`, creating no job and spending none of the station's quota.

#### Scenario: cap below the limit
- **WHEN** limits.usdPerJob is 3 and a station with `requests` calls requestJob({ line, text, maxUsd: 1.5 })
- **THEN** it returns { id } and the stored job has budgetUsd 1.5

#### Scenario: cap above the limit
- **WHEN** limits.usdPerJob is 3 and requestJob is called with maxUsd 5 (or 0, -1, NaN, or a string)
- **THEN** it returns { reason } that mentions limits.usdPerJob, no job is created and the kv quota counter is unchanged

#### Scenario: no cap
- **WHEN** requestJob is called without maxUsd
- **THEN** the job's budgetUsd is limits.usdPerJob, as before

### Requirement: Package reads its own jobs
The station context SHALL offer `ctx.job(id)`. It returns the status, `costUsd`, `budgetUsd`, `finishedAt`, whether the job waits for an answer, and the delivery mode and commit, but only for jobs whose source is `{kind: 'package'}` with the same package. For any other id it MUST return undefined. Texts it returns MUST be cleaned like `deliveredJobs` (no secrets or local paths).

#### Scenario: own job
- **WHEN** a station opened job X through requestJob and the job is later delivered in merge mode with a commit
- **THEN** ctx.job(X) returns status 'delivered', the job's costUsd and budgetUsd, and delivery { mode: 'merge', commit }

#### Scenario: foreign job
- **WHEN** ctx.job is called with the id of an owner job or of a job opened by another package
- **THEN** it returns undefined

### Requirement: Tab items can link package files
A tab data item SHALL accept an optional `file`: a relative path inside the package's data folder. `TabDataSchema` MUST refuse absolute paths, drive letters and `..` segments. The panel MUST show a download link only for items whose file exists as a regular file whose real path is inside the data folder.

#### Scenario: valid file item
- **WHEN** a tab's JSON has an item { title, file: 'out/a.zip' } and package-data/<pkg>/out/a.zip exists
- **THEN** the tab page shows a 'Descargar' link to the panel's download route for that file

#### Scenario: escaping path
- **WHEN** an item has file '../x.zip' or an absolute path
- **THEN** readTabData returns state 'invalid'

#### Scenario: missing file
- **WHEN** an item's file does not exist
- **THEN** the item is shown without a download link

### Requirement: Panel serves tab downloads safely
The panel SHALL serve GET `/packages/<pkg>/<tab>/files/<path>` only to an authenticated session, and only when that tab's current data lists that exact `file`. The file's real path MUST be inside the package's data folder, it MUST be a regular file, and it MUST be at most `MAX_DOWNLOAD_BYTES`. The response MUST be `application/octet-stream` with `Content-Disposition: attachment`, a sanitized file name and `X-Content-Type-Options: nosniff`. Every other request to that route MUST get 404, and no package code runs.

#### Scenario: listed file
- **WHEN** an authenticated GET asks for a file listed by the tab
- **THEN** the response is 200 with the file's bytes and an attachment Content-Disposition

#### Scenario: unlisted file
- **WHEN** the GET asks for a file that exists in the data folder but no item of the tab lists it
- **THEN** the response is 404

#### Scenario: link leaving the folder
- **WHEN** the listed file is a symbolic link (or sits under a linked folder) that resolves outside package-data/<pkg>
- **THEN** the response is 404

#### Scenario: no session
- **WHEN** the GET comes without the panel cookie
- **THEN** the response is 401 and the file is not sent

### Requirement: Stations declare uploads
A manifest station SHALL accept `uploads: { maxMb, extensions }` (`maxMb` positive and at most 100, default 20; `extensions` default ['.zip']). A manifest that declares `uploads` without `onDemand: true` MUST be refused.

#### Scenario: valid declaration
- **WHEN** a station declares onDemand: true and uploads: { maxMb: 10 }
- **THEN** the package loads and the station's uploads limit is 10 MB with extensions ['.zip']

#### Scenario: uploads without onDemand
- **WHEN** a station declares uploads but not onDemand: true
- **THEN** readManifest refuses the package with a reason naming uploads

### Requirement: Uploading a file to a station
`uploadToStation` in app.ts SHALL store an uploaded file under `<package-data>/<pkg>/uploads/<station>/` with a sanitized base name, and SHALL ask for an on-demand run of that station that carries the upload. It MUST refuse, storing nothing (no partial file left), when any of these holds: the station does not declare `uploads`, the extension is not allowed, the content goes over `maxMb`, a zip does not start with the zip signature, or `requestStationRun` would refuse (pending run, andon, budget).

#### Scenario: accepted upload
- **WHEN** a 1 KB valid zip named '../evil name.zip' is uploaded to a station with uploads
- **THEN** a file whose base name has no path separators exists under package-data/<pkg>/uploads/<station>/, and stationOnDemandKey is set

#### Scenario: too large
- **WHEN** the content exceeds maxMb
- **THEN** it is refused with a reason, and no file is left in the uploads folder

#### Scenario: wrong extension
- **WHEN** a '.exe' file is uploaded to a station with default extensions
- **THEN** it is refused and nothing is written

#### Scenario: run already pending
- **WHEN** the station already has an on-demand run pending
- **THEN** the upload is refused and nothing is written

### Requirement: Station receives the upload
The on-demand turn that answers an upload SHALL give the station `ctx.upload` (`{ name, path, sizeBytes, at }`, with `path` inside its data folder). Turns that do not answer an upload MUST have no `ctx.upload`.

#### Scenario: run after upload
- **WHEN** onDemandPass runs a station after a file was uploaded to it
- **THEN** the module's pass receives ctx.upload whose path points to the stored file

#### Scenario: regular pass
- **WHEN** packagesPass runs the station's regular turn
- **THEN** ctx.upload is undefined

### Requirement: Safe unzip
`ctx.unzip(zip, dest)` SHALL extract a zip whose path and destination are inside the station's data folder (or inside one of its package repositories). It MUST refuse the whole archive, writing nothing, when any entry: is a symbolic link; has an absolute path, a drive letter or `..`; is encrypted or zip64; or pushes the archive past the limits on entry count or total uncompressed size.

#### Scenario: normal zip
- **WHEN** a zip with 'src/a.txt' and 'README.md' is unzipped into dataDir/work
- **THEN** both files exist under dataDir/work with their contents

#### Scenario: path traversal
- **WHEN** a zip contains an entry '../../x.txt'
- **THEN** unzip returns { reason } and no file is written anywhere

#### Scenario: symlink entry
- **WHEN** a zip contains an entry whose unix mode marks a symbolic link
- **THEN** unzip returns { reason } and nothing is written

#### Scenario: destination outside
- **WHEN** dest resolves outside the data folder
- **THEN** unzip returns { reason }

### Requirement: Panel upload form
The panel's `/packages` page SHALL show an upload form for each station that declares `uploads`. POST `/packages/upload` MUST pass the same-origin check and need a session, MUST store through `uploadToStation`, and MUST enforce the size limit while reading the body. The 64 KB form limit applies to every other route.

#### Scenario: upload from the panel
- **WHEN** an authenticated same-origin multipart POST to /packages/upload carries a valid zip for a station with uploads
- **THEN** it redirects to /packages with a confirmation message and the file is stored

#### Scenario: cross-site upload
- **WHEN** the POST carries Sec-Fetch-Site: cross-site
- **THEN** the response is 403 and nothing is stored

### Requirement: Local package repositories
A station whose manifest declares `repositories: { perDay }` SHALL be able to call `ctx.repos.create(name, { from?, setup?, verify? })`. The call creates a git repository with an initial commit on branch `main` at `<ZERO_HOME>/package-repos/<pkg>/<name>`, optionally seeded with a zip from its data folder through the safe unzip. It adds a line `<pkg>-<name>` to the factory file through `editConfig`, with `integrate: merge`, `package: <pkg>` and the given setup/verify. It MUST refuse when the station lacks `repositories`, when the daily count is reached, when the name is invalid, or when the line name is taken.

#### Scenario: create from zip
- **WHEN** a station with repositories: { perDay: 5 } calls repos.create('d1', { from: 'uploads/s/a.zip', verify: ['npm test'] })
- **THEN** package-repos/<pkg>/d1 is a git repository whose main branch has one commit with the zip's files, and ctx.config.lines has line '<pkg>-d1' with package '<pkg>', integrate 'merge' and verify ['npm test']

#### Scenario: no permission
- **WHEN** a station without repositories calls repos.create
- **THEN** it returns { reason } and neither the file nor the folder changes

#### Scenario: name taken by another line
- **WHEN** the factory already has a line named '<pkg>-d1' that is not owned by the package
- **THEN** repos.create('d1') returns { reason }

### Requirement: Jobs on package repositories
`ctx.requestJob({ repo, text, maxUsd? })` SHALL open a normal job on the station's package-owned line. That job SHALL be delivered as a merge commit on the repository's `main`, with no remote and no pull request. `requestJob` MUST refuse a line owned by another package, and `ctx.lines` MUST NOT list lines owned by other packages.

#### Scenario: job on own repo
- **WHEN** a station calls requestJob({ repo: 'd1', text }) after creating it
- **THEN** the job is created on line '<pkg>-d1' with source { kind: 'package' }

#### Scenario: delivery without remote
- **WHEN** a job on a package repository passes verify and review in runner tests with fake agents
- **THEN** the job ends 'delivered' with delivery mode 'merge' and a commit that is main's head in that repository

#### Scenario: other package's line
- **WHEN** a station of package B calls requestJob({ line: 'a-d1', text }) for a line owned by package A
- **THEN** it returns { reason } and creates no job

### Requirement: Package repositories stay out of idle passes
Lines with `package` set MUST NOT be looked at by scout, unjam or research.

#### Scenario: scout skips
- **WHEN** scoutPass runs with an owner line and a package-owned line
- **THEN** the scout agent is called only for the owner line

### Requirement: Exporting and removing package repositories
`ctx.repos.archive(name, file)` SHALL write a zip of the repository's `main` tree (git archive) to a `.zip` path inside the station's data folder. `ctx.repos.remove(name)` SHALL delete the line entry and the folder, and MUST refuse while the line has an unfinished job. Both MUST refuse repositories the package does not own.

#### Scenario: archive
- **WHEN** after a delivered job, repos.archive('d1', 'out/d1.zip') is called
- **THEN** dataDir/out/d1.zip exists and contains the files of main's head

#### Scenario: archive outside data folder
- **WHEN** file is '../x.zip' or absolute
- **THEN** it returns { reason } and writes nothing

#### Scenario: remove with unfinished job
- **WHEN** repos.remove('d1') is called while a job of line '<pkg>-d1' is queued
- **THEN** it returns { reason } and the line and folder remain
