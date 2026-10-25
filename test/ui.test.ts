import { afterEach, describe, expect, it, vi } from "vitest";
import * as element from "../src/element";
import { mount } from "../src/ui";

globalThis.CSS ??= { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) } as typeof CSS;

vi.mock("../src/element", async (orig) => {
  const real = await orig<typeof import("../src/element")>();
  return { ...real, describe: vi.fn(real.describe) };
});

let off: (() => void) | undefined;
afterEach(() => {
  off?.();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const open = (submit: Parameters<typeof mount>[0] = async () => ({})) => {
  let root!: ShadowRoot;
  off = mount(submit, undefined, { onRoot: (r) => (root = r) });
  return root;
};
const $ = (root: ShadowRoot, s: string) => root.querySelector(s) as HTMLElement;
const compose = (root: ShadowRoot) => {
  $(root, ".fab").click();
  $(root, '[data-mode="page"]').click();
  return $(root, "textarea") as HTMLTextAreaElement;
};

describe("styles", () => {
  it("adopts a constructable stylesheet when available", () => {
    const sheets: string[] = [];
    vi.stubGlobal("CSSStyleSheet", class { replaceSync(t: string) { sheets.push(t); } });
    const root = open();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toContain(".fab{");
    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(root.querySelector("style")).toBeNull();
  });

  it("falls back to a <style> element", () => {
    const root = open();
    expect(root.querySelector("style")?.textContent).toContain(".fab{");
  });
});

describe("behaviour", () => {
  it("returns focus to the button when closed from inside the widget", () => {
    const root = open();
    compose(root);
    expect(root.activeElement?.tagName).toBe("TEXTAREA");
    $(root, '.panel [data-act="close"]').click();
    expect(root.activeElement).toBe($(root, ".fab"));
  });

  it("announces a send once: the toast is not a live region", () => {
    const root = open();
    expect($(root, ".toast").hasAttribute("role")).toBe(false);
  });

  it("keeps the toast and the button in one corner container", () => {
    const root = open();
    const dock = $(root, ".dock");
    expect(dock.contains($(root, ".toast"))).toBe(true);
    expect(dock.contains($(root, ".fab"))).toBe(true);
  });

  it("sends on Ctrl+Enter or Cmd+Enter", async () => {
    const submit = vi.fn(async () => ({}));
    const root = open(submit);
    const text = compose(root);
    text.value = "broken";
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(submit).toHaveBeenCalledTimes(1);
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("recovers when describing the picked element throws", () => {
    const root = open();
    const btn = document.body.appendChild(document.createElement("button"));
    btn.textContent = "Pay";
    vi.mocked(element.describe).mockImplementationOnce(() => {
      throw new Error("This area is private and cannot be captured.");
    });
    $(root, ".fab").click();
    document.elementFromPoint = () => btn;
    btn.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect($(root, ".panel").hidden).toBe(false);
    expect($(root, ".status").textContent).toBe("This area is private and cannot be captured.");
    expect($(root, ".chip").textContent).toBe("Entire page");
    // Listeners are consistent: a fresh pick works.
    $(root, '[data-act="change"]').click();
    expect($(root, ".bar").hidden).toBe(false);
    btn.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect($(root, ".chip").textContent).toBe("Pay");
  });
});

describe("flows", () => {
  it("opens the picker from the button and closes it with Escape", () => {
    const root = open();
    expect($(root, ".bar").hidden).toBe(true);
    $(root, ".fab").click();
    expect($(root, ".bar").hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect($(root, ".bar").hidden).toBe(true);
  });

  it("opens the panel in page mode and closes composing with Escape", () => {
    const root = open();
    const text = compose(root);
    expect($(root, ".panel").hidden).toBe(false);
    expect($(root, ".chip").textContent).toBe("Entire page");
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    expect($(root, ".panel").hidden).toBe(true);
  });

  it("asks for feedback when the comment is empty", () => {
    const submit = vi.fn(async () => ({}));
    const root = open(submit);
    compose(root);
    $(root, '[data-act="send"]').click();
    expect(submit).not.toHaveBeenCalled();
    expect($(root, ".status").textContent).toBe("Please enter your feedback first.");
    expect($(root, ".status").classList.contains("err")).toBe(true);
  });

  it("shows the toast with a link after a successful send", async () => {
    const root = open(async () => ({ url: "https://github.com/a/b/issues/1" }));
    const text = compose(root);
    text.value = "broken";
    $(root, '[data-act="send"]').click();
    await vi.waitFor(() => expect($(root, ".toast").hidden).toBe(false));
    const link = $(root, ".toast a") as HTMLAnchorElement;
    expect(link.hidden).toBe(false);
    expect(link.href).toBe("https://github.com/a/b/issues/1");
    expect(text.value).toBe("");
  });

  it("does not send the page title", async () => {
    document.title = "Secret roadmap";
    const submit = vi.fn(async (_r: unknown) => ({}));
    const root = open(submit);
    const text = compose(root);
    text.value = "broken";
    $(root, '[data-act="send"]').click();
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect("title" in (submit.mock.calls[0]![0] as object)).toBe(false);
  });

  it("keeps the text when sending fails", async () => {
    const root = open(async () => {
      throw new Error("boom");
    });
    const text = compose(root);
    text.value = "broken";
    $(root, '[data-act="send"]').click();
    await vi.waitFor(() => expect($(root, ".status").textContent).toBe("Could not send. Please try again."));
    expect(text.value).toBe("broken");
    expect($(root, ".panel").hidden).toBe(false);
    expect(($(root, '[data-act="send"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows an error and re-enables sending when collecting the report throws", async () => {
    let root!: ShadowRoot;
    const submit = vi.fn(async () => ({}));
    off = mount(
      submit,
      {
        url: () => {
          throw new Error("bad rewrite");
        },
      },
      { onRoot: (r) => (root = r) },
    );
    const text = compose(root);
    text.value = "broken";
    $(root, '[data-act="send"]').click();
    await vi.waitFor(() => expect($(root, ".status").textContent).toBe("Could not send. Please try again."));
    expect(submit).not.toHaveBeenCalled();
    expect(($(root, '[data-act="send"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("moves focus to the issue link after a send, or to the button without one", async () => {
    for (const [reply, expected] of [[{ url: "https://github.com/a/b/issues/1" }, "A"], [{}, "BUTTON"]] as const) {
      const root = open(async () => reply);
      const text = compose(root);
      text.value = "broken";
      $(root, '[data-act="send"]').click();
      await vi.waitFor(() => expect($(root, ".toast").hidden).toBe(false));
      expect(root.activeElement?.tagName).toBe(expected);
      if (expected === "BUTTON") expect(root.activeElement).toBe($(root, ".fab"));
      off?.();
      document.body.innerHTML = "";
    }
  });

  it("closes on Escape from inside the widget without the page seeing it", () => {
    const root = open();
    const text = compose(root);
    const page = vi.fn();
    document.body.addEventListener("keydown", page);
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    expect(page).not.toHaveBeenCalled();
    expect($(root, ".panel").hidden).toBe(true);
  });

  it("leaves Escape on the page alone and keeps the panel open", () => {
    const root = open();
    compose(root);
    const page = vi.fn();
    document.body.addEventListener("keydown", page);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(page).toHaveBeenCalledTimes(1);
    expect($(root, ".panel").hidden).toBe(false);
  });
});

