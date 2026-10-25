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
:host{all:initial;--c:#3e63dd;--t:#191c22;--m:#697180;--b:#e4e7ec;--sh:0 16px 42px rgba(24,29,39,.2);font-family:system-ui,-apple-system,sans-serif;color:var(--t)}
*,*:before,*:after{box-sizing:border-box;font-family:inherit}
button{font:inherit;cursor:pointer}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--c);outline-offset:2px}
[hidden]{display:none!important}
.dock{position:fixed;z-index:2147483003;display:flex;align-items:center;gap:8px}
.dock[data-h=left]{flex-direction:row-reverse}
.fab{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 15px;border:0;border-radius:12px;background:#21242b;color:#fff;font-size:13px;font-weight:600;box-shadow:var(--sh);touch-action:none}
.fab svg{width:17px;height:17px}
.bar{position:fixed;right:20px;bottom:20px;z-index:2147483003;display:flex;align-items:center;gap:10px;min-height:42px;padding:6px 8px 6px 12px;border:1px solid var(--b);border-radius:12px;background:#fff;box-shadow:var(--sh);font-size:12px}
.hint{font-weight:600;white-space:nowrap}
.modes{display:flex;gap:2px;padding:2px;border-radius:8px;background:#f1f3f6}
.mode{height:28px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:#7c8493;font-size:12px}
.mode:disabled{opacity:.45;cursor:not-allowed}
.mode.on{background:#fff;color:var(--t);box-shadow:0 1px 3px rgba(24,29,39,.14)}
.kbd{height:19px;padding:1px 5px;border:1px solid #d4d8df;border-bottom-width:2px;border-radius:5px;background:#fff;color:var(--m);font:10px/15px ui-monospace,monospace}
.x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:var(--m)}
.x:hover{background:#f8f9fb;color:var(--t)}
.box{position:fixed;display:none;z-index:2147483000;border:2px solid var(--c);border-radius:3px;background:rgba(62,99,221,.1);box-shadow:0 0 0 5px rgba(62,99,221,.14);pointer-events:none}
.box.on{box-shadow:0 0 0 4px rgba(62,99,221,.11)}
.tag{position:absolute;left:-2px;top:-29px;max-width:260px;height:23px;padding:3px 7px;border-radius:5px;background:var(--c);color:#fff;font-size:11px;font-weight:600;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel{position:fixed;z-index:2147483003;width:min(340px,calc(100vw - 32px));border:1px solid var(--b);border-radius:12px;background:#fff;box-shadow:var(--sh)}
.head{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 0 14px}
h2{margin:0;font-size:14px;font-weight:650}
.body{display:flex;flex-direction:column;gap:10px;padding:10px 14px 14px}
.trow{display:flex;align-items:center;gap:7px;min-width:0}
.chip{display:inline-flex;align-items:center;min-width:0;max-width:245px;height:25px;padding:0 8px;border:1px solid rgba(62,99,221,.3);border-radius:7px;background:#eef2fd;color:var(--c);font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.link{border:0;background:transparent;color:var(--m);padding:3px;font-size:12px}
textarea{width:100%;min-height:88px;resize:vertical;padding:9px 10px;border:1px solid #cfd4dc;border-radius:7px;color:var(--t);background:#fff;font-size:13px;line-height:1.5}
.status{min-height:17px;margin:0;color:var(--m);font-size:12px}
.status.err{color:#b42318}
.actions{display:flex;justify-content:flex-end;gap:7px}
.btn{height:32px;padding:0 11px;border:1px solid #d5d9e0;border-radius:7px;background:#fff;color:#353b45;font-size:12px;font-weight:600}
.btn.primary{border-color:var(--c);background:var(--c);color:#fff}
.btn:disabled{opacity:.55;cursor:wait}
.toast{display:flex;align-items:center;gap:8px;height:38px;padding:0 13px;border-radius:10px;background:#21242b;color:#f2f3f5;box-shadow:var(--sh);font-size:13px}
.toast .ok{color:#6ec493;font-weight:700}
.toast a{color:#9db4ff}
.sr{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important}
@media(max-width:640px){
.bar{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;flex-wrap:wrap}
.hint{flex:1}.kbd{display:none}
.dock{flex-direction:column;align-items:flex-end}
.dock[data-h=left]{flex-direction:column;align-items:flex-start}
.dock[data-v=top]{flex-direction:column-reverse}
.panel{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;width:auto}
.toast{max-width:calc(100vw - 40px)}}
`;

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
  <button class="x" data-act="close" type="button" aria-label="Exit feedback mode">✕</button>
</section>
<section class="panel" role="dialog" aria-modal="false" aria-labelledby="ttl" hidden>
  <div class="head"><h2 id="ttl">New feedback</h2><button class="x" data-act="close" type="button" aria-label="Close feedback">✕</button></div>
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
<div class="toast" hidden><span class="ok">✓</span><span class="msg">Feedback sent — thank you</span><a target="_blank" rel="noopener" hidden>View issue</a></div>
<button class="fab" type="button" aria-expanded="false" aria-label="Open feedback">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="12" r="7.4" fill="currentColor" stroke="none"/><circle cx="11.5" cy="10" r="1.15" fill="#21242b" stroke="none"/><path d="M10.5 14h3.5a1.75 1.75 0 0 1-3.5 0z" fill="#21242b" stroke="#21242b" stroke-width="1.2"/><path d="M18.7 10a3 3 0 0 1 0 4"/><path d="M21.7 9a6 6 0 0 1 0 6"/></svg>
  <span>Feedback</span>
</button>
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
