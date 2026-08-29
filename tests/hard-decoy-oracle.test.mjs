import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalJson, parseCanonicalJson, parseStrictJson } from "../scripts/hard-decoy/oracle/canonical-json.mjs";
import {
  classifyHiddenEpitopePair,
  commitHiddenRecord,
  createOracleCertificate,
  decryptPaddedEvidence,
  deriveHiddenRecordNonce,
  deriveOracleTargetEligibility,
  encryptedEvidenceDescriptor,
  encryptedEvidenceEphemeralPublicKeySpkiSha256,
  encryptedEvidenceRecipientPublicKeySpkiSha256,
  encryptPaddedEvidence,
  merkleRoot,
  PRODUCTION_ENCRYPTED_EVIDENCE_BYTES,
  publicKeySpkiSha256,
  verifyOpenedOracleEvidence,
  verifyOracleCertificate,
  verifyOracleTranscript,
} from "../scripts/hard-decoy/oracle/oracle-attestation.mjs";
import { decodeUtf8, writeExclusiveDurableFile } from "../scripts/hard-decoy/oracle/secure-io.mjs";
import { verifyFrozenOracleRequest } from "../scripts/hard-decoy-v3/verify-oracle-request.mjs";
import { buildV3RequestFixture } from "./fixtures/hard-decoy-v3-request-fixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function hidden(tokens, directInterfacePass = true, failureCode = null) {
  return { directInterfacePass, failureCode, tokens: [...tokens].sort() };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function buildFixture() {
  const signing = generateKeyPairSync("ed25519");
  const recipient = generateKeyPairSync("x25519");
  const ephemeral = generateKeyPairSync("x25519");
  const commitmentSeed = Buffer.alloc(32, 0x31);
  const paddingSeed = Buffer.alloc(32, 0x42);
  const requestFixture = await buildV3RequestFixture({
    keyCeremonyOverrides: {
      signingPublicKeySpkiSha256: publicKeySpkiSha256(signing.publicKey, "ed25519"),
      signingKeyFingerprintSha256: publicKeySpkiSha256(signing.publicKey, "ed25519"),
      encryptionRecipientPublicKeySpkiSha256: publicKeySpkiSha256(recipient.publicKey, "x25519"),
      encryptionRecipientFingerprintSha256: publicKeySpkiSha256(recipient.publicKey, "x25519"),
      precommittedEphemeralPublicKeySpkiSha256: publicKeySpkiSha256(ephemeral.publicKey, "x25519"),
      precommittedEphemeralSecretCommitmentSha256: sha256(ephemeral.privateKey.export({ type: "pkcs8", format: "der" })),
      commitmentNonceSeedCommitmentSha256: sha256(commitmentSeed),
      paddingSeedCommitmentSha256: sha256(paddingSeed),
    },
  });
  const verifiedRequest = await verifyFrozenOracleRequest(requestFixture.directory, {
    expectedChecksumsSha256: requestFixture.root,
    repositoryRoot: ROOT,
  });
  const { requestSummary } = verifiedRequest;
  const candidateHidden = hidden(["GPCRDB:2X60", "GPCRDB:3X25", "GPCRDB:ECL1:01"]);
  const developmentHidden = hidden(["GPCRDB:5X50", "GPCRDB:6X30"]);
  const targetRecords = requestSummary.targetManifest.map((row) => ({
    ...row,
    hidden: row.role === "candidate" ? candidateHidden : developmentHidden,
  }));
  const hiddenById = new Map(targetRecords.map((row) => [row.targetId, row.hidden]));
  const targetCommitments = targetRecords.map((row) => ({
    targetId: row.targetId,
    role: row.role,
    hiddenRecordCommitment: commitHiddenRecord(
      "target",
      row.targetId,
      row.hidden,
      deriveHiddenRecordNonce(commitmentSeed, "target", row.targetId),
    ),
  }));
  const pairEvidence = requestSummary.pairManifest.map((row) => ({
    pairId: row.pairId,
    ...classifyHiddenEpitopePair(hiddenById.get(row.leftId), hiddenById.get(row.rightId)),
  }));
  const pairDecisions = requestSummary.pairManifest.map((row, index) => ({
    ...row,
    decision: pairEvidence[index].decision,
    hiddenRecordCommitment: commitHiddenRecord(
      "pair",
      row.pairId,
      {
        decision: pairEvidence[index].decision,
        intersection: pairEvidence[index].intersection,
        minSize: pairEvidence[index].minSize,
        union: pairEvidence[index].union,
      },
      deriveHiddenRecordNonce(commitmentSeed, "pair", row.pairId),
    ),
  }));
  const evidenceValue = {
    schemaVersion: "1.0.0",
    commitmentSeedHex: commitmentSeed.toString("hex"),
    paddingSeedHex: paddingSeed.toString("hex"),
    targets: targetRecords,
    pairs: pairEvidence,
  };
  const envelope = encryptPaddedEvidence(
    evidenceValue,
    recipient.publicKey,
    ephemeral.privateKey,
    requestSummary.requestSha256,
    paddingSeed,
  );
  const commitments = [
    ...targetCommitments.map((row) => row.hiddenRecordCommitment),
    ...pairDecisions.map((row) => row.hiddenRecordCommitment),
  ];
  const payload = {
    schemaVersion: "1.0.0",
    protocolId: "confovhh-hard-decoy-v3",
    requestId: requestSummary.requestId,
    requestSha256: requestSummary.requestSha256,
    protocolSha256: requestSummary.protocolSha256,
    oracleImplementationSha256: requestSummary.oracleImplementationSha256,
    containerImageDigest: requestSummary.containerImageDigest,
    mappingContractSha256: requestSummary.mappingContractSha256,
    topologyOntologySha256: requestSummary.topologyOntologySha256,
    authorizationReceiptSha256: requestSummary.authorizationReceiptSha256,
    commitmentNonceSeedCommitmentSha256: requestSummary.commitmentNonceSeedCommitmentSha256,
    paddingSeedCommitmentSha256: requestSummary.paddingSeedCommitmentSha256,
    signingPublicKeySpkiSha256: requestSummary.signingPublicKeySpkiSha256,
    recipientPublicKeySpkiSha256: requestSummary.recipientPublicKeySpkiSha256,
    ephemeralPublicKeySpkiSha256: requestSummary.ephemeralPublicKeySpkiSha256,
    transparencyLogKeyFingerprintSha256: requestSummary.transparencyLogKeyFingerprintSha256,
    transparencyChallengeSha256: requestSummary.transparencyChallengeSha256,
    sequenceNumber: requestSummary.sequenceNumber,
    targetCount: targetCommitments.length,
    targetCommitments,
    pairCount: pairDecisions.length,
    pairDecisions,
    commitmentMerkleRoot: merkleRoot(commitments),
    encryptedEvidence: encryptedEvidenceDescriptor(envelope),
  };
  return {
    ...requestFixture,
    signing,
    recipient,
    ephemeral,
    commitmentSeed,
    paddingSeed,
    evidenceValue,
    envelope,
    payload,
    verifiedRequest,
  };
}

