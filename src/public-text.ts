import { breakMentions } from "./intake/proposals.js";
import { reportText } from "./report.js";
import { redact } from "./secrets.js";

const LOCAL_PATH = "(ruta local)";
const WEB_URL = /(https?:\/\/[^\s<>"'`)\]]+)/i;

// What `reportText` leaves: any other absolute path. A lone segment only counts under a system root, so `/line` or `CI/CD` stay.
const OTHER_PATHS = [
  /(?<![\w.:/\\~-])\/[\w.@-]+\/[\w.@-]/,
  /(?<![\w.:/\\~-])\/(?:bin|etc|home|mnt|opt|private|root|srv|tmp|Users|usr|var|Volumes)(?![\w-])/,
  /(?<![\w\\])\\\\?[\w.$-]+\\[\w.$-]/,
];

/** From the first local path to the end of its line: a path with spaces has no other known end. */
function dropPaths(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const at = Math.min(...[...OTHER_PATHS, new RegExp(LOCAL_PATH.replace(/[()]/g, "\\$&"))].map((p) => line.search(p)).filter((i) => i >= 0));
      return Number.isFinite(at) ? `${line.slice(0, at)}${LOCAL_PATH}` : line;
    })
    .join("\n");
}

/**
 * Text fit for the whole internet: secrets and local paths out, @mentions
 * broken, web addresses untouched. A best-effort filter, like `scrub`, so
 * `removed` tells the caller something had to go.
 */
export function publicText(text: string, repos: string[]): { text: string; removed: boolean } {
  const redacted = redact(text);
  const scrubbed = reportText(redacted, { all: repos });
  const parts = scrubbed.split(WEB_URL);
  // Odd parts are the addresses; a path after one still ends its own stretch of text, so each stretch is read alone.
  const out = parts.map((part, i) => (i % 2 ? part : breakMentions(dropPaths(part)))).join("");
  const plain = parts.map((part, i) => (i % 2 ? part : dropPaths(part))).join("");
  return { text: out, removed: plain !== text };
}
