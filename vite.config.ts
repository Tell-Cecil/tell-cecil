import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "Cecil",
      formats: ["iife", "es"],
      fileName: (format) => (format === "iife" ? "cecil.js" : "cecil.mjs"),
    },
    minify: true,
  },
  test: { environment: "jsdom" },
});
