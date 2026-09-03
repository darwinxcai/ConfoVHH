import vinext from "vinext";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { TransformPluginContext } from "rolldown";
import { defineConfig } from "vite";
import hostingConfig from "./build/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const require = createRequire(import.meta.url);
const immunumEntry = require.resolve("immunum");
const immunumWasmBase64 = Buffer.from(readFileSync(
  path.join(path.dirname(immunumEntry), "immunum_bg.wasm"),
)).toString("base64");

function immunumWorkerWasmPlugin(forceWorkerRuntime = false) {
  return {
    name: "immunum-worker-wasm",
    enforce: "pre" as const,
    transform(this: TransformPluginContext, code: string, id: string) {
      if (path.normalize(id.split("?")[0]) !== path.normalize(immunumEntry)) return null;
      const nodeLoader = [
        "const wasmPath = `${__dirname}/immunum_bg.wasm`;",
        "const wasmBytes = require('fs').readFileSync(wasmPath);",
      ].join("\n");
      if (!code.includes(nodeLoader)) {
        throw new Error("The installed immunum loader no longer matches the worker-safe transform.");
      }
      const wasmRuntime = [
        "const wasmModule = new WebAssembly.Module(wasmBytes);",
        "let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;",
        "wasm.__wbindgen_start();",
      ].join("\n");
      if (!code.includes(wasmRuntime)) {
        throw new Error("The installed immunum runtime no longer matches the worker-safe transform.");
      }
      const commonJsExport = "exports.Annotator = Annotator;";
      if (!code.includes(commonJsExport)) {
        throw new Error("The installed immunum export no longer matches the worker-safe transform.");
      }
      // Vite serves excluded dependencies as native ESM during development.
      // Convert immunum's lone CommonJS assignment so both the agent preview
      // and production worker expose the same named import.
      const transformedCode = code.replace(commonJsExport, "export { Annotator };");
      if (!forceWorkerRuntime && !this.environment.config.isWorker) {
        const unavailableRuntime = [
          "let wasm = new Proxy(Object.create(null), {",
          "  get() { throw new Error('IMGT numbering is available only inside the ConfoVHH audit worker.'); },",
          "});",
        ].join("\n");
        return transformedCode.replace(`${nodeLoader}\n${wasmRuntime}`, unavailableRuntime);
      }
      return transformedCode.replace(
        nodeLoader,
        `const wasmBytes = Uint8Array.from(atob("${immunumWasmBase64}"), (character) => character.charCodeAt(0));`,
      );
    },
  };
}

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const watcherIgnores = [
  "**/.bench-venv/**",
  "**/.bench-cache/**",
  "**/.sites-runtime/**",
  "**/.next/**",
  "**/dist/**",
];

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    optimizeDeps: {
      exclude: ["immunum"],
    },
    worker: {
      // Worker bundles have their own plugin pipeline. Without this transform,
      // immunum's Node-only fs loader survives production bundling and the
      // background audit fails at startup in the browser.
      plugins: () => [immunumWorkerWasmPlugin(true)],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? {
            watch: {
              useFsEvents: false,
              usePolling: true,
              ignored: watcherIgnores,
            },
          }
        : { watch: { ignored: watcherIgnores } }),
    },
    plugins: [
      immunumWorkerWasmPlugin(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
