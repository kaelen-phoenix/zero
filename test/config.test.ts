import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";

describe("ConfigSchema", () => {
  it("fills defaults from an empty file", () => {
    const config = ConfigSchema.parse({});
    expect(config.engine).toBe("claude");
    expect(config.labels.ready).toBe("zero:ready");
    expect(config.roles.coder).toMatchObject({ maxTurns: 120, timeoutMinutes: 45 });
  });

  it("allows a different engine per role", () => {
    const config = ConfigSchema.parse({
      engine: "claude",
      roles: { coder: { engine: "codex", model: "gpt-5-codex", timeoutMinutes: 60 } },
    });
    expect(config.roles.coder.engine).toBe("codex");
    expect(config.roles.planner.engine).toBeUndefined();
  });

  it("validates custom engines", () => {
    const config = ConfigSchema.parse({ engines: { opencode: { command: ["opencode", "run", "{prompt}"] } } });
    expect(config.engines.opencode).toEqual({ command: ["opencode", "run", "{prompt}"], readArgs: [], writeArgs: [], modelArgs: [] });
    expect(() => ConfigSchema.parse({ engines: { bad: { command: [] } } })).toThrow();
  });
});
