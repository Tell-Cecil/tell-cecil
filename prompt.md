# Set up Tell Cecil

You are a coding agent adding Tell Cecil to the user's website. Tell Cecil is a feedback widget: visitors pick an element on the page, write a comment, and a small relay files it as an issue in GitHub, GitLab or Jira. Follow these steps in order. Work in the user's project folder only.

## Rules

- Never ask the user to paste a token, key or password into this chat, and never print, read aloud or copy one from `.env`. The setup page in their browser writes secrets straight to `.env`.
- Never commit `.env`. `init` adds it to `.gitignore`; leave that line in place.
- Don't install anything globally. `npx tell-cecil` needs Node 20 or newer.
- Ask before changing anything outside the steps below.

## 1. Find the project

Work in the folder with the site's `package.json` (or its `index.html` for a plain site). In a monorepo, ask the user which app gets the widget.

Check for an existing setup: if `.env` already has `CECIL_` variables, run `npx tell-cecil check`. If it says "ready", skip to step 3.

## 2. Connect the tracker

Run this in the project folder. It waits for the user in the browser, up to 15 minutes, so run it in the background or with a long timeout:

```sh
npx -y tell-cecil@latest init
```

It reads the GitHub or GitLab repo from the git remote `origin`. Pass options when that is wrong or missing:

- Another repo: `--tracker github --repo owner/repo` (or `--tracker gitlab --repo group/project`, plus `--url https://gitlab.example.com` when self-hosted).
- Jira Cloud: `--tracker jira --url https://acme.atlassian.net --project KEY --email user@example.com`. Ask the user for the site, project key and email; they are not secrets.
- The site's origin, when it isn't the framework's default dev server: `--origin http://localhost:3000`. Repeat for each origin, including production, e.g. `--origin https://example.com`.

`init` prints a link and tries to open it. Read the link from its output and tell the user right away, in one line, with the link itself: "Finish in your browser: <link>". Then wait for `init` to exit. On GitHub they click **Create GitHub App**, then **Install**; on GitLab and Jira they create a token on a pre-filled page and paste it into the setup page (not into this chat).

When it exits, read its output:

- `✓ Connected: …`: done. It also prints the script tag for step 3.
- `.env already has … Run again with --force`: tell the user which variables exist and ask before running again with `--force`.
- `couldn't tell where issues should go`: ask the user which tracker and repo, then pass `--tracker` and `--repo`.
- `timed out`: ask the user whether to start again. For GitHub, the output says how to finish installing the app.

## 3. Add the widget

Add the script tag `init` printed (or rebuild it: `data-endpoint` is the relay URL, `data-project-key` is `CECIL_PROJECT_KEY` from `.env`, which is public):

```html
<script src="https://cdn.jsdelivr.net/npm/tell-cecil@VERSION/dist/cecil.js"
  data-endpoint="http://localhost:8787"
  data-project-key="pk_site"></script>
```

Where it goes:

- Vite, plain HTML, Astro: before `</body>` in `index.html` or the base layout.
- Next.js App Router: in `app/layout.tsx`, `<Script src="…" data-endpoint="…" data-project-key="…" strategy="afterInteractive" />` from `next/script` inside `<body>`. Pages Router: the same in `pages/_document.tsx` or `_app.tsx`.
- SvelteKit: before `</body>` in `src/app.html`.
- Bundled apps that prefer npm: `npm i tell-cecil`, then call `init({ endpoint, projectKey })` from `tell-cecil` once on the client.
- Anything else: find the layout or template that wraps every page and add the tag before `</body>` there. If there are several or you're not sure, ask the user which one.

Put the endpoint and key in the project's own config if it has a pattern for public values (e.g. `VITE_` or `NEXT_PUBLIC_` variables), so production can point at the deployed relay.

## 4. Check it

```sh
npx tell-cecil check
```

It validates `.env` and asks the tracker, read-only, whether issues can be filed. Fix what it reports, or show the user its message.

## 5. Run it

Tell the user, briefly:

- Start the relay next to the dev server, in the same folder: `npx tell-cecil` (port 8787). Add it to the dev script if they like, e.g. with `concurrently`.
- Open the site, click **Feedback**, pick an element and send. The issue appears in the tracker.
- For production, deploy the relay where `.env`'s variables can be set as secrets (any Node host, the Dockerfile, or a Cloudflare Worker: https://github.com/Tell-Cecil/tell-cecil#quick-start), add the production origin to `CECIL_ORIGINS`, and point `data-endpoint` at it. The endpoint must be https unless it is localhost.
- If the repo is public, anyone can read the reports. `check` says so.

Then stop. Don't file a test issue unless the user asks.
