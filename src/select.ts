import { isExcluded, labelFor } from "./element";
import type { Privacy } from "./privacy";
import type { Rect } from "./types";

/** Element under the pointer, looking inside open shadow roots. */
function elementAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Position the outline `box` (its first child is a label) over a viewport rect. */
export function place(box: HTMLElement, r: Rect, label: string): void {
  Object.assign(box.style, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  (box.firstElementChild as HTMLElement).textContent = label.replace(/\s+/g, " ").trim().slice(0, 120);
}

export type Picked = { el: Element } | { area: Rect } | null;

export interface PickOptions {
  /** The widget's own host element: never pickable. */
  host: Element;
  /** Outline overlay inside the widget. */
  box: HTMLElement;
  mode: "element" | "area";
  privacy?: Privacy;
  /** Called once with the choice, or null if cancelled with Esc. */
  done(picked: Picked): void;
}

const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

/**
 * Let the user choose an element (hover, click, or Tab + Enter) or drag an area.
 * Esc cancels. Returns a function that stops picking.
 */
export function pick({ host, box, mode, privacy, done }: PickOptions): () => void {
  let start: { x: number; y: number } | undefined;
  let hovered: Element | undefined;

  const mine = (e: Event) => e.composedPath().includes(host);
  const usable = (el: Element | null): el is Element => !!el && el !== host && !host.contains(el) && !isExcluded(el, privacy);

  function preview(el: Element | null | undefined) {
    hovered = el && usable(el) ? el : undefined;
    if (!hovered) {
      box.style.display = "none";
      return;
    }
    const r = hovered.getBoundingClientRect();
    place(box, r, labelFor(hovered, privacy));
  }
  function areaRect(e: PointerEvent): Rect {
    const x2 = clamp(e.clientX, innerWidth);
    const y2 = clamp(e.clientY, innerHeight);
    return { x: Math.min(start!.x, x2), y: Math.min(start!.y, y2), width: Math.abs(x2 - start!.x), height: Math.abs(y2 - start!.y) };
  }

  // Presses are swallowed so the page doesn't react while picking. That also stops a press from moving focus.
  const swallow = (e: Event) => {
    if (mine(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onMove = (e: PointerEvent) => {
    if (mine(e)) return;
    if (mode === "element") preview(elementAt(e.clientX, e.clientY));
    else if (start) place(box, areaRect(e), "Selected area");
  };
  const onDown = (e: PointerEvent) => {
    swallow(e);
    if (mode !== "area" || e.button !== 0 || mine(e)) return;
    start = { x: clamp(e.clientX, innerWidth), y: clamp(e.clientY, innerHeight) };
  };
  const onUp = (e: PointerEvent) => {
    swallow(e);
    if (mode !== "area" || !start) return;
    const area = areaRect(e);
    start = undefined;
    swallowNextClick();
    if (area.width < 8 || area.height < 8) {
      box.style.display = "none";
      return;
    }
    stop();
    done({ area: { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) } });
  };
  const onClick = (e: MouseEvent) => {
    if (mine(e)) return;
    if (mode === "area") {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const el = hovered ?? elementAt(e.clientX, e.clientY);
    if (!usable(el)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stop();
    done({ el });
  };
  const onFocus = (e: FocusEvent) => {
    if (mode === "element" && e.target instanceof Element) preview(e.target);
  };
  // The picker owns Space, Enter and Escape while it runs; the page must not see them. Other keys (Tab) pass through.
  const onKey = (e: KeyboardEvent) => {
    const own = e.key === "Escape" || e.key === "Enter" || e.key === " ";
    if (own && !(e.key !== "Escape" && mine(e))) swallow(e);
    if (e.key === "Escape") {
      stop();
      done(null);
      return;
    }
    const active = document.activeElement;
    if (mode !== "element" || (e.key !== "Enter" && e.key !== " ") || !active || active === document.body || !usable(active)) return;
    if (e.key === " ") return;
    stop();
    done({ el: active });
  };
  // Firefox activates buttons on Space keyup, which keydown's preventDefault doesn't stop.
  const onKeyUp = (e: KeyboardEvent) => {
    if ((e.key === " " || e.key === "Enter") && !mine(e)) swallow(e);
  };
  // Not preventDefault: that would also cancel the click a tap needs.
  const onTouch = (e: Event) => {
    if (!mine(e)) e.stopImmediatePropagation();
  };
  const onScroll = () => mode === "element" && hovered && preview(hovered);

  const on = (add: boolean) => {
    const m = add ? "addEventListener" : "removeEventListener";
    document[m]("pointermove", onMove as EventListener, true);
    document[m]("pointerdown", onDown as EventListener, true);
    document[m]("pointerup", onUp as EventListener, true);
    document[m]("mousedown", swallow, true);
    document[m]("mouseup", swallow, true);
    document[m]("touchstart", onTouch, true);
    document[m]("touchend", onTouch, true);
    document[m]("keyup", onKeyUp as EventListener, true);
    document[m]("click", onClick as EventListener, true);
    document[m]("focusin", onFocus as EventListener, true);
    document[m]("keydown", onKey as EventListener, true);
    window[m]("scroll", onScroll, true);
    window[m]("resize", onScroll);
  };

  function stop() {
    on(false);
    box.style.display = "none";
  }
  on(true);
  return stop;
}

/** The click that ends a drag would hit the page; swallow it. */
function swallowNextClick() {
  const eat = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  document.addEventListener("click", eat, true);
  setTimeout(() => document.removeEventListener("click", eat, true), 250);
}
