import { describe } from "./element";
import { pageUrl, type Privacy } from "./privacy";
import { pick, place, type Picked } from "./select";
import { MAX_COMMENT, type ElementInfo, type Rect, type Report, type Submit } from "./types";

type Target =
  | { kind: "page" }
  | { kind: "element"; el: Element; info: ElementInfo }
  | { kind: "area"; rect: Rect };
type Mode = "idle" | "picking" | "composing" | "sent";
type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

function collect(comment: string, t?: Target, privacy?: Privacy): Report {
  return {
    comment,
    url: pageUrl(location.href, privacy),
    element: t?.kind === "element" ? t.info : undefined,
    area: t?.kind === "area" ? t.rect : undefined,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    timestamp: new Date().toISOString(),
  };
}

const CSS_TEXT = `
:host{all:initial;--c:#ffd500;--t:#0a0a0a;--t2:#444;--m:#767676;--b:#c8c8c8;--p:#f6f6f6;--sh:0 16px 40px rgba(10,10,10,.12);--f:Archivo,"Helvetica Neue",Arial,sans-serif;--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;font-family:var(--f);color:var(--t);-webkit-font-smoothing:antialiased}
*,*:before,*:after{box-sizing:border-box;font-family:inherit}
button{font:inherit;cursor:pointer}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--t);outline-offset:2px}
[hidden]{display:none!important}
svg{display:block;flex:none}
.dock{position:fixed;z-index:2147483003;display:flex;align-items:center;gap:8px}
.dock[data-h=left]{flex-direction:row-reverse}
.fab{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px 0 14px;border:0;border-radius:999px;background:var(--t);color:#fff;font-size:15px;font-weight:500;box-shadow:var(--sh);touch-action:none}
.fab:hover{background:var(--t2)}
.fab svg{width:18px;height:18px}
.fab .ry{stroke:var(--c)}
.bar{position:fixed;right:20px;bottom:20px;z-index:2147483003;display:flex;align-items:center;gap:12px;min-height:44px;padding:6px 6px 6px 16px;border:1px solid var(--b);border-radius:8px;background:#fff;box-shadow:var(--sh);font-size:13px}
.hint{font-weight:600;white-space:nowrap}
.modes{display:flex;gap:2px;padding:2px;border-radius:4px;background:var(--p)}
.mode{height:28px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:var(--t2);font-size:13px;font-weight:500}
.mode:disabled{opacity:.45;cursor:not-allowed}
.mode.on{background:#fff;color:var(--t);box-shadow:inset 0 0 0 1px var(--b)}
.kbd{height:20px;padding:0 6px;border:1px solid var(--b);border-radius:4px;background:#fff;color:var(--m);font:11px/18px var(--mono)}
.x{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:4px;background:transparent;color:var(--m)}
.x:hover{color:var(--t)}
.x svg{width:12px;height:12px}
.box{position:fixed;display:none;z-index:2147483000;border-radius:4px;outline:2px solid var(--c);outline-offset:4px;pointer-events:none}
.tag{position:absolute;left:-6px;top:-32px;max-width:260px;height:20px;padding:0 8px;border-radius:4px;background:var(--t);color:#fff;font:11px/20px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel{position:fixed;z-index:2147483003;width:min(340px,calc(100vw - 32px));border:1px solid var(--b);border-radius:8px;background:#fff;box-shadow:var(--sh)}
.head{display:flex;align-items:center;justify-content:space-between;padding:20px 20px 0}
h2{display:flex;align-items:center;gap:8px;margin:0;font-size:15px;line-height:22px;font-weight:600}
h2 svg{width:16px;height:16px}
h2 rect{fill:var(--c)}
.body{display:flex;flex-direction:column;gap:12px;padding:12px 20px 20px}
.trow{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border-radius:4px;background:var(--p);font:12px/16px var(--mono)}
.trow:before{content:"";flex:none;width:8px;height:8px;border:1.5px solid var(--c)}
.chip{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.link,.btn{padding:0;border:0;background:transparent;color:var(--t);font-family:var(--f);font-weight:500;text-decoration:underline;text-underline-offset:3px}
.link:hover{color:var(--t2)}
textarea{display:block;width:100%;min-height:88px;resize:vertical;margin:0;padding:10px 12px;border:1px solid var(--b);border-radius:4px;color:var(--t);background:#fff;font-size:15px;line-height:22px}
textarea::placeholder{color:var(--m)}
.status{margin:0;color:var(--m);font-size:13px;line-height:18px}
.status:empty{position:absolute}
.status.err{color:#b42318}
.actions{display:flex;align-items:center;justify-content:flex-end;gap:16px}
.btn{color:var(--t2);font-size:15px}
.btn:hover{color:var(--t)}
.btn.primary{height:44px;padding:0 20px;border-radius:999px;background:var(--t);color:#fff;text-decoration:none}
.btn.primary:hover{background:var(--t2)}
.btn:disabled{opacity:.55;cursor:wait}
.toast{display:flex;align-items:center;gap:10px;height:44px;padding:0 16px;border-radius:8px;background:var(--t);color:#fff;box-shadow:var(--sh);font-size:15px;white-space:nowrap}
.toast svg{width:12px;height:12px;color:var(--c)}
.toast a{color:var(--c);font-weight:500;text-decoration:underline;text-underline-offset:3px}
.sr{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important}
@media(max-width:640px){
.bar{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;flex-wrap:wrap}
.hint{flex:1}.kbd{display:none}
.dock{flex-direction:column;align-items:flex-end}
.dock[data-h=left]{flex-direction:column;align-items:flex-start}
.dock[data-v=top]{flex-direction:column-reverse}
.panel{left:0!important;right:0!important;bottom:0!important;top:auto!important;width:auto;border:0;border-top:1px solid var(--t);border-radius:8px 8px 0 0}
.head{padding:16px 16px 0}.body{padding:12px 16px max(16px,env(safe-area-inset-bottom))}
.toast{max-width:calc(100vw - 40px)}}
`;

