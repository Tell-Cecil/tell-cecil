import { githubTracker, type GitHubTarget } from "./github";
import { gitlabTracker, type GitLabTarget } from "./gitlab";
import { jiraTracker, type JiraTarget } from "./jira";
import { MAX_COMMENT, type ElementInfo, type Rect, type Report, type Tracker } from "./types";

export type { GitHubTarget, GitLabTarget, JiraTarget };

export interface Project {
  /** Exact origins allowed to submit, e.g. "https://example.com". */
  origins: string[];
  /** Where reports go: exactly one of github, gitlab or jira. */
  github?: GitHubTarget;
  gitlab?: GitLabTarget;
  jira?: JiraTarget;
  /** Return the created issue's URL and number (Jira: key) to the page. Default true; false keeps the repo or project from reaching browsers. */
  exposeIssueUrl?: boolean;
}

export interface RelayOptions {
  /** Public project key (not a secret) -> project. */
  projects: Record<string, Project>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** In-memory, so per instance only. `max` is per project key + client IP; `projectMax` (default 60) is per project key. */
  rateLimit?: { max: number; windowMs: number; projectMax?: number };
  now?: () => number;
  /** Test only: the rate-limit store, so tests can inspect pruning. */
  hits?: Map<string, number[]>;
  /** Test only: shortens the 10 second limit on the tracker call. */
  upstreamTimeoutMs?: number;
  /** Identifies the client for rate limiting. Default: cf-connecting-ip, else the last x-forwarded-for entry. */
  clientIp?: (req: Request) => string;
}

export const MAX_REQUEST_BYTES = 32_000;
const MAX_FIELD = 500;
const MAX_BUCKETS = 10_000;

