// @vitest-environment node
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { projectFromEnv } from "../src/env";
import { appJwt, appTokens, pkcs8 } from "../src/github-app";
import { createRelay } from "../src/relay";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const ORIGIN = "https://example.com";
const report = { comment: "Broken", url: "https://example.com/", userAgent: "UA", viewport: { width: 1, height: 1 } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Fake GitHub: installation lookup, token minting and issue creation. */
function github(opts: { installed?: boolean; expires?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/repos/acme/site/installation")) return opts.installed === false ? json({ message: "Not Found" }, 404) : json({ id: 77 });
    if (url.endsWith("/app/installations/77/access_tokens")) return json({ token: `ghs_${calls.length}`, expires_at: opts.expires ?? "2100-01-01T00:00:00Z" }, 201);
    if (url.endsWith("/repos/acme/site/issues")) return json({ html_url: "https://github.com/acme/site/issues/1", number: 1 }, 201);
    return json({}, 500);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("GitHub App key", () => {
  it("accepts PKCS#1 and PKCS#8 PEMs, raw or base64, and gives the same PKCS#8 bytes", () => {
    const want = privateKey.export({ type: "pkcs8", format: "der" });
    for (const k of [PKCS1, PKCS8, Buffer.from(PKCS1).toString("base64"), Buffer.from(PKCS8).toString("base64")]) {
      expect(Buffer.from(pkcs8(k)).equals(want)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const k of ["", "nope", "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"]) expect(() => pkcs8(k)).toThrow(/private key PEM/);
  });

  it("signs an RS256 JWT GitHub accepts: issuer, a minute of clock slack, under ten minutes", async () => {
    const key = await crypto.subtle.importKey("pkcs8", pkcs8(PKCS1), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const jwt = await appJwt("123", key, 1_000_000_000_000);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iat: 999_999_940, exp: 1_000_000_480, iss: "123" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("GitHub App tokens", () => {
  it("finds the installation once and asks for a token limited to the repo and issues", async () => {
    const gh = github();
    const t = appTokens({ id: "123", key: PKCS8 }, "acme/site");
    expect(await t.token(gh.fetch, 1000)).toBe("ghs_2");
    const mint = gh.calls[1]!;
    expect(JSON.parse(mint.init.body as string)).toEqual({ repositories: ["site"], permissions: { issues: "write" } });
    expect((mint.init.headers as Record<string, string>).authorization).toMatch(/^Bearer ey/);
  });

  it("caches until five minutes before expiry and shares one request between concurrent callers", async () => {
    let now = Date.parse("2030-01-01T00:00:00Z");
    const gh = github({ expires: "2030-01-01T01:00:00Z" });
    const t = appTokens({ id: "123", key: PKCS8 }, "acme/site", () => now);
    const [a, b] = await Promise.all([t.token(gh.fetch, 1000), t.token(gh.fetch, 1000)]);
    expect(a).toBe(b);
    now += 54 * 60_000;
    expect(await t.token(gh.fetch, 1000)).toBe(a);
    expect(gh.calls).toHaveLength(2);
    now += 2 * 60_000;
    expect(await t.token(gh.fetch, 1000)).not.toBe(a);
    expect(gh.calls).toHaveLength(3);
  });

  it("says when the app isn't installed on the repo", async () => {
    const t = appTokens({ id: "123", key: PKCS8 }, "acme/site");
    await expect(t.token(github({ installed: false }).fetch, 1000)).rejects.toThrow("GitHub App is not installed on acme/site");
  });
});

describe("GitHub App in the relay", () => {
  it("files the issue with an installation token", async () => {
    const gh = github();
    const relay = createRelay({ projects: { pk: { origins: [ORIGIN], github: { repo: "acme/site", app: { id: "123", key: PKCS1 } } } }, fetch: gh.fetch });
    const res = await relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk", report }) }));
    expect(res.status).toBe(201);
    const issue = gh.calls.at(-1)!;
    expect(issue.url).toBe("https://api.github.com/repos/acme/site/issues");
    expect((issue.init.headers as Record<string, string>).authorization).toBe("Bearer ghs_2");
  });

  it("returns 502 and logs why when the app can't get a token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const relay = createRelay({ projects: { pk: { origins: [ORIGIN], github: { repo: "acme/site", app: { id: "123", key: PKCS1 } } } }, fetch: github({ installed: false }).fetch });
    const res = await relay(new Request("http://relay/", { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ projectKey: "pk", report }) }));
    expect(res.status).toBe(502);
    expect(log).toHaveBeenCalledWith("cecil-relay: GitHub: GitHub App is not installed on acme/site");
    log.mockRestore();
  });

  it("validates the config at startup", () => {
    const mk = (github: object) => () => createRelay({ projects: { pk: { origins: [ORIGIN], github: { repo: "acme/site", ...github } } } });
    expect(mk({ app: { id: "123", key: "x" } })).toThrow(/private key PEM/);
    expect(mk({ app: { id: "", key: PKCS1 } })).toThrow(/App ID/);
    expect(mk({ token: "T", app: { id: "1", key: PKCS1 } })).toThrow(/not both/);
  });

  it("reads CECIL_GITHUB_APP_ID and CECIL_GITHUB_APP_KEY", () => {
    const key = Buffer.from(PKCS8).toString("base64");
    expect(projectFromEnv({ CECIL_GITHUB_REPO: "acme/site", CECIL_GITHUB_APP_ID: "123", CECIL_GITHUB_APP_KEY: key }).github).toEqual({
      repo: "acme/site",
      token: undefined,
      app: { id: "123", key },
      labels: undefined,
    });
    const both = projectFromEnv({ CECIL_GITHUB_REPO: "acme/site", CECIL_GITHUB_TOKEN: "T", CECIL_GITHUB_APP_ID: "1", CECIL_GITHUB_APP_KEY: key });
    expect(() => createRelay({ projects: { pk: both } })).toThrow(/not both/);
  });
});
