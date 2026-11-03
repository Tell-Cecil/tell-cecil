// Read-only checks that a project's tracker config can file issues. Used by `tell-cecil check` and the setup page.
import { baseUrl } from "./base-url";
import { appTokens, HEADERS } from "./github-app";
import type { Project } from "./relay";

const TIMEOUT = 10_000;

/** Why a tracker refused, in words a person can act on. */
function refused(status: number, what: string, fix: string): Error {
  if (status === 401) return new Error(`the ${what} credentials were rejected (401). ${fix}`);
  if (status === 403 || status === 404) return new Error(`the ${what} credentials can't see it (${status}). ${fix}`);
  return new Error(`${what} answered ${status}`);
}

/** Resolves with a one-line description of where issues will go, or rejects with what's wrong. */
export async function probe(project: Project, doFetch: typeof fetch = fetch): Promise<string> {
  const get = (url: string, headers: Record<string, string>) => doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });

  if (project.github) {
    const { repo, token, app } = project.github;
    const bearer = app ? await appTokens(app, repo).token(doFetch, TIMEOUT) : token;
    const res = await get(`https://api.github.com/repos/${repo}`, { ...HEADERS, authorization: `Bearer ${bearer}` });
    if (res.status !== 200) throw refused(res.status, "GitHub", `Give the token access to ${repo} with Issues: read and write.`);
    const r = (await res.json()) as { has_issues?: boolean; private?: boolean };
    if (r.has_issues === false) throw new Error(`issues are turned off for ${repo}. Turn them on in the repo's Settings > General > Features.`);
    return `GitHub ${repo}${r.private === false ? " (public: anyone can read the reports)" : ""}${app ? ", filed by the GitHub App" : ""}`;
  }

  if (project.gitlab) {
    const { project: path, token, url = "https://gitlab.com" } = project.gitlab;
    const res = await get(`${baseUrl(url, "GitLab URL", "https://gitlab.example.com")}/api/v4/projects/${encodeURIComponent(path)}`, { "private-token": token, "user-agent": "cecil-relay" });
    if (res.status !== 200) throw refused(res.status, "GitLab", `Use a token with the api scope from an account with the Reporter role on ${path}.`);
    const r = (await res.json()) as { issues_enabled?: boolean; visibility?: string };
    if (r.issues_enabled === false) throw new Error(`issues are turned off for ${path}. Turn them on in Settings > General > Visibility.`);
    return `GitLab ${path}${r.visibility === "public" ? " (public: anyone can read the reports)" : ""}`;
  }

  if (project.jira) {
    const { url, email, token, project: key, issueType = "Task" } = project.jira;
    const site = baseUrl(url, "Jira URL", "https://acme.atlassian.net");
    const auth = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${email}:${token}`)))}`;
    const res = await get(`${site}/rest/api/3/project/${encodeURIComponent(key)}`, { authorization: auth, accept: "application/json", "user-agent": "cecil-relay" });
    if (res.status !== 200) throw refused(res.status, "Jira", `Check the email, the API token and that the account can create issues in ${key}.`);
    const r = (await res.json()) as { issueTypes?: { name: string }[] };
    const types = (r.issueTypes ?? []).map((t) => t.name);
    if (types.length && !types.includes(issueType)) throw new Error(`project ${key} has no "${issueType}" issue type. Set CECIL_JIRA_ISSUE_TYPE to one of: ${types.join(", ")}.`);
    return `Jira ${key} on ${site}`;
  }

  throw new Error("no tracker configured");
}
