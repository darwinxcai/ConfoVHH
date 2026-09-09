import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyReviewerExports } from "../scripts/paper/verify-reviewer-exports.mjs";

const ROOT = new URL("../", import.meta.url);
const PACKAGE = new URL("paper/evidence/reviewer-browser-2026-09-08/", ROOT);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("preserved synthetic browser exports reproduce their source-bound comparison", async () => {
  const read = name => readFile(new URL(name, PACKAGE));
  const execution = JSON.parse(await read("execution.json"));
  const generatedReportBytes = {}, browserReportBytes = {};
  for (const name of ["near", "separated"]) {
    generatedReportBytes[name] = await read(`synthetic-${name}.audit.json`);
    browserReportBytes[name] = await read(`browser-${name}.json`);
  }
  const actual = await verifyReviewerExports({ receiptBytes: await read("receipt.json"), generatedReportBytes, browserReportBytes });
  // Runtime versions describe the execution environment; reports must retain
  // identical semantics when verification runs under another supported Node.
  assert.deepEqual({ ...actual, nodeVersion: execution.comparison.nodeVersion }, execution.comparison);
  assert.deepEqual(Object.keys(execution.sourceSha256).sort(), ["app/page.tsx", "qa/tests/reviewer-workflow.spec.mjs", "qa/playwright.config.mjs", "qa/package-lock.json", "scripts/paper/verify-reviewer-exports.mjs"].sort());
  for (const [relative, expected] of Object.entries(execution.sourceSha256)) {
    assert.equal(sha(await readFile(new URL(relative, ROOT))), expected, relative);
  }
  assert.deepEqual(execution.observedCases, ["near", "separated"].map((name, index) => ({
    name, roleConfirmationRequired: true, roleInitiallyUnchecked: true,
    newFileClearedPriorConfirmation: index === 1, displayedContactPairs: index === 0 ? 10 : 0,
  })));
  assert.deepEqual(execution.offOriginRequests, []);
  assert.deepEqual(execution.pageErrors, []);
  assert.equal(execution.independentResearcherCompletion, false);
  assert.equal(execution.biologicalValidation, false);
  assert.equal(execution.servedBuildIdentityVerified, false);
});
