import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Line and daemon tests drive real git repositories end to end; on Windows under parallel load they can exceed the 5 s default.
    testTimeout: 60_000,
    // Most of the suite waits on git and node subprocesses, so more workers than CPUs finish it sooner than vitest's default (CPUs - 1).
    maxWorkers: Math.max(2, Math.round(availableParallelism() * 1.5)),
  },
});
