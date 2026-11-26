import { stripAttribution } from "./attribution.js";
import type { Signature } from "./config.js";
import type { IssueApi } from "./intake/github.js";
import type { MergeApi } from "./line/automerge.js";

/**
 * A commit message without AI attribution, ending with the signature's trailer
 * as its own last paragraph, so git reads it as a trailer.
 */
export function withTrailer(message: string, signature?: Signature): string {
  const clean = stripAttribution(message);
  return signature ? `${clean}\n\n${signature.trailer}` : clean;
}

/** A pull request, issue or comment body without AI attribution, ending with the signature's text. */
export function signText(body: string, signature?: Signature): string {
  const clean = stripAttribution(body);
  return signature ? `${clean}\n\n${signature.text}` : clean;
}

/**
 * Cleans and signs every comment and issue the factory writes through `api`,
 * even without a signature; the adapter still adds FACTORY_MARK after it.
 */
export function signedIssues(api: IssueApi, signature?: Signature): IssueApi {
  return {
    labeled: (label) => api.labeled(label),
    unlabeled: () => api.unlabeled(),
    issue: (number) => api.issue(number),
    lastLabeled: (number, label) => api.lastLabeled(number, label),
    permission: (login) => api.permission(login),
    comment: (number, body) => api.comment(number, signText(body, signature)),
    comments: (number) => api.comments(number),
    ensureLabel: (label, description) => api.ensureLabel(label, description),
    createIssue: (title, body, labels) => api.createIssue(stripAttribution(title), signText(body, signature), labels),
    addLabels: (number, labels) => api.addLabels(number, labels),
    close: (number, reason) => api.close(number, reason),
  };
}

/** Cleans and signs the comments the automatic merge posts on pull requests, even without a signature. */
export function signedMerges(api: MergeApi, signature?: Signature): MergeApi {
  return {
    pullRequest: (number) => api.pullRequest(number),
    checks: (sha) => api.checks(sha),
    merge: (number, sha) => api.merge(number, sha),
    deleteBranch: (branch) => api.deleteBranch(branch),
    comment: (number, body) => api.comment(number, signText(body, signature)),
    ...(api.close && { close: (number: number) => api.close!(number) }),
    ...(api.behind && { behind: (base: string, sha: string) => api.behind!(base, sha) }),
    ...(api.updateBranch && { updateBranch: (number: number, sha: string) => api.updateBranch!(number, sha) }),
    ...(api.rerun && { rerun: (run: number) => api.rerun!(run) }),
    ...(api.failedLog && { failedLog: (run: number, check: string) => api.failedLog!(run, check) }),
  };
}
