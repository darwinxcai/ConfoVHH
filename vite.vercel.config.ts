import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { immunumWorkerWasmPlugin } from "./build/immunum-worker-wasm-plugin.ts";

/**
 * Static single-page build for Vercel.
 *
 * ConfoVHH runs entirely in the browser: every analysis executes in a Web
 * Worker and no route needs a server at request time. This config is therefore
 * a plain Vite build to static assets — no framework adapter, no server
 * runtime, no RSC pipeline. Response headers and the legacy host redirect are
 * declared in vercel.json instead of a worker entry point.
 *
 * The Cloudflare Worker path (vite.config.ts) is unchanged and still owns
 * `npm run build`.
 */

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: projectRoot,
  base: "/",
  publicDir: path.join(projectRoot, "public"),
  resolve: {
    alias: [
      // Mirrors the "@/*" -> "./*" mapping in tsconfig.json.
      { find: /^@\//, replacement: projectRoot },
    ],
  },
  optimizeDeps: {
    // immunum is transformed by immunumWorkerWasmPlugin; pre-bundling it would
    // hide the Node-only loader from that transform.
    exclude: ["immunum"],
  },
  worker: {
    format: "es",
    // Worker bundles have their own plugin pipeline. Without this transform,
    // immunum's Node-only fs loader survives production bundling and the
    // background audit fails at startup in the browser.
    plugins: () => [immunumWorkerWasmPlugin(true)],
    rollupOptions: {
      output: {
        entryFileNames: "assets/workers/[name]-[hash].js",
        chunkFileNames: "assets/workers/[name]-[hash].js",
      },
    },
  },
  plugins: [immunumWorkerWasmPlugin(), react()],
  build: {
    outDir: path.join(projectRoot, "dist", "static"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
