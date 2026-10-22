import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reconstructPublicationDiscovery } from "../scripts/hard-decoy-v3/capture-publication-discovery.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/publication-first-discovery-2026-09-04");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function mutatedSnapshot(mutate, check) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-publication-discovery-"));
  try {
    await cp(SNAPSHOT, temporary, { recursive: true });
    const manifestPath = path.join(temporary, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const record = manifest.requests[0];
    const rawPath = path.join(temporary, record.rawFile);
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    mutate({ manifest, record, raw });
    const bytes = Buffer.from(`${JSON.stringify(raw)}\n`);
    await writeFile(rawPath, bytes);
    record.sha256 = sha256(bytes);
    record.bytes = bytes.length;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    // Rebind every ordinary hash so rejection must come from request semantics.
    const checksumPath = path.join(temporary, "checksums.sha256");
    const checksumRows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
    const corrected = [];
    for (const line of checksumRows) {
      const name = line.slice(66);
      corrected.push(`${sha256(await readFile(path.join(temporary, name)))}  ${name}`);
    }
    await writeFile(checksumPath, `${corrected.join("\n")}\n`);
    await check(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("publication discovery reproduces its dated bibliography without claiming source review or census completeness", async () => {
  const built = await reconstructPublicationDiscovery(SNAPSHOT);
  assert.equal(built.summary.querySummaries.length, 5);
  assert.ok(built.summary.querySummaries.every((row) => row.retrievedAllReportedResults));
  assert.equal(built.summary.selectedSourceQueryPaginationComplete, true);
  assert.equal(built.summary.primarySourceAccessionExtractionComplete, false);
  assert.equal(built.summary.broaderDiscoveryComplete, false);
  assert.equal(built.summary.targetFreezePermitted, false);
  assert.equal(built.summary.nativeCoordinatesInspected, false);
  assert.equal(built.summary.labelsAccessed, false);
  for (const [name, expected] of Object.entries(built.files)) assert.equal(await readFile(path.join(SNAPSHOT, name), "utf8"), expected, name);
  const publications = built.files["publications.jsonl"].trimEnd().split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(publications.length, built.summary.uniquePublicationCount);
  assert.equal(new Set(publications.map((row) => row.sourceId)).size, publications.length);
  assert.ok(publications.every((row) => row.entryAccessionExtractionStatus === "PENDING_PRIMARY_SOURCE_REVIEW" && row.formalDisposition === "PENDING_REQUIRED_METADATA"));
});

test("a rehashed response from the wrong phrase is rejected despite matching result totals", async () => {
  await mutatedSnapshot(({ raw }) => { raw.request.queryString = '"UNRELATED QUERY"'; }, async (directory) => {
    await assert.rejects(reconstructPublicationDiscovery(directory), /query|phrase|request/iu);
  });
});

test("page, HTTP and result-format bindings survive ordinary hash rebinding", async (t) => {
  const cases = [
    ["cursor", ({ raw }) => { raw.request.cursorMark = "not-the-requested-cursor"; }],
    ["page size", ({ raw }) => { raw.request.pageSize = 1; }],
    ["result type", ({ raw }) => { raw.request.resultType = "core"; }],
    ["method", ({ record }) => { record.method = "POST"; }],
    ["status", ({ record }) => { record.status = 503; }],
  ];
  for (const [label, mutate] of cases) await t.test(label, async () => {
    await mutatedSnapshot(mutate, async (directory) => {
      await assert.rejects(reconstructPublicationDiscovery(directory));
    });
  });
});