/** Read the body up to `max` bytes, whether or not content-length was sent. Null means too large. */
async function readBody(req: Request, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.length;
    if (size > max) {
      void reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

const opt = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const strings = (v: unknown, n: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, MAX_FIELD)) : [];

function parseRect(v: unknown): Rect | null {
  const r = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const n = [r.x, r.y, r.width, r.height];
  if (!n.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  const [x, y, width, height] = (n as number[]).map(Math.round) as [number, number, number, number];
  return { x, y, width, height };
}

function parseElement(v: unknown): ElementInfo | null {
  if (typeof v !== "object" || v === null) return null;
  const e = v as Record<string, unknown>;
  const selector = opt(e.selector, MAX_FIELD);
  const tag = opt(e.tag, 50);
  const rect = parseRect(e.rect);
  if (!selector || !tag || !rect) return null;
  const attributes: Record<string, string> = {};
  if (typeof e.attributes === "object" && e.attributes !== null) {
    for (const [k, val] of Object.entries(e.attributes).slice(0, 10)) {
      if (typeof val === "string") attributes[k.slice(0, 50)] = val.slice(0, MAX_FIELD);
    }
  }
  const info: ElementInfo = { selector, tag, locators: strings(e.locators, 8), rect, redacted: e.redacted === true };
  const role = opt(e.role, 100);
  const name = opt(e.name, MAX_FIELD);
  const text = opt(e.text, MAX_FIELD);
  const ancestors = strings(e.ancestors, 4);
  if (role) info.role = role;
  if (name) info.name = name;
  if (text) info.text = text;
  if (Object.keys(attributes).length) info.attributes = attributes;
  if (ancestors.length) info.ancestors = ancestors;
  return info;
}

// The last entry is the hop added by the nearest proxy; earlier ones are client-controlled.
const defaultIp = (req: Request) =>
  req.headers.get("cf-connecting-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";

/** The page URL must be a clean http(s) URL on the origin the request came from. */
function pageUrl(v: unknown, origin: string): string | null {
  if (typeof v !== "string" || v.length > MAX_FIELD || /[\s\u0000-\u001f]/.test(v)) return null;
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === origin ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Validate untrusted JSON into a Report. Returns null if the shape is wrong.
 * Long strings are clamped rather than rejected.
 */
function parseReport(x: unknown, origin: string, now: number): Report | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const comment = str(r.comment, MAX_COMMENT)?.trim();
  const url = pageUrl(r.url, origin);
  const userAgent = str(r.userAgent, MAX_FIELD);
  const vp = r.viewport as Record<string, unknown> | undefined;
  if (!comment || url === null || userAgent === null) return null;
  if (typeof vp?.width !== "number" || typeof vp.height !== "number") return null;
  const element = r.element === undefined ? undefined : parseElement(r.element);
  const area = r.area === undefined ? undefined : parseRect(r.area);
  if (element === null || area === null) return null;
  return {
    comment,
    url,
    user: opt(r.user, 100),
    element,
    area,
    userAgent,
    viewport: { width: Math.round(vp.width), height: Math.round(vp.height) },
    timestamp: new Date(now).toISOString(),
  };
}

/** Fail at startup, not on the first report, when the config can't work. Returns each project's tracker. */
function validate(projects: Record<string, Project>): Map<string, Tracker> {
  const keys = Object.keys(projects);
  if (!keys.length) throw new Error("cecil: no projects configured");
  const trackers = new Map<string, Tracker>();
  for (const key of keys) {
    const { origins, github, gitlab, jira } = projects[key]!;
    for (const o of origins) {
      let canonical: string | undefined;
      try {
        canonical = new URL(o).origin;
      } catch {
        // Reported below.
      }
      if (canonical !== o) throw new Error(`cecil: project "${key}": origin "${o}" must be exactly an origin like "https://example.com"${canonical ? ` (try "${canonical}")` : ""}`);
    }
    const make = [github && (() => githubTracker(github)), gitlab && (() => gitlabTracker(gitlab)), jira && (() => jiraTracker(jira))].filter((m) => !!m);
    if (make.length !== 1) throw new Error(`cecil: project "${key}": set exactly one of github, gitlab or jira`);
    try {
      trackers.set(key, make[0]!());
    } catch (err) {
      throw new Error(`cecil: project "${key}": ${(err as Error).message}`);
    }
  }
  return trackers;
}

/**
 * A stateless `(Request) => Response` handler. Runs unchanged on Cloudflare
 * Workers, Vercel/Deno/Bun, or Node via src/server.ts.
 */
export function createRelay(opts: RelayOptions): (req: Request) => Promise<Response> {
  const trackers = validate(opts.projects);
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const limit = opts.rateLimit ?? { max: 10, windowMs: 60_000 };
  const hits = opts.hits ?? new Map<string, number[]>();
  let lastPrune = -Infinity;
  const allOrigins = new Set(Object.values(opts.projects).flatMap((p) => p.origins));

  function reply(status: number, body: unknown, origin: string | null, allowed: boolean): Response {
    const headers = new Headers({ "content-type": "application/json" });
    if (origin && allowed) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "origin");
    }
    return new Response(body === null ? null : JSON.stringify(body), { status, headers });
  }

  /** Seconds to wait if either bucket is full, else 0 after recording the hit in both. */
  function limited(ipKey: string, projectKey: string): number {
    const t = now();
    // A full scan is O(n): at most once per window, or once a second if the map has outgrown its cap.
    if (t - lastPrune >= limit.windowMs || (hits.size > MAX_BUCKETS && t - lastPrune >= 1000)) {
      lastPrune = t;
      for (const [k, v] of hits) if (t - v[v.length - 1]! >= limit.windowMs) hits.delete(k);
    }
    const recent = (k: string) => (hits.get(k) ?? []).filter((x) => t - x < limit.windowMs);
    const buckets = [
      [ipKey, recent(ipKey), limit.max],
      [projectKey, recent(projectKey), limit.projectMax ?? 60],
    ] as const;
    const full = buckets.filter(([, r, max]) => r.length >= max);
    for (const [k, r] of buckets) hits.set(k, r);
    if (full.length) return Math.max(...full.map(([, r]) => Math.max(1, Math.ceil((r[0]! + limit.windowMs - t) / 1000))));
    for (const [k, r] of buckets) r.push(t);
    return 0;
  }

  async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");

    if (req.method === "OPTIONS") {
      const ok = origin !== null && allOrigins.has(origin);
      const res = reply(204, null, origin, ok);
      if (ok) {
        res.headers.set("access-control-allow-methods", "POST");
        res.headers.set("access-control-allow-headers", "content-type");
        res.headers.set("access-control-max-age", "600");
      }
      return res;
    }
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, origin, false);

    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) return reply(413, { error: "too_large" }, origin, false);
    const text = await readBody(req, MAX_REQUEST_BYTES);
    if (text === null) return reply(413, { error: "too_large" }, origin, false);

    let payload: { projectKey?: unknown; report?: unknown };
    try {
      payload = JSON.parse(text);
    } catch {
      return reply(400, { error: "bad_json" }, origin, false);
    }

    // Unknown key and wrong origin look identical so keys can't be probed.
    const key = typeof payload.projectKey === "string" ? payload.projectKey : "";
    const project = Object.prototype.hasOwnProperty.call(opts.projects, key) ? opts.projects[key] : undefined;
    if (!project || origin === null || !project.origins.includes(origin)) {
      return reply(403, { error: "forbidden" }, origin, false);
    }

    const ip = (opts.clientIp ?? defaultIp)(req);
    const wait = limited(`ip|${key}|${ip}`, `project|${key}`);
    if (wait) {
      const res = reply(429, { error: "rate_limited" }, origin, true);
      res.headers.set("retry-after", String(wait));
      return res;
    }

    const report = parseReport(payload.report, origin, now());
    if (!report) return reply(400, { error: "bad_report" }, origin, true);

    const tracker = trackers.get(key)!;
    let res: Response;
    try {
      res = await tracker.file(report, doFetch, opts.upstreamTimeoutMs ?? 10_000);
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (timedOut) console.error(`cecil-relay: ${tracker.name} did not respond in time`);
      return reply(timedOut ? 504 : 502, { error: timedOut ? "upstream_timeout" : "upstream_error" }, origin, true);
    }
    if (res.status !== 201) {
      // Upstream detail can contain repo/permission info; log server-side, not to the browser.
      const detail = await res.text().catch(() => "");
      console.error(`cecil-relay: ${tracker.name} responded ${res.status}: ${detail.slice(0, 500)}`);
      return reply(502, { error: "upstream_error" }, origin, true);
    }
    // The issue exists by now, so an unreadable reply must not look like a failure.
    let issue = {};
    try {
      issue = tracker.issue(await res.json());
    } catch (err) {
      console.error(`cecil-relay: could not read ${tracker.name}'s reply`, err);
    }
    return reply(201, project.exposeIssueUrl === false ? {} : issue, origin, true);
  }

  return async (req) => {
    try {
      return await handle(req);
    } catch (err) {
      console.error("cecil-relay: unexpected error", err);
      return reply(500, { error: "internal" }, null, false);
    }
  };
}
