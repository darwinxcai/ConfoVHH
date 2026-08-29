import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  sign,
  verify,
} from "node:crypto";

import { isVerifiedFrozenOracleRequest } from "../../hard-decoy-v3/verify-oracle-request.mjs";
import { canonicalJson, parseCanonicalJson } from "./canonical-json.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const REQUEST_ID = /^REQUEST-[A-F0-9]{16}$/u;
const TOKEN = /^[A-Z0-9][A-Z0-9:._-]{0,95}$/u;
const DECISIONS = new Set(["EDGE", "NO_EDGE", "FAIL_CLOSED"]);
const RECORD_KINDS = new Set(["target", "pair"]);
const FAILURE_CODES = new Set([
  "AMBIGUOUS_MAPPING",
  "EMPTY_INTERFACE",
  "NO_DIRECT_INTERFACE",
  "PARSE_FAILURE",
  "RESOURCE_LIMIT",
  "SOURCE_MISMATCH",
  "UNMAPPED_RECEPTOR_RESIDUE",
]);
const EVIDENCE_MAGIC = Buffer.from("CVHHEV3\0", "ascii");
const PRODUCTION_PADDED_BYTES = 4 * 1024 * 1024;
const X25519_SPKI_BYTES = 44;
const RECIPIENT_FINGERPRINT_BYTES = 32;
export const PRODUCTION_ENCRYPTED_EVIDENCE_BYTES = EVIDENCE_MAGIC.byteLength + 2 + X25519_SPKI_BYTES + RECIPIENT_FINGERPRINT_BYTES + 16 + PRODUCTION_PADDED_BYTES;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function asPrivateKey(key) {
  return key && key.type === "private" ? key : createPrivateKey(key);
}

