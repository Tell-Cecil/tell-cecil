import type { Report } from "./types";

export interface GitHubTarget {
  /** "owner/repo". Server-side only: the browser never chooses where issues go. */
  repo: string;
  /** Token with issues:write on that repo. Never sent to the browser. */
  token: string;
  labels?: string[];
}

// GitHub allows 65,536 characters; leave room for the metadata block.
export const MAX_BODY = 60_000;

const code = (s: string) => `\`${s.replace(/\s+/g, " ").replace(/`/g, "'")}\``;

const esc = (s: string) => s.replace(/</g, "&lt;");

/** The longest prefix of `s` whose escaped form fits in `room`, never splitting an entity. */
function fit(s: string, room: number): string {
  let out = "";
  let len = 0;
  for (const ch of s) {
    len += ch === "<" ? 4 : ch.length;
    if (len > room) break;
    out += ch;
  }
  return esc(out);
}

/** Blockquote the comment, cut to `max` characters, so it can't pass for the metadata below it. `<` is escaped so raw HTML (a `<!--`) can't swallow what follows. */
function quoted(comment: string, max: number): string {
  const out: string[] = [];
  let len = 0;
  for (const line of comment.split(/\r\n|\r|\n/)) {
    const q = line ? `> ${esc(line)}` : ">";
    if (len + q.length + 1 > max) {
      const room = max - len - 3;
      if (room > 0 && line) out.push(`> ${fit(line, room)}`);
      break;
    }
    out.push(q);
    len += q.length + 1;
  }
  return out.join("\n");
}

/** Every client-supplied value except the comment goes through code(), so it can't forge lines or mentions. The comment is quoted. */
export function formatBody(r: Report): string {
  const e = r.element;
  const who = e && [e.role, e.name && `"${e.name}"`].filter(Boolean).join(" ");
  const attrs = e?.attributes && Object.entries(e.attributes).map(([k, v]) => code(`${k}=${v}`));
  const meta = [
    "### Report details",
    `**Page:** ${code(r.url)}`,
    r.user ? `**Reporter:** ${code(r.user)} (self-reported)` : "",
    e ? `**Element:** ${code(e.selector)}` : "",
    who ? `**Accessible:** ${code(who)}` : "",
    e?.text ? `**Text:** ${code(e.text)}` : "",
    attrs?.length ? `**Attributes:** ${attrs.join(" · ")}` : "",
    e && e.locators.length > 1 ? `**Locators:** ${e.locators.map(code).join(" · ")}` : "",
    e?.ancestors?.length ? `**Ancestors:** ${code(e.ancestors.join(" > "))}` : "",
    e?.redacted ? "_Some content was hidden for privacy._" : "",
    r.area ? `**Area:** ${r.area.x},${r.area.y} ${r.area.width}x${r.area.height} (viewport)` : "",
    `**Viewport:** ${r.viewport.width}x${r.viewport.height}`,
    `**Browser:** ${code(r.userAgent)}`,
    `**Reported:** ${r.timestamp}`,
  ]
    .filter(Boolean)
    .join("\n");
  // Only the comment is cut to fit, so a code span is never left half open.
  return `${quoted(r.comment, Math.max(0, MAX_BODY - meta.length - 2))}\n\n${meta}`;
}

export function formatTitle(r: Report): string {
  const first = r.comment.split("\n")[0]!.trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

/** POST the report as a new issue. Returns the raw response for the caller to interpret. */
export function createGitHubIssue({ repo, token, labels }: GitHubTarget, report: Report, doFetch: typeof fetch, timeoutMs = 10_000): Promise<Response> {
  return doFetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "cecil-relay",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: formatTitle(report), body: formatBody(report), labels }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
