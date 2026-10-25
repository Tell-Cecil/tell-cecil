# Tell Cecil

[![npm](https://img.shields.io/npm/v/tell-cecil)](https://www.npmjs.com/package/tell-cecil)

Embeddable feedback widget. Visitors click a button, pick an element on the page, describe the problem, and Tell Cecil files it in your tracker with the selector, accessible name and page context. MIT licensed, no dependencies, about 8 KB gzipped.

> **Alpha.** Works with GitHub. Expect changes.

<!-- TODO: demo GIF -->

> **If your GitHub repo is public, every report is public.** Use a private repo unless you want comments and page paths visible to everyone. See [Privacy](#privacy).

## How it works

The widget collects the report in the browser and posts it to a small relay you run. The relay creates the GitHub issue with a server-side token, so reporters need no GitHub account and your token and labels never reach the page. The success reply includes the issue link, which shows the repo name to the reporter; set `exposeIssueUrl: false` on the project in `createRelay` to turn that off (the widget then shows no link).

## Quick start

**1. Run the relay.** Needs Node 20 or later and a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) with access to one repository and Issues: read and write.

```sh
export CECIL_GITHUB_TOKEN=github_pat_...   # fine-grained, issues: read/write on one repo
export CECIL_GITHUB_REPO=owner/repo
export CECIL_PROJECT_KEY=pk_abc
export CECIL_ORIGINS=https://yoursite.com  # comma-separated exact origins
npx tell-cecil                             # http://localhost:8787
```

The same variables can live in a `.env` file in the folder you run it from (Node 20.12+). Optional: `CECIL_LABELS`, `PORT`, `CECIL_TRUST_PROXY=1`. Defaults are project key `dev` and origin `http://localhost:5173`.

To run the relay inside your own app instead, `npm i tell-cecil` and call `createRelay` from `tell-cecil/relay`. It is a `(Request) => Response` function, so it also runs on Cloudflare Workers, Vercel, Deno or Bun. The source repo has a Cloudflare Worker example (`examples/cloudflare-worker`) and a `Dockerfile` for the Node runner (`docker build -t tell-cecil . && docker run --env-file .env -p 8787:8787 tell-cecil`).

From source: `npm install && npm run build` produces `dist/cecil.js` (script tag), `dist/cecil.mjs` (ES module), `dist/relay.mjs`, `dist/server.mjs` and type declarations in `dist/types`. `npm run relay` runs the relay from `src/` for development.

**Rate limiting and proxies.** The relay limits per project key and client IP (default 10 per minute), plus a per-project cap (`rateLimit.projectMax`, default 60 per minute), and answers 429 with a `retry-after` header. By default the Node runner ignores any client-supplied `x-forwarded-for` and `cf-connecting-ip` and uses the socket address. If you run it behind a reverse proxy you control, set `CECIL_TRUST_PROXY=1` to use the proxy's `x-forwarded-for` (the last entry is the one your proxy added). When calling `createRelay` yourself, pass `clientIp: (req) => string` to choose the client identity; the default prefers `cf-connecting-ip`, else the last `x-forwarded-for` entry, else `"unknown"`.

**Limits are weak by design.** The rate-limit store is in memory, per process. On Cloudflare Workers that means per isolate, which is weak: put Cloudflare rate-limiting rules or a WAF in front of the relay for real protection. The per-project cap also means a flood can lock legitimate reporters out for that window; that trade-off protects the GitHub token's quota.

**2. Add the widget.** Load it from a CDN (or copy `dist/cecil.js` to your site):

```html
<script src="https://cdn.jsdelivr.net/npm/tell-cecil@0.0.1/dist/cecil.js"
  data-endpoint="https://relay.example.com"
  data-project-key="pk_abc"></script>
```

From a bundler, `import { init } from "tell-cecil"` and call `init({ endpoint, projectKey })`. The endpoint may be relative (`/cecil`) when the relay sits behind your own domain; it must be https unless it is localhost.

If reports fail, the browser console says why. A 403 means the project key is wrong or the page's origin isn't in the relay's `CECIL_ORIGINS`. The relay refuses to start on a malformed origin (trailing slash or path), a repo that isn't `owner/repo`, an empty token or no projects.

**Who reported it.** Add `data-user="jane@corp.example"`, or in code `init({ ..., user: () => currentUser.email })`. The issue shows it as `Reporter: ... (self-reported)`. The browser supplies this value, so it is not verified. Anyone who can reach the relay can claim any name, so keep the relay behind your VPN or SSO proxy.

The relay checks the project key and the exact `Origin` against an allowlist, rate limits, validates the report, then calls the GitHub API. The project key is public, not a secret. Origin checks stop other websites in browsers, not scripts, so your real protection is the rate limit and a scoped token (issues: write on one repo).

## Configuration reference

**Widget `init(config)`** (from `dist/cecil.mjs`) and the matching `<script>` data attributes (`dist/cecil.js`):

| `init` option | Data attribute | Description |
| --- | --- | --- |
| `endpoint` (required) | `data-endpoint` | Relay URL. Relative is allowed; must be https unless localhost, 127.0.0.1 or [::1]. |
| `projectKey` (required) | `data-project-key` | Public key the relay maps to a repo and origin allowlist. |
| `user` | `data-user` | Self-reported reporter, a string or a function called on each send. Unverified. |
| `privacy.exclude` | `data-exclude` | Selectors that can't be picked (comma-separated in the attribute). |
| `privacy.mask` | `data-mask` | Selectors whose text and name are left out. |
| `privacy.url` | `data-full-url` (presence) | Rewrites the page URL before sending. Default: origin and path only. The attribute sends the full URL. |

`init` returns a function that removes the widget. Calling it twice returns the existing one.

**Node runner (`dist/server.mjs`) environment variables:**

| Variable | Default | Description |
| --- | --- | --- |
| `CECIL_GITHUB_TOKEN` (required) | | Fine-grained token, issues read/write on one repo. |
| `CECIL_GITHUB_REPO` (required) | | `owner/repo`. |
| `CECIL_PROJECT_KEY` | `dev` | Public project key. |
| `CECIL_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins allowed to submit. |
| `CECIL_LABELS` | none | Comma-separated labels added to each issue. |
| `CECIL_TRUST_PROXY` | off | `1` uses the proxy's `x-forwarded-for` for rate limiting. |
| `PORT` | `8787` | Listen port. |

**`createRelay(options)`:**

| Option | Default | Description |
| --- | --- | --- |
| `projects` (required) | | Map of project key to `{ origins, github: { repo, token, labels? }, exposeIssueUrl? }`. `exposeIssueUrl` defaults to true. |
| `rateLimit` | `{ max: 10, windowMs: 60000, projectMax: 60 }` | `max` per project key and client IP, `projectMax` per project key, per window. In memory, per instance. |
| `clientIp` | `cf-connecting-ip`, else last `x-forwarded-for`, else `"unknown"` | Chooses the client identity for rate limiting. |
| `fetch` | global `fetch` | Used for the GitHub call; injectable for tests. |
| `now` | `Date.now` | Clock, injectable for tests. |

## What the reporter sees

Click **Feedback**, then choose **Element** (hover and click, or Tab and Enter) or **Page**, write a comment, and send. Esc exits. The button can be dragged to any corner. Area selection is planned.

## Privacy

**If your repo is public, every report is public.** Use a private repo unless you want reporters' comments and page paths visible to everyone.

Tell Cecil never reads input values, editable content or page HTML. It sends the selector, role, accessible name, a short text excerpt, a few attributes, up to four ancestors, and the element's position.

- `data-cecil-private` on an element: it and its children can't be picked.
- `data-cecil-mask` on an element: it can be picked, but its text and name are left out.
- All `input`, `textarea`, `select` and `contenteditable` content is masked by default: the element is reported, but never its value, text or selected option. Form controls keep their label (`aria-label`, `label`, or `placeholder`) as the name; `contenteditable` and `data-cecil-mask` content gets no name. A container is marked redacted only if it holds `data-cecil-private`, your own `exclude` matches, `data-cecil-mask`/your `mask` matches or `contenteditable` content; form fields, scripts and hidden inputs don't count.
- The page URL is sent without its query string and hash. To send the full URL, use `data-full-url` on the script tag, or `privacy: { url: (href) => ... }` in `init` to rewrite it yourself.
- Add your own selectors: `data-exclude=".admin, #billing"` and `data-mask=".account-number"` (comma-separated), or `privacy: { exclude: [...], mask: [...] }` in `init`.

## Content Security Policy

The widget adds its styles as a constructable stylesheet (falling back to a `<style>` element in older browsers), so it works under a strict `style-src`. Your `connect-src` must include the relay's origin, and `script-src` must allow wherever you host `cecil.js`.

## Develop

```sh
npm install
npm test
npm run build      # dist/cecil.js, dist/cecil.mjs, dist/relay.mjs, dist/server.mjs, dist/types
npm run dev        # demo page (index.html) on http://localhost:5173; run `npm run relay` beside it
```

## Limits

- GitHub only; no screenshots; the rate limit is in memory per instance.
- Not yet: area selection, screenshots, other trackers.

## License

MIT
