# Proposal

## Why

Right now, when GitHub refuses to show a repository's Dependabot alerts, `zero status` always says the token needs read permission for them. That happens even when the real reason is that Dependabot alerts are turned off in that repository, which is the case on your 5 lines today. After this change, if GitHub answers that the alerts are disabled, the problem will say that Dependabot alerts are turned off in the repository. It will also give the link to the page where you can turn them on (https://github.com/<owner>/<repo>/settings/security_analysis). The token-permission message stays only for a real permission refusal. The README will say this in both languages.

## What Changes

- Separate "Dependabot alerts turned off" from "token without permission"
- Supuesto: The disabled case is recognized from GitHub's English message text ('Dependabot alerts are disabled'). If GitHub changes that wording, the code falls back to the permission message.
- Supuesto: Octokit's RequestError may put the API message in `message` (often with ' - <docs url>' appended) or only in `response.data.message`, so both are checked.
- Supuesto: The repository in the link comes from `lineRepository` (configuration, already `owner/repo`), not from third-party data.

## Capabilities

### New Capabilities

### Modified Capabilities
- `work-intake`: Separate "Dependabot alerts turned off" from "token without permission"

## Impact

Generado por zero para el trabajo 30de3de0.
