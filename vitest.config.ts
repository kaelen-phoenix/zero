import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Line and daemon tests drive real git repositories end to end; on Windows under parallel load they can exceed the 5 s default.
    testTimeout: 60_000,
    // Most of the suite's time is spent waiting on git and node child processes, so every core gets a worker (vitest leaves one idle by default).
    maxWorkers: availableParallelism(),
    // Temp repositories live for one test: git's background maintenance and fsync only cost process starts and disk flushes there.
    env: {
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "maintenance.auto",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "gc.auto",
      GIT_CONFIG_VALUE_1: "0",
      GIT_CONFIG_KEY_2: "core.fsync",
      GIT_CONFIG_VALUE_2: "none",
    },
  },
});
