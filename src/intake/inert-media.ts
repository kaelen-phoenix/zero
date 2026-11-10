/** The opening `<` of a tag that loads a resource, open or closing, up to where the tag name ends. */
const RESOURCE_TAG = /<(?=\/?(?:img|picture|source|video|audio|iframe)(?:[\s/>]|$))/gi;

/**
 * Makes remote media inert in text bound for GitHub, so nothing is fetched just
 * by opening the issue: Markdown images get their `[` escaped and resource tags
 * their `<` as an entity, since a backslash does nothing inside an HTML block.
 * It reads no context on purpose: a model cannot step out of it with backticks.
 * Run it last: removing a path from the text can bring the syntax together.
 */
export function inertMedia(text: string): string {
  return text.replace(/!\[/g, "!\\[").replace(RESOURCE_TAG, "&lt;");
}
