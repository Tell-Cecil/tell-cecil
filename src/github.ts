import { appTokens, HEADERS, type GitHubApp } from "./github-app";
import { formatBody, formatTitle } from "./markdown";
import type { Report, Tracker } from "./types";

export type { GitHubApp };

export interface GitHubTarget {
  /** "owner/repo". Server-side only: the browser never chooses where issues go. */
  repo: string;
  /** Token with issues:write on that repo. Never sent to the browser. Set this or `app`. */
  token?: string;
  /** A GitHub App installed on the repo; issues are filed as the app's bot. Set this or `token`. */
  app?: GitHubApp;
  labels?: string[];
}

// Zero-width spaces stop reporters from pinging GitHub users or linking other repos' issues. Only the comment is free markdown;
// everything else is rendered in a code span, where GitHub links nothing, so it is kept byte-exact.
export const noPing = (s: string) =>
  s
    .replace(/(?<!\w)@(?=[\w-])/g, "@​")
    .replace(/([\w.-]+\/[\w.-]+)#(\d)/g, "$1#​$2")
    .replace(/\bGH-(\d)/gi, "GH-​$1");

export function githubTracker({ repo, token, app, labels }: GitHubTarget, now?: () => number): Tracker {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo "${repo}" must look like "owner/repo"`);
  if (token !== undefined && app) throw new Error("set a GitHub token or a GitHub App, not both");
  if (!app && !token) throw new Error("GitHub token is empty");
  const tokens = app && appTokens(app, repo, now);
  return {
    name: "GitHub",
    async file(report: Report, doFetch, timeoutMs) {
      const r = { ...report, comment: noPing(report.comment) };
      const bearer = tokens ? await tokens.token(doFetch, timeoutMs) : token;
      const res = await doFetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: { ...HEADERS, authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ title: formatTitle(r), body: formatBody(r), labels }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401) tokens?.reset();
      return res;
    },
    issue(reply) {
      const { html_url, number } = reply as { html_url?: string; number?: number };
      return { url: html_url, number };
    },
  };
}
