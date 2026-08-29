import assert from "node:assert/strict";
import { link, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalJson } from "../scripts/hard-decoy/oracle/canonical-json.mjs";
import { verifyFrozenOracleRequest } from "../scripts/hard-decoy-v3/verify-oracle-request.mjs";
import {
  buildV3RequestFixture,
  canonicalV3Jsonl,
  makeV3RequestSource,
  rebindV3OracleRequest,
  V3_REQUEST_TRUST,
  v3FixtureSha256,
  writeV3RequestChecksumManifest,
} from "./fixtures/hard-decoy-v3-request-fixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TRUST = V3_REQUEST_TRUST;
const h = v3FixtureSha256;
const jsonl = canonicalV3Jsonl;
const source = makeV3RequestSource;
const rebindOracle = rebindV3OracleRequest;
const writeChecksumManifest = writeV3RequestChecksumManifest;

async function withFixture(options, callback) {
  const fixture = await buildV3RequestFixture(options);
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
}

test("accepts a canonical frozen request with ten disjoint candidate components and exact whole-batch pairs", async () => {
  await withFixture({}, async ({ directory, root }) => {
    const result = await verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT });
    assert.deepEqual({ ...result, requestSummary: undefined }, {
      state: "ORACLE_REQUEST_FROZEN",
      requestId: "REQUEST-0123456789ABCDEF",
      requestSequence: 1,
      checksumManifestSha256: root,
      candidateTargets: 10,
      candidateComponents: 10,
      developmentTargets: 2,
      pairCount: 65,
      benchmarkExecutionAuthorized: false,
      requestSummary: undefined,
    });
    assert.equal(result.requestSummary.requestSha256, root);
    assert.equal(result.requestSummary.targetManifest.length, 12);
    assert.equal(result.requestSummary.pairManifest.length, 65);
    assert.equal(result.requestSummary.requestId, "REQUEST-0123456789ABCDEF");
    assert.equal(result.requestSummary.protocolSha256, TRUST.v3);
    assert.equal(result.requestSummary.authorizationReceiptSha256, h("authorization-receipt"));
    assert.equal(result.requestSummary.transparencyChallengeSha256, h("transparency-challenge"));
    assert.deepEqual(result.requestSummary.targetManifest[0], { targetId: "CAND-001", role: "candidate" });
    assert.deepEqual(result.requestSummary.pairManifest[0], { pairId: "CAND-001--CAND-002", leftId: "CAND-001", rightId: "CAND-002" });
    assert.equal(Object.isFrozen(result.requestSummary), true);
    assert.equal(Object.isFrozen(result.requestSummary.targetManifest), true);
    assert.equal(Object.isFrozen(result.requestSummary.pairManifest[0]), true);
  });
});

test("requires the out-of-band checksum root and rejects a fully self-rehashed mutation", async () => {
  await withFixture({}, async ({ directory, root }) => {
    await assert.rejects(() => verifyFrozenOracleRequest(directory, { repositoryRoot: ROOT }), /Expected external checksum/);
    const keyPath = path.join(directory, "key-ceremony.json");
    const key = JSON.parse(await readFile(keyPath, "utf8"));
    key.authorizationReceiptSha256 = h("mutated-authorization");
    await writeFile(keyPath, canonicalJson(key));
    const mutatedRoot = await rebindOracle(directory, (oracle) => {
      oracle.authorizationReceiptSha256 = key.authorizationReceiptSha256;
      return oracle;
    });
    assert.notEqual(mutatedRoot, root);
    await assert.rejects(
      () => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }),
      /externally pinned checksum-manifest trust root/,
    );
  });
});

test("rejects fewer than ten candidate targets/components even when all internal hashes agree", async () => {
  await withFixture({ candidateCount: 9 }, async ({ directory, root }) => {
    await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), /at least ten candidates/);
  });
});

test("rejects missing, reversed, duplicate, and forbidden pair rows after complete rebinding", async () => {
  for (const mode of ["missing", "reversed", "duplicate", "development-development"]) {
    await withFixture({}, async ({ directory }) => {
      const filename = path.join(directory, "pair-manifest.jsonl");
      const rows = (await readFile(filename, "utf8")).trimEnd().split("\n").map(JSON.parse);
      if (mode === "missing") rows.pop();
      if (mode === "reversed") {
        [rows[0].leftTargetId, rows[0].rightTargetId] = [rows[0].rightTargetId, rows[0].leftTargetId];
        rows[0].pairId = `${rows[0].leftTargetId}--${rows[0].rightTargetId}`;
      }
      if (mode === "duplicate") rows.push(structuredClone(rows[0]));
      if (mode === "development-development") rows.push({ schemaVersion: "1.0.0", pairId: "DEV-001--DEV-002", leftTargetId: "DEV-001", rightTargetId: "DEV-002", pairKind: "candidate-development" });
      rows.sort((left, right) => left.pairId.localeCompare(right.pairId));
      await writeFile(filename, jsonl(rows));
      const nextRoot = await rebindOracle(directory, (oracle) => {
        oracle.expectedPairCount = rows.length;
        return oracle;
      });
      await assert.rejects(
        () => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: nextRoot, repositoryRoot: ROOT }),
        /canonical unordered-pair order|omits, duplicates, reverses|duplicate|forbidden or inconsistent pair kind/,
        mode,
      );
    });
  }
});

