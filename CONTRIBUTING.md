# Contributing

## Setup

```sh
npm ci
npm test            # vitest (jsdom, plus node for relay, github and ssr tests)
npm run typecheck
npm run build       # dist/cecil.js, dist/cecil.mjs, dist/relay.mjs, dist/server.mjs, dist/types
npm run dev         # demo page on http://localhost:5173; run `npm run relay` beside it
```

Before every commit, `npm test && npm run typecheck && npm run build` must pass.

## Rules

- **Bug fixes start with a failing test.** Write the regression test, watch it fail on the old code, then fix.
- **Bundle budget:** `dist/cecil.js` must stay at or under 9 KB gzipped (`gzip -c dist/cecil.js | wc -c`). If a change goes over, cut something or discuss it first.
- **No new runtime dependencies.**
- **Style:** match the surrounding code. 2-space indent, double quotes, semicolons, about 140 columns, terse names, few comments, no classes.
- **Docs:** a public API change updates the README (and the configuration reference) in the same commit, and adds a line to `CHANGELOG.md` under Unreleased.
- One focused commit per change, with a message that says why.

## Out of scope

Area selection is half-built and its button is disabled on purpose. Screenshots, theming, i18n and other trackers are not planned yet; open an issue before starting on them.