const fixture = await buildFixture();
test.after(async () => rm(fixture.temporary, { recursive: true, force: true }));

test("exact integer epitope thresholds include equality and fail closed", () => {
  assert.equal(classifyHiddenEpitopePair(hidden(["A", "B", "C", "D", "E", "F", "G"]), hidden(["A", "B", "C", "D", "H", "I", "J"])).decision, "EDGE");
  assert.equal(classifyHiddenEpitopePair(hidden(["A", "B", "C", "D", "E"]), hidden(["A", "B", "C", "F", "G", "H", "I", "J"])).decision, "EDGE");
  assert.equal(classifyHiddenEpitopePair(hidden(["A", "B", "C", "D", "E"]), hidden(["A", "B", "F", "G", "H", "I", "J", "K"])).decision, "NO_EDGE");
  assert.equal(classifyHiddenEpitopePair(hidden([], false, "EMPTY_INTERFACE"), hidden(["A"])).decision, "FAIL_CLOSED");
  assert.equal(classifyHiddenEpitopePair(hidden([], false, "NO_DIRECT_INTERFACE"), hidden(["A"])).decision, "FAIL_CLOSED");
});

test("signed oracle certificate verifies and opened evidence fully reconciles", () => {
  assert.equal(fixture.envelope.byteLength, PRODUCTION_ENCRYPTED_EVIDENCE_BYTES);
  const certificate = createOracleCertificate(fixture.payload, fixture.signing.privateKey);
  const verified = verifyOracleCertificate(certificate, fixture.signing.publicKey, {
    requestSha256: fixture.root,
    protocolSha256: fixture.verifiedRequest.requestSummary.protocolSha256,
  });
  assert.equal(verified.pairDecisions[0].decision, "EDGE");
  assert.equal(
    canonicalJson(decryptPaddedEvidence(fixture.envelope, fixture.recipient.privateKey, fixture.root)),
    canonicalJson(fixture.evidenceValue),
  );
  const opened = verifyOpenedOracleEvidence({
    certificate,
    publicKey: fixture.signing.publicKey,
    verifiedRequest: fixture.verifiedRequest,
    encryptedEvidence: fixture.envelope,
    recipientPrivateKey: fixture.recipient.privateKey,
  });
  assert.equal(opened.evidence.pairs.length, fixture.payload.pairCount);
  assert.equal(opened.targetEligibility.every((row) => row.eligible), true);
});