test("rejects unlisted, missing, symlinked, and hardlinked request files", async () => {
  for (const mode of ["unlisted", "missing", "symlink", "hardlink"]) {
    await withFixture({}, async ({ directory, root, temporary }) => {
      const targetPath = path.join(directory, "mapping-contract.json");
      if (mode === "unlisted") await writeFile(path.join(directory, "extra.json"), "{}");
      if (mode === "missing") await unlink(targetPath);
      if (mode === "symlink") {
        await unlink(targetPath);
        await symlink("topology-ontology.json", targetPath);
      }
      if (mode === "hardlink") {
        const outside = path.join(temporary, "outside.json");
        await writeFile(outside, await readFile(targetPath));
        await unlink(targetPath);
        await link(outside, targetPath);
      }
      await assert.rejects(
        () => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }),
        /allowlist drifted|direct regular file|single-link/,
        mode,
      );
    });
  }
});

test("strict schemas reject hidden disclosures and decoded duplicate keys", async () => {
  await withFixture({}, async ({ directory }) => {
    const targetPath = path.join(directory, "target-universe.jsonl");
    const rows = (await readFile(targetPath, "utf8")).trimEnd().split("\n").map(JSON.parse);
    rows[0].dockqLabel = 1;
    await writeFile(targetPath, jsonl(rows));
    const root = await rebindOracle(directory);
    await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), /forbidden disclosure field|unexpected/);
  });

  await withFixture({}, async ({ directory }) => {
    const oraclePath = path.join(directory, "oracle-contract.json");
    const text = await readFile(oraclePath, "utf8");
    await writeFile(oraclePath, `{"st\\u0061te":"ORACLE_REQUEST_FROZEN",${text.slice(1)}`);
    const root = await writeChecksumManifest(directory);
    await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), /duplicate object key/);
  });
});

test("noncanonical numbers and path/confusable identifiers fail closed", async () => {
  await withFixture({}, async ({ directory }) => {
    const oraclePath = path.join(directory, "oracle-contract.json");
    const text = await readFile(oraclePath, "utf8");
    await writeFile(oraclePath, text.replace('"requestSequence":1', '"requestSequence":1.0'));
    const root = await writeChecksumManifest(directory);
    await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), /not canonical JSON/);
  });

  for (const badObjectId of ["../ESCAPE", "OBJECT：CONFUSABLE"]) {
    await withFixture({}, async ({ directory }) => {
      const sourcePath = path.join(directory, "source-manifest.jsonl");
      const rows = (await readFile(sourcePath, "utf8")).trimEnd().split("\n").map(JSON.parse);
      rows[0].objectId = badObjectId;
      await writeFile(sourcePath, jsonl(rows));
      const root = await rebindOracle(directory);
      await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), /objectId is invalid/);
    });
  }
});

test("source mappings are exact and reject missing or unbound source rows", async () => {
  for (const mode of ["missing", "unbound"]) {
    await withFixture({}, async ({ directory }) => {
      const sourcePath = path.join(directory, "source-manifest.jsonl");
      const rows = (await readFile(sourcePath, "utf8")).trimEnd().split("\n").map(JSON.parse);
      if (mode === "missing") rows.splice(rows.findIndex((row) => row.sourceId === "SRC-STRUCT-C001"), 1);
      else rows.push(source("SRC-UNBOUND", "annotation"));
      rows.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
      await writeFile(sourcePath, jsonl(rows));
      const root = await rebindOracle(directory);
      await assert.rejects(
        () => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }),
        /references missing source|exactly the referenced source mapping/,
      );
    });
  }
});

test("key, digest, entropy, resource, and state substitutions fail closed", async () => {
  const cases = [
    ["key-ceremony.json", (row) => { row.signingKeyFingerprintSha256 = h("substituted-key"); }, /Signing-key fingerprint substitution/],
    ["key-ceremony.json", (row) => { row.paddingSeedCommitmentSha256 = row.commitmentNonceSeedCommitmentSha256; }, /distinct commitments/],
    ["resource-contract.json", (row) => { row.maximumPairs = 1; }, /cannot accommodate/],
    ["oracle-contract.json", (row) => { row.state = "DRAFT"; row.oracleRequestFrozen = false; }, /not explicitly frozen/],
    ["oracle-contract.json", (row) => { row.v3ProtocolSha256 = h("substituted-protocol"); }, /Protocol ancestry digest drifted/],
  ];
  for (const [filename, mutate, expectation] of cases) {
    await withFixture({}, async ({ directory }) => {
      const filepath = path.join(directory, filename);
      const value = JSON.parse(await readFile(filepath, "utf8"));
      mutate(value);
      await writeFile(filepath, canonicalJson(value));
      const root = filename === "oracle-contract.json" ? await writeChecksumManifest(directory) : await rebindOracle(directory);
      await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), expectation);
    });
  }
});

test("canonical HTTPS source mappings reject credentials and traversal spellings", async () => {
  for (const url of ["https://user@example.org/source", "https://example.org/a/../source", "https://example.org/%2e%2e/source"]) {
    await withFixture({}, async ({ directory }) => {
      const sourcePath = path.join(directory, "source-manifest.jsonl");
      const rows = (await readFile(sourcePath, "utf8")).trimEnd().split("\n").map(JSON.parse);
      rows[0].url = url;
      await writeFile(sourcePath, jsonl(rows));
      const root = await rebindOracle(directory);
      await assert.rejects(() => verifyFrozenOracleRequest(directory, { expectedChecksumsSha256: root, repositoryRoot: ROOT }), /canonical HTTPS URL/);
    });
  }
});
