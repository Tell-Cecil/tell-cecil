// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { projectFromEnv } from "../src/env";
import { formatDescription } from "../src/jira";
import { createRelay, type Project } from "../src/relay";

const ORIGIN = "https://example.com";
const report = {
  comment: "Button broken, cc @octocat",
  url: "https://example.com/pricing",
  userAgent: "TestUA",
  viewport: { width: 1280, height: 720 },
};
const element = { selector: "#buy", tag: "button", role: "button", name: "Buy", locators: ["#buy", "role=button"], rect: { x: 0, y: 0, width: 1, height: 1 }, redacted: true };

function setup(target: Omit<Project, "origins">, reply: Response) {
  const fakeFetch = vi.fn(async () => reply);
  const relay = createRelay({ projects: { pk_1: { origins: [ORIGIN], ...target } }, fetch: fakeFetch as unknown as typeof fetch, now: () => 0 });
  const post = (r: object = report) =>
    relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk_1", report: r }) }));
  const sent = () => {
    const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
  };
  return { post, sent };
}

describe("GitLab", () => {
  const created = () => new Response(JSON.stringify({ iid: 3, web_url: "https://gitlab.com/acme/web/site/-/issues/3" }), { status: 201 });

  it("files an issue on gitlab.com with the project path, token and labels", async () => {
    const { post, sent } = setup({ gitlab: { project: "acme/web/site", token: "SECRET", labels: ["feedback", "web"] } }, created());
    const res = await post({ ...report, element });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: "https://gitlab.com/acme/web/site/-/issues/3", number: 3 });
    const { url, headers, body } = sent();
    expect(url).toBe("https://gitlab.com/api/v4/projects/acme%2Fweb%2Fsite/issues");
    expect(headers["private-token"]).toBe("SECRET");
    expect(body.title).toBe("Button broken, cc @​octocat");
    expect(body.labels).toBe("feedback,web");
    expect(body.description).toContain("**Element:** `#buy`");
    expect(body.description).toContain("**Page:** `https://example.com/pricing`");
  });

  it("uses a self-hosted URL and a numeric project ID", async () => {
    const { post, sent } = setup({ gitlab: { project: "42", token: "T", url: "https://git.corp.example/gitlab/" } }, created());
    expect((await post()).status).toBe(201);
    expect(sent().url).toBe("https://git.corp.example/gitlab/api/v4/projects/42/issues");
  });

  it("neutralises mentions and references in the comment, and keeps quick actions quoted", async () => {
    const { post, sent } = setup({ gitlab: { project: "acme/site", token: "T" } }, created());
    await post({ ...report, comment: "cc @all @jane\nsee #1 !2 $3 &4 acme/x#5 ~bug ~\"needs work\" %v1\n/close\n/assign @jane" });
    const d = sent().body.description as string;
    for (const raw of ["@all", "@jane", "#1", "!2", "$3", "&4", "acme/x#5", "~bug", '~"needs', "%v1"]) expect(d).not.toContain(raw);
    expect(d).toContain("> /close");
    expect(d).not.toMatch(/^\/close/m);
  });

  it("rejects a bad project, an empty token, comma labels and a bad URL", () => {
    const mk = (gitlab: Partial<NonNullable<Project["gitlab"]>>) => () => createRelay({ projects: { pk: { origins: [ORIGIN], gitlab: { project: "a/b", token: "T", ...gitlab } } } });
    expect(mk({})).not.toThrow();
    for (const project of ["acme", "https://gitlab.com/a/b", "a/ b"]) expect(mk({ project })).toThrow(/group\/project/);
    expect(mk({ token: "" })).toThrow(/token/);
    expect(mk({ labels: ["a,b"] })).toThrow(/commas/);
    for (const url of ["gitlab.com", "ftp://gitlab.com", "https://gitlab.com/?x=1"]) expect(mk({ url })).toThrow(/GitLab URL/);
  });
});

