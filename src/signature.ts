import type { Signature } from "./config.js";
import type { IssueApi } from "./intake/github.js";
import type { MergeApi } from "./line/automerge.js";

/** A commit message ending with the signature's trailer as its own last paragraph, so git reads it as a trailer. */
export function withTrailer(message: string, signature?: Signature): string {
  return signature ? `${message}\n\n${signature.trailer}` : message;
}

/** A pull request, issue or comment body ending with the signature's text. */
export function signText(body: string, signature?: Signature): string {
  return signature ? `${body}\n\n${signature.text}` : body;
}

/** Signs every comment and issue the factory writes through `api`; the adapter still adds FACTORY_MARK after it. */
export function signedIssues(api: IssueApi, signature?: Signature): IssueApi {
  if (!signature) return api;
  return {
    labeled: (label) => api.labeled(label),
    unlabeled: () => api.unlabeled(),
    issue: (number) => api.issue(number),
    lastLabeled: (number, label) => api.lastLabeled(number, label),
    permission: (login) => api.permission(login),
    comment: (number, body) => api.comment(number, signText(body, signature)),
    comments: (number) => api.comments(number),
    ensureLabel: (label, description) => api.ensureLabel(label, description),
    createIssue: (title, body, labels) => api.createIssue(title, signText(body, signature), labels),
    addLabels: (number, labels) => api.addLabels(number, labels),
    close: (number, reason) => api.close(number, reason),
  };
}

/** Signs the comments the automatic merge posts on pull requests. */
export function signedMerges(api: MergeApi, signature?: Signature): MergeApi {
  if (!signature) return api;
  return {
    pullRequest: (number) => api.pullRequest(number),
    checks: (sha) => api.checks(sha),
    merge: (number, sha) => api.merge(number, sha),
    deleteBranch: (branch) => api.deleteBranch(branch),
    comment: (number, body) => api.comment(number, signText(body, signature)),
  };
}
