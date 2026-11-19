# Proposal

## Why

You can configure your own agents with `type: conflict`, globally, per line or from a package. When zero brings the base branch into a job's branch and some files are left in conflict that the simple model-free resolution can't handle, zero calls those agents before the normal build. That happens when it refreshes a pull request, or when a pull request in conflict comes back to the queue. Each agent gets the job's request and specification, the conflicted files with their blocks, and the base commits that caused them. It resolves them in the work copy and answers file by file: resolved, or returned with a reason. zero accepts the result only if no conflict markers are left and the branch contains the base. Then it runs verify as usual, without spending an attempt. If the agent returns a file, fails or leaves something wrong, everything goes on as today: build resolves the conflict with the usual instructions. Each try appears in the spans and in `zero trace`. If no agent of this type is configured, nothing changes.

## What Changes

- Custom agents of type conflict to resolve merge conflicts with the base
- Supuesto: Assumption: when several conflict agents are configured, they are tried one after the other in `lineAgents` order, and each one starts from a fresh merge. The first one that resolves everything wins. The request does not say how several should combine.
- Supuesto: Assumption: an agent's `returned` reasons go only to spans, not into build's feedback, because the request says to continue with the current path (build with conflictFeedback) and the agent's text is not trusted as instructions.
- Supuesto: The conflict agent works on the same work copy as the job (box or local). An interruption during its call must leave the fallback state already saved, or a resumed job could skip the merge. The fallback state is therefore written before the call.
- Supuesto: Conflict blocks of large or binary files must be capped in the prompt. Huge conflicts could otherwise overflow the engine's limit or the Windows command line for CLI engines that receive the prompt in argv. Those engines already switch to stdin above 30,000 characters.
- Supuesto: The agent may change files other than the conflicted ones. That is accepted, because verify, protected paths, the reviews and the final operationArtifacts check still run on the whole change.
- Supuesto: The agent catalog (`CatalogType` in src/catalog.ts) still accepts only review and build. Conflict agents cannot come from the catalog in this change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Custom agents of type conflict to resolve merge conflicts with the base

## Impact

Generado por zero para el trabajo b5587be4.
