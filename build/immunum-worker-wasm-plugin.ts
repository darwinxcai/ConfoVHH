import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Used by the static Vercel build (vite.vercel.config.ts).
 *
 * vite.config.ts, which drives the Cloudflare Worker build, deliberately keeps
 * its own inline copy of this transform. tests/ui-components.test.mjs asserts
 * that file's literal source text, so the two cannot be merged without changing
 * a frozen test. Any fix here should be mirrored there by hand until that
 * pinning is lifted.
 *
 * immunum ships wasm-bindgen glue that boots its WebAssembly module through a
 * Node-only `fs` read. That loader cannot run in a browser Web Worker, so the
 * production bundle inlines the module bytes instead.
 *
 * The transform is deliberately structural rather than literal: wasm-bindgen
 * regenerates this glue on every immunum release, and cosmetic churn (quote
 * style, identifier names, `node:fs` specifiers, whitespace) must not break the
 * build. Each guard matches the *shape* of the statement it rewrites and fails
 * with a message naming the file, the installed version, the pinned version,
 * and the concrete next step.
 */

/** The only immunum release this transform is validated against. */
export const PINNED_IMMUNUM_VERSION = "1.3.0";

/**
 * SHA-256 of the immunum_bg.wasm shipped by PINNED_IMMUNUM_VERSION.
 *
 * A version string is not enough to pin the executed engine. immunum 1.2.0 and
 * 1.3.0 ship a byte-identical immunum.js and differ only in this module, so
 * every guard below would pass on the wrong WebAssembly binary. IMGT numbering
 * is part of the scientific record, so the bytes that actually run are pinned
 * by digest.
 */
export const PINNED_IMMUNUM_WASM_SHA256 =
  "68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b";

const WASM_FILENAME = "immunum_bg.wasm";
const UPGRADE_GUIDANCE =
  `Re-validate build/immunum-worker-wasm-plugin.ts against the new generated glue, ` +
  `then update PINNED_IMMUNUM_VERSION and the "immunum" pin in package.json together.`;

/**
 * `const <path> = <expr mentioning __dirname and immunum_bg.wasm>;`
 * `const <bytes> = require("fs").readFileSync(<path>);`
 *
 * Tolerates template literals or concatenation, single or double quotes, and
 * the `node:fs` specifier.
 */
const NODE_WASM_LOADER = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*__dirname[^;\n]*` +
    String.raw`immunum_bg\.wasm[^;\n]*;[\s]*` +
    String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])(?:node:)?fs\3\s*\)\s*` +
    String.raw`\.\s*readFileSync\(\s*\1\s*\)\s*;`,
);

/**
 * `const <module> = new WebAssembly.Module(<bytes>);`
 * `let <wasm> = new WebAssembly.Instance(<module>, <imports>()).exports;`
 * `<wasm>.__wbindgen_start();`
 */
const WASM_BOOTSTRAP = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+WebAssembly\.Module\(\s*[A-Za-z_$][\w$]*\s*\)\s*;[\s]*` +
    String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+WebAssembly\.Instance\(\s*\1\s*,\s*` +
    String.raw`[A-Za-z_$][\w$]*\(\s*\)\s*\)\s*\.\s*exports\s*;[\s]*` +
    String.raw`\2\s*\.\s*__wbindgen_start\(\s*\)\s*;`,
);

