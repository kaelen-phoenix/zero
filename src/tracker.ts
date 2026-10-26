import { Octokit } from "@octokit/rest";

export interface Task {
  number: number;
  title: string;
  body: string;
}

/** Where tasks come from and where results are reported. GitHub Issues by default. */
export interface Tracker {
  nextReady(label: string): Promise<Task | null>;
  get(number: number): Promise<Task>;
  setState(number: number, add: string, remove: string[]): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  openPullRequest(pr: { head: string; base: string; title: string; body: string }): Promise<string>;
}

export function createGitHubTracker(token: string, repository: string): Tracker {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository "${repository}", expected owner/repo`);
  const gh = new Octokit({ auth: token });
  const toTask = (i: { number: number; title: string; body?: string | null }): Task => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
  });

  return {
    async nextReady(label) {
      const { data } = await gh.issues.listForRepo({
        owner, repo, labels: label, state: "open", sort: "created", direction: "asc", per_page: 10,
      });
      const issue = data.find((i) => !i.pull_request);
      return issue ? toTask(issue) : null;
    },
    async get(number) {
      const { data } = await gh.issues.get({ owner, repo, issue_number: number });
      return toTask(data);
    },
    async setState(number, add, remove) {
      for (const name of remove) {
        await gh.issues.removeLabel({ owner, repo, issue_number: number, name }).catch((e) => {
          if (e.status !== 404) throw e;
        });
      }
      await gh.issues.addLabels({ owner, repo, issue_number: number, labels: [add] });
    },
    async comment(number, body) {
      await gh.issues.createComment({ owner, repo, issue_number: number, body });
    },
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
