// The `tell-cecil` command: runs the relay, or `init` / `check`.
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "init") {
  const { init } = await import("./init");
  process.exitCode = await init(args);
} else if (cmd === "check") {
  const { check } = await import("./check");
  process.exitCode = await check();
} else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`Usage:
  npx tell-cecil          Run the relay with the CECIL_* variables from the environment or .env
  npx tell-cecil init     Connect GitHub, GitLab or Jira in your browser and write .env (--help for options)
  npx tell-cecil check    Check .env and the connection without filing anything`);
} else if (cmd) {
  console.error(`tell-cecil: unknown command "${cmd}". Try: npx tell-cecil help`);
  process.exitCode = 1;
} else {
  await import("./server");
}
export {};
