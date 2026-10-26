import { createHash, randomBytes } from "node:crypto";
import type { SecretStore } from "../keychain.js";

export const PANEL_KEY = "ZERO_PANEL_KEY";

/** The panel's key: created on first use and kept in the OS keychain, never in a file. */
export function panelKey(secrets: SecretStore): string {
  return secrets.get(PANEL_KEY) ?? rotatePanelKey(secrets);
}

/** A new key: every link and session made with the old one stops working. */
export function rotatePanelKey(secrets: SecretStore): string {
  const key = randomBytes(32).toString("base64url");
  secrets.set(PANEL_KEY, key);
  return key;
}

/** The key travels in the fragment, which browsers never send to the server (or to a tunnel in between). */
export const panelLink = (base: string, key: string) => `${base.replace(/\/$/, "")}/#k=${key}`;

/** The session cookie derives from the key: it survives daemon restarts and dies when the key rotates. */
export const sessionFor = (key: string) => createHash("sha256").update(`${key}:session`).digest("hex");
