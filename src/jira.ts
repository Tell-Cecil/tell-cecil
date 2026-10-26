import { baseUrl } from "./base-url";
import { formatTitle } from "./markdown";
import type { Report, Tracker } from "./types";

export interface JiraTarget {
  /** Your Jira Cloud site, e.g. "https://acme.atlassian.net". */
  url: string;
  /** Atlassian account email that owns the API token. */
  email: string;
  /** API token of an account allowed to create issues in the project. Never sent to the browser. */
  token: string;
  /** Project key, e.g. "WEB". Server-side only. */
  project: string;
  /** Default "Task", which most project templates have. */
  issueType?: string;
  /** Jira labels can't contain spaces. */
  labels?: string[];
}

// Atlassian Document Format. Text nodes are literal: no markup to forge, and only explicit mention nodes notify anyone.
type Node = Record<string, unknown>;
const text = (t: string, mark?: "strong" | "code"): Node => ({ type: "text", text: t, ...(mark && { marks: [{ type: mark }] }) });
const paragraph = (...content: Node[]): Node => ({ type: "paragraph", content });
// Jira rejects control characters; single line values also lose their line breaks.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
const line = (s: string) => clean(s.replace(/\s+/g, " "));

/** Same details as the Markdown body, as ADF. Every value is a code-marked text node. */
export function formatDescription(r: Report): Node {
  const e = r.element;
  const who = e && [e.role, e.name && `"${e.name}"`].filter(Boolean).join(" ");
  const field = (k: string, v?: string) => (v && line(v).trim() ? paragraph(text(`${k}: `, "strong"), text(line(v), "code")) : null);
  const details = [
    field("Page", r.url),
    field("Reporter (self-reported)", r.user),
    field("Element", e?.selector),
    field("Accessible", who),
    field("Text", e?.text),
    field("Attributes", e?.attributes && Object.entries(e.attributes).map(([k, v]) => `${k}=${v}`).join(" · ")),
    field("Locators", e && e.locators.length > 1 ? e.locators.join(" · ") : undefined),
    field("Ancestors", e?.ancestors?.join(" > ")),
    e?.redacted ? paragraph({ ...text("Some content was hidden for privacy."), marks: [{ type: "em" }] }) : null,
    field("Area", r.area && `${r.area.x},${r.area.y} ${r.area.width}x${r.area.height} (viewport)`),
    field("Viewport", `${r.viewport.width}x${r.viewport.height}`),
    field("Browser", r.userAgent),
    field("Reported", r.timestamp),
  ].filter((n) => n !== null);
  const quote = clean(r.comment)
    .split(/\r\n|\r|\n/)
    .map((l) => (l ? paragraph(text(l)) : paragraph()));
  return {
    type: "doc",
    version: 1,
    content: [{ type: "blockquote", content: quote }, { type: "heading", attrs: { level: 3 }, content: [text("Report details")] }, ...details],
  };
}

export function jiraTracker({ url, email, token, project, issueType = "Task", labels }: JiraTarget): Tracker {
  const site = baseUrl(url, "Jira URL", "https://acme.atlassian.net");
  if (!/^[A-Z][A-Z0-9_]+$/.test(project)) throw new Error(`Jira project "${project}" must be a project key like "WEB"`);
  if (!email || !token) throw new Error("Jira email or token is empty");
  if (labels?.some((l) => /\s/.test(l))) throw new Error("Jira labels can't contain spaces");
  // btoa only takes Latin-1, so encode the UTF-8 bytes.
  const auth = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${email}:${token}`)))}`;
  return {
    name: "Jira",
    file(report: Report, doFetch, timeoutMs) {
      const fields = {
        project: { key: project },
        issuetype: { name: issueType },
        summary: line(formatTitle(report)),
        description: formatDescription(report),
        ...(labels?.length && { labels }),
      };
      return doFetch(`${site}/rest/api/3/issue`, {
        method: "POST",
        headers: { authorization: auth, accept: "application/json", "user-agent": "cecil-relay", "content-type": "application/json" },
        body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    issue(reply) {
      const { key } = reply as { key?: string };
      return typeof key === "string" ? { url: `${site}/browse/${encodeURIComponent(key)}`, key } : {};
    },
  };
}