test("evidence envelope binds its context, recipient, and precommitted ephemeral key", () => {
  assert.equal(encryptedEvidenceEphemeralPublicKeySpkiSha256(fixture.envelope), publicKeySpkiSha256(fixture.ephemeral.publicKey, "x25519"));
  assert.equal(encryptedEvidenceRecipientPublicKeySpkiSha256(fixture.envelope), publicKeySpkiSha256(fixture.recipient.publicKey, "x25519"));
  assert.throws(() => decryptPaddedEvidence(fixture.envelope, fixture.recipient.privateKey, "b".repeat(64)), /authenticate|Unsupported state|unable/i);
  const otherRecipient = generateKeyPairSync("x25519");
  assert.throws(() => decryptPaddedEvidence(fixture.envelope, otherRecipient.privateKey, fixture.root), /recipient key/);
});

test("tampering, key substitution, incomplete matrices, and noncanonical signatures fail", () => {
  const certificate = createOracleCertificate(structuredClone(fixture.payload), fixture.signing.privateKey);
  certificate.payload.pairDecisions[0].decision = "NO_EDGE";
  assert.throws(() => verifyOracleCertificate(certificate, fixture.signing.publicKey), /signature is invalid/);

  const clean = createOracleCertificate(fixture.payload, fixture.signing.privateKey);
  const substituted = generateKeyPairSync("ed25519");
  assert.throws(() => verifyOracleCertificate(clean, substituted.publicKey), /key substitution/);
  const badEncoding = structuredClone(clean);
  badEncoding.signatureBase64 = `${badEncoding.signatureBase64}\n`;
  assert.throws(() => verifyOracleCertificate(badEncoding, fixture.signing.publicKey), /signature encoding/);

  const reversed = structuredClone(fixture.payload);
  [reversed.pairDecisions[0].leftId, reversed.pairDecisions[0].rightId] = [reversed.pairDecisions[0].rightId, reversed.pairDecisions[0].leftId];
  assert.throws(() => createOracleCertificate(reversed, fixture.signing.privateKey), /bytewise canonical/);
  const incomplete = structuredClone(fixture.payload);
  incomplete.pairDecisions.pop();
  incomplete.pairCount -= 1;
  assert.throws(() => createOracleCertificate(incomplete, fixture.signing.privateKey), /pair matrix is incomplete/);
});

