import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function nodeTestArguments(nodeVersion, testFiles) {
  // Node 22.23.2 can abort in V8's DoComputeBuiltinContinuation while the
  // unchanged IMGT WASM engine is exercised by the VHH pregraph replay.
  // Keep the current security release and every assertion; disable only
  // JS-to-WASM call inlining on this observed affected runtime. Future
  // Node releases and Node 24 retain their normal compiler settings.
  // Evidence: https://github.com/darwinxcai/ConfoVHH/actions/runs/34279616607/job/102240942802
  const runtimeFlags = nodeVersion === "22.23.2" ? ["--no-turbo-inline-js-wasm-calls"] : [];
  // Remaining arguments are paths, never options that could skip assertions.
  return [...runtimeFlags, "--test", "--test-concurrency=1", "--", ...testFiles];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Pass the explicit test files to run-node-tests.mjs.");
    process.exitCode = 1;
  } else {
    const args = nodeTestArguments(process.versions.node, files);
    if (args[0].startsWith("--no-turbo-")) {
      console.error(`Node ${process.versions.node}: replaying all requested tests with ${args[0]}.`);
    }
    const child = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (child.error) console.error(child.error.message);
    if (child.signal) console.error(`Node test process terminated by ${child.signal}.`);
    process.exitCode = child.status ?? 1;
  }
}
