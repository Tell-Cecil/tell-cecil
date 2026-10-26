import { projectFromEnv } from "../../src/env";
import { createRelay } from "../../src/relay";

// The same CECIL_* variables as the Node runner: CECIL_PROJECT_KEY, CECIL_ORIGINS (comma-separated exact origins),
// CECIL_LABELS, and the variables for one tracker (GitHub, GitLab or Jira; see the README). Put tokens in secrets.
type Env = Record<string, string | undefined>;

// Built once per isolate so the in-memory rate limit survives between requests.
let relay: ReturnType<typeof createRelay> | undefined;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    relay ??= createRelay({ projects: { [env.CECIL_PROJECT_KEY ?? "dev"]: projectFromEnv(env) } });
    return relay(req);
  },
};
