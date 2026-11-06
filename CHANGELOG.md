# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- The widget has a new look: an ink Feedback pill with the Cecil pointer mark, a white panel with the mark in a yellow tile, a grey target row, an ink Send button and toast, and a yellow outline with an ink name tag while picking. On phones the panel is a bottom sheet. It uses Archivo and JetBrains Mono when the page has them and loads no fonts itself.

## [0.0.5] - 2026-11-03

### Fixed
- `init`: the token form (GitLab, Jira and the GitHub token fallback) was rejected with "Bad origin". The setup page's `no-referrer` policy made browsers send `Origin: null`.

### Changed
- `init`: the Jira form starts empty except for the fields passed as flags, and `--email` is gone: the person enters their email with the token. The email is required.

## [0.0.4] - 2026-11-03

Relay and CLI only: the widget is unchanged from 0.0.2.

### Added
- `npx tell-cecil init` connects GitHub, GitLab or Jira from a local setup page and writes `.env` (and adds it to `.gitignore`). It reads the repo from the git remote and guesses the dev server origin. On GitHub it creates a GitHub App for the repo with issues-only permissions; `--token` uses a fine-grained token instead. Tokens are pasted into the page, never into the terminal.
- `npx tell-cecil check` validates `.env` and asks the tracker, read-only, whether issues can be filed.
- GitHub App auth in the relay: `github: { repo, app: { id, key } }`, or `CECIL_GITHUB_APP_ID` and `CECIL_GITHUB_APP_KEY`. It mints installation tokens limited to the repo and to issues, cached until shortly before they expire. Uses WebCrypto only, so it runs on Workers too.
- `prompt.md`: setup instructions for coding agents, for the copy-paste prompt in the README.

### Changed
- The relay logs why a tracker call failed (`cecil-relay: GitHub: ...`), not only the 502.

## [0.0.3] - 2026-10-26

Relay only: the widget is unchanged from 0.0.2.

### Added
- GitLab and Jira Cloud as issue trackers, next to GitHub. A relay project takes exactly one of `github`, `gitlab` or `jira`; the Node runner and the Worker example read `CECIL_GITLAB_*` or `CECIL_JIRA_*` variables. GitLab works with self-hosted instances. Jira issues use Atlassian Document Format, so reporters can't inject markup or mentions.

### Changed
- Mention and reference neutralising moved from the relay's input parsing into each tracker, so the GitLab one also covers `@all`, merge requests, labels and milestones.
- The issue title is cut at the first line break of any kind, not only `\n`.

## [0.0.2] - 2026-10-25

### Changed
- New Feedback button icon: a speaking face, matching the project logo.

### Added
- Releases are published to npm from GitHub Actions with provenance.

## [0.0.1] - 2026-10-25

First npm release.

### Added
- Published as `tell-cecil`: the widget (`import { init } from "tell-cecil"`, or `dist/cecil.js` from a CDN), the relay (`tell-cecil/relay`), and the Node runner as `npx tell-cecil`, which also reads a `.env` file from the current folder.
- The relay caps the request body while streaming it (413 without needing content-length) and gives up on GitHub after 10 seconds (504).
- `exposeIssueUrl` project option, `clientIp` and `rateLimit.projectMax` relay options, `retry-after` on 429.
- Startup validation of relay configuration (origins, repo, token, projects).
- Relative endpoints, a 15 second request timeout and console hints for failures (for example 403).
- Ctrl/Cmd+Enter sends; focus returns to the button on close; the toast is no longer a live region.
- Richer element descriptions: implicit roles, wrapping labels, longer selectors until unique.
- Demo page, Dockerfile, Cloudflare Worker example, GitHub Actions CI, built relay (`dist/relay.mjs`, `dist/server.mjs`) and type declarations.
- Tests for the UI flows, picker, relay, GitHub formatting, SSR import and script-tag configuration.

### Security
- The page title is no longer sent. The relay still accepts a `title` from older widgets and ignores it.
- Privacy selectors are validated one by one, so a bad selector no longer disables exclusion or masking.
- Exclusion and masking apply across open shadow roots.
- `input`, `textarea`, `select` and `contenteditable` content is masked by default.
- The reported page URL has its query string and hash removed by default (`data-full-url` or `privacy.url` to change).
- The relay neutralises `@mentions` and issue references in the comment (other fields render as code), blockquotes the comment and escapes its raw HTML, validates the report URL origin, and uses server time for the timestamp.
- The relay rate limits by the proxy-added client IP, not a spoofable header, and adds a per-project cap. Memory use of the limiter is bounded.
- The Node runner ignores client-supplied `x-forwarded-for` and `cf-connecting-ip` unless `CECIL_TRUST_PROXY=1`.

### Changed
- The 403 console hint names the relay's origin allowlist instead of a runner-specific variable.
- The widget adopts a constructable stylesheet (with a `<style>` fallback), so a strict CSP keeps working.
- The toast and button share one corner container instead of per-corner offsets.
- `init` is safe in `<head>`, without a DOM, and when called twice.
- Types and GitHub formatting moved out of `index` and `relay`; `format.ts` is now `github.ts`, `dev-server.ts` is now `server.ts`.
- Requires Node 20 or later for the relay runner.

### Fixed
- Page handlers no longer react to presses while picking.
- The relay and Node runner stay up on malformed upstream replies.
- Report bodies are truncated only in the comment, never mid-metadata.
