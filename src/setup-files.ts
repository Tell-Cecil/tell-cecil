// Pure helpers for `tell-cecil init`: where the repo lives, and the .env and .gitignore it writes.

export interface Remote {
  tracker: "github" | "gitlab";
  /** "owner/repo", or "group/subgroup/project" on GitLab. */
  repo: string;
  /** GitLab instance, when it isn't gitlab.com. */
  url?: string;
}

/** The tracker and repo behind a git remote URL (https, ssh or scp-like), or null when it isn't GitHub or a GitLab host. */
export function parseRemote(remote: string): Remote | null {
  const m =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(remote.trim()) ??
    /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (!m) return null;
  const [, host, path] = m as unknown as [string, string, string];
  if (host === "github.com" || host === "ssh.github.com") return /^[\w.-]+\/[\w.-]+$/.test(path) ? { tracker: "github", repo: path } : null;
  if (/gitlab/i.test(host) && /^[\w.-]+(\/[\w.-]+)+$/.test(path)) {
    return host === "gitlab.com" ? { tracker: "gitlab", repo: path } : { tracker: "gitlab", repo: path, url: `https://${host}` };
  }
  return null;
}

/** Dev server origins from the project's dependencies: the framework's default port. */
export function guessOrigins(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null): string[] {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const port = deps.next ? 3000 : deps.astro ? 4321 : deps["@sveltejs/kit"] || deps.vite ? 5173 : deps["react-scripts"] ? 3000 : 5173;
  return [`http://localhost:${port}`];
}

/** GitHub App names to try for a repo, best first, each at most GitHub's 34 characters. */
export function appNames(repo: string, random: string): string[] {
  const [owner = "", name = ""] = repo.split("/");
  const fit = (base: string, tail: string) => `${base.slice(0, 34 - tail.length).replace(/[\s._-]+$/, "")}${tail}`;
  return [fit(name, " feedback"), fit(name, ` feedback ${owner}`.slice(0, 20)), fit(name, ` feedback ${random}`)];
}

/** The URL slug GitHub gives an app name. */
export const appSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A readable project key from a repo or project name, e.g. "acme/Web Site" -> "pk_web-site". */
export const projectKey = (name: string) => `pk_${name.split("/").pop()!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site"}`;

// Variables init writes. Others in .env (CECIL_LABELS, PORT, the user's own) are left alone.
const OWNED = /^CECIL_(PROJECT_KEY|ORIGINS|GITHUB_\w+|GITLAB_\w+|JIRA_\w+)$/;
const LINE = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/;

const unquote = (v: string) => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t.replace(/\s+#.*$/, "");
};

/** Variables init would replace with a different value. Writing over them needs --force. */
export function envConflicts(text: string, vars: Record<string, string>): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m && OWNED.test(m[1]!) && unquote(m[2]!) !== vars[m[1]!]) found.push(m[1]!);
  }
  return [...new Set(found)];
}

const MARK = "# Tell Cecil (written by npx tell-cecil init)";
// Node's .env parser (and dotenv) has no escapes: a quoted value runs to the same quote. Use a quote the value lacks.
function quote(v: string): string {
  if (/^[\w.,:/@+=-]*$/.test(v)) return v;
  if (/[\r\n]/.test(v)) throw new Error("a .env value can't contain a line break");
  const q = ["'", '"', "`"].find((c) => !v.includes(c));
  if (!q) throw new Error("a .env value can't contain all of ', \" and `");
  return `${q}${v}${q}`;
}

/** The .env text with init's variables set and any other tracker's removed. Other lines are kept as they were. */
export function mergeEnv(text: string, vars: Record<string, string>): string {
  const kept = text
    .split(/\r?\n/)
    .filter((line) => {
      const m = LINE.exec(line);
      return !(m && OWNED.test(m[1]!)) && line !== MARK;
    })
    .join("\n")
    .replace(/\n+$/, "");
  const added = Object.entries(vars).map(([k, v]) => `${k}=${quote(v)}`);
  return `${kept ? `${kept}\n\n` : ""}${MARK}\n${added.join("\n")}\n`;
}

/** The .gitignore text with .env ignored, or null when it already is. */
export function ignoreEnv(text: string): string | null {
  const ignored = text.split(/\r?\n/).some((l) => /^\/?(\.env|\.env\*|\*\.env)$/.test(l.trim()));
  if (ignored) return null;
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}.env\n`;
}
