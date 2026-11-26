# Tasks

## 1. Etapa 1: Single attribution list and clean published text

- [x] 1.1 Create src/attribution.ts with ATTRIBUTION_PATTERNS, isAttributionLine and stripAttribution.
- [x] 1.2 Apply stripAttribution in withTrailer, signText, signedIssues and signedMerges (always wrapping), and to the pull request and merge titles in src/line/integrate.ts.
- [x] 1.3 Turn off Claude Code attribution in claudeOptions settings (src/engines/claude.ts).
- [x] 1.4 Add the AGENTS.md convention and the docs in docs/agents/core.md and docs/agents/engines.md.
- [x] 1.5 Tests: stripAttribution cases, signed adapters cleaning with signature undefined (adjust existing identity expectations), claudeOptions attribution, docs.test.ts convention check.

## 2. Etapa 2: Clean the job's unpublished commits before integrating or pushing

- [x] 2.1 Add scrubBranch(repo, branch, keep) to src/attribution.ts, using git commit-tree and preserving tree, mapped parents, author and committer with their dates, then update-ref with the old value.
- [x] 2.2 Call it in src/line/runner.ts after copy.publish() and before integrate (keep: base, copy.base, refresh.head), and in src/coord/progress.ts before the progress push (keep: lease SHA).
- [x] 2.3 Tests with real git: cleaned agent commit, deterministic SHAs, base/remote/pushed commits untouched, clean branch untouched, and an end-to-end delivery with fake agents.
- [x] 2.4 Document in docs/agents/production-line.md and add the OpenSpec change. Run typecheck, tests and openspec validate.