describe("Jira", () => {
  const jira = { url: "https://acme.atlassian.net", email: "bot@acme.example", token: "SECRET", project: "WEB" };
  const created = () => new Response(JSON.stringify({ id: "10001", key: "WEB-12", self: "https://acme.atlassian.net/rest/api/3/issue/10001" }), { status: 201 });

  it("files an issue with basic auth, the project key and a Task by default", async () => {
    const { post, sent } = setup({ jira: { ...jira, labels: ["feedback"] } }, created());
    const res = await post();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: "https://acme.atlassian.net/browse/WEB-12", key: "WEB-12" });
    const { url, headers, body } = sent();
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    expect(headers.authorization).toBe(`Basic ${Buffer.from("bot@acme.example:SECRET").toString("base64")}`);
    expect(body.fields).toMatchObject({ project: { key: "WEB" }, issuetype: { name: "Task" }, summary: "Button broken, cc @octocat", labels: ["feedback"] });
    expect(body.fields.description.type).toBe("doc");
  });

  it("uses the configured issue type and leaves out empty labels", async () => {
    const { post, sent } = setup({ jira: { ...jira, issueType: "Bug" } }, created());
    await post();
    expect(sent().body.fields.issuetype).toEqual({ name: "Bug" });
    expect(sent().body.fields).not.toHaveProperty("labels");
  });

  it("encodes a non-Latin-1 email", async () => {
    const { post, sent } = setup({ jira: { ...jira, email: "zoë@例え.jp" } }, created());
    await post();
    expect(sent().headers.authorization).toBe(`Basic ${Buffer.from("zoë@例え.jp:SECRET").toString("base64")}`);
  });

  it("rejects a bad project key, missing credentials, spaced labels and a bad URL", () => {
    const mk = (j: Partial<NonNullable<Project["jira"]>>) => () => createRelay({ projects: { pk: { origins: [ORIGIN], jira: { ...jira, ...j } } } });
    expect(mk({})).not.toThrow();
    for (const project of ["web", "W", "WEB-1", ""]) expect(mk({ project })).toThrow(/project key/);
    expect(mk({ token: "" })).toThrow(/email or token/);
    expect(mk({ email: "" })).toThrow(/email or token/);
    expect(mk({ labels: ["two words"] })).toThrow(/spaces/);
    expect(mk({ url: "acme.atlassian.net" })).toThrow(/Jira URL/);
  });
});

describe("Jira description", () => {
  const r = { ...report, comment: "Line one\n\n**not bold** <b>x</b>\u0007", timestamp: "now", element: { ...element, attributes: { id: "buy" }, ancestors: ["main", "body"] }, user: "jane\nadmin" };
  const doc = formatDescription(r) as { content: { type: string; content?: { type: string; content?: { text: string; marks?: { type: string }[] }[] }[] }[] };

  it("quotes the comment line by line as literal text", () => {
    const quote = doc.content[0]!;
    expect(quote.type).toBe("blockquote");
    expect(quote.content!.map((p) => p.content?.[0]?.text ?? "")).toEqual(["Line one", "", "**not bold** <b>x</b>"]);
  });

  it("puts every value in a code-marked text node on one line", () => {
    const rows = doc.content.slice(2).map((p) => (p.content as unknown as { text: string; marks?: { type: string }[] }[]).map((t) => t.text).join(""));
    expect(rows).toContain("Element: #buy");
    expect(rows).toContain('Accessible: button "Buy"');
    expect(rows).toContain("Locators: #buy · role=button");
    expect(rows).toContain("Ancestors: main > body");
    expect(rows).toContain("Reporter (self-reported): jane admin");
    expect(rows).toContain("Some content was hidden for privacy.");
    const page = doc.content[2]!.content as unknown as { text: string; marks: { type: string }[] }[];
    expect(page[1]).toEqual({ type: "text", text: "https://example.com/pricing", marks: [{ type: "code" }] });
  });

  it("never emits an empty text node", () => {
    const empty = JSON.stringify(formatDescription({ ...r, user: "  ", element: { ...element, text: "" } })).includes('"text":""');
    expect(empty).toBe(false);
  });
});

describe("tracker config", () => {
  it("needs exactly one tracker per project", () => {
    const gh = { repo: "a/b", token: "T" };
    const gl = { project: "a/b", token: "T" };
    expect(() => createRelay({ projects: { pk: { origins: [ORIGIN] } } })).toThrow(/exactly one/);
    expect(() => createRelay({ projects: { pk: { origins: [ORIGIN], github: gh, gitlab: gl } } })).toThrow(/exactly one/);
  });

  it("reads one tracker from CECIL_* variables", () => {
    expect(projectFromEnv({ CECIL_GITLAB_TOKEN: "T", CECIL_GITLAB_PROJECT: "a/b", CECIL_LABELS: "x, y", CECIL_ORIGINS: "https://a.example,https://b.example" })).toEqual({
      origins: ["https://a.example", "https://b.example"],
      gitlab: { project: "a/b", token: "T", url: undefined, labels: ["x", "y"] },
    });
    const jira = projectFromEnv({ CECIL_JIRA_URL: "https://acme.atlassian.net", CECIL_JIRA_EMAIL: "e", CECIL_JIRA_TOKEN: "T", CECIL_JIRA_PROJECT: "WEB", CECIL_JIRA_ISSUE_TYPE: "Bug" });
    expect(jira.jira).toMatchObject({ project: "WEB", issueType: "Bug" });
    expect(jira.origins).toEqual(["http://localhost:5173"]);
    expect(() => createRelay({ projects: { pk: projectFromEnv({ CECIL_GITHUB_TOKEN: "T", CECIL_GITHUB_REPO: "a/b", CECIL_JIRA_TOKEN: "T" }) } })).toThrow(/exactly one/);
    expect(() => createRelay({ projects: { pk: projectFromEnv({ CECIL_GITLAB_TOKEN: "T" }) } })).toThrow(/GitLab project ""/);
  });
});
