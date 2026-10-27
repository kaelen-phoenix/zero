/** State the issue intake keeps in `kv`, shared with the views that report on it. */
export const issueKey = (repository: string, number: number) => `issue:${repository}#${number}`;
export const intakeProblemKey = (line: string) => `intake.problem.${line}`;

/** Hidden mark on every comment the factory posts, so it never answers itself (it comments as the owner). */
export const FACTORY_MARK = "<!-- zero -->";
