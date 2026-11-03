// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../src/init";
import { probe } from "../src/probe";
import { appNames, appSlug, envConflicts, guessOrigins, ignoreEnv, mergeEnv, parseRemote, projectKey } from "../src/setup-files";

describe("git remote", () => {
  it("reads GitHub and GitLab remotes in every form", () => {
    for (const r of ["git@github.com:acme/site.git", "https://github.com/acme/site", "https://github.com/acme/site.git/", "ssh://git@github.com/acme/site.git", "https://user@github.com/acme/site.git"]) {
      expect(parseRemote(r)).toEqual({ tracker: "github", repo: "acme/site" });
    }
    expect(parseRemote("git@gitlab.com:group/sub/proj.git")).toEqual({ tracker: "gitlab", repo: "group/sub/proj" });
    expect(parseRemote("https://gitlab.corp.example/team/app.git")).toEqual({ tracker: "gitlab", repo: "team/app", url: "https://gitlab.corp.example" });
    expect(parseRemote("ssh://git@gitlab.corp.example:2222/team/app.git")).toEqual({ tracker: "gitlab", repo: "team/app", url: "https://gitlab.corp.example" });
  });

  it("returns null for other hosts and odd paths", () => {
    for (const r of ["git@bitbucket.org:acme/site.git", "https://github.com/acme", "https://github.com/acme/site/extra", "/local/path", ""]) expect(parseRemote(r)).toBeNull();
  });
});

describe("defaults", () => {
  it("guesses the dev server origin from the framework", () => {
    expect(guessOrigins({ dependencies: { next: "15" } })).toEqual(["http://localhost:3000"]);
    expect(guessOrigins({ devDependencies: { vite: "6" } })).toEqual(["http://localhost:5173"]);
    expect(guessOrigins({ dependencies: { astro: "5" } })).toEqual(["http://localhost:4321"]);
    expect(guessOrigins(null)).toEqual(["http://localhost:5173"]);
  });

  it("makes a readable project key", () => {
    expect(projectKey("acme/Web Site")).toBe("pk_web-site");
    expect(projectKey("group/sub/my_app")).toBe("pk_my-app");
    expect(projectKey("WEB")).toBe("pk_web");
    expect(projectKey("acme/---")).toBe("pk_site");
  });
});

describe("GitHub App name", () => {
  it("is the repo name and feedback, then with the owner or a suffix", () => {
    expect(appNames("alwa97/cecil-test", "3f2a")).toEqual(["cecil-test feedback", "cecil-test feedback alwa97", "cecil-test feedback 3f2a"]);
    expect(appSlug("cecil-test feedback")).toBe("cecil-test-feedback");
  });

  it("fits GitHub's 34 characters", () => {
    const names = appNames("a-very-long-organization-name/an-equally-long-repository-name", "3f2a");
    for (const n of names) expect(n.length).toBeLessThanOrEqual(34);
    expect(names[0]).toBe("an-equally-long-repositor feedback");
  });
});

