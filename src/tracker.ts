import { Octokit } from "@octokit/rest";

/** GitHub, for lines that integrate through pull requests. */
export interface PullRequests {
  /** Opens a pull request, or updates the open one for the same branch. Returns its URL. */
  openPullRequest(pr: { head: string; base: string; title: string; body: string }): Promise<string>;
}

export function createGitHubTracker(token: string, repository: string): PullRequests {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository "${repository}", expected owner/repo`);
  const gh = new Octokit({ auth: token });
  return {
    async openPullRequest({ head, base, title, body }) {
      const existing = await gh.pulls.list({ owner, repo, head: `${owner}:${head}`, state: "open" });
      if (existing.data[0]) {
        await gh.pulls.update({ owner, repo, pull_number: existing.data[0].number, title, body });
        return existing.data[0].html_url;
      }
      const { data } = await gh.pulls.create({ owner, repo, head, base, title, body });
      return data.html_url;
    },
  };
}
