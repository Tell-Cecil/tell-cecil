import { describe, expect, it } from "vitest";
import { pageUrl } from "../src/privacy";

describe("pageUrl", () => {
  it("drops query and hash by default and honours a custom function", () => {
    const href = "https://e.com/a/b?token=x#y";
    expect(pageUrl(href)).toBe("https://e.com/a/b");
    expect(pageUrl(href, {})).toBe("https://e.com/a/b");
    expect(pageUrl(href, { url: (h) => h })).toBe(href);
    expect(pageUrl(href, { url: (h) => h.replace(/token=\w+/, "token=_") })).toBe("https://e.com/a/b?token=_#y");
  });
});
