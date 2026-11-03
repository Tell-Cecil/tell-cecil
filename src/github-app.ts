// GitHub App auth with WebCrypto only, so it runs on Node 20+, Workers, Deno and Bun.

export interface GitHubApp {
  /** App ID (or client ID), shown on the app's settings page. */
  id: string;
  /** The app's private key: the PEM GitHub gives you (PKCS#1 or PKCS#8), or that PEM base64-encoded on one line. */
  key: string;
}

const API = "https://api.github.com";
export const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "cecil-relay" };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const utf8 = (s: string) => new TextEncoder().encode(s);

/** DER bytes of the key, as PKCS#8. Throws if it isn't an RSA private key PEM. */
export function pkcs8(key: string): Uint8Array<ArrayBuffer> {
  let pem = key.trim();
  if (!pem.startsWith("-----BEGIN")) {
    try {
      pem = atob(pem.replace(/\s+/g, "")).trim();
    } catch {
      // Reported below.
    }
  }
  const m = /^-----BEGIN (RSA )?PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END \1?PRIVATE KEY-----$/.exec(pem);
  if (!m) throw new Error("GitHub App key must be the app's private key PEM, or that PEM base64-encoded");
  const der = Uint8Array.from(atob(m[2]!.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return m[1] ? wrapPkcs1(der) : der;
}

// WebCrypto imports only PKCS#8, and GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"). PKCS#8 is the PKCS#1 key in an
// OCTET STRING after a version and the rsaEncryption algorithm identifier.
function wrapPkcs1(der: Uint8Array): Uint8Array<ArrayBuffer> {
  const len = (n: number) => (n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255]);
  const algo = [0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...len(der.length)];
  const body = algo.length + octet.length + der.length;
  return Uint8Array.from([0x30, ...len(body), ...algo, ...octet, ...der]);
}

/** A signed app JWT, valid for 9 minutes from a minute ago (GitHub allows 10, and clocks drift). */
export async function appJwt(id: string, key: CryptoKey, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000) - 60;
  const head = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(utf8(JSON.stringify({ iat, exp: iat + 540, iss: id })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Installation tokens for one repo, limited to issues:write, cached until five minutes before they expire.
 * Validates the key's shape now; the key is imported and the installation found on first use.
 */
export function appTokens({ id, key }: GitHubApp, repo: string, now: () => number = Date.now) {
  if (!/^\w+$/.test(id)) throw new Error(`GitHub App ID "${id}" must be the app's numeric ID or client ID`);
  const der = pkcs8(key);
  let cryptoKey: Promise<CryptoKey> | undefined;
  let installation: number | undefined;
  let cached: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;

  async function mint(doFetch: typeof fetch, timeoutMs: number): Promise<string> {
    cryptoKey ??= crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]).catch((err) => {
      cryptoKey = undefined;
      throw new Error(`GitHub App key could not be read: ${(err as Error).message}`);
    });
    const jwt = await appJwt(id, await cryptoKey, now());
    const call = (path: string, init: RequestInit = {}) =>
      doFetch(`${API}${path}`, { ...init, headers: { ...HEADERS, authorization: `Bearer ${jwt}`, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
    if (installation === undefined) {
      const res = await call(`/repos/${repo}/installation`);
      if (res.status === 404) throw new Error(`GitHub App is not installed on ${repo}`);
      if (res.status !== 200) throw new Error(`GitHub App could not find its installation (${res.status}): ${(await res.text()).slice(0, 300)}`);
      installation = ((await res.json()) as { id: number }).id;
    }
    const res = await call(`/app/installations/${installation}/access_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositories: [repo.split("/")[1]], permissions: { issues: "write" } }),
    });
    if (res.status !== 201) {
      // Uninstalled, or the repo was removed from the installation: look it up again next time.
      installation = undefined;
      throw new Error(`GitHub App could not get a token for ${repo} (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const { token, expires_at } = (await res.json()) as { token: string; expires_at: string };
    cached = { token, until: Date.parse(expires_at) - 5 * 60_000 };
    return token;
  }

  return {
    /** A token for the repo. Concurrent callers share one request. */
    token(doFetch: typeof fetch, timeoutMs: number): Promise<string> {
      if (cached && now() < cached.until) return Promise.resolve(cached.token);
      pending ??= mint(doFetch, timeoutMs).finally(() => (pending = undefined));
      return pending;
    },
    /** Forget the cached token, e.g. after GitHub rejects it. */
    reset() {
      cached = undefined;
    },
  };
}