/** `exports.Annotator = <local>;` or `module.exports.Annotator = <local>;` */
const COMMONJS_ANNOTATOR_EXPORT = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:module\s*\.\s*)?exports\s*\.\s*Annotator\s*=\s*([A-Za-z_$][\w$]*)\s*;`,
);

type GuardId =
  | "node-wasm-loader"
  | "wasm-bootstrap"
  | "commonjs-annotator-export"
  | "residual-commonjs-export"
  | "adjacent-bootstrap";

/** A complete headline sentence per guard, not a fragment. */
const GUARD_HEADLINES: Record<GuardId, string> = {
  "node-wasm-loader":
    "Could not find the Node-only `fs.readFileSync` loader that reads immunum_bg.wasm from disk.",
  "wasm-bootstrap":
    "Could not find the `new WebAssembly.Module` / `new WebAssembly.Instance` / `__wbindgen_start()` boot sequence.",
  "commonjs-annotator-export":
    "Could not find the CommonJS `exports.Annotator` assignment.",
  "residual-commonjs-export":
    "The rewritten module still contains an unconverted CommonJS `exports.` assignment, which would throw at runtime in an ES module.",
  "adjacent-bootstrap":
    "The wasm loader is no longer immediately followed by the boot sequence, so replacing them as one span would drop unrelated code.",
};

function guardFailure(guard: GuardId, entry: string, installedVersion: string): Error {
  return new Error(
    [
      `[immunum-worker-wasm] ${GUARD_HEADLINES[guard]}`,
      `  context:   immunum's generated wasm-bindgen glue no longer has the expected shape.`,
      `  file:      ${entry}`,
      `  installed: immunum ${installedVersion}`,
      `  pinned:    immunum ${PINNED_IMMUNUM_VERSION}`,
      installedVersion === PINNED_IMMUNUM_VERSION
        ? `  cause:     The pinned release resolved to unexpected glue. Verify node_modules/immunum is not patched or partially installed, then reinstall with \`npm ci\`.`
        : `  cause:     The installed version differs from the pinned version, so the generated glue changed.`,
      `  fix:       ${UPGRADE_GUIDANCE}`,
      `  guard:     ${guard}`,
    ].join("\n"),
  );
}

type ResolvedImmunum = {
  entry: string;
  installedVersion: string;
  wasmBase64: string;
};

