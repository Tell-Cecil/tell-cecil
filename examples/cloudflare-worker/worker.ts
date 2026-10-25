import { createRelay } from "../../src/relay";

interface Env {
  CECIL_GITHUB_TOKEN: string;
  CECIL_GITHUB_REPO: string;
  CECIL_PROJECT_KEY: string;
  /** Comma-separated exact origins, e.g. "https://yoursite.com". */
  CECIL_ORIGINS: string;
  CECIL_LABELS?: string;
}

const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

// Built once per isolate so the in-memory rate limit survives between requests.
let relay: ReturnType<typeof createRelay> | undefined;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    relay ??= createRelay({
      projects: {
        [env.CECIL_PROJECT_KEY]: {
          origins: list(env.CECIL_ORIGINS),
          github: { repo: env.CECIL_GITHUB_REPO, token: env.CECIL_GITHUB_TOKEN, labels: env.CECIL_LABELS ? list(env.CECIL_LABELS) : undefined },
        },
      },
    });
    return relay(req);
  },
};
