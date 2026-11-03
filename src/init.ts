// `npx tell-cecil init`: connects a tracker in the browser and writes .env. Built so a coding agent can run it: the
// person authorizes on a local page, and secrets go from that page straight into .env, never through the terminal.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseArgs } from "node:util";
import { HEADERS } from "./github-app";
import { probe } from "./probe";
import type { Project } from "./relay";
import { appNames, appSlug, envConflicts, guessOrigins, ignoreEnv, mergeEnv, parseRemote, projectKey } from "./setup-files";

const HELP = `Usage: npx tell-cecil init [options]

Connects GitHub, GitLab or Jira in your browser and writes the CECIL_* variables to .env.
GitHub and GitLab are read from the git remote "origin" when you don't pass them.

  --tracker <github|gitlab|jira>
  --repo <owner/repo>      GitHub repo or GitLab project path
  --url <url>              Self-hosted GitLab, or your Jira site (https://acme.atlassian.net)
  --project <KEY>          Jira project key
  --email <email>          Jira account email
  --origin <url>           Site origin allowed to send reports. Repeat for more. Default: your dev server
  --key <pk_...>           Project key for the widget. Default: pk_<repo name>
  --token                  GitHub: paste a fine-grained token instead of creating a GitHub App
  --force                  Replace CECIL_* variables already in .env
  --no-browser             Print the setup link without opening it
  --timeout <minutes>      Give up after this long. Default 15
`;

type Tracker = "github" | "gitlab" | "jira";
interface Done {
  vars: Record<string, string>;
  where: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const out = (s = "") => process.stdout.write(`${s}\n`);
// This package's version, for the CDN link. Walks up because the code runs from src/ or from dist/chunks/.
const version = (): string => {
  for (const up of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(up, import.meta.url), "utf8"));
      if (pkg.name === "tell-cecil") return pkg.version;
    } catch {
      // Try the next folder up.
    }
  }
  return "latest";
};

function gitRemote(): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, never> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // The link is printed as well.
  }
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req as AsyncIterable<Buffer>) {
    body += chunk;
    if (body.length > 20_000) throw new Error("form too large");
  }
  return new URLSearchParams(body);
}

// ---- Pages ----

