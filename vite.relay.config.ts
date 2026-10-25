import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// Server build: dist/relay.mjs (createRelay) and dist/server.mjs (the Node runner). Run after the widget build, which clears dist.
export default defineConfig({
  build: {
    target: "node20",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: { relay: "src/relay.ts", server: "src/server.ts" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.mjs`,
    },
    rollupOptions: {
      external: [...builtinModules, /^node:/],
      // server.mjs is the package's `tell-cecil` bin, so npx can run it directly.
      output: { banner: (chunk) => (chunk.name === "server" ? "#!/usr/bin/env node" : "") },
    },
  },
});