// The Cecil mark: ink on a yellow tile for white grounds; on ink, a white pointer with yellow rays.
const RAYS = "M64.056 21.501L71.056 4.001M78.556 30.001L94.056 19.001M82.556 45.501L102.556 47.001";
const POINTER =
  "M22.328 92.533C21.899 93.366 20.663 93.204 20.463 92.289L4.029 17.164C3.845 16.323 4.739 15.658 5.492 16.076L69.019 51.37C69.787 51.796 69.671 52.935 68.833 53.198L37.955 62.876C37.7 62.956 37.487 63.135 37.365 63.372L22.328 92.533Z";
const mark = (tile?: boolean) =>
  `<svg viewBox="${tile ? "-16 -20 139 139" : "0 -4.5 107 107"}" aria-hidden="true" focusable="false">${tile ? '<rect x="-16" y="-20" width="139" height="139" rx="28"/>' : ""}<path class="ry" d="${RAYS}" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/><path d="${POINTER}" fill="currentColor" stroke="currentColor" stroke-width="8"/></svg>`;
const icon = (d: string, w: number) =>
  `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const X = icon("M2 2l8 8M10 2l-8 8", 1.5);

const HTML = `
<div class="box"><span class="tag"></span></div>
<section class="bar" aria-label="Cecil target selection" hidden>
  <span class="hint">Select something to comment on</span>
  <div class="modes">
    <button class="mode" data-mode="element" type="button">Element</button>
    <button class="mode" data-mode="page" type="button">Page</button>
    <button class="mode" data-mode="area" type="button" disabled title="Coming soon">Area</button>
  </div>
  <span class="kbd" aria-hidden="true">esc</span>
  <button class="x" data-act="close" type="button" aria-label="Exit feedback mode">${X}</button>
</section>
<section class="panel" role="dialog" aria-modal="false" aria-labelledby="ttl" hidden>
  <div class="head"><h2 id="ttl">${mark(true)}New feedback</h2><button class="x" data-act="close" type="button" aria-label="Close feedback">${X}</button></div>
  <div class="body">
    <div class="trow"><span class="chip"></span><button class="link" data-act="change" type="button">Change</button></div>
    <textarea aria-label="Feedback" placeholder="What should be improved?"></textarea>
    <p class="status" role="status"></p>
    <div class="actions">
      <button class="btn" data-act="close" type="button">Cancel</button>
      <button class="btn primary" data-act="send" type="button">Send feedback</button>
    </div>
  </div>
