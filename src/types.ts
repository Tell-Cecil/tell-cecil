export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the picker learned about the element the reporter chose. No HTML, no input values. */
export interface ElementInfo {
  /** Best CSS selector (test id, id, or tag path). */
  selector: string;
  tag: string;
  role?: string;
  /** Accessible name: aria-label, label, alt, title, or text. */
  name?: string;
  text?: string;
  attributes?: Record<string, string>;
  /** Other ways to find it, most stable first. */
  locators: string[];
  /** Nearest ancestors, closest first, e.g. `nav[role=navigation]`. */
  ancestors?: string[];
  /** Viewport coordinates when picked. */
  rect: Rect;
  /** True if privacy rules hid some content. */
  redacted: boolean;
}

/** What the widget collects from the page and the reporter. */
export interface Report {
  comment: string;
  url: string;
  /** Who is reporting, as the host page declares it. Not verified. */
  user?: string;
  element?: ElementInfo;
  /** Viewport rectangle the reporter dragged, if any. */
  area?: Rect;
  userAgent: string;
  viewport: { width: number; height: number };
  /** Set by the relay; whatever the browser sends is ignored. */
  timestamp: string;
}

/** Send a report to the relay. Returns the created issue's URL. */
export type Submit = (report: Report) => Promise<{ url?: string }>;

export const MAX_COMMENT = 4000;

/** Files reports in one issue tracker. Relay side only. */
export interface Tracker {
  /** For logs, e.g. "GitHub". */
  name: string;
  /** POST the report as a new issue. Returns the raw response for the relay to interpret; success is 201. */
  file(report: Report, doFetch: typeof fetch, timeoutMs: number): Promise<Response>;
  /** What the page may learn about the issue, from the tracker's 201 reply. */
  issue(reply: unknown): { url?: string; number?: number; key?: string };
}
