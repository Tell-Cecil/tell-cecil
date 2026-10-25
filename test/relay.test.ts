// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRelay } from "../src/relay";

const report = {
  comment: "Button broken, cc @octocat",
  url: "https://example.com/pricing",
  userAgent: "TestUA",
  viewport: { width: 1280, height: 720 },
  timestamp: "2026-10-21T00:00:00.000Z",
};

const ORIGIN = "https://example.com";

const created = () => new Response(JSON.stringify({ html_url: "https://github.com/acme/site/issues/7", number: 7 }), { status: 201 });

function setup(upstream: () => Response | Error = created, max = 2) {
  const fakeFetch = vi.fn(async () => {
    const r = upstream();
    if (r instanceof Error) throw r;
    return r;
  });
  const relay = createRelay({
    projects: { pk_1: { origins: [ORIGIN], github: { repo: "acme/site", token: "SECRET", labels: ["feedback"] } } },
    fetch: fakeFetch as unknown as typeof fetch,
    rateLimit: { max, windowMs: 60_000 },
    now: () => 0,
  });
  const post = (body: unknown, origin: string | null = ORIGIN) =>
    relay(
      new Request("http://relay/", {
        method: "POST",
        headers: origin ? { origin } : {},
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { relay, post, fakeFetch };
}

describe("createRelay config", () => {
  const project = (o: Partial<{ origins: string[]; repo: string; token: string }> = {}) => ({
    pk: { origins: o.origins ?? [ORIGIN], github: { repo: o.repo ?? "acme/site", token: o.token ?? "T" } },
  });
  it("accepts a valid config", () => {
    expect(() => createRelay({ projects: project() })).not.toThrow();
  });
  it("rejects origins that aren't exactly an origin", () => {
    for (const o of ["https://example.com/", "https://example.com/app", "example.com", "HTTPS://Example.com"]) {
      expect(() => createRelay({ projects: project({ origins: [o] }) })).toThrow(/origin/);
    }
  });
  it("rejects a bad repo, an empty token and no projects", () => {
    for (const repo of ["acme", "acme/site/extra", "https://github.com/acme/site", "acme/ site"]) {
      expect(() => createRelay({ projects: project({ repo }) })).toThrow(/owner\/repo/);
    }
    expect(() => createRelay({ projects: project({ token: "" }) })).toThrow(/token/);
    expect(() => createRelay({ projects: {} })).toThrow(/no projects/);
  });
});

describe("relay", () => {
  it("creates a GitHub issue using server-side repo, token and labels", async () => {
    const { post, fakeFetch } = setup();
    const res = await post({ projectKey: "pk_1", report });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: "https://github.com/acme/site/issues/7", number: 7 });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/site/issues");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET");
    const sent = JSON.parse(init.body as string);
    expect(sent.labels).toEqual(["feedback"]);
    expect(sent.body).toContain("**Page:** `https://example.com/pricing`");
    expect(sent.body).not.toContain("@octocat");
  });

  it("includes element details and rejects a malformed element", async () => {
    const { post, fakeFetch } = setup();
    const element = {
      selector: "#buy",
      tag: "button",
      role: "button",
      name: "Buy @octocat",
      locators: ["#buy", "role=button"],
      rect: { x: 1.4, y: 2, width: 3, height: 4 },
      redacted: true,
    };
    expect((await post({ projectKey: "pk_1", report: { ...report, element } })).status).toBe(201);
    const [, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string).body as string;
    expect(body).toContain('`button "Buy @octocat"`');
    expect(body).toContain("hidden for privacy");
    expect((await post({ projectKey: "pk_1", report: { ...report, element: { selector: "x" } } })).status).toBe(400);
  });

  it("includes a self-reported user", async () => {
    const { post, fakeFetch } = setup();
    expect((await post({ projectKey: "pk_1", report: { ...report, user: "jane@corp.example @octocat" } })).status).toBe(201);
    const [, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string).body as string;
    expect(body).toContain("**Reporter:** `jane@corp.example @octocat`");
    expect(body).toContain("self-reported");
  });

  it("keeps untrusted metadata from forging lines or mentions", async () => {
    const { post, fakeFetch } = setup(created, 100);
    const sent = async (extra: object) => {
      fakeFetch.mockClear();
      const res = await post({ projectKey: "pk_1", report: { ...report, ...extra } });
      const [, init] = (fakeFetch.mock.calls[0] ?? [, { body: "{}" }]) as unknown as [string, RequestInit];
      return { res, body: (JSON.parse(init.body as string).body ?? "") as string };
    };
    expect((await sent({ url: "https://example.com/a\n**Reporter:** `ceo`" })).res.status).toBe(400);
    expect((await sent({ url: "https://evil.test/" })).res.status).toBe(400);
    expect((await sent({ url: "javascript:alert(1)" })).res.status).toBe(400);
    const ua = await sent({ userAgent: "@octocat\n**Reporter:** x" });
    expect(ua.body).toContain("`@octocat **Reporter:** x`");
    expect(ua.body).not.toMatch(/^\*\*Reporter:\*\*/m);
    const stamped = await sent({ timestamp: "2020-01-01\n@admins" });
    expect(stamped.body).toContain("**Reported:** 1970-01-01T00:00:00.000Z");
    expect(stamped.body).not.toContain("@admins");
    expect((await sent({ comment: "cc @octocat" })).body).not.toContain("@octocat");
    const ref = await sent({ comment: "see acme/other#5 and GH-9" });
    expect(ref.body).not.toContain("acme/other#5");
    expect(ref.body).not.toContain("GH-9");
  });

  it("rejects unknown keys, wrong origins and missing origins identically", async () => {
    const { post, fakeFetch } = setup();
    for (const res of [
      await post({ projectKey: "nope", report }),
      await post({ projectKey: "pk_1", report }, "https://evil.test"),
      await post({ projectKey: "pk_1", report }, null),
      await post({ projectKey: "__proto__", report }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    const { post } = setup();
    expect((await post("not json")).status).toBe(400);
    expect((await post({ projectKey: "pk_1", report: { comment: "" } })).status).toBe(400);
    expect((await post({ projectKey: "pk_1", report: { ...report, viewport: "big" } })).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const { post, fakeFetch } = setup();
    expect((await post("x".repeat(40_000))).status).toBe(413);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked body that has no content-length", async () => {
    const { relay, fakeFetch } = setup();
    const chunk = new TextEncoder().encode("x".repeat(10_000));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (++sent > 100) return c.close();
        c.enqueue(chunk);
      },
    });
    const res = await relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body, duplex: "half" } as RequestInit));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(10);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("ignores a client-sent selector and counts bytes, not characters", async () => {
    const { post, fakeFetch } = setup();
    expect((await post({ projectKey: "pk_1", report: { ...report, selector: "evil > selector" } })).status).toBe(201);
    const [, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).body).not.toContain("evil");
    expect((await post("é".repeat(20_000))).status).toBe(413);
  });

  it("rate limits per project key and client", async () => {
    const { post } = setup();
    expect((await post({ projectKey: "pk_1", report })).status).toBe(201);
    expect((await post({ projectKey: "pk_1", report })).status).toBe(201);
    expect((await post({ projectKey: "pk_1", report })).status).toBe(429);
  });

  it("rate limits by the proxy-added x-forwarded-for entry, not client-supplied ones", async () => {
    const { relay } = setup();
    const send = (xff: string) =>
      relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": xff }, body: JSON.stringify({ projectKey: "pk_1", report }) }));
    expect((await send("1.1.1.1, 9.9.9.9")).status).toBe(201);
    expect((await send("2.2.2.2, 9.9.9.9")).status).toBe(201);
    expect((await send("3.3.3.3, 9.9.9.9")).status).toBe(429);
    expect((await send("3.3.3.3, 8.8.8.8")).status).toBe(201);
  });

  it("uses a custom clientIp hook", async () => {
    const relay = createRelay({
      projects: { pk_1: { origins: [ORIGIN], github: { repo: "acme/site", token: "T" } } },
      fetch: (async () => created()) as unknown as typeof fetch,
      rateLimit: { max: 1, windowMs: 60_000 },
      now: () => 0,
      clientIp: (req) => req.headers.get("x-real-ip") ?? "unknown",
    });
    const send = (ip: string) =>
      relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN, "x-real-ip": ip }, body: JSON.stringify({ projectKey: "pk_1", report }) }));
    expect((await send("a")).status).toBe(201);
    expect((await send("b")).status).toBe(201);
    expect((await send("a")).status).toBe(429);
  });

  it("caps a project across client IPs and says when to retry", async () => {
    let t = 0;
    const relay = createRelay({
      projects: { pk_1: { origins: [ORIGIN], github: { repo: "acme/site", token: "T" } } },
      fetch: (async () => created()) as unknown as typeof fetch,
      rateLimit: { max: 5, windowMs: 60_000, projectMax: 3 },
      now: () => t,
      clientIp: (req) => req.headers.get("x-real-ip")!,
    });
    const send = (ip: string) =>
      relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN, "x-real-ip": ip }, body: JSON.stringify({ projectKey: "pk_1", report }) }));
    expect((await send("a")).status).toBe(201);
    t = 10_000;
    expect((await send("b")).status).toBe(201);
    expect((await send("c")).status).toBe(201);
    const limited = await send("d");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("50");
    t = 60_000;
    expect((await send("d")).status).toBe(201);
  });

  it("prunes expired rate-limit buckets", async () => {
    const hits = new Map<string, number[]>();
    for (let i = 0; i < 10_001; i++) hits.set(`ip|pk_1|${i}`, [0]);
    const relay = createRelay({
      projects: { pk_1: { origins: [ORIGIN], github: { repo: "acme/site", token: "T" } } },
      fetch: (async () => created()) as unknown as typeof fetch,
      rateLimit: { max: 5, windowMs: 60_000 },
      now: () => 120_000,
      hits,
    });
    await relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk_1", report }) }));
    expect(hits.size).toBe(2);
  });

  it("hides upstream failures from the browser", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const upstream of [() => new Response("Bad credentials SECRET", { status: 401 }), () => new Error("network SECRET")]) {
      const { post } = setup(upstream);
      const res = await post({ projectKey: "pk_1", report });
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain("SECRET");
    }
    spy.mockRestore();
  });

  it("still answers 201 when GitHub's success reply is unreadable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { post } = setup(() => new Response("{", { status: 201 }));
    const res = await post({ projectKey: "pk_1", report });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({});
    spy.mockRestore();
  });

  it("returns 500 instead of rejecting on unexpected errors, and logs upstream bodies", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const relay = createRelay({
      projects: { pk_1: { origins: [ORIGIN], github: { repo: "acme/site", token: "T" } } },
      fetch: (async () => new Response("x".repeat(900), { status: 422 })) as unknown as typeof fetch,
      clientIp: () => {
        throw new Error("boom");
      },
    });
    const post = () => relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk_1", report }) }));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    spy.mockClear();
    const { post: post2 } = setup(() => new Response("x".repeat(900), { status: 422 }));
    expect((await post2({ projectKey: "pk_1", report })).status).toBe(502);
    expect(String(spy.mock.calls[0]![0])).toBe(`cecil-relay: GitHub responded 422: ${"x".repeat(500)}`);
    spy.mockRestore();
  });

  it("can withhold the issue URL from the page", async () => {
    const relay = createRelay({
      projects: { pk_1: { origins: [ORIGIN], exposeIssueUrl: false, github: { repo: "acme/site", token: "T" } } },
      fetch: (async () => created()) as unknown as typeof fetch,
    });
    const res = await relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk_1", report }) }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({});
  });

  it("answers CORS preflight only for allowed origins", async () => {
    const { relay } = setup();
    const ok = await relay(new Request("http://relay/", { method: "OPTIONS", headers: { origin: ORIGIN } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await relay(new Request("http://relay/", { method: "OPTIONS", headers: { origin: "https://evil.test" } }));
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("relay report title", () => {
  it("accepts a report without a title", async () => {
    const { post } = setup();
    expect((await post({ projectKey: "pk_1", report })).status).toBe(201);
  });

  it("ignores a title sent by an older widget", async () => {
    const { post, fakeFetch } = setup();
    const res = await post({ projectKey: "pk_1", report: { ...report, title: "UniqueTitleXYZ" } });
    expect(res.status).toBe(201);
    const init = (fakeFetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).not.toContain("UniqueTitleXYZ");
  });
});

describe("relay mention handling", () => {
  it("keeps code-span fields byte-identical and neutralises only the comment", async () => {
    const { post, fakeFetch } = setup();
    const element = {
      selector: "a[href='/u/@jane']",
      tag: "a",
      name: "owner/repo#1",
      locators: ["a[href='/u/@jane']", 'role=link name="@jane GH-2"'],
      attributes: { "data-x": "@user owner/repo#1" },
      rect: { x: 0, y: 0, width: 1, height: 1 },
    };
    const res = await post({
      projectKey: "pk_1",
      report: { ...report, comment: "cc @octocat owner/repo#1", url: "https://example.com/u/@jane?r=owner/repo#1", element, user: "@jane", userAgent: "UA @jane" },
    });
    expect(res.status).toBe(201);
    const [, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string).body as string;
    expect(body).toContain("`https://example.com/u/@jane?r=owner/repo#1`");
    expect(body).toContain("`a[href='/u/@jane']`");
    expect(body).toContain('`role=link name="@jane GH-2"`');
    expect(body).toContain("`data-x=@user owner/repo#1`");
    expect(body).toContain("`@jane`");
    expect(body).toContain("`UA @jane`");
    expect(body).toContain("cc @\u200boctocat owner/repo#\u200b1");
  });
});

describe("relay upstream and pruning", () => {
  const mk = (extra: object, f: () => Response | Promise<Response> = created) =>
    createRelay({
      projects: { pk_1: { origins: [ORIGIN], github: { repo: "acme/site", token: "T" } } },
      fetch: ((_u: unknown, init: RequestInit) => {
        const r = f();
        return init.signal && r instanceof Promise ? Promise.race([r, new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))]) : r;
      }) as unknown as typeof fetch,
      ...extra,
    });
  const send = (relay: ReturnType<typeof createRelay>) =>
    relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk_1", report }) }));

  it("answers 504 when GitHub never responds", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(mk({ upstreamTimeoutMs: 20 }, () => new Promise<Response>(() => {})));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "upstream_timeout" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("did not respond"));
    spy.mockRestore();
  });

  it("scans for expired buckets at most once per window", async () => {
    let t = 70_000;
    const hits = new Map<string, number[]>();
    const relay = mk({ rateLimit: { max: 5, windowMs: 60_000 }, now: () => t, hits });
    hits.set("stale", [0]);
    await send(relay);
    expect(hits.has("stale")).toBe(false);
    hits.set("stale", [0]);
    t = 70_001;
    await send(relay);
    expect(hits.has("stale")).toBe(true);
    t = 131_000;
    await send(relay);
    expect(hits.has("stale")).toBe(false);
  });
});