</section>
<div class="dock">
<div class="toast" hidden>${icon("M2.5 6.5l2.5 2.5 4.5-5", 1.8)}<span class="msg">Feedback sent. Thank you.</span><a target="_blank" rel="noopener" hidden>View issue</a></div>
<button class="fab" type="button" aria-expanded="false" aria-label="Open feedback">${mark()}<span>Feedback</span></button>
</div>
<p class="sr" aria-live="polite"></p>`;

const CORNER_KEY = "cecil:corner";
const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function mount(submit: Submit, privacy?: Privacy, test?: { onRoot?: (r: ShadowRoot) => void }): () => void {
  const host = document.createElement("div");
  host.setAttribute("data-cecil", "");
  const root = host.attachShadow({ mode: "closed" });
  test?.onRoot?.(root);
  root.innerHTML = HTML;
  // A <style> element is blocked by strict CSP (style-src without 'unsafe-inline'); an adopted sheet is not.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS_TEXT);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    root.prepend(style);
  }
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const box = $(".box");
  const bar = $(".bar");
  const panel = $(".panel");
  const dock = $(".dock");
  const toast = $(".toast");
  const fab = $(".fab");
  const announcer = $(".sr");
  const text = $<HTMLTextAreaElement>("textarea");
  text.maxLength = MAX_COMMENT;
  const status = $(".status");
  const chip = $(".chip");
  const change = $('[data-act="change"]');
  const sendBtn = $<HTMLButtonElement>('[data-act="send"]');
  document.body.append(host);

  let mode: Mode = "idle";
  let target: Target | undefined;
  let stopPick: (() => void) | undefined;
  let pickMode: "element" | "area" = "element";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let corner: Corner = "bottom-right";
  try {
    const saved = localStorage.getItem(CORNER_KEY) as Corner | null;
    if (saved && CORNERS.includes(saved)) corner = saved;
  } catch {
    // Remembering the corner is optional.
  }

  const announce = (m: string) => (announcer.textContent = m);
  const setStatus = (m: string, err = false) => {
    status.textContent = m;
    status.classList.toggle("err", err);
  };
  const label = (t: Target) =>
    t.kind === "element" ? (t.info.name ?? t.info.text ?? `<${t.info.tag}>`) : t.kind === "area" ? "Selected area" : "Entire page";

  function applyCorner() {
    const h = corner.endsWith("left") ? "left" : "right";
    const v = corner.startsWith("top") ? "top" : "bottom";
    dock.dataset.h = h;
    dock.dataset.v = v;
    for (const el of [dock, bar]) {
      el.style.left = h === "left" ? "20px" : "auto";
      el.style.right = h === "right" ? "20px" : "auto";
      el.style.top = v === "top" ? "20px" : "auto";
      el.style.bottom = v === "bottom" ? "20px" : "auto";
    }
  }

  /** Outline the chosen target and put the panel next to it (or in the corner for the page). */
  function layout() {
    if (mode !== "composing" || !target) return;
    const w = Math.min(340, innerWidth - 32);
    const h = panel.offsetHeight || 248;
    const rect: Rect | undefined =
      target.kind === "element" ? (target.el.isConnected ? target.el.getBoundingClientRect() : target.info.rect) : target.kind === "area" ? target.rect : undefined;
    if (!rect) {
      box.style.display = "none";
      panel.style.left = corner.endsWith("left") ? "16px" : `${Math.max(16, innerWidth - w - 16)}px`;
      panel.style.top = corner.startsWith("top") ? "16px" : `${Math.max(16, innerHeight - h - 16)}px`;
      return;
    }
    place(box, rect, label(target));
    box.classList.add("on");
    const below = rect.y + rect.height + 12;
    panel.style.left = `${clamp(rect.x, 16, Math.max(16, innerWidth - w - 16))}px`;
    panel.style.top = `${below + h <= innerHeight - 16 ? below : clamp(rect.y - h - 12, 16, Math.max(16, innerHeight - h - 16))}px`;
  }

  function render() {
    const picking = mode === "picking";
    bar.hidden = !picking;
    panel.hidden = mode !== "composing";
    toast.hidden = mode !== "sent";
    fab.hidden = picking || mode === "composing";
    fab.setAttribute("aria-expanded", String(mode !== "idle"));
    $(".hint").textContent = pickMode === "area" ? "Drag to select an area" : "Select something to comment on";
    root.querySelectorAll<HTMLElement>(".mode").forEach((b) => {
      const on = b.dataset.mode === pickMode && picking;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (mode === "composing" && target) {
      chip.textContent = label(target);
      change.textContent = target.kind === "page" ? "Select element" : "Change";
      setStatus("");
      layout();
      text.focus();
    } else {
      box.classList.remove("on");
      if (!picking) box.style.display = "none";
    }
  }

  function startPick(m: "element" | "area") {
    clearTimeout(timer);
    stopPick?.();
    pickMode = m;
    mode = "picking";
    target = undefined;
    announce(m === "area" ? "Area mode. Drag a rectangle. Press Escape to exit." : "Hover or Tab to an element, then click or press Enter. Press Escape to exit.");
    render();
    stopPick = pick({
      host,
      box,
      mode: m,
      privacy,
      done: (p: Picked) => {
        stopPick = undefined;
        if (!p) return close();
        try {
          target = "el" in p ? { kind: "element", el: p.el, info: describe(p.el, privacy) } : { kind: "area", rect: p.area };
        } catch (err) {
          // The picker has already stopped, so fall back to the page target and say why.
          pickPage();
          return setStatus(err instanceof Error ? err.message : "That could not be captured.", true);
        }
        mode = "composing";
        announce(`${label(target)} selected. Feedback form opened.`);
        render();
      },
    });
  }

  function pickPage() {
    stopPick?.();
    stopPick = undefined;
    target = { kind: "page" };
    mode = "composing";
    render();
  }

  function close() {
    const hadFocus = root.activeElement !== null;
    clearTimeout(timer);
    stopPick?.();
    stopPick = undefined;
    mode = "idle";
    target = undefined;
    render();
    if (hadFocus) fab.focus();
  }

  async function send() {
    if (sendBtn.disabled) return;
    const comment = text.value.trim();
    if (!comment) return setStatus("Please enter your feedback first.", true);
    sendBtn.disabled = true;
    setStatus("Sending…");
    try {
      const { url } = await submit(collect(comment, target, privacy));
      text.value = "";
      const link = toast.querySelector("a")!;
      link.hidden = !url;
      if (url) link.href = url;
      mode = "sent";
      announce("Feedback sent. Thank you.");
      render();
      // The textarea is hidden now; keep focus on something visible.
      (url ? link : fab).focus();
      timer = setTimeout(close, url ? 5000 : 1400);
    } catch (err) {
      setStatus((err as { status?: number }).status === 429 ? "Too many reports. Please try again in a minute." : "Could not send. Please try again.", true);
    } finally {
      sendBtn.disabled = false;
    }
  }

  // Draggable button: dropping it snaps to the nearest corner, remembered per browser.
  let drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  let eatClick = false;
  fab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    fab.setPointerCapture?.(e.pointerId);
  });
  fab.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) >= 6) drag.moved = true;
    if (drag.moved) fab.style.transform = `translate(${dx}px,${dy}px)`;
  });
  fab.addEventListener("pointerup", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = undefined;
    fab.style.transform = "";
    if (!moved) return;
    eatClick = true;
    corner = `${e.clientY < innerHeight / 2 ? "top" : "bottom"}-${e.clientX < innerWidth / 2 ? "left" : "right"}` as Corner;
    try {
      localStorage.setItem(CORNER_KEY, corner);
    } catch {
      // Optional.
    }
    applyCorner();
    announce(`Feedback button moved to the ${corner.replace("-", " ")}.`);
  });
  fab.addEventListener("pointercancel", () => {
    drag = undefined;
    fab.style.transform = "";
  });
  fab.addEventListener("click", () => {
    if (eatClick) eatClick = false;
    else startPick("element");
  });

  root.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-act],[data-mode]");
    if (!t) return;
    if (t.dataset.act === "close") close();
    else if (t.dataset.act === "change") startPick("element");
    else if (t.dataset.act === "send") void send();
    else if (t.dataset.mode === "page") pickPage();
    else if (t.dataset.mode) startPick(t.dataset.mode as "element" | "area");
  });

  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || mode !== "composing" || !e.composedPath().includes(host)) return;
    e.stopPropagation();
    close();
  };
  // Capture, so a host-page modal listening further down doesn't close too. Only for Escape pressed inside the widget.
  document.addEventListener("keydown", onKey, true);
  addEventListener("resize", layout);
  addEventListener("scroll", layout, true);
  applyCorner();
  render();

  return () => {
    close();
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("resize", layout);
    removeEventListener("scroll", layout, true);
    host.remove();
  };
}
