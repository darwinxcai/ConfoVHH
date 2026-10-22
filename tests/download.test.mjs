import assert from "node:assert/strict";
import test from "node:test";

import { safeDownloadFilename } from "../lib/download.ts";

test("download filenames remove traversal syntax, controls, format marks, and dot-only names", () => {
  const observed = safeDownloadFilename("../../\u202E\u200B=payload\u0000.pdb_audit.json");
  assert.doesNotMatch(observed, /[\\/:*?"<>|]/u);
  assert.doesNotMatch(observed, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  assert.ok(observed.endsWith(".json"));
  assert.equal(safeDownloadFilename("...", "fallback.json"), "fallback.json");
});

test("download filenames are deterministically bounded while preserving a short extension", () => {
  const observed = safeDownloadFilename(`${"a".repeat(300)}.json`);
  assert.equal(Array.from(observed).length, 160);
  assert.ok(observed.endsWith(".json"));
  assert.equal(observed, safeDownloadFilename(`${"a".repeat(300)}.json`));
});
