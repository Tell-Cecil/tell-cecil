import { baseUrl } from "./base-url";
import { formatBody, formatTitle } from "./markdown";
import type { Report, Tracker } from "./types";

export interface GitLabTarget {
  /** "group/project" (subgroups allowed) or the numeric project ID. Server-side only. */
  project: string;
  /** Personal, group or project access token with the api scope, Reporter role or higher. Never sent to the browser. */
  token: string;
  labels?: string[];
  /** Your GitLab instance. Default "https://gitlab.com". */
  url?: string;
}

// Zero-width spaces stop reporters from pinging users (@all included) and from linking issues, merge requests, snippets,
// epics, labels and milestones. Only the comment is free markdown; GitLab links nothing in code spans. Quick actions
// (/close) need a line of their own, and every comment line is blockquoted.
export const noPing = (s: string) =>
  s
    .replace(/(?<!\w)@(?=[\w-])/g, "@​")
    .replace(/([#!$&])(?=\d)/g, "$1​")
    .replace(/([~%])(?=[\w"])/g, "$1​");

export function gitlabTracker({ project, token, labels, url = "https://gitlab.com" }: GitLabTarget): Tracker {
  if (!/^(\d+|[\w.-]+(\/[\w.-]+)+)$/.test(project)) throw new Error(`GitLab project "${project}" must look like "group/project" or be a numeric ID`);
  if (!token) throw new Error("GitLab token is empty");
  if (labels?.some((l) => l.includes(","))) throw new Error("GitLab labels can't contain commas");
  const api = `${baseUrl(url, "GitLab URL", "https://gitlab.example.com")}/api/v4/projects/${encodeURIComponent(project)}/issues`;
  return {
    name: "GitLab",
    file(report: Report, doFetch, timeoutMs) {
      const r = { ...report, comment: noPing(report.comment) };
      return doFetch(api, {
        method: "POST",
        headers: { "private-token": token, "user-agent": "cecil-relay", "content-type": "application/json" },
        body: JSON.stringify({ title: formatTitle(r), description: formatBody(r), labels: labels?.join(",") }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    issue(reply) {
      const { web_url, iid } = reply as { web_url?: string; iid?: number };
      return { url: web_url, number: iid };
    },
  };
}
