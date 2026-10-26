import type { Project } from "./relay";

export const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** The runner's one project from CECIL_* variables. Setting variables for more than one tracker, or none, fails in createRelay. */
export function projectFromEnv(env: Record<string, string | undefined>): Project {
  const labels = env.CECIL_LABELS ? list(env.CECIL_LABELS) : undefined;
  const project: Project = { origins: list(env.CECIL_ORIGINS ?? "http://localhost:5173") };
  if (env.CECIL_GITHUB_TOKEN || env.CECIL_GITHUB_REPO) {
    project.github = { repo: env.CECIL_GITHUB_REPO ?? "", token: env.CECIL_GITHUB_TOKEN ?? "", labels };
  }
  if (env.CECIL_GITLAB_TOKEN || env.CECIL_GITLAB_PROJECT) {
    project.gitlab = { project: env.CECIL_GITLAB_PROJECT ?? "", token: env.CECIL_GITLAB_TOKEN ?? "", url: env.CECIL_GITLAB_URL || undefined, labels };
  }
  if (env.CECIL_JIRA_TOKEN || env.CECIL_JIRA_PROJECT) {
    project.jira = {
      url: env.CECIL_JIRA_URL ?? "",
      email: env.CECIL_JIRA_EMAIL ?? "",
      token: env.CECIL_JIRA_TOKEN ?? "",
      project: env.CECIL_JIRA_PROJECT ?? "",
      issueType: env.CECIL_JIRA_ISSUE_TYPE || undefined,
      labels,
    };
  }
  return project;
}
