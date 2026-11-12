# Proposal

## Why

Packages like zero-plus get four generic pieces to build "entregas express" on top of: 1. **Cost per job.** When a package's station asks for a job, it can set a cost cap. The cap can never be above `limits.usdPerJob`. The station can then read the state and real cost of its own jobs. 2. **Downloads from package tabs.** A package tab can offer files from the package's data folder for download, in addition to http/https links. Only files that the tab itself lists can be downloaded, and only if they really are inside that folder (links that lead out are not followed). 3. **Uploads.** From the panel (and from the terminal with `zero package upload`), you can send a file, for example a zip, to a package station that accepts uploads. - The file is stored in the package's data folder with a size limit. - The station receives it in its next run. - zero gives the station a safe way to unzip it: no symbolic links, no paths that leave the folder, and limits on size and number of files. 4. **Local repositories without GitHub.** A station with permission can ask zero to create a git repository inside ZERO_HOME, optionally starting from a zip. - zero adds the line on its own (nobody edits `zero.factory.yaml` by hand). - The station can ask for a job there. The job goes through spec, build, verify and review, and is delivered as a commit on that repository, with no pull request. - The station can then export the result as a zip into its data folder, for a tab to offer as a download. The current rules still hold: everything stays in ZERO_HOME, the panel runs no package code, and third-party text and files are treated as data.

## What Changes

- Package contract: uploads, tab downloads, local package repositories and per-job cost
- Supuesto: The request is large. It is split into 5 stages; each one is useful on its own and leaves the tests passing.
- Supuesto: Chat upload (MCP) is left out. A chat tool taking a local path or base64 content needs its own decision about which local files the chat may send to third-party code, so it is in followUps. The CLI and the panel cover the person in charge.
- Supuesto: Only one upload per station can be pending at a time, because uploads reuse the single pending on-demand run. A second upload is refused until the station has taken the first.
- Supuesto: Package-owned lines are written into zero.factory.yaml by zero itself (editConfig). A concurrent hand edit of the file can race with it, as with the other editConfig operations.
- Supuesto: Package repositories inherit the factory's `isolation`. With `container`, the box must reach `<ZERO_HOME>/package-repos` like any line repository; the box compose already mounts the data at the same path, but this is not tested end to end.
- Supuesto: setup and verify commands for a package repository come from the station's code. That code already runs in zero's process with allowCode, and the commands run under the same isolation as any line's, so trust does not widen. Still, the person in charge should know when installing such a package.
- Supuesto: Multipart parsing through `Request.formData()` holds the body in memory, which is why uploads are capped at 100 MB.
- Supuesto: A zip parser is written without a library: only stored/deflate entries, with no zip64 and no encryption. Zips outside that are refused rather than guessed at.
- Supuesto: Merge mode on a freshly initialised repository relies on `main` being checked out in the repository's own folder and clean. zero only writes there through merges, which holds as long as stations do not write into the repository's folder after creating it. Stations should change the code only through jobs.

## Capabilities

### New Capabilities
- `agent-packages`: Package contract: uploads, tab downloads, local package repositories and per-job cost

### Modified Capabilities

## Impact

Generado por zero para el trabajo f0f4aea9.
