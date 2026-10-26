import { formatBody, formatTitle } from "./markdown";
import type { Report, Tracker } from "./types";

export interface GitHubTarget {
  /** "owner/repo". Server-side only: the browser never chooses where issues go. */
  repo: string;
  /** Token with issues:write on that repo. Never sent to the browser. */
  token: string;
  labels?: string[];
}

// Zero-width spaces stop reporters from pinging GitHub users or linking other repos' issues. Only the comment is free markdown;
// everything else is rendered in a code span, where GitHub links nothing, so it is kept byte-exact.
export const noPing = (s: string) =>
  s
    .replace(/(?<!\w)@(?=[\w-])/g, "@​")
    .replace(/([\w.-]+\/[\w.-]+)#(\d)/g, "$1#​$2")
    .replace(/\bGH-(\d)/gi, "GH-​$1");

export function githubTracker({ repo, token, labels }: GitHubTarget): Tracker {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo "${repo}" must look like "owner/repo"`);
  if (!token) throw new Error("GitHub token is empty");
  return {
    name: "GitHub",
    file(report: Report, doFetch, timeoutMs) {
      const r = { ...report, comment: noPing(report.comment) };
      return doFetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "cecil-relay",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: formatTitle(r), body: formatBody(r), labels }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    issue(reply) {
      const { html_url, number } = reply as { html_url?: string; number?: number };
      return { url: html_url, number };
    },
  };
}