const STYLE = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#f6f6f4;color:#161616}
main{max-width:560px;margin:56px auto;padding:0 16px}.card{background:#fff;border:1px solid #e4e4e0;border-radius:12px;padding:28px}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 14px}.muted{color:#6b6b66;font-size:14px}code{font:13px ui-monospace,monospace;background:#f1f1ee;padding:1px 5px;border-radius:4px}
ol{padding-left:20px;margin:0 0 18px}li{margin-bottom:10px}label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}
input{width:100%;padding:9px 11px;border:1px solid #cfcfca;border-radius:8px;font:14px ui-monospace,monospace}
button,.btn{display:inline-block;margin-top:18px;padding:10px 18px;border:0;border-radius:8px;background:#161616;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.light{background:#fff;color:#161616;border:1px solid #cfcfca}.err{background:#fdeceb;color:#8a1c14;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:14px}
.ok{font-size:40px;line-height:1}.brand{font-weight:700;font-size:14px;margin-bottom:14px;color:#6b6b66}
@media (prefers-color-scheme:dark){body{background:#121211;color:#ededea}.card{background:#1b1b1a;border-color:#2c2c2a}code{background:#262624}
input{background:#121211;color:#ededea;border-color:#3a3a37}button,.btn{background:#ededea;color:#121211}.btn.light{background:#1b1b1a;color:#ededea;border-color:#3a3a37}
.muted,.brand{color:#9a9a94}a{color:#8ab4ff}.err{background:#3a1512;color:#f6b8b2}}`;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${esc(title)}</title><style>${STYLE}</style></head><body><main><div class="brand">Tell Cecil setup</div><div class="card">${body}</div></main></body></html>`;

const errorBox = (e?: string) => (e ? `<div class="err">${esc(e)}</div>` : "");

const donePage = (where: string) =>
  page("Connected", `<div class="ok">✓</div><h1>Connected</h1><p>Reports will be filed in <b>${esc(where)}</b>.</p><p class="muted">You can close this tab. The terminal or your agent finishes the setup.</p>`);

// ---- init ----

export async function init(argv: string[]): Promise<number> {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      tracker: { type: "string" },
      repo: { type: "string" },
      url: { type: "string" },
      project: { type: "string" },
      email: { type: "string" },
      origin: { type: "string", multiple: true },
      key: { type: "string" },
      token: { type: "boolean" },
      force: { type: "boolean" },
      "no-browser": { type: "boolean" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (a.help) {
    out(HELP);
    return 0;
  }

  const remote = a.repo || a.tracker === "jira" ? null : gitRemote();
  const detected = remote ? parseRemote(remote) : null;
  const tracker = (a.tracker ?? detected?.tracker) as Tracker | undefined;
  if (!tracker || !["github", "gitlab", "jira"].includes(tracker)) {
    out(`tell-cecil: couldn't tell where issues should go${remote ? ` (git remote: ${remote})` : ""}. Pass --tracker github|gitlab|jira and --repo.`);
    return 1;
  }
  const repo = a.repo ?? (detected?.tracker === tracker ? detected.repo : undefined);
  if (tracker !== "jira" && !repo) {
    out(`tell-cecil: pass --repo ${tracker === "github" ? "owner/repo" : "group/project"}.`);
    return 1;
  }
  if (tracker === "github" && !/^[\w.-]+\/[\w.-]+$/.test(repo!)) {
    out(`tell-cecil: --repo "${repo}" must look like owner/repo.`);
    return 1;
  }
  const gitlabUrl = (tracker === "gitlab" && (a.url ?? detected?.url)) || undefined;
  const origins = a.origin?.length ? a.origin : guessOrigins(readJson("package.json"));
  for (const o of origins) {
    let ok = false;
    try {
      ok = new URL(o).origin === o;
    } catch {}
    if (!ok) {
      out(`tell-cecil: --origin "${o}" must be exactly an origin, like https://example.com or http://localhost:5173.`);
      return 1;
    }
  }
  const key = a.key ?? projectKey(repo ?? a.project ?? "site");
  const base = { CECIL_PROJECT_KEY: key, CECIL_ORIGINS: origins.join(",") };

  const envText = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const conflicts = envConflicts(envText, base);
  if (conflicts.length && !a.force) {
    out(`tell-cecil: .env already has ${conflicts.join(", ")}. Run again with --force to replace them.`);
    return 1;
  }
  const writeEnv = (vars: Record<string, string>) => {
    writeFileSync(".env", mergeEnv(existsSync(".env") ? readFileSync(".env", "utf8") : "", { ...base, ...vars }), { mode: 0o600 });
  };

  // ---- the local setup page ----
  const state = randomBytes(16).toString("hex");
  let port = 0;
  const local = () => `http://127.0.0.1:${port}`;
  const at = (p = "") => `${local()}/${state}${p}`;
  const owner = repo?.split("/")[0] ?? "";
  const useApp = tracker === "github" && !a.token;
  let app: { id: string; slug: string; key: string } | undefined;

  // The install page, with the owner and only this repo selected when their IDs can be found.
  async function installUrl(slug: string): Promise<string> {
    const params = new URLSearchParams();
    if (ownerId) params.set("suggested_target_id", String(ownerId));
    const id = await repoId();
    if (id) params.append("repository_ids[]", String(id));
    return `https://github.com/apps/${slug}/installations/new${params.size ? `/permissions?${params}` : ""}`;
  }

  // Public repos are visible anonymously; for a private one, ask the GitHub CLI if it's signed in.
  async function repoId(): Promise<number | undefined> {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
      if (res.status === 200) return ((await res.json()) as { id: number }).id;
    } catch {
      // Try gh.
    }
    try {
      const id = Number(execFileSync("gh", ["api", `repos/${repo}`, "--jq", ".id"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim());
      return id || undefined;
    } catch {
      return undefined;
    }
  }

  let finish!: (d: Done) => void;
  const finished = new Promise<Done>((r) => (finish = r));

  async function check(project: Omit<Project, "origins">): Promise<string> {
    return probe({ origins: origins, ...project });
  }

  function githubPage(error?: string): string {
    const manifest = {
      name: appName,
      url: "https://github.com/Tell-Cecil/tell-cecil",
      description: `Files website feedback from Tell Cecil as issues in ${repo}.`,
      public: false,
      redirect_url: at("/github/created"),
      setup_url: at("/github/installed"),
      setup_on_update: true,
      hook_attributes: { url: "https://example.invalid/", active: false },
      default_permissions: { issues: "write", metadata: "read" },
      default_events: [],
    };
    return page(
      "Connect GitHub",
      `${errorBox(error)}<h1>Connect ${esc(repo!)}</h1>
<p>Tell Cecil files reports through its own GitHub App, so issues come from a bot and no token expires.</p>
<ol><li><b>Create the app.</b> GitHub shows what it can do: read and write issues, nothing else. Click <i>Create GitHub App</i> there.</li>
<li><b>Install it</b> on <code>${esc(repo!)}</code> only.</li></ol>
<form id="f" method="post" action="https://github.com/${orgPath}settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}"><button>Create GitHub App</button></form>
<p class="muted" style="margin-top:18px">Rather use a token? <a href="${at("/token")}">Paste a fine-grained token instead</a>.</p>`,
    );
  }

  function tokenPage(error?: string, form: Record<string, string> = {}): string {
    const v = (k: string, d = "") => esc(form[k] ?? d);
    if (tracker === "github") {
      const create = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
        name: `Tell Cecil ${repo}`.slice(0, 40),
        description: `Lets the Tell Cecil relay file feedback issues in ${repo}.`,
        target_name: owner,
        expires_in: "90",
        issues: "write",
      })}`;
      return page(
        "Connect GitHub",
        `${errorBox(error)}<h1>Connect ${esc(repo!)}</h1><ol>
<li><a href="${esc(create)}" target="_blank" rel="noopener">Create a token on GitHub</a>. It's filled in for you: under <i>Repository access</i>, choose <b>Only select repositories</b> and pick <code>${esc(repo!)}</code>, then <i>Generate token</i>.</li>
<li>Paste it here. It goes into <code>.env</code> on this computer, nowhere else.</li></ol>
<form method="post" action="${at("/token")}"><label for="t">Token</label><input id="t" name="token" type="password" autocomplete="off" required placeholder="github_pat_…"><button>Connect</button></form>
${useApp ? `<p class="muted" style="margin-top:18px"><a href="${at("/")}">Back to the GitHub App</a></p>` : ""}`,
      );
    }
    if (tracker === "gitlab") {
      const create = `${gitlabUrl ?? "https://gitlab.com"}/-/user_settings/personal_access_tokens?${new URLSearchParams({ name: `Tell Cecil ${repo}`, scopes: "api" })}`;
      return page(
        "Connect GitLab",
        `${errorBox(error)}<h1>Connect ${esc(repo!)}</h1><ol>
<li><a href="${esc(create)}" target="_blank" rel="noopener">Create a token on GitLab</a>. Name and the <code>api</code> scope are filled in; set an expiry and click <i>Create</i>. A project access token (Settings &gt; Access tokens, Reporter role) works too.</li>
<li>Paste it here. It goes into <code>.env</code> on this computer, nowhere else.</li></ol>
<form method="post" action="${at("/token")}"><label for="t">Token</label><input id="t" name="token" type="password" autocomplete="off" required placeholder="glpat-…"><button>Connect</button></form>`,
      );
    }
    return page(
      "Connect Jira",
      `${errorBox(error)}<h1>Connect Jira</h1>
<p>Use an account that can create issues in the project. <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">Create an API token</a> for it, then fill this in. It goes into <code>.env</code> on this computer, nowhere else.</p>
<form method="post" action="${at("/token")}">
<label for="u">Jira site</label><input id="u" name="url" required value="${v("url", a.url ?? "")}" placeholder="https://acme.atlassian.net">
<label for="p">Project key</label><input id="p" name="project" required value="${v("project", a.project ?? "")}" placeholder="WEB">
<label for="e">Account email</label><input id="e" name="email" type="email" required value="${v("email", a.email ?? "")}">
<label for="t">API token</label><input id="t" name="token" type="password" autocomplete="off" required>
<label for="i">Issue type</label><input id="i" name="issueType" value="${v("issueType", "Task")}">
<button>Connect</button></form>`,
    );
  }

  async function saveToken(f: URLSearchParams): Promise<string> {
    const token = (f.get("token") ?? "").trim();
    let target: Omit<Project, "origins">;
    let vars: Record<string, string>;
    if (tracker === "github") {
      target = { github: { repo: repo!, token } };
      vars = { CECIL_GITHUB_REPO: repo!, CECIL_GITHUB_TOKEN: token };
    } else if (tracker === "gitlab") {
      target = { gitlab: { project: repo!, token, url: gitlabUrl } };
      vars = { CECIL_GITLAB_PROJECT: repo!, CECIL_GITLAB_TOKEN: token, ...(gitlabUrl && { CECIL_GITLAB_URL: gitlabUrl }) };
    } else {
      const g = (k: string) => (f.get(k) ?? "").trim();
      const url = g("url").replace(/\/+$/, "");
      const issueType = g("issueType") || "Task";
      target = { jira: { url, email: g("email"), token, project: g("project").toUpperCase(), issueType } };
      vars = { CECIL_JIRA_URL: url, CECIL_JIRA_EMAIL: g("email"), CECIL_JIRA_TOKEN: token, CECIL_JIRA_PROJECT: g("project").toUpperCase() };
      if (issueType !== "Task") vars.CECIL_JIRA_ISSUE_TYPE = issueType;
    }
    if (!token) throw new Error("Paste the token first.");
    const where = await check(target);
    writeEnv(vars);
    finish({ vars, where });
    return where;
  }

  let orgPath = "";
  let ownerId: number | undefined;
  let appName = appNames(repo ?? "", "")[0]!;
  if (useApp) {
    // App names are unique across GitHub. Public apps show up here; a private app with the name is caught by GitHub's form.
    for (const name of appNames(repo!, randomBytes(2).toString("hex"))) {
      appName = name;
      const res = await fetch(`https://api.github.com/apps/${appSlug(name)}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res?.status !== 200) break;
    }
    try {
      const res = await fetch(`https://api.github.com/users/${owner}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
      const u = (await res.json()) as { type?: string; id?: number };
      if (u.type === "Organization") orgPath = `organizations/${owner}/`;
      ownerId = u.id;
    } catch {
      // Assume a personal account; GitHub lets you switch owner if not.
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", ...headers });
      res.end(html);
    };
    // Only this page's own origin, so other sites and DNS rebinding can't drive it.
    if (req.headers.host !== `127.0.0.1:${port}`) return send(400, "Bad host");
    const url = new URL(req.url ?? "/", local());
    if (!url.pathname.startsWith(`/${state}`)) return send(404, page("Not found", "<h1>Not found</h1><p>Use the link printed by <code>tell-cecil init</code>.</p>"));
    const route = url.pathname.slice(state.length + 1) || "/";

    try {
      if (req.method === "POST" && route === "/token") {
        if (req.headers.origin !== local()) return send(403, "Bad origin");
        const f = await readForm(req);
        try {
          return send(200, donePage(await saveToken(f)));
        } catch (err) {
          return send(200, tokenPage((err as Error).message.replace(/^./, (c) => c.toUpperCase()), Object.fromEntries(f)));
        }
      }
      if (req.method !== "GET") return send(405, "Method not allowed");
      if (route === "/") return send(200, useApp ? githubPage() : tokenPage());
      if (route === "/token") return send(200, tokenPage());

      if (route === "/github/created" && useApp) {
        const code = url.searchParams.get("code");
        if (!code || url.searchParams.get("state") !== state) return send(400, githubPage("GitHub didn't send the app back. Try again."));
        const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST", headers: HEADERS });
        if (r.status !== 201) return send(502, githubPage(`GitHub couldn't finish creating the app (${r.status}). Try again.`));
        const created = (await r.json()) as { id: number; slug: string; pem: string };
        app = { id: String(created.id), slug: created.slug, key: Buffer.from(created.pem).toString("base64") };
        // Save the app now, so it isn't lost if the install step is abandoned.
        writeEnv({ CECIL_GITHUB_REPO: repo!, CECIL_GITHUB_APP_ID: app.id, CECIL_GITHUB_APP_KEY: app.key });
        out(`tell-cecil: created the GitHub App "${created.slug}". Now install it on ${repo} in the browser.`);
        return send(302, "", { location: await installUrl(created.slug) });
      }

      if (route === "/github/installed" && useApp) {
        if (!app) return send(400, githubPage("Create the app first."));
        const install = await installUrl(app.slug);
        try {
          const where = await check({ github: { repo: repo!, app: { id: app.id, key: app.key } } });
          finish({ vars: { CECIL_GITHUB_REPO: repo!, CECIL_GITHUB_APP_ID: app.id, CECIL_GITHUB_APP_KEY: app.key }, where });
          return send(200, donePage(where));
        } catch (err) {
          return send(
            200,
            page(
              "Install the app",
              `${errorBox(`The app can't reach ${repo} yet: ${(err as Error).message}`)}<h1>Install on ${esc(repo!)}</h1><p>Install the app and make sure <code>${esc(repo!)}</code> is one of the selected repositories.</p><a class="btn" href="${esc(install)}">Install the app</a>`,
            ),
          );
        }
      }
      return send(404, page("Not found", "<h1>Not found</h1>"));
    } catch (err) {
      out(`tell-cecil: setup page error: ${(err as Error).message}`);
      return send(500, page("Error", `${errorBox((err as Error).message)}<p><a href="${at("/")}">Start over</a></p>`));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;

  const what = tracker === "github" ? `GitHub ${repo}` : tracker === "gitlab" ? `GitLab ${repo}` : "Jira";
  out(`Tell Cecil setup: ${what}`);
  out(`Finish in your browser${a["no-browser"] ? "" : " (it should have opened)"}:`);
  out(`  ${at("/")}`);
  const minutes = Number(a.timeout ?? 15) || 15;
  out(`Waiting up to ${minutes} minutes…`);
  if (!a["no-browser"]) openBrowser(at("/"));

  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([finished, new Promise<null>((r) => (timer = setTimeout(() => r(null), minutes * 60_000)))]);
  clearTimeout(timer);
  // Let the browser receive the done page before closing.
  setTimeout(() => server.close(), 500).unref();
  server.closeIdleConnections?.();
  if (!result) {
    out(`tell-cecil: timed out after ${minutes} minutes.`);
    if (app) out(`The GitHub App is saved in .env. Install it on ${repo} at https://github.com/apps/${app.slug}/installations/new, then run: npx tell-cecil check`);
    return 1;
  }

  const gi = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : null;
  const ignored = gi === null ? (existsSync(".git") ? ignoreEnv("") : null) : ignoreEnv(gi);
  if (ignored !== null) writeFileSync(".gitignore", ignored);

  const port8787 = process.env.PORT ?? "8787";
  out("");
  out(`✓ Connected: ${result.where}`);
  out(`✓ Wrote .env: ${Object.keys({ ...base, ...result.vars }).join(", ")}${ignored !== null ? " (and added .env to .gitignore)" : ""}`);
  out("");
  out("Add the widget to your page, before </body>:");
  out("");
  out(`  <script src="https://cdn.jsdelivr.net/npm/tell-cecil@${version()}/dist/cecil.js"`);
  out(`    data-endpoint="http://localhost:${port8787}"`);
  out(`    data-project-key="${key}"></script>`);
  out("");
  out(`Then start the relay in this folder: npx tell-cecil   (allowed origins: ${origins.join(", ")})`);
  out("Check the setup any time: npx tell-cecil check");
  return 0;
}
