import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { nodeTestArguments } from "../scripts/run-node-tests.mjs";

const launcher = path.resolve(import.meta.dirname, "../scripts/run-node-tests.mjs");

test("the runtime workaround preserves every requested test and only affects the observed Node release", () => {
  const files = ["tests/first.test.mjs", "tests/second.test.mjs"];
  const unchanged = ["--test", "--test-concurrency=1", "--", ...files];
  assert.deepEqual(nodeTestArguments("22.23.2", files), ["--no-turbo-inline-js-wasm-calls", ...unchanged]);
  for (const version of ["22.18.0", "22.23.1", "22.23.3", "24.19.0", "24.21.0"]) {
    assert.deepEqual(nodeTestArguments(version, files), unchanged);
  }
});

test("the launcher requires explicit tests, runs all files, and propagates assertion and process failures", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-node-test-launcher-"));
  try {
    const passing = path.join(temporary, "passing.test.mjs");
    const failing = path.join(temporary, "failing.test.mjs");
    const killed = path.join(temporary, "killed.test.mjs");
    await writeFile(passing, 'import test from "node:test"; test("sentinel-pass", () => {});\n');
    await writeFile(failing, 'import test from "node:test"; test("sentinel-fail", () => { throw new Error("intentional fixture failure"); });\n');
    await writeFile(killed, 'process.kill(process.pid, "SIGTERM");\n');
    // Exercise the same top-level CLI environment used by npm, rather than
    // inheriting the parent test runner's internal IPC reporter context.
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const run = (files) => spawnSync(process.execPath, [launcher, ...files], {
      encoding: "utf8", timeout: 30_000, env: environment,
    });

    const empty = run([]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /explicit test files/u);

    const pass = run([passing]);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /sentinel-pass/u);

    const fail = run([passing, failing]);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /sentinel-pass/u);
    assert.match(fail.stdout, /sentinel-fail/u);

    // The launcher accepts paths only. A filter-looking argument must not
    // turn an explicit failing test into a successful all-skipped run.
    const filtered = run(["--test-name-pattern=NO_MATCH", failing]);
    assert.notEqual(filtered.status, 0);

    const terminated = run([killed]);
    assert.equal(terminated.status, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