/** Any CommonJS export the named-ESM rewrite did not convert. */
const RESIDUAL_COMMONJS_EXPORT = /(?:^|\n)[ \t]*(?:module\s*\.\s*)?exports\s*[.[]/;

function resolveImmunum(): ResolvedImmunum {
  const require = createRequire(import.meta.url);

  let entry: string;
  try {
    entry = require.resolve("immunum");
  } catch {
    throw new Error(
      `[immunum-worker-wasm] Cannot resolve the "immunum" package. ` +
        `Install dependencies with \`npm ci\` before building.`,
    );
  }

  const packageDirectory = path.dirname(entry);

  let installedVersion: string;
  try {
    installedVersion = JSON.parse(
      readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
    ).version;
  } catch {
    throw new Error(
      `[immunum-worker-wasm] Cannot read the installed immunum package manifest at ` +
        `${path.join(packageDirectory, "package.json")}. Reinstall with \`npm ci\`.`,
    );
  }

  if (installedVersion !== PINNED_IMMUNUM_VERSION) {
    throw new Error(
      [
        `[immunum-worker-wasm] immunum must be pinned to exactly ${PINNED_IMMUNUM_VERSION}.`,
        `  installed: immunum ${installedVersion}`,
        `  pinned:    immunum ${PINNED_IMMUNUM_VERSION}`,
        `  why:       IMGT numbering output is part of the scientific record, so the`,
        `             executed immunum bytes are pinned exactly, never by range.`,
        `  fix:       ${UPGRADE_GUIDANCE}`,
      ].join("\n"),
    );
  }

  const wasmPath = path.join(packageDirectory, WASM_FILENAME);
  let wasmBytes: Buffer;
  try {
    wasmBytes = readFileSync(wasmPath);
  } catch {
    throw new Error(
      `[immunum-worker-wasm] Cannot read ${wasmPath}. The installed immunum package ` +
        `is incomplete; reinstall with \`npm ci\`.`,
    );
  }

  const wasmSha256 = createHash("sha256").update(wasmBytes).digest("hex");
  if (wasmSha256 !== PINNED_IMMUNUM_WASM_SHA256) {
    throw new Error(
      [
        `[immunum-worker-wasm] The installed immunum WebAssembly module does not match the pinned digest.`,
        `  file:     ${wasmPath}`,
        `  expected: sha256 ${PINNED_IMMUNUM_WASM_SHA256}`,
        `  actual:   sha256 ${wasmSha256}`,
        `  why:      immunum ${PINNED_IMMUNUM_VERSION} reports the expected version here, but the`,
        `            engine bytes differ. The generated glue is identical across some immunum`,
        `            releases, so the version string alone cannot detect this.`,
        `  fix:      Reinstall with \`npm ci\`. If the new bytes are intended, re-run the IMGT`,
        `            numbering validation and update PINNED_IMMUNUM_WASM_SHA256 with the result.`,
      ].join("\n"),
    );
  }

  return { entry, installedVersion, wasmBase64: Buffer.from(wasmBytes).toString("base64") };
}

/**
 * @param forceWorkerRuntime Force the browser WASM runtime regardless of the
 * build environment. Set for the dedicated `worker.plugins` pipeline, whose
 * environment flags are not visible to the main pipeline's plugin instance.
 */
export function immunumWorkerWasmPlugin(forceWorkerRuntime = false): Plugin {
  let immunum: ResolvedImmunum | null = null;

  return {
    name: "immunum-worker-wasm",
    enforce: "pre",
    transform(code: string, id: string) {
      immunum ??= resolveImmunum();
      const { entry, installedVersion, wasmBase64 } = immunum;

      if (path.normalize(id.split("?")[0]) !== path.normalize(entry)) return null;

      const loader = NODE_WASM_LOADER.exec(code);
      if (!loader) throw guardFailure("node-wasm-loader", entry, installedVersion);

      const bootstrap = WASM_BOOTSTRAP.exec(code);
      if (!bootstrap) throw guardFailure("wasm-bootstrap", entry, installedVersion);

      const exported = COMMONJS_ANNOTATOR_EXPORT.exec(code);
      if (!exported) {
        throw guardFailure("commonjs-annotator-export", entry, installedVersion);
      }

      const loaderStart = loader.index;
      const loaderEnd = loader.index + loader[0].length;
      const bootstrapStart = bootstrap.index;
      const bootstrapEnd = bootstrap.index + bootstrap[0].length;

      // The disabled-runtime branch replaces the loader and the boot sequence as
      // one span, so they must actually be adjacent. If immunum ever separates
      // them, a span replacement would silently drop unrelated code.
      if (
        bootstrapStart < loaderEnd ||
        code.slice(loaderEnd, bootstrapStart).trim() !== ""
      ) {
        throw guardFailure("adjacent-bootstrap", entry, installedVersion);
      }

      // Vite serves excluded dependencies as native ESM during development.
      // Convert immunum's lone CommonJS assignment so both the local preview and
      // the production worker expose the same named import.
      const withNamedExport =
        code.slice(0, exported.index) +
        exported[0].replace(
          /(?:module\s*\.\s*)?exports\s*\.\s*Annotator\s*=\s*[A-Za-z_$][\w$]*\s*;/,
          `export { ${exported[1]} as Annotator };`,
        ) +
        code.slice(exported.index + exported[0].length);

      // A future release could export more than one symbol. Converting only the
      // first would leave a bare `exports.` reference that throws at runtime in
      // an ES module, so fail the build instead.
      if (RESIDUAL_COMMONJS_EXPORT.test(withNamedExport)) {
        throw guardFailure("residual-commonjs-export", entry, installedVersion);
      }

      // Indices below refer to the original source; the named-export rewrite is
      // upstream of the loader in every generated layout seen so far, so recheck
      // rather than assume.
      const offset = withNamedExport.length - code.length;
      const shift = exported.index < loaderStart ? offset : 0;

      const isWorkerEnvironment =
        forceWorkerRuntime || Boolean(this.environment?.config?.isWorker);

      if (!isWorkerEnvironment) {
        // Outside the audit worker the WASM module is never booted. Replace the
        // whole bootstrap with a proxy that explains itself if anything reaches
        // for it.
        const disabledRuntime = [
          `let ${bootstrap[2]} = new Proxy(Object.create(null), {`,
          `  get() { throw new Error('IMGT numbering is available only inside the ConfoVHH audit worker.'); },`,
          `});`,
        ].join("\n");
        return (
          withNamedExport.slice(0, loaderStart + shift) +
          disabledRuntime +
          withNamedExport.slice(bootstrapEnd + shift)
        );
      }

      const inlinedBytes =
        `const ${loader[2]} = Uint8Array.from(atob(${JSON.stringify(wasmBase64)}), ` +
        `(character) => character.charCodeAt(0));`;

      return (
        withNamedExport.slice(0, loaderStart + shift) +
        inlinedBytes +
        withNamedExport.slice(loaderEnd + shift)
      );
    },
  };
}
