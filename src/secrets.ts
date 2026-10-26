/**
 * Recognisable credential shapes. Used to keep secrets out of the factory
 * definition and out of the townhall. Not exhaustive: a last line of defence,
 * not a vault.
 */
const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** `password: hunter2`, `api_key="..."`: only the value is a secret. */
const ASSIGNMENT = /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*["']?)([^\s"']{8,})/gi;

export const REDACTED = "[REDACTED]";

export function findSecret(text: string): string | undefined {
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

export function redact(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  return out.replace(ASSIGNMENT, (_, key, sep) => `${key}${sep}${REDACTED}`);
}
