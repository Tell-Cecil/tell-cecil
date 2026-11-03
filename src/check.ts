// `npx tell-cecil check`: is .env complete, and can the tracker be reached with it? Files nothing.
import { projectFromEnv } from "./env";
import { probe } from "./probe";
import { createRelay } from "./relay";

export async function check(): Promise<number> {
  try {
    process.loadEnvFile?.();
  } catch {}
  const project = projectFromEnv(process.env);
  const key = process.env.CECIL_PROJECT_KEY ?? "dev";
  try {
    createRelay({ projects: { [key]: project } });
  } catch (err) {
    console.log(`tell-cecil: not ready: ${(err as Error).message.replace(/^cecil: project "[^"]*": /, "")}. Run: npx tell-cecil init`);
    return 1;
  }
  try {
    const where = await probe(project);
    console.log(`tell-cecil: ready. Project key "${key}", origins ${project.origins.join(", ")}, files issues in ${where}.`);
    return 0;
  } catch (err) {
    console.log(`tell-cecil: not ready: ${(err as Error).message}`);
    return 1;
  }
}