test("public certificate declassifies decisions and commitments, not hidden epitopes", () => {
  const certificate = createOracleCertificate(fixture.payload, fixture.signing.privateKey);
  const text = canonicalJson(certificate);
  assert.doesNotMatch(text, /GPCRDB|2X60|ECL1|intersection|union|minSize|failureCode|directInterfacePass/);
  assert.match(text, /"decision":"EDGE"/);
  assert.match(text, /"hiddenRecordCommitment":"[a-f0-9]{64}"/);
});

test("transcript requires an actually verified frozen request and exact encrypted bytes", () => {
  const certificate = createOracleCertificate(fixture.payload, fixture.signing.privateKey);
  const result = verifyOracleTranscript({
    certificate,
    publicKey: fixture.signing.publicKey,
    verifiedRequest: fixture.verifiedRequest,
    encryptedEvidence: fixture.envelope,
  });
  assert.equal(result.targetEligibility.length, 10);
  assert.equal(result.targetEligibility.every((row) => row.eligible), true);

  assert.throws(() => verifyOracleTranscript({
    certificate,
    publicKey: fixture.signing.publicKey,
    verifiedRequest: { ...fixture.verifiedRequest },
    encryptedEvidence: fixture.envelope,
  }), /frozen-request verifier/);
  const changedEnvelope = Buffer.from(fixture.envelope);
  changedEnvelope[changedEnvelope.length - 1] ^= 1;
  assert.throws(() => verifyOracleTranscript({
    certificate,
    publicKey: fixture.signing.publicKey,
    verifiedRequest: fixture.verifiedRequest,
    encryptedEvidence: changedEnvelope,
  }), /evidence digest drifted/);
});

test("development leakage edges and FAIL_CLOSED pairs make candidates ineligible", () => {
  const developmentEdge = structuredClone(fixture.payload);
  const edgeIndex = developmentEdge.pairDecisions.findIndex((row) => row.leftId.startsWith("CAND-") && row.rightId.startsWith("DEV-"));
  const edge = developmentEdge.pairDecisions[edgeIndex];
  edge.decision = "EDGE";
  edge.hiddenRecordCommitment = commitHiddenRecord(
    "pair",
    edge.pairId,
    { decision: "EDGE", intersection: 1, minSize: 1, union: 1 },
    deriveHiddenRecordNonce(fixture.commitmentSeed, "pair", edge.pairId),
  );
  developmentEdge.commitmentMerkleRoot = merkleRoot([
    ...developmentEdge.targetCommitments.map((row) => row.hiddenRecordCommitment),
    ...developmentEdge.pairDecisions.map((row) => row.hiddenRecordCommitment),
  ]);
  const eligibility = deriveOracleTargetEligibility(developmentEdge);
  assert.deepEqual(eligibility.find((row) => row.targetId === edge.leftId), {
    targetId: edge.leftId,
    eligible: false,
    reason: "ORACLE_DEVELOPMENT_LEAKAGE_EDGE",
  });

  const failed = structuredClone(fixture.payload);
  const failedPair = failed.pairDecisions[0];
  failedPair.decision = "FAIL_CLOSED";
  failedPair.hiddenRecordCommitment = commitHiddenRecord(
    "pair",
    failedPair.pairId,
    { decision: "FAIL_CLOSED", intersection: null, minSize: null, union: null },
    deriveHiddenRecordNonce(fixture.commitmentSeed, "pair", failedPair.pairId),
  );
  failed.commitmentMerkleRoot = merkleRoot([
    ...failed.targetCommitments.map((row) => row.hiddenRecordCommitment),
    ...failed.pairDecisions.map((row) => row.hiddenRecordCommitment),
  ]);
  assert.equal(deriveOracleTargetEligibility(failed).filter((row) => !row.eligible).length, 2);
});

