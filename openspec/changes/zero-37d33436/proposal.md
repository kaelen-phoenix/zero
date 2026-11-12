# Proposal

## Why

You'll get a decision document, docs/adr/0004-servidores-mcp.md, in Spanish and in the same format as the earlier ADRs. It looks at which MCP servers from GitHub's catalog (Playwright, Chrome DevTools, GitHub, Serena, Skyvern and others) would help each station: spec, build, verify, review, security, scout, research and reply. For each one it gives the risk in credentials, network access, writing outside the work copy, and the rule that guarantees come from zero and not from the engine. It also says whether zero should publish its own MCP server (the one the chat already uses) in the catalog. It ends with a recommendation and a list of concrete next requests. Nothing gets installed and the factory's behavior doesn't change. A small test checks that the document exists and covers each station.

## What Changes

- ADR 0004: MCP servers for the factory's stations and zero's own server in GitHub's catalog
- Supuesto: Catalog facts (server capabilities, licenses, the GitHub MCP catalog's publication requirements) can't be checked offline from the repository. The ADR has to say which statements come from the request or general knowledge and haven't been verified, rather than present them as checked.
- Supuesto: The claim that codex/opencode/agy load MCP servers from the user's own config comes from reading the invocations (no disabling flag), not from a real run. If it's true and the person in charge has registered zero's chat server in ~/.codex/config.toml or opencode.json, a factory agent could reach tools like zero_request or zero_merge. The ADR must mark this as unverified and urgent to check.
- Supuesto: Requirement names could collide with existing production-line requirements; specStation's uniqueRequirementNames handles that.
- Supuesto: The request asks for no code, but the static test is a small addition so verification has something to check. It doesn't touch src/.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: ADR 0004: MCP servers for the factory's stations and zero's own server in GitHub's catalog

## Impact

Generado por zero para el trabajo 37d33436.
