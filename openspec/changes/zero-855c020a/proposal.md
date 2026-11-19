# Proposal

## Why

When a pull request clashes with the main branch and the factory gives the clash to a conflict agent, the agent will now see three versions of each clashing piece: what the job's branch had, what the main branch had, and the shared starting point before either changed it. Before, the agent only saw the two final versions, so it had to guess what each side meant to change. With the starting point, it can keep both sides' changes more often. That means fewer failed resolution tries and fewer stuck pull requests like #214. Files where the starting point can't be shown (binary files, or files that only exist on one side) are handed over as before. Any leftover conflict marker, including the new base marker `|||||||`, still makes the factory reject the resolution.

## What Changes

- Conflict agents see the base side of each block (diff3)
- Supuesto: A user git config with `merge.conflictstyle=zdiff3` or `diff3` doesn't matter: `git checkout --conflict=diff3` always rewrites with the diff3 style.
- Supuesto: `git checkout --conflict=diff3` rewrites the work-tree file from the index stages, so it discards any edits made to that file since the merge. That is safe here because the merge was just redone and no agent has run yet.
- Supuesto: The existing prompt regex in test/conflict-agents.test.ts:133 assumes no base section and has to be updated. Other tests that match the conflict blocks exactly may need the same update.
- Supuesto: diff3 blocks are longer, so the 6000-character `BLOCKS_CHARS` cut in `conflictBlocks` will be reached sooner on big conflicts. The limit is left as it is.
- Supuesto: In the scenario, 'the file is untouched' means content equal to what `git merge` left. Line endings depend on the test helper's `core.autocrlf` setting.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Conflict agents see the base side of each block (diff3)

## Impact

Generado por zero para el trabajo 855c020a.
