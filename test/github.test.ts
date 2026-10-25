// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatBody, formatTitle, MAX_BODY } from "../src/github";
import type { Report } from "../src/types";

const base: Report = {
  comment: "hi",
  url: "https://e.com",
  userAgent: "UA",
  viewport: { width: 1, height: 1 },
  timestamp: "now",
};
const element = { selector: "#buy", tag: "button", role: "button", name: "Buy", locators: ["#buy", "role=button"], rect: { x: 0, y: 0, width: 1, height: 1 }, redacted: false };

describe("formatBody", () => {
  it("lists element details and the dragged area", () => {
    const body = formatBody({ ...base, element, area: { x: 1, y: 2, width: 3, height: 4 } });
    expect(body).toContain("**Element:** `#buy`");
    expect(body).toContain('**Accessible:** `button "Buy"`');
    expect(body).toContain("**Locators:** `#buy` · `role=button`");
    expect(body).toContain("**Area:** 1,2 3x4");
  });

  it("renders attributes", () => {
    const body = formatBody({ ...base, element: { ...element, attributes: { id: "buy", "data-testid": "go\nnow" } } });
    expect(body).toContain("**Attributes:** `id=buy` · `data-testid=go now`");
  });

  it("separates the comment from the metadata with a blank line", () => {
    expect(formatBody(base).startsWith("> hi\n\n### Report details\n**Page:** `https://e.com`")).toBe(true);
  });

  it("shortens only the comment, never the metadata", () => {
    const body = formatBody({ ...base, comment: "x".repeat(MAX_BODY * 2), element: { ...element, text: "y".repeat(500) } });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(body).toContain(`**Text:** \`${"y".repeat(500)}\``);
    expect(body.endsWith("**Reported:** now")).toBe(true);
  });
});

describe("formatBody comment", () => {
  it("keeps a comment that imitates metadata inside the blockquote", () => {
    const comment = "bug\n\n---\n**Page:** `https://evil.test`\n### Report details\n**Reporter:** `ceo@corp` (verified)\r\nlast";
    const body = formatBody({ ...base, comment });
    const section = body.slice(0, body.indexOf("\n\n### Report details\n"));
    expect(section.split("\n").every((l) => l.startsWith(">"))).toBe(true);
    expect(section).toContain("> ### Report details");
    expect(section).toContain("> last");
    expect(body.match(/^### Report details$/gm)).toHaveLength(1);
    expect(body.match(/^\*\*Page:\*\*/gm)).toHaveLength(1);
  });

  it("escapes raw HTML so it cannot swallow the details", () => {
    for (const comment of ["Broken\n<!--", "<details><summary>x"]) {
      const body = formatBody({ ...base, comment });
      const i = body.indexOf("\n\n### Report details\n");
      expect(i).toBeGreaterThan(0);
      expect(body.slice(0, i)).not.toContain("<");
      expect(body.slice(i)).toContain("**Page:**");
    }
    expect(formatBody({ ...base, comment: "<!--" })).toContain("> &lt;!--");
  });

  it("never splits an entity when truncating escaped text", () => {
    const body = formatBody({ ...base, comment: "<".repeat(MAX_BODY) });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(body.slice(0, body.indexOf("\n\n### Report details")).replace(/&lt;/g, "").replace(/^> /, "")).toBe("");
  });

  it("stays within the limit when quoting many short lines", () => {
    const body = formatBody({ ...base, comment: "x\n".repeat(MAX_BODY) });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(body.endsWith("**Reported:** now")).toBe(true);
  });
});

describe("formatTitle", () => {
  it("uses the first line, clipped to 80 characters", () => {
    expect(formatTitle({ ...base, comment: "Broken\nmore" })).toBe("Broken");
    expect(formatTitle({ ...base, comment: "a".repeat(100) })).toBe(`${"a".repeat(77)}...`);
  });
});
