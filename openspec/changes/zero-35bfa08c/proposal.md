# Proposal

## Why

Almost everything the "construcciones express" need is already in zero. From the panel and the terminal you can already send a zip to a package station. The station can already turn it into a local repository, run a full job on it (spec, build, verify, review) with a cost cap, read what the job cost and offer the result for download in its panel tab. Two things were missing, and this change adds them. First, you will be able to send the file from the chat too, with the new `zero_package_upload` tool: from a chat on this machine you give it a file path, and from any chat, including the remote one, you can send the content itself. Second, a station can read the factory's per-job limit (`ctx.limits.usdPerJob`), so it knows how far it can cap a job. The README (English and Spanish) explains both. Once this is in, zero sends request 6d6ef921 to the zero-plus line again.

## What Changes

- Upload a file to a package station from the chat, and read limits from ctx
- Supuesto: Assumption: everything else the request lists already exists and is documented. That covers panel and CLI upload, tab downloads, a repository from a zip with a full-line job (`ctx.repos.create` + `requestJob({ repo })`, a line in the file written by zero, not by hand), `maxUsd` and `ctx.job(id).costUsd`. So no `ctx.requestExpressJob` is added. If the refused request 6d6ef921 really needs a repository with no line entry at all, it will be refused again, and that would be a separate change.
- Supuesto: The remote MCP body is capped at 1 MiB (`MAX_MCP_BODY` in src/mcp/http.ts), so base64 uploads over the remote chat top out near 750 KB. Many chat clients cannot produce large base64 arguments at all. The local path is the practical way in.
- Supuesto: The local `path` input lets the stdio chat read any file the user's account can read into package-data, where third-party station code sees it. That is why it is refused on the remote server. On stdio the chat is the person's own client, like the CLI.
- Supuesto: `ctx.limits` is additive, so PACKAGE_INTERFACE stays 1, as the request allows ('si cambia').

## Capabilities

### New Capabilities
- `agent-packages`: Upload a file to a package station from the chat, and read limits from ctx

### Modified Capabilities

## Impact

Generado por zero para el trabajo 35bfa08c.
