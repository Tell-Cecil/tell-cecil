// @vitest-environment node
import { expect, it } from "vitest";

it("can be imported without a DOM", async () => {
  const mod = await import("../src/index");
  expect(typeof mod.init).toBe("function");
});
