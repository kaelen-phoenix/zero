import { describe, expect, it } from "vitest";
import { ConfigError, parseFactory } from "../src/config.js";
import { publicText } from "../src/public-text.js";
import { findSecret, redact } from "../src/secrets.js";

/** These credential shapes outlive the removed proof of concept: an old file or text may still carry them. */
describe("Instagram token shape", () => {
  it("is recognised by redact and findSecret", () => {
    const token = `IGAA${"a".repeat(36)}`;
    expect(token).toHaveLength(40);
    expect(findSecret(`x ${token} y`)).toBe(token);
    expect(redact(`x ${token} y`)).not.toContain(token);
  });
});

describe("Facebook Page tokens", () => {
  const PAGE_TOKEN = `EAA${"a".repeat(40)}`;

  it("are recognized as secrets", () => {
    expect(findSecret(`x ${PAGE_TOKEN} y`)).toBe(PAGE_TOKEN);
    expect(findSecret(`EAA${"a".repeat(19)}`)).toBeUndefined();
    expect(() => parseFactory(`social: { signature: ${PAGE_TOKEN} }\n`)).toThrow(ConfigError);
    expect(publicText(`token ${PAGE_TOKEN}`, []).removed).toBe(true);
  });
});
