// Node runner for the relay. On Workers or other platforms, call createRelay() from your own entry point.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRelay, MAX_REQUEST_BYTES } from "./relay";

// Read ./.env when present (Node 20.12+), so `npx tell-cecil` works from a folder holding one. Real env vars win.
try {
  process.loadEnvFile?.();
} catch {}

const { CECIL_GITHUB_TOKEN, CECIL_GITHUB_REPO, CECIL_PROJECT_KEY = "dev", CECIL_LABELS, PORT = "8787" } = process.env;
const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const origins = list(process.env.CECIL_ORIGINS ?? "http://localhost:5173");

if (!CECIL_GITHUB_TOKEN || !CECIL_GITHUB_REPO) {
  console.error("Set CECIL_GITHUB_TOKEN and CECIL_GITHUB_REPO (owner/repo). See README.");
  process.exit(1);
}

const relay = createRelay({
  projects: {
    [CECIL_PROJECT_KEY]: {
      origins,
      github: {
        repo: CECIL_GITHUB_REPO,
        token: CECIL_GITHUB_TOKEN,
        labels: CECIL_LABELS ? list(CECIL_LABELS) : undefined,
      },
    },
  },
});

// Only behind a proxy you control that sets x-forwarded-for; otherwise clients could pick their own rate-limit bucket.
const trustProxy = process.env.CECIL_TRUST_PROXY === "1";

async function serve(incoming: IncomingMessage, outgoing: ServerResponse) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of incoming as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_REQUEST_BYTES) {
      outgoing.writeHead(413).end();
      return;
    }
    chunks.push(c);
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(incoming.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  if (!trustProxy) {
    headers.delete("cf-connecting-ip");
    headers.set("x-forwarded-for", incoming.socket.remoteAddress ?? "unknown");
  }
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const req = new Request(`http://localhost:${PORT}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });

  const res = await relay(req);
  outgoing.writeHead(res.status, Object.fromEntries(res.headers));
  outgoing.end(await res.text());
}

const server = createServer(async (incoming, outgoing) => {
  try {
    await serve(incoming, outgoing);
  } catch (err) {
    console.error("cecil-relay: request failed", err);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(Number(PORT), () => {
  console.log(`cecil relay on http://localhost:${PORT}  key="${CECIL_PROJECT_KEY}"  origins=${origins.join(",")}`);
});

// Containers stop with SIGTERM: finish in-flight requests, then exit; force it after 5 seconds.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    console.log(`cecil-relay: ${sig}, shutting down`);
    setTimeout(() => process.exit(1), 5000).unref();
    server.close(() => process.exit(0));
  });
}
