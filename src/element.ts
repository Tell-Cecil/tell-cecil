import type { Privacy } from "./privacy";
import type { ElementInfo } from "./types";

const EXCLUDE = ["script", "style", "template", "input[type=hidden]", "[data-cecil-private]", "[data-cecil]"];
// Form controls lose their value and text but keep their label; the rest of MASK hides content, so it loses its name too.
const CONTROLS = ["input", "textarea", "select"];
const HIDE = ['[contenteditable]:not([contenteditable="false"])', "[data-cecil-mask]"];
const ATTRS = ["id", "data-testid", "data-test", "name", "role", "type"];
const TEST_ATTRS = ["data-testid", "data-test"];

const valid = (sel: string) => {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    console.warn("cecil: ignoring invalid selector", sel);
    return false;
  }
};
const NONE: Privacy = {};
const cache = new WeakMap<Privacy, { exclude: string; mask: string; hide: string; hidden: string }>();

/** Built-in and site selectors, each validated alone so one bad selector can't disable the rest. */
function lists(p: Privacy) {
  let l = cache.get(p);
  if (!l) {
    const hide = [...HIDE, ...(p.mask ?? []).filter(valid)];
    const site = (p.exclude ?? []).filter(valid);
    // `hidden`: excluded content a reader would miss. Plumbing like <script> or a hidden CSRF input doesn't count.
    l = {
      exclude: [...EXCLUDE, ...site].join(","),
      mask: [...CONTROLS, ...hide].join(","),
      hide: hide.join(","),
      hidden: ["[data-cecil-private]", ...site].join(","),
    };
    cache.set(p, l);
  }
  return l;
}

const is = (el: Element, sel: string) => el.matches(sel);
// closest() stops at a shadow boundary, so keep climbing through the hosts.
function inside(el: Element, sel: string): boolean {
  for (let n: Element | null = el; n; ) {
    if (n.closest(sel)) return true;
    const root = n.getRootNode();
    n = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

export function isExcluded(el: Element, privacy: Privacy = NONE): boolean {
  return inside(el, lists(privacy).exclude);
}

const clean = (s: string | null | undefined, max: number) => s?.replace(/\s+/g, " ").trim().slice(0, max) || undefined;
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, " ")}"`;
const ident = (s: string) => CSS.escape(s);

/** Visible text of an element, skipping excluded and masked descendants. */
function textOf(el: Element, p: ReturnType<typeof lists>, max: number, skip?: Element): string | undefined {
  let out = "";
  const walk = (n: Node, root = false) => {
    if (out.length >= max * 2) return;
    if (n.nodeType === 3) out += ` ${n.textContent ?? ""}`;
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e === skip || (!root && (is(e, p.exclude) || is(e, p.mask)))) return;
      e.childNodes.forEach((c) => walk(c));
    }
  };
  walk(el, true);
  return clean(out, max);
}

function roleOf(el: Element): string | undefined {
  const explicit = clean(el.getAttribute("role"), 100)?.toLowerCase();
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : undefined;
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return (
      { checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider", search: "searchbox" }[type] ??
      (type === "hidden" ? undefined : "textbox")
    );
  }
  if (tag === "section") return el.getAttribute("aria-label")?.trim() || el.getAttribute("aria-labelledby")?.trim() ? "region" : undefined;
  return {
    button: "button",
    textarea: "textbox",
    select: "combobox",
    option: "option",
    img: "img",
    nav: "navigation",
    main: "main",
    form: "form",
    li: "listitem",
    ul: "list",
    ol: "list",
    table: "table",
    dialog: "dialog",
    header: "banner",
    footer: "contentinfo",
    aside: "complementary",
  }[tag];
}

const LABELABLE = /^(button|input|meter|output|progress|select|textarea)$/;

function labelOf(el: Element, p: ReturnType<typeof lists>): string | undefined {
  const scope = el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot) : el.ownerDocument;
  const usable = (e: Element | null, skip?: Element) => (e && !inside(e, p.exclude) && !inside(e, p.mask) ? textOf(e, p, 1000, skip) : undefined);
  const byIds = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .slice(0, 8)
    .map((id) => (id ? usable(scope.getElementById(id)) : undefined))
    .filter(Boolean)
    .join(" ");
  const id = el.getAttribute("id");
  const labelable = LABELABLE.test(el.tagName.toLowerCase());
  return (
    clean(el.getAttribute("aria-label"), 1000) ??
    clean(byIds, 1000) ??
    (id ? usable(scope.querySelector(`label[for=${quote(id)}]`)) : undefined) ??
    (labelable ? usable(el.closest("label"), el) : undefined)
  );
}

