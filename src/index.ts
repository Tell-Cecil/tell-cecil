import type { Privacy } from "./privacy";
import type { Submit } from "./types";
import { mount } from "./ui";

export type { ElementInfo, Rect, Report, Submit } from "./types";
export type { Privacy } from "./privacy";

export interface CecilConfig {
  /** URL of your cecil relay, e.g. https://cecil.example.com */
  endpoint: string;
  /** Public project key; the relay maps it to a repo and an origin allowlist. */
  projectKey: string;
  /** Who is reporting, e.g. an email. A function is called on each send. Shown in the issue as self-reported. */
  user?: string | (() => string | undefined);
  privacy?: Privacy;
}

const TIMEOUT_MS = 15_000;

function createSubmit({ endpoint, projectKey }: CecilConfig): Submit {
  const url = new URL(endpoint, location.href);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("cecil: relay endpoint must use https");
  return async (report) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        // text/plain avoids a CORS preflight; the relay parses the body as JSON regardless.
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ projectKey, report }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        console.warn(`cecil: relay responded ${res.status}${res.status === 403 ? " (check the projectKey and the relay's origin allowlist)" : ""}`);
        throw Object.assign(new Error(`cecil: relay responded ${res.status}`), { status: res.status });
      }
      // The issue exists even if the reply is unreadable.
      return (await res.json().catch(() => ({}))) as { url?: string };
    } finally {
      clearTimeout(timer);
    }
  };
}

let current: (() => void) | undefined;

/** Mount the widget, waiting for <body> if called early. Returns a function that removes it. */
export function init(config: CecilConfig): () => void {
  if (current) {
    console.warn("cecil: already initialised");
    return current;
  }
  const send = createSubmit(config);
  const { user } = config;
  let stop: (() => void) | undefined;
  let cancelled = false;
  const go = () => {
    if (!cancelled) stop = mount((report) => send({ ...report, user: typeof user === "function" ? user() : user }), config.privacy);
  };
  if (document.body) go();
  else document.addEventListener("DOMContentLoaded", go, { once: true });
  return (current = () => {
    cancelled = true;
    document.removeEventListener("DOMContentLoaded", go);
    stop?.();
    current = undefined;
  });
}

/** Read config from the embedding <script> tag's data-* attributes. */
function configFromScript(s: HTMLScriptElement): CecilConfig | null {
  const { endpoint, projectKey, user, exclude, mask, fullUrl } = s.dataset;
  if (!endpoint || !projectKey) return null;
  const list = (v?: string) => v?.split(",").map((x) => x.trim()).filter(Boolean);
  return { endpoint, projectKey, user, privacy: { exclude: list(exclude), mask: list(mask), url: fullUrl === undefined ? undefined : (h) => h } };
}

// currentScript is only set while the script first runs, so read it now.
const script = typeof document === "undefined" ? null : document.currentScript;
if (script && "dataset" in script && script.dataset.endpoint) {
  const cfg = configFromScript(script as HTMLScriptElement);
  if (cfg) init(cfg);
  else console.warn("cecil: set data-endpoint and data-project-key");
}