describe(".env and .gitignore", () => {
  const vars = { CECIL_PROJECT_KEY: "pk_site", CECIL_ORIGINS: "http://localhost:5173" };

  it("finds Tell Cecil variables that would change, and ignores the rest", () => {
    expect(envConflicts("", vars)).toEqual([]);
    expect(envConflicts("PORT=1\nCECIL_LABELS=x\nCECIL_PROJECT_KEY=pk_site\nexport CECIL_ORIGINS='http://localhost:5173'", vars)).toEqual([]);
    expect(envConflicts("CECIL_PROJECT_KEY=pk_other\nCECIL_GITLAB_TOKEN=x", vars)).toEqual(["CECIL_PROJECT_KEY", "CECIL_GITLAB_TOKEN"]);
  });

  it("replaces the old tracker's variables and keeps everything else", () => {
    const before = "# mine\nPORT=9000\nCECIL_LABELS=feedback\nCECIL_GITLAB_TOKEN=old\nCECIL_GITLAB_PROJECT=a/b\n";
    const after = mergeEnv(before, { ...vars, CECIL_GITHUB_REPO: "acme/site", CECIL_GITHUB_TOKEN: "t#1 x" });
    expect(after).toBe(
      '# mine\nPORT=9000\nCECIL_LABELS=feedback\n\n# Tell Cecil (written by npx tell-cecil init)\nCECIL_PROJECT_KEY=pk_site\nCECIL_ORIGINS=http://localhost:5173\nCECIL_GITHUB_REPO=acme/site\nCECIL_GITHUB_TOKEN=\'t#1 x\'\n',
    );
    expect(mergeEnv(after, vars)).toBe(`# mine\nPORT=9000\nCECIL_LABELS=feedback\n\n# Tell Cecil (written by npx tell-cecil init)\nCECIL_PROJECT_KEY=pk_site\nCECIL_ORIGINS=http://localhost:5173\n`);
  });

  it("writes values Node's .env loader reads back unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "cecil-env-"));
    const key = Buffer.from("-----BEGIN RSA PRIVATE KEY-----\nAB+/=\n-----END RSA PRIVATE KEY-----\n").toString("base64");
    const values = { ...vars, CECIL_GITHUB_APP_KEY: key, CECIL_JIRA_TOKEN: 'a "b" #c', CECIL_JIRA_EMAIL: "zoë@example.com" };
    writeFileSync(join(dir, ".env"), mergeEnv("", values));
    // parseEnv is the parser behind process.loadEnvFile.
    expect(parseEnv(readFileSync(join(dir, ".env"), "utf8"))).toMatchObject(values);
  });

  it("adds .env to .gitignore unless it's already ignored", () => {
    expect(ignoreEnv("")).toBe(".env\n");
    expect(ignoreEnv("node_modules")).toBe("node_modules\n.env\n");
    expect(ignoreEnv(".env.local\n")).toBe(".env.local\n.env\n");
    for (const t of [".env", "/.env\n", ".env*", "*.env"]) expect(ignoreEnv(t)).toBeNull();
  });
});

