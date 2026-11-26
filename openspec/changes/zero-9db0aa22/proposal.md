# Proposal

## Why

Build will learn how long each check usually takes on this line. The build station is the agent that writes the code. The checks are the verify commands, for example `npm test`, which here takes 20 to 28 minutes. A check can take more than a third of build's time limit (45 minutes by default). In that case build is told not to run the whole suite. It should run only the tests of the files it touches, because zero runs the full suite in verify anyway. Verify does not change and keeps running every command. A build can also hit its time limit. When that happens, the next attempt's feedback will say the time limit was reached, how many minutes it was, and that the work done so far is still uncommitted in the work copy. The next attempt should pick up from there. Today it just says to make smaller changes. Hitting the time limit still counts as an attempt, as it does today.

## What Changes

- Tell build how long each verify command takes, and say so when the clock cut it
- Supuesto: The runner tests share history across a job's spans, so durations recorded by earlier verify runs in the same test (with real commands like `node -e`) can show up in later build prompts. Tests should assert on durations they insert themselves, use distinct command strings, and assert containment rather than the whole prompt.
- Supuesto: When the build that timed out was resolving a merge conflict, the next attempt's startMerge restarts the merge, so the half-done work may not survive. The 'continue from the copy' wording is still added there, with the conflict feedback appended. Assumed acceptable; a more precise message for that case is out of scope.
- Supuesto: A build on a replacement engine uses the same stations.build.timeoutMinutes, so N in the feedback is that value. Custom writer agents (type build) have their own timeoutMinutes and keep today's prompt and feedback.
- Supuesto: The SDK may not throw when the abort happens. If the loop ends normally with no result after the abort, the Claude engine should still report timedOut when abort.signal is aborted by the timer. The implementation should check this in the no-result path as well.
- Supuesto: Assumption: 'more than a third' is strict (duration > timeoutMinutes*60000/3), and durations are shown as Math.max(1, Math.round(ms/60000)) minutes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Tell build how long each verify command takes, and say so when the clock cut it

## Impact

Generado por zero para el trabajo 9db0aa22.
