import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Line and daemon tests drive real git repositories end to end; on Windows under parallel load they can exceed the 5 s default.
    testTimeout: 60_000,
    // Most of the suite waits on git and node child processes, so one worker per CPU (not the default one less) finishes sooner.
    maxWorkers: availableParallelism(),
  },
});
