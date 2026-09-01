import vinext from "vinext";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TransformPluginContext } from "rolldown";
import { defineConfig } from "vite";

const rootRequire = createRequire(import.meta.url);
const vercelRequire = createRequire(path.join(process.cwd(), "hosting/vercel/package.json"));
const immunumEntry = rootRequire.resolve("immunum");
const tailwindCssEntry = rootRequire.resolve("tailwindcss/index.css");
const nitroViteEntry = vercelRequire.resolve("nitro/vite");
const immunumWasmBase64 = Buffer.from(
  readFileSync(path.join(path.dirname(immunumEntry), "immunum_bg.wasm")),
).toString("base64");

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

const watcherIgnores = [
  "**/.bench-venv/**",
  "**/.bench-cache/**",
  "**/.sites-runtime/**",
  "**/.next/**",
  "**/dist/**",
];

export default defineConfig(async () => {
  const { nitro } = await import(pathToFileURL(nitroViteEntry).href);

  return {
    resolve: {
      alias: [
        {
          find: /^tailwindcss$/,
          replacement: tailwindCssEntry,
        },
      ],
    },
    optimizeDeps: {
      exclude: ["immunum"],
    },
    worker: {
      plugins: () => [immunumWorkerWasmPlugin(true)],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      watch: { ignored: watcherIgnores },
    },
    plugins: [immunumWorkerWasmPlugin(), vinext(), nitro()],
  };
});
