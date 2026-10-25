import { beforeEach, describe, expect, it, vi } from "vitest";
import { describe as describeEl, isExcluded, labelFor } from "../src/element";

// jsdom has no CSS.escape; real browsers do.
globalThis.CSS ??= { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) } as typeof CSS;

beforeEach(() => {
  document.body.innerHTML = `
    <nav aria-label="Main"><a href="/x" data-testid="go"><span>Go <b>now</b></span></a></nav>
    <form><label for="pw">Password</label><input id="pw" type="password" value="hunter2">
    <button class="a">One</button><button class="a">Two</button></form>
    <div data-cecil-private><button id="secret">Secret</button></div>
    <div id="card">Card <span data-cecil-mask>4111</span> end</div>`;
});

describe("describeEl", () => {
  it("prefers test ids, and reports role, name and ancestors", () => {
    const info = describeEl(document.querySelector("a")!);
    expect(info.selector).toBe('[data-testid="go"]');
    expect(info.role).toBe("link");
    expect(info.name).toBe("Go now");
    expect(info.ancestors).toEqual(["nav[role=navigation]"]);
    expect(info.locators).toContain("role=link name=\"Go now\"");
  });

  it("disambiguates siblings with nth-of-type", () => {
    const info = describeEl(document.querySelectorAll("button.a")[1]!);
    expect(info.selector).toMatch(/button:nth-of-type\(2\)$/);
  });

  it("never reads password values and hides masked text", () => {
    const pw = describeEl(document.querySelector("#pw")!);
    expect(JSON.stringify(pw)).not.toContain("hunter2");
    expect(pw.redacted).toBe(true);
    expect(pw.name).toBe("Password");
    const card = describeEl(document.querySelector("#card")!);
    expect(card.text).toBe("Card end");
    expect(card.redacted).toBe(true);
  });

  it("never captures editable content", () => {
    document.body.innerHTML = `
      <textarea id="t">my secret draft</textarea>
      <select id="s"><option id="o">saved address 1 Main St</option></select>
      <div id="ce" contenteditable="true">private <b id="b">note</b></div>
      <div id="p">Visible <div contenteditable>typed words</div> tail</div>
      <div id="off" contenteditable="false">static</div>`;
    for (const id of ["t", "s", "o", "ce", "b"]) {
      const info = describeEl(document.getElementById(id)!);
      expect(info.text).toBeUndefined();
      expect(info.name).toBeUndefined();
      expect(info.redacted).toBe(true);
    }
    const parent = describeEl(document.getElementById("p")!);
    expect(parent.redacted).toBe(true);
    expect(parent.text).toBe("Visible tail");
    expect(describeEl(document.getElementById("off")!).text).toBe("static");
  });

  it("applies exclusion and masking across open shadow roots", () => {
    document.body.innerHTML = `
      <div data-cecil-private><div id="h1"></div></div>
      <div data-cecil-mask id="m"><div id="h2"></div></div>`;
    const inner = (host: string) => {
      const root = document.querySelector(host)!.attachShadow({ mode: "open" });
      root.innerHTML = "<section><button>Pay 4111</button></section>";
      return root.querySelector("button")!;
    };
    const priv = inner("#h1");
    expect(isExcluded(priv)).toBe(true);
    expect(() => describeEl(priv)).toThrow();
    const masked = describeEl(inner("#h2"));
    expect(masked.redacted).toBe(true);
    expect(masked.text).toBeUndefined();
    expect(masked.name).toBeUndefined();
  });

  it("knows implicit roles of structural elements", () => {
    document.body.innerHTML = `<header id="h"></header><footer id="f"></footer><aside id="a"></aside><ul id="ul"><li id="li">x</li></ul><ol id="ol"></ol>
      <table id="t"></table><dialog id="d"></dialog><select><option id="o">x</option></select>
      <section id="named" aria-label="Pricing"></section><section id="plain"></section>`;
    const role = (id: string) => describeEl(document.getElementById(id)!).role;
    expect(["h", "f", "a", "ul", "li", "ol", "t", "d", "o", "named", "plain"].map(role)).toEqual([
      "banner", "contentinfo", "complementary", "list", "listitem", "list", "table", "dialog", "option", "region", undefined,
    ]);
  });

  it("names a control from a wrapping label, without the control itself", () => {
    document.body.innerHTML = '<label>Battery <meter id="m" value="0.5">50%</meter></label><span id="s">plain</span>';
    expect(describeEl(document.getElementById("m")!).name).toBe("Battery");
    expect(describeEl(document.getElementById("s")!).name).toBe("plain");
  });

  it("finds label[for] and aria-labelledby inside a shadow root", () => {
    document.body.innerHTML = "<div id='host'></div>";
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = '<label for="m">Level</label><meter id="m"></meter><span id="t">Title</span><meter id="n" aria-labelledby="t"></meter>';
    expect(describeEl(root.getElementById("m")!).name).toBe("Level");
    expect(describeEl(root.getElementById("n")!).name).toBe("Title");
  });

  it("keeps extending the path past eight levels until it is unique", () => {
    const chain = (n: number) => "<div>".repeat(n) + "<b class='leaf'>x</b>" + "</div>".repeat(n);
    document.body.innerHTML = chain(10) + chain(10);
    const leaf = document.querySelectorAll(".leaf")[1]!;
    const sel = describeEl(leaf).selector;
    expect(sel.split(" > ").length).toBeGreaterThan(8);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(leaf);
  });

  it("refuses private elements and honours site selectors", () => {
    const secret = document.querySelector("#secret")!;
    expect(isExcluded(secret)).toBe(true);
    expect(() => describeEl(secret)).toThrow();
    expect(isExcluded(document.querySelector("nav")!, { exclude: ["nav"] })).toBe(true);
  });

  it("keeps built-in rules when a site selector is invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { exclude: ["((bad"], mask: ["((bad", ".x"] };
    expect(isExcluded(document.querySelector("#secret")!, bad)).toBe(true);
    expect(isExcluded(document.querySelector("nav")!, bad)).toBe(false);
    const pw = describeEl(document.querySelector("#pw")!, bad);
    expect(pw.redacted).toBe(true);
    document.body.insertAdjacentHTML("beforeend", '<p id="m">a <i class="x">hidden</i></p>');
    expect(describeEl(document.querySelector("#m")!, bad).text).toBe("a");
    expect(warn).toHaveBeenCalledWith("cecil: ignoring invalid selector", "((bad");
    warn.mockRestore();
  });
});

describe("labelFor", () => {
  it("uses the accessible name and hides masked text", () => {
    expect(labelFor(document.querySelector("a")!)).toBe("Go now");
    document.body.innerHTML = '<button id="b" data-cecil-mask aria-label="Card 4111">4111</button><i id="i"></i>';
    expect(labelFor(document.getElementById("b")!)).toBe("<button>");
    expect(labelFor(document.getElementById("i")!)).toBe("<i>");
  });
});

describe("masked form controls", () => {
  const html = (h: string) => (document.body.innerHTML = h);
  const $ = (s: string) => document.querySelector(s)!;

  it("names a control from label[for] and offers a role locator with that name", () => {
    html('<label for="email">Email address</label><input id="email">');
    const info = describeEl($("#email"));
    expect(info.name).toBe("Email address");
    expect(info.locators).toContain('role=textbox name="Email address"');
  });

  it("names a checkbox from a wrapping label, excluding the control", () => {
    html('<label><input type="checkbox" id="c" checked> Remember me</label>');
    expect(describeEl($("#c")).name).toBe("Remember me");
  });

  it("names a select from aria-label, and a textbox from its placeholder", () => {
    html('<select id="s" aria-label="Plan"><option>Pro secret</option></select><input id="p" placeholder="Search docs">');
    expect(describeEl($("#s")).name).toBe("Plan");
    expect(describeEl($("#p")).name).toBe("Search docs");
  });

  it("finds label[for] inside a shadow root", () => {
    const host = document.body.appendChild(document.createElement("div"));
    host.attachShadow({ mode: "open" }).innerHTML = '<label for="a">Shadow label</label><input id="a">';
    expect(describeEl(host.shadowRoot!.querySelector("input")!).name).toBe("Shadow label");
  });

  it("never emits the value, selected option or typed text", () => {
    html('<label for="e">Email</label><input id="e"><textarea id="t"></textarea><select id="s"><option selected>Chosen</option></select>');
    ($("#e") as HTMLInputElement).value = "secret@x.com";
    ($("#t") as HTMLTextAreaElement).value = "secret@x.com";
    for (const id of ["#e", "#t", "#s"]) {
      const json = JSON.stringify(describeEl($(id)));
      expect(json).not.toContain("secret@x.com");
      expect(json).not.toContain("Chosen");
    }
    expect(describeEl($("#s")).name).toBeUndefined();
  });

  it("leaves other masked content unnamed", () => {
    html('<div id="m" data-cecil-mask aria-label="Account 4111">4111</div>');
    const info = describeEl($("#m"));
    expect(info.name).toBeUndefined();
    expect(info.locators.some((l) => l.startsWith("role="))).toBe(false);
  });

  it("does not redact a plain form, but does when it holds an excluded or masked element", () => {
    html('<form id="f"><label for="e">Email</label><input id="e"><textarea></textarea></form>');
    expect(describeEl($("#f")).redacted).toBe(false);
    html('<form id="f"><input id="e"><div data-cecil-private>x</div></form>');
    expect(describeEl($("#f")).redacted).toBe(true);
    html('<form id="f"><input id="e"><span data-cecil-mask>x</span></form>');
    expect(describeEl($("#f")).redacted).toBe(true);
  });

  it("keeps an excluded control unnamed and uncapturable", () => {
    html('<label for="e">Email</label><input id="e" class="no">');
    expect(() => describeEl($("#e"), { exclude: [".no"] })).toThrow();
    expect(labelFor($("#e"), { mask: ["#e"] })).toBe("<input>");
  });
});

describe("redacted", () => {
  const html = (h: string) => (document.body.innerHTML = h);
  const $ = (s: string) => document.querySelector(s)!;

  it("ignores plumbing: hidden inputs, scripts and the widget host", () => {
    html('<form id="f"><input type="hidden" name="csrf" value="x"><input id="e"></form>');
    expect(describeEl($("#f")).redacted).toBe(false);
    html('<div id="d"><script>1</script><style>a{}</style><template></template>text</div>');
    expect(describeEl($("#d")).redacted).toBe(false);
    html('<p>page</p><div data-cecil></div>');
    expect(describeEl(document.body).redacted).toBe(false);
  });

  it("flags private and site-excluded children", () => {
    html('<div id="a"><div data-cecil-private>x</div></div><div id="b"><span class="no">x</span></div>');
    expect(describeEl($("#a")).redacted).toBe(true);
    expect(describeEl($("#b"), { exclude: [".no"] }).redacted).toBe(true);
    expect(describeEl($("#b")).redacted).toBe(false);
  });
});

