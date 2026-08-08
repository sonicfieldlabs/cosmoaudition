import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist",
    ssr: "src/server.ts",
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
        format: "es"
      }
    }
  },
  ssr: {
    noExternal: true
  }
});