/** The name a reporter may see. Masked form controls get their label or placeholder, never their value or text; other masked content gets none. */
function nameOf(el: Element, p: ReturnType<typeof lists>): string | undefined {
  if (inside(el, p.mask)) {
    const control = CONTROLS.includes(el.tagName.toLowerCase()) && !inside(el, p.hide);
    return control ? (labelOf(el, p) ?? clean(el.getAttribute("placeholder"), 1000)) : undefined;
  }
  return labelOf(el, p) ?? clean(el.getAttribute("placeholder"), 1000) ?? clean(el.getAttribute("alt"), 1000) ?? clean(el.getAttribute("title"), 1000) ?? textOf(el, p, 1000);
}

/** Short label for the picker's preview: the accessible name, never text a mask would hide. */
export function labelFor(el: Element, privacy: Privacy = NONE): string {
  const p = lists(privacy);
  return nameOf(el, p) || `<${el.tagName.toLowerCase()}>`;
}

function unique(el: Element, sel: string): boolean {
  try {
    const root = el.getRootNode() as ParentNode;
    const found = ("querySelectorAll" in root ? root : el.ownerDocument).querySelectorAll(sel);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  // Eight levels is usually enough; keep climbing (to 16) only while the path is still ambiguous.
  for (let n: Element | null = el; n && parts.length < 16 && (parts.length < 8 || !unique(el, parts.join(" > "))); n = n.parentElement) {
    const tag = n.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    const id = clean(n.getAttribute("id"), 500);
    if (id && unique(n, `#${ident(id)}`)) {
      parts.unshift(`#${ident(id)}`);
      break;
    }
    const same = [...(n.parentElement?.children ?? [])].filter((s) => s.tagName === n!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

/** Locators most stable first. Entries starting with `role=` are not CSS. */
function locatorsOf(el: Element, role?: string, name?: string): string[] {
  const out: string[] = [];
  for (const a of TEST_ATTRS) {
    const v = clean(el.getAttribute(a), 500);
    if (v && unique(el, `[${a}=${quote(v)}]`)) out.push(`[${a}=${quote(v)}]`);
  }
  const id = clean(el.getAttribute("id"), 500);
  if (id && unique(el, `#${ident(id)}`)) out.push(`#${ident(id)}`);
  if (role && name) out.push(`role=${role} name=${quote(name.slice(0, 100))}`);
  const path = cssPath(el);
  if (!out.includes(path)) out.push(path);
  return out.slice(0, 8);
}

function ancestorsOf(el: Element): string[] | undefined {
  const out: string[] = [];
  for (let n = el.parentElement; n && out.length < 4; n = n.parentElement) {
    const tag = n.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    const role = roleOf(n);
    out.push(role && role !== tag ? `${tag}[role=${role}]` : tag);
  }
  return out.length ? out : undefined;
}

/** Describe an element for a report. Throws if it is excluded. */
export function describe(el: Element, privacy: Privacy = NONE): ElementInfo {
  const p = lists(privacy);
  if (inside(el, p.exclude)) throw new Error("This area is private and cannot be captured.");
  const masked = inside(el, p.mask);
  const role = roleOf(el);
  const name = nameOf(el, p);
  const text = masked ? undefined : textOf(el, p, 500);
  const locators = locatorsOf(el, role, name);
  const attributes: Record<string, string> = {};
  for (const a of ATTRS) {
    const v = clean(el.getAttribute(a), 500);
    if (v) attributes[a] = v;
  }
  const r = el.getBoundingClientRect();
  const hidesChild = el.querySelector(p.hidden) !== null || el.querySelector(p.hide) !== null;
  const ancestors = ancestorsOf(el);
  const info: ElementInfo = {
    selector: locators.find((l) => !l.startsWith("role=")) ?? cssPath(el),
    tag: el.tagName.toLowerCase(),
    locators,
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    redacted: masked || hidesChild,
  };
  if (role) info.role = role;
  if (name) info.name = name;
  if (text) info.text = text;
  if (Object.keys(attributes).length) info.attributes = attributes;
  if (ancestors) info.ancestors = ancestors;
  return info;
}