describe("probe", () => {
  const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("describes where issues go, and warns about public repos", async () => {
    expect(await probe({ origins: [], github: { repo: "acme/site", token: "T" } }, reply(200, { has_issues: true, private: false }))).toBe(
      "GitHub acme/site (public: anyone can read the reports)",
    );
    expect(await probe({ origins: [], gitlab: { project: "a/b", token: "T" } }, reply(200, { visibility: "private" }))).toBe("GitLab a/b");
    const jira = { url: "https://acme.atlassian.net", email: "e", token: "T", project: "WEB" };
    expect(await probe({ origins: [], jira }, reply(200, { issueTypes: [{ name: "Task" }] }))).toBe("Jira WEB on https://acme.atlassian.net");
  });

  it("explains refusals and missing pieces", async () => {
    await expect(probe({ origins: [], github: { repo: "acme/site", token: "T" } }, reply(401))).rejects.toThrow(/rejected \(401\)/);
    await expect(probe({ origins: [], github: { repo: "acme/site", token: "T" } }, reply(404))).rejects.toThrow(/can't see it \(404\)/);
    await expect(probe({ origins: [], github: { repo: "acme/site", token: "T" } }, reply(200, { has_issues: false }))).rejects.toThrow(/issues are turned off/);
    const jira = { url: "https://acme.atlassian.net", email: "e", token: "T", project: "WEB", issueType: "Bug" };
    await expect(probe({ origins: [], jira }, reply(200, { issueTypes: [{ name: "Task" }, { name: "Story" }] }))).rejects.toThrow("one of: Task, Story");
  });
});

describe("init", () => {
  let dir: string;
  let cwd: string;
  let lines: string[];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "cecil-init-"));
    process.chdir(dir);
    lines = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (lines.push(String(s)), true));
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  /** Start init, wait for its setup link, and return it with the pending exit code. */
  async function start(args: string[]) {
    const code = init([...args, "--no-browser"]);
    for (let i = 0; i < 100 && !lines.some((l) => l.includes("http://127.0.0.1")); i++) await new Promise((r) => setTimeout(r, 10));
    const link = lines.find((l) => l.includes("http://127.0.0.1"))!.trim();
    return { link, code };
  }

  /** The real fetch for the local page, the fake one for GitHub, GitLab and Jira. */
  function upstream(handler: (url: string, init?: RequestInit) => Response) {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) =>
      String(url).startsWith("http://127.0.0.1") ? realFetch(url, init) : handler(String(url), init)) as typeof fetch;
  }

  it("connects GitLab with a pasted token and writes .env and .gitignore", async () => {
    writeFileSync(".gitignore", "node_modules\n");
    upstream((url) => (url === "https://gitlab.com/api/v4/projects/team%2Fapp" ? Response.json({ visibility: "private" }) : new Response("", { status: 500 })));
    const { link, code } = await start(["--tracker", "gitlab", "--repo", "team/app", "--origin", "https://app.example"]);
    const page = await (await realFetch(link)).text();
    expect(page).toContain("personal_access_tokens?name=Tell+Cecil+team%2Fapp&#38;scopes=api");

    const post = (token: string) =>
      realFetch(link.replace(/\/$/, "/token"), { method: "POST", headers: { origin: new URL(link).origin, "content-type": "application/x-www-form-urlencoded" }, body: `token=${token}` });
    expect(await (await post("")).text()).toContain("Paste the token first.");
    expect(await (await post("glpat-1")).text()).toContain("Connected");
    expect(await code).toBe(0);
    expect(readFileSync(".env", "utf8")).toContain("CECIL_PROJECT_KEY=pk_app\nCECIL_ORIGINS=https://app.example\nCECIL_GITLAB_PROJECT=team/app\nCECIL_GITLAB_TOKEN=glpat-1\n");
    expect(readFileSync(".gitignore", "utf8")).toBe("node_modules\n.env\n");
    expect(lines.join("")).toContain('data-project-key="pk_app"');
  });

  it("refuses requests from other origins and hosts", async () => {
    upstream(() => Response.json({}));
    const { link, code } = await start(["--tracker", "gitlab", "--repo", "team/app"]);
    const res = await realFetch(link.replace(/\/$/, "/token"), { method: "POST", headers: { origin: "https://evil.example" }, body: "token=x" });
    expect(res.status).toBe(403);
    expect((await realFetch(link.replace(/\/[0-9a-f]{32}\/$/, "/"))).status).toBe(404);
    // Finish so the server closes.
    await realFetch(link.replace(/\/$/, "/token"), { method: "POST", headers: { origin: new URL(link).origin }, body: "token=ok" });
    expect(await code).toBe(0);
  });

  it("creates and installs a GitHub App through the manifest flow", async () => {
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    upstream((url) => {
      if (url === "https://api.github.com/users/acme") return Response.json({ type: "User", id: 42 });
      if (url === "https://api.github.com/app-manifests/CODE/conversions") return Response.json({ id: 9, slug: "tell-cecil-site", pem }, { status: 201 });
      if (url === "https://api.github.com/repos/acme/site/installation") return Response.json({ id: 5 });
      if (url === "https://api.github.com/app/installations/5/access_tokens") return Response.json({ token: "ghs_x", expires_at: "2100-01-01T00:00:00Z" }, { status: 201 });
      if (url === "https://api.github.com/repos/acme/site") return Response.json({ has_issues: true, private: true });
      return new Response("", { status: 500 });
    });
    const { link, code } = await start(["--repo", "acme/site", "--tracker", "github"]);
    const page = await (await realFetch(link)).text();
    const state = link.split("/")[3]!;
    expect(page).toContain(`action="https://github.com/settings/apps/new?state=${state}"`);
    const manifest = JSON.parse(page.match(/name="manifest" value="([^"]+)"/)![1]!.replace(/&#34;/g, '"').replace(/&#38;/g, "&"));
    expect(manifest).toMatchObject({ public: false, default_permissions: { issues: "write", metadata: "read" }, redirect_url: `${link}github/created` });

    expect((await realFetch(`${link}github/created?code=CODE&state=wrong`)).status).toBe(400);
    const created = await realFetch(`${link}github/created?code=CODE&state=${state}`, { redirect: "manual" });
    expect(created.headers.get("location")).toBe("https://github.com/apps/tell-cecil-site/installations/new/permissions?suggested_target_id=42");
    expect(readFileSync(".env", "utf8")).toContain("CECIL_GITHUB_APP_ID=9\n");

    expect(await (await realFetch(`${link}github/installed?installation_id=5&setup_action=install`)).text()).toContain("Connected");
    expect(await code).toBe(0);
    const env = readFileSync(".env", "utf8");
    expect(env).toContain("CECIL_GITHUB_REPO=acme/site\n");
    expect(env).toContain(`CECIL_GITHUB_APP_KEY=${Buffer.from(pem).toString("base64")}\n`);
    expect(env).not.toContain("CECIL_GITHUB_TOKEN");
  });

  it("won't overwrite another setup without --force", async () => {
    writeFileSync(".env", "CECIL_GITHUB_TOKEN=keep\n");
    expect(await init(["--tracker", "gitlab", "--repo", "team/app", "--no-browser"])).toBe(1);
    expect(lines.join("")).toContain(".env already has CECIL_GITHUB_TOKEN");
  });
});