function asPublicKey(key) {
  return key && key.type === "public" ? key : createPublicKey(key);
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} has unexpected keys.`);
}

function digest(domain, ...parts) {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  for (const part of parts) {
    hash.update("\0", "utf8");
    hash.update(part);
  }
  return hash.digest("hex");
}

function deterministicBytes(seed, domain, length) {
  invariant(Buffer.isBuffer(seed) && seed.byteLength === 32, "A deterministic oracle seed must contain 256 bits.");
  invariant(Number.isSafeInteger(length) && length >= 0 && length <= 16 * 1024 * 1024, "Invalid deterministic byte request.");
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  for (let counter = 0; offset < length; counter += 1) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter, 0);
    const block = createHmac("sha256", seed).update(domain, "utf8").update("\0", "utf8").update(count).digest();
    const copied = Math.min(block.byteLength, length - offset);
    block.copy(output, offset, 0, copied);
    offset += copied;
  }
  return output;
}

function assertKeyType(key, expected, label) {
  invariant(key.asymmetricKeyType === expected, `${label} must be ${expected}.`);
}

export function publicKeySpkiSha256(publicKey, expectedType = null) {
  const key = asPublicKey(publicKey);
  if (expectedType != null) assertKeyType(key, expectedType, "Oracle public key");
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

export function publicKeyFingerprint(publicKey) {
  return publicKeySpkiSha256(publicKey, "ed25519");
}

export function commitHiddenRecord(kind, recordId, record, nonce) {
  invariant(RECORD_KINDS.has(kind), "A hidden-record commitment requires an explicit record kind.");
  invariant(typeof recordId === "string" && ID.test(recordId), "A hidden-record commitment requires one canonical record ID.");
  invariant(Buffer.isBuffer(nonce) && nonce.byteLength === 32, "A hidden-record commitment requires one 256-bit nonce.");
  return digest(`ConfoVHH-v3-hidden-record-${kind}`, Buffer.from(recordId, "utf8"), nonce, Buffer.from(canonicalJson(record), "utf8"));
}

export function deriveHiddenRecordNonce(precommittedSeed, kind, recordId) {
  invariant(RECORD_KINDS.has(kind), "A hidden-record nonce requires an explicit record kind.");
  invariant(typeof recordId === "string" && ID.test(recordId), "A hidden-record nonce requires one canonical record ID.");
  return deterministicBytes(precommittedSeed, `ConfoVHH-v3-hidden-record-nonce\0${kind}\0${recordId}`, 32);
}

export function merkleRoot(commitments) {
  invariant(Array.isArray(commitments) && commitments.length > 0, "A Merkle tree requires at least one commitment.");
  let level = commitments.map((commitment, index) => {
    invariant(SHA256.test(commitment), `Invalid Merkle commitment at index ${index}.`);
    return digest("ConfoVHH-v3-merkle-leaf", Buffer.from(commitment, "hex"));
  });
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(digest("ConfoVHH-v3-merkle-node", Buffer.from(left, "hex"), Buffer.from(right, "hex")));
    }
    level = next;
  }
  return level[0];
}

export function classifyHiddenEpitopePair(left, right) {
  for (const [label, record] of [["left", left], ["right", right]]) {
    exactKeys(record, ["directInterfacePass", "failureCode", "tokens"], `${label} hidden epitope record`);
    invariant(typeof record.directInterfacePass === "boolean", `${label} direct-interface state is invalid.`);
    invariant(record.failureCode === null || FAILURE_CODES.has(record.failureCode), `${label} failure code is invalid.`);
    invariant(Array.isArray(record.tokens) && record.tokens.length <= 2_048 && record.tokens.every((token) => typeof token === "string" && TOKEN.test(token)), `${label} token set is invalid.`);
    invariant(new Set(record.tokens).size === record.tokens.length, `${label} token set contains duplicates.`);
    invariant(canonicalJson(record.tokens) === canonicalJson([...record.tokens].sort()), `${label} token set must be bytewise sorted.`);
    invariant(
      record.directInterfacePass
        ? record.failureCode === null && record.tokens.length > 0
        : FAILURE_CODES.has(record.failureCode) && record.tokens.length === 0,
      `${label} hidden epitope state is contradictory.`,
    );
  }
  if (
    !left.directInterfacePass || !right.directInterfacePass || left.failureCode != null || right.failureCode != null ||
    left.tokens.length === 0 || right.tokens.length === 0
  ) return { decision: "FAIL_CLOSED", intersection: null, union: null, minSize: null };

  const leftSet = new Set(left.tokens);
  const rightSet = new Set(right.tokens);
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  const union = leftSet.size + rightSet.size - intersection;
  const minSize = Math.min(leftSet.size, rightSet.size);
  const edge = 5 * intersection >= 2 * union || 5 * intersection >= 3 * minSize;
  return { decision: edge ? "EDGE" : "NO_EDGE", intersection, union, minSize };
}

export function signOraclePayload(payload, privateKey) {
  validateOraclePayload(payload);
  const key = asPrivateKey(privateKey);
  assertKeyType(key, "ed25519", "Oracle signing key");
  return sign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64");
}

export function createOracleCertificate(payload, privateKey) {
  return {
    schemaVersion: "1.0.0",
    algorithm: "Ed25519",
    payload,
    signatureBase64: signOraclePayload(payload, privateKey),
  };
}

export function validateOraclePayload(payload) {
  exactKeys(payload, [
    "authorizationReceiptSha256",
    "commitmentMerkleRoot",
    "commitmentNonceSeedCommitmentSha256",
    "containerImageDigest",
    "encryptedEvidence",
    "ephemeralPublicKeySpkiSha256",
    "mappingContractSha256",
    "oracleImplementationSha256",
    "paddingSeedCommitmentSha256",
    "pairCount",
    "pairDecisions",
    "protocolId",
    "protocolSha256",
    "recipientPublicKeySpkiSha256",
    "requestId",
    "requestSha256",
    "schemaVersion",
    "sequenceNumber",
    "signingPublicKeySpkiSha256",
    "targetCommitments",
    "targetCount",
    "topologyOntologySha256",
    "transparencyChallengeSha256",
    "transparencyLogKeyFingerprintSha256",
  ], "oracle payload");
  invariant(payload.schemaVersion === "1.0.0" && payload.protocolId === "confovhh-hard-decoy-v3", "Unexpected oracle payload identity.");
  invariant(REQUEST_ID.test(payload.requestId), "Invalid frozen oracle request ID.");
  for (const field of [
    "authorizationReceiptSha256", "commitmentMerkleRoot", "commitmentNonceSeedCommitmentSha256",
    "ephemeralPublicKeySpkiSha256", "mappingContractSha256", "oracleImplementationSha256",
    "paddingSeedCommitmentSha256", "protocolSha256", "recipientPublicKeySpkiSha256", "requestSha256",
    "signingPublicKeySpkiSha256", "topologyOntologySha256", "transparencyChallengeSha256",
    "transparencyLogKeyFingerprintSha256",
  ]) invariant(SHA256.test(payload[field]), `Invalid oracle payload digest: ${field}`);
  invariant(/^sha256:[a-f0-9]{64}$/u.test(payload.containerImageDigest), "Invalid pinned container digest.");
  invariant(payload.sequenceNumber === 1, "The pre-label oracle sequence number must be one.");
  invariant(Number.isSafeInteger(payload.targetCount) && payload.targetCount >= 11 && payload.targetCount <= 128, "Invalid oracle target count.");
  invariant(Number.isSafeInteger(payload.pairCount) && payload.pairCount >= 1 && payload.pairCount <= 16_384, "Invalid oracle pair count.");
  invariant(Array.isArray(payload.targetCommitments) && payload.targetCommitments.length === payload.targetCount, "Target commitment count drifted.");
  invariant(Array.isArray(payload.pairDecisions) && payload.pairDecisions.length === payload.pairCount, "Pair decision count drifted.");

  const targetIds = new Set();
  const commitments = [];
  let candidateCount = 0;
  let developmentCount = 0;
  for (const row of payload.targetCommitments) {
    exactKeys(row, ["hiddenRecordCommitment", "role", "targetId"], "target commitment");
    invariant(ID.test(row.targetId) && !targetIds.has(row.targetId), "Invalid or duplicate target commitment ID.");
    invariant(row.role === "candidate" || row.role === "development", "Invalid target role.");
    invariant(SHA256.test(row.hiddenRecordCommitment), "Invalid target hidden-record commitment.");
    targetIds.add(row.targetId);
    commitments.push(row.hiddenRecordCommitment);
    if (row.role === "candidate") candidateCount += 1;
    else developmentCount += 1;
  }
  invariant(candidateCount >= 10 && developmentCount >= 1, "Oracle payload requires at least ten candidate nodes and one development node.");
  invariant(
    canonicalJson(payload.targetCommitments.map((row) => row.targetId)) === canonicalJson([...payload.targetCommitments.map((row) => row.targetId)].sort()),
    "Target commitments must be bytewise sorted.",
  );

  const pairIds = new Set();
  const endpointPairs = new Set();
  for (const row of payload.pairDecisions) {
    exactKeys(row, ["decision", "hiddenRecordCommitment", "leftId", "pairId", "rightId"], "pair decision");
    invariant(ID.test(row.pairId) && !pairIds.has(row.pairId), "Invalid or duplicate pair ID.");
    invariant(targetIds.has(row.leftId) && targetIds.has(row.rightId) && row.leftId < row.rightId, "Pair endpoints must be known and bytewise canonical.");
    invariant(DECISIONS.has(row.decision), "Invalid pair decision.");
    invariant(SHA256.test(row.hiddenRecordCommitment), "Invalid pair hidden-record commitment.");
    pairIds.add(row.pairId);
    const endpointKey = `${row.leftId}\0${row.rightId}`;
    invariant(!endpointPairs.has(endpointKey), "Oracle payload contains a duplicate endpoint pair.");
    endpointPairs.add(endpointKey);
    commitments.push(row.hiddenRecordCommitment);
  }
  invariant(
    canonicalJson(payload.pairDecisions.map((row) => row.pairId)) === canonicalJson([...payload.pairDecisions.map((row) => row.pairId)].sort()),
    "Pair decisions must be bytewise sorted.",
  );
  const targetById = new Map(payload.targetCommitments.map((row) => [row.targetId, row]));
  const candidates = payload.targetCommitments.filter((row) => row.role === "candidate");
  const developments = payload.targetCommitments.filter((row) => row.role === "development");
  const expectedEndpoints = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      expectedEndpoints.push([candidates[left].targetId, candidates[right].targetId].sort().join("\0"));
    }
    for (const development of developments) {
      expectedEndpoints.push([candidates[left].targetId, development.targetId].sort().join("\0"));
    }
  }
  invariant(
    canonicalJson([...endpointPairs].sort()) === canonicalJson(expectedEndpoints.sort()),
    "Oracle payload pair matrix is incomplete or contains a forbidden pair.",
  );
  for (const row of payload.pairDecisions) {
    const roles = [targetById.get(row.leftId).role, targetById.get(row.rightId).role].sort().join("-");
    invariant(roles === "candidate-candidate" || roles === "candidate-development", "Oracle payload contains a forbidden development-development pair.");
  }
  invariant(merkleRoot(commitments) === payload.commitmentMerkleRoot, "Oracle commitment Merkle root disagrees with ordered rows.");

  exactKeys(payload.encryptedEvidence, ["bytes", "format", "sha256"], "encrypted evidence descriptor");
  invariant(payload.encryptedEvidence.format === "confovhh-x25519-hkdf-sha256-aes-256-gcm-fixed-v1", "Unexpected encrypted evidence format.");
  invariant(SHA256.test(payload.encryptedEvidence.sha256), "Invalid encrypted evidence digest.");
  invariant(payload.encryptedEvidence.bytes === PRODUCTION_ENCRYPTED_EVIDENCE_BYTES, "Invalid encrypted evidence byte count.");
}

export function verifyOracleCertificate(certificate, publicKey, expectations = {}) {
  exactKeys(certificate, ["algorithm", "payload", "schemaVersion", "signatureBase64"], "oracle certificate");
  invariant(certificate.schemaVersion === "1.0.0" && certificate.algorithm === "Ed25519", "Unexpected oracle certificate identity.");
  validateOraclePayload(certificate.payload);
  invariant(publicKeySpkiSha256(publicKey, "ed25519") === certificate.payload.signingPublicKeySpkiSha256, "Oracle signing key substitution detected.");
  invariant(/^[A-Za-z0-9+/]{86}==$/u.test(certificate.signatureBase64), "Invalid Ed25519 signature encoding.");
  const signatureBytes = Buffer.from(certificate.signatureBase64, "base64");
  invariant(signatureBytes.byteLength === 64 && signatureBytes.toString("base64") === certificate.signatureBase64, "Ed25519 signature encoding is noncanonical.");
  invariant(verify(
    null,
    Buffer.from(canonicalJson(certificate.payload), "utf8"),
    publicKey,
    signatureBytes,
  ), "Oracle certificate signature is invalid.");
  for (const [field, expected] of Object.entries(expectations)) {
    invariant(certificate.payload[field] === expected, `Oracle certificate expectation drifted: ${field}`);
  }
  return certificate.payload;
}

export function deriveOracleTargetEligibility(payload) {
  validateOraclePayload(payload);
  const roleByTarget = new Map(payload.targetCommitments.map((row) => [row.targetId, row.role]));
  const eligibility = new Map(payload.targetCommitments
    .filter((row) => row.role === "candidate")
    .map((row) => [row.targetId, { targetId: row.targetId, eligible: true, reason: null }]));
  for (const pair of payload.pairDecisions) {
    const candidateDevelopmentEdge = pair.decision === "EDGE" &&
      roleByTarget.get(pair.leftId) !== roleByTarget.get(pair.rightId);
    if (pair.decision !== "FAIL_CLOSED" && !candidateDevelopmentEdge) continue;
    for (const targetId of [pair.leftId, pair.rightId]) {
      const row = eligibility.get(targetId);
      if (row) {
        row.eligible = false;
        if (pair.decision === "FAIL_CLOSED") row.reason = "ORACLE_PAIR_FAIL_CLOSED";
        else if (row.reason == null) row.reason = "ORACLE_DEVELOPMENT_LEAKAGE_EDGE";
      }
    }
  }
  return [...eligibility.values()].sort((left, right) => left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0);
}

export function verifyOracleTranscript({ certificate, publicKey, verifiedRequest, encryptedEvidence }) {
  invariant(isVerifiedFrozenOracleRequest(verifiedRequest), "Oracle transcript requires the in-process result of the frozen-request verifier.");
  const { requestSummary } = verifiedRequest;
  exactKeys(requestSummary, [
    "authorizationReceiptSha256", "commitmentNonceSeedCommitmentSha256", "containerImageDigest",
    "ephemeralPublicKeySpkiSha256", "mappingContractSha256", "oracleImplementationSha256",
    "paddingSeedCommitmentSha256", "pairManifest", "protocolSha256", "recipientPublicKeySpkiSha256",
    "requestId", "requestSha256", "sequenceNumber", "signingPublicKeySpkiSha256", "targetManifest",
    "topologyOntologySha256", "transparencyChallengeSha256", "transparencyLogKeyFingerprintSha256",
  ], "verified oracle request summary");
  invariant(SHA256.test(requestSummary.requestSha256), "Invalid expected oracle request digest.");
  invariant(Array.isArray(requestSummary.targetManifest) && Array.isArray(requestSummary.pairManifest), "Oracle request summary ledgers are missing.");
  const expectations = Object.fromEntries(Object.entries(requestSummary).filter(([key]) => !["targetManifest", "pairManifest"].includes(key)));
  const payload = verifyOracleCertificate(certificate, publicKey, expectations);
  const expectedTargets = requestSummary.targetManifest.map((row) => {
    exactKeys(row, ["role", "targetId"], "request target row");
    invariant(ID.test(row.targetId) && (row.role === "candidate" || row.role === "development"), "Invalid request target row.");
    return { targetId: row.targetId, role: row.role };
  });
  const actualTargets = payload.targetCommitments.map((row) => ({ targetId: row.targetId, role: row.role }));
  invariant(canonicalJson(actualTargets) === canonicalJson(expectedTargets), "Oracle target transcript drifted from the frozen request.");
  const expectedPairs = requestSummary.pairManifest.map((row) => {
    exactKeys(row, ["leftId", "pairId", "rightId"], "request pair row");
    invariant(ID.test(row.pairId) && row.leftId < row.rightId, "Invalid request pair row.");
    return row;
  });
  const actualPairs = payload.pairDecisions.map((row) => ({ pairId: row.pairId, leftId: row.leftId, rightId: row.rightId }));
  invariant(canonicalJson(actualPairs) === canonicalJson(expectedPairs), "Oracle pair transcript drifted from the frozen request.");
  invariant(Buffer.isBuffer(encryptedEvidence) && encryptedEvidence.byteLength === payload.encryptedEvidence.bytes, "Encrypted evidence bytes drifted from the signed descriptor.");
  invariant(createHash("sha256").update(encryptedEvidence).digest("hex") === payload.encryptedEvidence.sha256, "Encrypted evidence digest drifted from the signed descriptor.");
  invariant(
    encryptedEvidenceEphemeralPublicKeySpkiSha256(encryptedEvidence) === requestSummary.ephemeralPublicKeySpkiSha256,
    "Encrypted evidence uses a non-precommitted ephemeral key.",
  );
  invariant(
    encryptedEvidenceRecipientPublicKeySpkiSha256(encryptedEvidence) === requestSummary.recipientPublicKeySpkiSha256,
    "Encrypted evidence uses a non-precommitted recipient key.",
  );
  return { payload, targetEligibility: deriveOracleTargetEligibility(payload) };
}

export function parseOracleCertificate(text) {
  return parseCanonicalJson(text);
}

export function encryptedEvidenceEphemeralPublicKeySpkiSha256(envelope) {
  invariant(Buffer.isBuffer(envelope) && envelope.byteLength === PRODUCTION_ENCRYPTED_EVIDENCE_BYTES, "Encrypted-evidence envelope has an unexpected size.");
  invariant(envelope.subarray(0, EVIDENCE_MAGIC.byteLength).equals(EVIDENCE_MAGIC), "Invalid encrypted-evidence envelope magic.");
  const publicLength = envelope.readUInt16BE(EVIDENCE_MAGIC.byteLength);
  invariant(publicLength === X25519_SPKI_BYTES, "Encrypted-evidence envelope has an unexpected X25519 key length.");
  const publicStart = EVIDENCE_MAGIC.byteLength + 2;
  const ephemeralDer = envelope.subarray(publicStart, publicStart + publicLength);
  const key = createPublicKey({ key: ephemeralDer, type: "spki", format: "der" });
  assertKeyType(key, "x25519", "Evidence ephemeral public key");
  return createHash("sha256").update(ephemeralDer).digest("hex");
}

export function encryptedEvidenceRecipientPublicKeySpkiSha256(envelope) {
  encryptedEvidenceEphemeralPublicKeySpkiSha256(envelope);
  const publicStart = EVIDENCE_MAGIC.byteLength + 2;
  return envelope.subarray(publicStart + X25519_SPKI_BYTES, publicStart + X25519_SPKI_BYTES + RECIPIENT_FINGERPRINT_BYTES).toString("hex");
}

export function encryptPaddedEvidence(
  value,
  recipientPublicKey,
  oracleEphemeralPrivateKey,
  contextSha256,
  precommittedPaddingSeed,
  paddedBytes = PRODUCTION_PADDED_BYTES,
) {
  invariant(Number.isSafeInteger(paddedBytes) && paddedBytes >= 16 * 1024 && paddedBytes <= 16 * 1024 * 1024, "Invalid evidence padding envelope.");
  invariant(SHA256.test(contextSha256), "Evidence encryption requires one frozen context digest.");
  const json = Buffer.from(canonicalJson(value), "utf8");
  invariant(json.byteLength + 4 <= paddedBytes, "Hidden oracle evidence exceeds its frozen padded envelope.");
  const plaintext = Buffer.allocUnsafe(paddedBytes);
  plaintext.writeUInt32BE(json.byteLength, 0);
  json.copy(plaintext, 4);
  deterministicBytes(
    precommittedPaddingSeed,
    `ConfoVHH-v3-evidence-padding\0${contextSha256}`,
    paddedBytes - 4 - json.byteLength,
  ).copy(plaintext, 4 + json.byteLength);

  const ephemeralPrivate = asPrivateKey(oracleEphemeralPrivateKey);
  assertKeyType(ephemeralPrivate, "x25519", "Evidence ephemeral private key");
  const ephemeralPublic = createPublicKey(ephemeralPrivate);
  const ephemeralDer = ephemeralPublic.export({ type: "spki", format: "der" });
  invariant(ephemeralDer.byteLength === X25519_SPKI_BYTES, "Unexpected X25519 public-key encoding.");
  const recipient = asPublicKey(recipientPublicKey);
  assertKeyType(recipient, "x25519", "Evidence recipient public key");
  const recipientDer = recipient.export({ type: "spki", format: "der" });
  const recipientFingerprint = createHash("sha256").update(recipientDer).digest();
  const sharedSecret = diffieHellman({ privateKey: ephemeralPrivate, publicKey: recipient });
  const material = Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.from(contextSha256, "hex"),
    Buffer.from("ConfoVHH-v3-evidence-key-and-nonce", "utf8"),
    44,
  ));
  const contentKey = material.subarray(0, 32);
  const nonce = material.subarray(32, 44);
  const cipher = createCipheriv("aes-256-gcm", contentKey, nonce);
  cipher.setAAD(Buffer.concat([EVIDENCE_MAGIC, Buffer.from(contextSha256, "hex"), ephemeralDer, recipientFingerprint]));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  invariant(ephemeralDer.byteLength <= 0xffff, "Ephemeral evidence key is too large.");
  const header = Buffer.alloc(EVIDENCE_MAGIC.byteLength + 2);
  EVIDENCE_MAGIC.copy(header, 0);
  header.writeUInt16BE(ephemeralDer.byteLength, EVIDENCE_MAGIC.byteLength);
  return Buffer.concat([header, ephemeralDer, recipientFingerprint, tag, ciphertext]);
}

export function decryptPaddedEvidence(envelope, recipientPrivateKey, contextSha256) {
  invariant(Buffer.isBuffer(envelope) && envelope.byteLength === PRODUCTION_ENCRYPTED_EVIDENCE_BYTES, "Encrypted-evidence envelope has an unexpected size.");
  invariant(envelope.subarray(0, EVIDENCE_MAGIC.byteLength).equals(EVIDENCE_MAGIC), "Invalid encrypted-evidence envelope magic.");
  invariant(SHA256.test(contextSha256), "Evidence decryption requires the frozen context digest.");
  const publicLength = envelope.readUInt16BE(EVIDENCE_MAGIC.byteLength);
  const publicStart = EVIDENCE_MAGIC.byteLength + 2;
  invariant(publicLength === X25519_SPKI_BYTES, "Unexpected encrypted-evidence X25519 key length.");
  const recipientStart = publicStart + publicLength;
  const tagStart = recipientStart + RECIPIENT_FINGERPRINT_BYTES;
  const ciphertextStart = tagStart + 16;
  invariant(ciphertextStart < envelope.byteLength, "Truncated encrypted-evidence envelope.");
  const ephemeralDer = envelope.subarray(publicStart, recipientStart);
  const recipientPrivate = asPrivateKey(recipientPrivateKey);
  assertKeyType(recipientPrivate, "x25519", "Evidence recipient private key");
  const expectedRecipientFingerprint = createHash("sha256").update(createPublicKey(recipientPrivate).export({ type: "spki", format: "der" })).digest();
  const encodedRecipientFingerprint = envelope.subarray(recipientStart, tagStart);
  invariant(encodedRecipientFingerprint.equals(expectedRecipientFingerprint), "Encrypted evidence recipient key does not match its precommitted envelope fingerprint.");
  const ephemeralPublic = createPublicKey({ key: ephemeralDer, type: "spki", format: "der" });
  assertKeyType(ephemeralPublic, "x25519", "Evidence ephemeral public key");
  const sharedSecret = diffieHellman({ privateKey: recipientPrivate, publicKey: ephemeralPublic });
  const material = Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.from(contextSha256, "hex"),
    Buffer.from("ConfoVHH-v3-evidence-key-and-nonce", "utf8"),
    44,
  ));
  const decipher = createDecipheriv("aes-256-gcm", material.subarray(0, 32), material.subarray(32, 44));
  decipher.setAAD(Buffer.concat([EVIDENCE_MAGIC, Buffer.from(contextSha256, "hex"), ephemeralDer, encodedRecipientFingerprint]));
  decipher.setAuthTag(envelope.subarray(tagStart, ciphertextStart));
  const plaintext = Buffer.concat([decipher.update(envelope.subarray(ciphertextStart)), decipher.final()]);
  const length = plaintext.readUInt32BE(0);
  invariant(length > 0 && length <= plaintext.byteLength - 4, "Invalid hidden-evidence length.");
  return parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(plaintext.subarray(4, 4 + length)));
}

export function encryptedEvidenceDescriptor(envelope) {
  return {
    format: "confovhh-x25519-hkdf-sha256-aes-256-gcm-fixed-v1",
    bytes: envelope.byteLength,
    sha256: createHash("sha256").update(envelope).digest("hex"),
  };
}

export function verifyOpenedOracleEvidence({
  certificate,
  publicKey,
  verifiedRequest,
  encryptedEvidence,
  recipientPrivateKey,
}) {
  const transcript = verifyOracleTranscript({ certificate, publicKey, verifiedRequest, encryptedEvidence });
  const { payload } = transcript;
  const evidence = decryptPaddedEvidence(encryptedEvidence, recipientPrivateKey, payload.requestSha256);
  exactKeys(evidence, ["commitmentSeedHex", "paddingSeedHex", "pairs", "schemaVersion", "targets"], "opened oracle evidence");
  invariant(evidence.schemaVersion === "1.0.0", "Unexpected opened-evidence schema version.");
  for (const field of ["commitmentSeedHex", "paddingSeedHex"]) {
    invariant(typeof evidence[field] === "string" && SHA256.test(evidence[field]), `Opened evidence has an invalid ${field}.`);
  }
  const commitmentSeed = Buffer.from(evidence.commitmentSeedHex, "hex");
  const paddingSeed = Buffer.from(evidence.paddingSeedHex, "hex");
  invariant(createHash("sha256").update(commitmentSeed).digest("hex") === payload.commitmentNonceSeedCommitmentSha256, "Opened commitment entropy does not match its precommitment.");
  invariant(createHash("sha256").update(paddingSeed).digest("hex") === payload.paddingSeedCommitmentSha256, "Opened padding entropy does not match its precommitment.");
  invariant(Array.isArray(evidence.targets) && evidence.targets.length === payload.targetCount, "Opened target evidence count drifted.");
  invariant(Array.isArray(evidence.pairs) && evidence.pairs.length === payload.pairCount, "Opened pair evidence count drifted.");

  const hiddenByTarget = new Map();
  const recomputedCommitments = [];
  for (let index = 0; index < evidence.targets.length; index += 1) {
    const row = evidence.targets[index];
    exactKeys(row, ["hidden", "role", "targetId"], `opened target ${index + 1}`);
    const publicRow = payload.targetCommitments[index];
    invariant(row.targetId === publicRow.targetId && row.role === publicRow.role, `Opened target ${index + 1} drifted from the public transcript.`);
    classifyHiddenEpitopePair(row.hidden, row.hidden);
    const commitment = commitHiddenRecord(
      "target",
      row.targetId,
      row.hidden,
      deriveHiddenRecordNonce(commitmentSeed, "target", row.targetId),
    );
    invariant(commitment === publicRow.hiddenRecordCommitment, `Opened target ${row.targetId} commitment mismatch.`);
    hiddenByTarget.set(row.targetId, row.hidden);
    recomputedCommitments.push(commitment);
  }

  for (let index = 0; index < evidence.pairs.length; index += 1) {
    const row = evidence.pairs[index];
    exactKeys(row, ["decision", "intersection", "minSize", "pairId", "union"], `opened pair ${index + 1}`);
    const publicRow = payload.pairDecisions[index];
    invariant(row.pairId === publicRow.pairId, `Opened pair ${index + 1} drifted from the public transcript.`);
    const recomputed = classifyHiddenEpitopePair(hiddenByTarget.get(publicRow.leftId), hiddenByTarget.get(publicRow.rightId));
    invariant(canonicalJson({ pairId: row.pairId, ...recomputed }) === canonicalJson(row), `Opened pair ${row.pairId} decision or overlap statistics mismatch.`);
    invariant(row.decision === publicRow.decision, `Opened pair ${row.pairId} disagrees with the public decision.`);
    const hiddenRecord = { decision: row.decision, intersection: row.intersection, minSize: row.minSize, union: row.union };
    const commitment = commitHiddenRecord(
      "pair",
      row.pairId,
      hiddenRecord,
      deriveHiddenRecordNonce(commitmentSeed, "pair", row.pairId),
    );
    invariant(commitment === publicRow.hiddenRecordCommitment, `Opened pair ${row.pairId} commitment mismatch.`);
    recomputedCommitments.push(commitment);
  }
  invariant(merkleRoot(recomputedCommitments) === payload.commitmentMerkleRoot, "Opened evidence Merkle root mismatch.");
  return { payload, evidence, targetEligibility: deriveOracleTargetEligibility(payload) };
}
