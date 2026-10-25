import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pick, type Picked } from "../src/select";

globalThis.CSS ??= { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) } as typeof CSS;

let stop: (() => void) | undefined;
let button: HTMLButtonElement;
const done = vi.fn<(p: Picked) => void>();
const page = { click: vi.fn(), mousedown: vi.fn(), pointerdown: vi.fn() };

beforeEach(() => {
  done.mockClear();
  document.body.innerHTML = '<button id="b">Buy</button><div id="host"></div>';
  button = document.querySelector("button")!;
  for (const [type, fn] of Object.entries(page)) {
    fn.mockClear();
    button.addEventListener(type, fn);
  }
  document.elementFromPoint = () => button;
  const box = document.createElement("div");
  box.append(document.createElement("span"));
  stop = pick({ host: document.querySelector("#host")!, box, mode: "element", done });
});
afterEach(() => stop?.());

const fire = (type: string) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
  button.dispatchEvent(e);
  return e;
};

describe("pick (element mode)", () => {
  it("selects on click without the page's click handler firing", () => {
    fire("pointermove");
    const e = fire("click");
    expect(done).toHaveBeenCalledWith({ el: button });
    expect(page.click).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("labels the preview with the masked name, not raw text", () => {
    button.setAttribute("data-cecil-mask", "");
    button.textContent = "4111 1111";
    const box = document.createElement("div");
    box.append(document.createElement("span"));
    stop?.();
    stop = pick({ host: document.querySelector("#host")!, box, mode: "element", done });
    fire("pointermove");
    expect(box.firstElementChild!.textContent).toBe("<button>");
  });

  it("keeps presses away from the page", () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart"]) {
      const e = fire(type);
      expect(e.defaultPrevented || type === "touchstart").toBe(true);
    }
    expect(page.mousedown).not.toHaveBeenCalled();
    expect(page.pointerdown).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("cancels on Escape and doesn't let the page see it", () => {
    const seen = vi.fn();
    button.addEventListener("keydown", seen);
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    button.dispatchEvent(e);
    expect(done).toHaveBeenCalledWith(null);
    expect(seen).not.toHaveBeenCalled();
  });

  it("swallows Space on a focused element but only Enter selects it", () => {
    button.focus();
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    button.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(done).not.toHaveBeenCalled();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(done).toHaveBeenCalledWith({ el: button });
  });

  it("keeps Space and Enter from reaching a focused page element", () => {
    const seen = vi.fn();
    button.addEventListener("keydown", seen);
    button.addEventListener("keyup", seen);
    button.focus();
    const send = (type: string, key: string) => {
      const e = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
      button.dispatchEvent(e);
      return e;
    };
    expect(send("keyup", " ").defaultPrevented).toBe(true);
    expect(send("keyup", "Enter").defaultPrevented).toBe(true);
    send("keydown", " ");
    send("keydown", "Enter");
    expect(seen).not.toHaveBeenCalled();
  });

  it("keeps Escape from reaching a focused page element", () => {
    const seen = vi.fn();
    button.addEventListener("keydown", seen);
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it("lets Tab through to the page", () => {
    const seen = vi.fn();
    button.addEventListener("keydown", seen);
    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    button.dispatchEvent(e);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
  });

  it("swallows touchend as well as touchstart", () => {
    const seen = vi.fn();
    button.addEventListener("touchend", seen);
    fire("touchend");
    expect(seen).not.toHaveBeenCalled();
  });

  it("leaves Space and Enter keyup alone inside the widget, but not on the page", () => {
    const inner = document.querySelector("#host")!.appendChild(document.createElement("button"));
    for (const key of [" ", "Enter"]) {
      const own = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, composed: true });
      inner.dispatchEvent(own);
      expect(own.defaultPrevented).toBe(false);
      const pageEv = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, composed: true });
      button.dispatchEvent(pageEv);
      expect(pageEv.defaultPrevented).toBe(true);
    }
  });
});

