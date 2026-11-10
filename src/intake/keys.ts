/** State the issue intake keeps in `kv`, shared with the views that report on it. */
export const issueKey = (repository: string, number: number) => `issue:${repository}#${number}`;
export const intakeProblemKey = (line: string) => `intake.problem.${line}`;
/** The same for the Linear intake. */
export const linearIssueKey = (team: string, id: string) => `linear-issue:${team}/${id}`;
export const linearProblemKey = (line: string) => `intake.linear.problem.${line}`;
/** A Jira issue's state, by the site's host and the issue key. */
export const jiraIssueKey = (site: string, key: string) => `jira:${new URL(site).host}/${key}`;
export const jiraProblemKey = (line: string) => `jira.problem.${line}`;

/** Hidden mark on every comment the factory posts, so it never answers itself (it comments as the owner). */
export const FACTORY_MARK = "<!-- zero -->";

/** Label of the issues that record night-shift proposals: decided by the proposal sync, never taken by the intake. */
export const PROPOSAL_LABEL = "zero:propuesta";
