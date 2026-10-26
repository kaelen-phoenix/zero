import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";

describe("ConfigSchema", () => {
  it("fills defaults from an empty file", () => {
    const config = ConfigSchema.parse({});
    expect(config.model).toBe("claude-opus-5-5");
    expect(config.labels.ready).toBe("zero:ready");
    expect(config.roles.coder.maxTurns).toBe(120);
  });

  it("keeps partial overrides", () => {
    const config = ConfigSchema.parse({ roles: { reviewer: { model: "claude-sonnet-5-5", maxTurns: 10, maxBudgetUsd: 1 } } });
    expect(config.roles.reviewer.model).toBe("claude-sonnet-5-5");
    expect(config.roles.planner.maxTurns).toBe(40);
  });
});