test("target and pair commitments have disjoint nonce and digest namespaces", () => {
  const seed = Buffer.alloc(32, 7);
  const record = { directInterfacePass: true, failureCode: null, tokens: ["ECL1"] };
  const targetNonce = deriveHiddenRecordNonce(seed, "target", "CAND-001");
  const pairNonce = deriveHiddenRecordNonce(seed, "pair", "CAND-001");
  assert.notDeepEqual(targetNonce, pairNonce);
  assert.notEqual(
    commitHiddenRecord("target", "CAND-001", record, targetNonce),
    commitHiddenRecord("pair", "CAND-001", record, pairNonce),
  );
  assert.throws(() => classifyHiddenEpitopePair(
    { directInterfacePass: true, failureCode: null, tokens: ["ECL2", "ECL1"] },
    hidden(["ECL1"]),
  ), /bytewise sorted/);
  assert.throws(() => classifyHiddenEpitopePair(
    { directInterfacePass: false, failureCode: "ARBITRARY_TEXT", tokens: [] },
    hidden(["ECL1"]),
  ), /failure code/);
});

test("strict parser rejects duplicate keys, decoded controls, bidi, unsafe numbers, and depth bombs", () => {
  assert.throws(() => parseStrictJson('{"a":1,"\\u0061":2}'), /duplicate object key/);
  assert.throws(() => parseStrictJson('{"a":"safe\\u0000unsafe"}'), /decoded control/);
  assert.throws(() => parseStrictJson('{"a":"safe\\u202eunsafe"}'), /bidirectional control/);
  assert.throws(() => parseStrictJson('{"a":9007199254740992}'), /unsafe integer/);
  assert.throws(() => parseStrictJson(`${"[".repeat(70)}0${"]".repeat(70)}`), /nesting-depth/);
});

test("canonical parser rejects alternate numeric forms, whitespace, BOM, and trailing bytes", () => {
  assert.deepEqual(parseCanonicalJson('{"n":1}'), Object.assign(Object.create(null), { n: 1 }));
  for (const source of ['{"n":1.0}', '{"n":1e0}', '{\r\n"n":1\r\n}', '{"n":1}\n', ' {"n":1}']) {
    assert.throws(() => parseCanonicalJson(source), /not canonical JSON/);
  }
  assert.throws(() => parseStrictJson('\ufeff{"n":1}'), /BOM/);
  assert.throws(() => decodeUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "fixture"), /BOM/);
});

test("canonicalizer rejects getters, symbols, and array side properties", () => {
  const getter = {};
  Object.defineProperty(getter, "a", { enumerable: true, get: () => randomBytes(1)[0] });
  assert.throws(() => canonicalJson(getter), /inert data property/);
  const symbol = { a: 1 };
  symbol[Symbol("hidden")] = 2;
  assert.throws(() => canonicalJson(symbol), /symbol or nonenumerable/);
  const array = [1];
  array.side = 2;
  assert.throws(() => canonicalJson(array), /non-index array properties/);
});

test("oracle output is durable, private, no-replace, and symlink-safe", async () => {
  const directory = path.join(fixture.temporary, "output");
  await mkdir(directory, { mode: 0o700 });
  const filename = path.join(directory, "certificate.json");
  await writeExclusiveDurableFile(filename, Buffer.from("{}", "utf8"));
  assert.equal((await readFile(filename, "utf8")), "{}");
  assert.equal(Number((await lstat(filename, { bigint: true })).mode) & 0o077, 0);
  await assert.rejects(() => writeExclusiveDurableFile(filename, Buffer.from("replacement")), /EEXIST/);

  const symlinkName = path.join(directory, "other.json");
  await writeFile(path.join(fixture.temporary, "target"), "canary");
  await symlink(path.join(fixture.temporary, "target"), symlinkName);
  await assert.rejects(() => writeExclusiveDurableFile(symlinkName, Buffer.from("changed")), /EEXIST/);
  assert.equal(await readFile(path.join(fixture.temporary, "target"), "utf8"), "canary");
});
