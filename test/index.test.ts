import { afterEach, describe, expect, it, vi } from "vitest";

const load = async () => {
  vi.resetModules();
  return import("../src/index");
};
const hosts = () => document.querySelectorAll("[data-cecil]").length;

afterEach(() => {
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });
  document.body ?? document.documentElement.append(document.createElement("body"));
  document.body.innerHTML = "";
});

/** The widget's shadow root is closed, so capture it as it is created. */
const attach = Element.prototype.attachShadow;
function captureRoot(): () => ShadowRoot {
  const roots: ShadowRoot[] = [];
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
    const r = attach.call(this, init);
    roots.push(r);
    return r;
  });
  return () => roots[roots.length - 1]!;
}

async function sendOnce(endpoint: string) {
  const root = captureRoot();
  const { init } = await load();
  const off = init({ endpoint, projectKey: "k" });
  const $ = (s: string) => root().querySelector(s) as HTMLElement;
  $(".fab").click();
  $('[data-mode="page"]').click();
  ($("textarea") as HTMLTextAreaElement).value = "broken";
  $('[data-act="send"]').click();
  await vi.waitFor(() => expect(!$(".toast").hidden || !/^(Sending…)?$/.test($(".status").textContent!)).toBe(true));
  const status = $(".status").textContent;
  off();
  return status;
}

describe("relay errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves a relative endpoint against the page and still requires https elsewhere", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendOnce("/cecil");
    expect((fetchMock.mock.calls[0] as unknown as [URL])[0].href).toBe(`${location.origin}/cecil`);
    const { init } = await load();
    expect(() => init({ endpoint: "http://example.com/cecil", projectKey: "k" })).toThrow(/https/);
    vi.unstubAllGlobals();
  });

  it("asks the reporter to wait on 429, and hints at the fix on 403", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    expect(await sendOnce("http://localhost:8787")).toBe("Too many reports. Please try again in a minute.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    expect(await sendOnce("http://localhost:8787")).toBe("Could not send. Please try again.");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("403 (check the projectKey and the relay's origin allowlist)"));
    vi.unstubAllGlobals();
  });

  it("gives up after 15 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: unknown, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))));
    const root = captureRoot();
    const { init } = await load();
    const off = init({ endpoint: "http://localhost:8787", projectKey: "k" });
    const $ = (s: string) => root().querySelector(s) as HTMLElement;
    $(".fab").click();
    $('[data-mode="page"]').click();
    ($("textarea") as HTMLTextAreaElement).value = "broken";
    $('[data-act="send"]').click();
    await vi.advanceTimersByTimeAsync(15_000);
    expect($(".status").textContent).toBe("Could not send. Please try again.");
    off();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("init", () => {
  it("mounts once and returns the existing unmount on a second call", async () => {
    const { init } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const off = init({ endpoint: "http://localhost:1", projectKey: "k" });
    expect(init({ endpoint: "http://localhost:1", projectKey: "k" })).toBe(off);
    expect(hosts()).toBe(1);
    expect(warn).toHaveBeenCalled();
    off();
    expect(hosts()).toBe(0);
    init({ endpoint: "http://localhost:1", projectKey: "k" })();
    warn.mockRestore();
  });

  it("waits for <body> when loaded from <head>", async () => {
    const s = document.createElement("script");
    s.dataset.endpoint = "http://localhost:1";
    s.dataset.projectKey = "k";
    Object.defineProperty(document, "currentScript", { value: s, configurable: true });
    document.body.remove();
    await expect(load()).resolves.toBeDefined();
    expect(hosts()).toBe(0);
    document.documentElement.append(document.createElement("body"));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(hosts()).toBe(1);
  });
});

describe("script tag config", () => {
  const withScript = async (data: Record<string, string>) => {
    const s = document.createElement("script");
    Object.assign(s.dataset, data);
    Object.defineProperty(document, "currentScript", { value: s, configurable: true });
    await load();
  };

  it("mounts from data-endpoint and data-project-key", async () => {
    await withScript({ endpoint: "http://localhost:1", projectKey: "k", exclude: " .a , .b,", mask: ".m", fullUrl: "" });
    expect(hosts()).toBe(1);
  });

  it("rejects a non-https, non-local endpoint", async () => {
    await expect(withScript({ endpoint: "http://example.com", projectKey: "k" })).rejects.toThrow(/https/);
    expect(hosts()).toBe(0);
  });

  it("warns and stays unmounted when the project key is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withScript({ endpoint: "http://localhost:1" });
    expect(hosts()).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("data-project-key"));
    warn.mockRestore();
  });
});

