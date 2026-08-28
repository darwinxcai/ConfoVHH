import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(THIS_FILE), "../..");
const CENSUS_RELATIVE = "validation/hard-decoy-holdout-v2/prelabel-census";
const SHA256 = /^[a-f0-9]{64}$/u;
const EXPECTED_CENSUS_FILES = [
  "README.md",
  "benchmark-spec.json",
  "census-attestation.json",
  "census-summary.json",
  "checksums.sha256",
  "development-registry.json",
  "endpoint-contract.json",
  "exclusion-ledger.jsonl",
  "generator-contracts.json",
  "historical-lock.json",
  "resource-contract.json",
  "scoring-contract.json",
  "target-census.jsonl",
  "vhh-lineage-census.jsonl",
].sort();
const FORBIDDEN_RESULT_KEYS = /^(?:dockq(?:score|value)?|capri(?:class|label)?|fnat|irmsd|lrmsd)$/iu;
const FORBIDDEN_PAYLOAD_KEYS = /^(?:results|labels|poses|predictions|nativePose|coordinatePayload|atomSite)$/iu;
const OBSERVED_LABEL_ASSIGNMENT = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const PRIVATE_VAULT_PATH = /(?:^|[\s="'`])(?:\/|\.{1,2}\/)?(?:native|label|candidate)-vault(?:\/|\\)[^\s"'`]+/iu;
const ENDPOINT_TOP_LEVEL_KEYS = [
  "averagePrecisionLiftPolicy",
  "bootstrap",
  "dockq",
  "hierarchy",
  "missingClassPolicy",
  "pairedContrastPolicy",
  "primaryEndpoints",
  "schemaVersion",
  "scientificGate",
  "secondaryEndpoints",
  "sensitivities",
  "tieRules",
].sort();
const ENDPOINT_DOCKQ_KEYS = ["capriBands", "mapping", "package", "primaryPositiveRule", "retainedFields", "version"].sort();
const BLOCKED_STATE_FIELDS = [
  "status",
  "exactFrozenGroupCount",
  "exactFrozenTargetSetExists",
  "targetManifestFrozen",
  "candidateManifestFrozen",
  "auditManifestFrozen",
  "prelabelSealCreated",
  "userApproved",
  "nativeHoldoutCoordinatesAccessed",
  "dockqLabelsAccessed",
  "performanceResultsAccessed",
  "holdoutReadyForApproval",
  "executionAuthorized",
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJsonFromPackage(packageTexts, relative) {
  return JSON.parse(packageTexts.get(relative));
}

function readJsonlFromPackage(packageTexts, relative) {
  const text = packageTexts.get(relative);
  invariant(text.endsWith("\n"), `${relative} must end with LF.`);
  return text.trimEnd().split("\n").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${relative}:${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

function walkKeys(value, visit, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, visit, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    visit(key, item, [...trail, key]);
    walkKeys(item, visit, [...trail, key]);
  }
}

function walkValues(value, visit, trail = []) {
  visit(value, trail);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValues(item, visit, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) walkValues(item, visit, [...trail, key]);
}

function hasCoordinatePayload(text) {
  return /(?:^|\r?\n)[ \t]*(?:ATOM {2}|HETATM).{20,}/mu.test(text)
    || /(?:^|\r?\n)[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu.test(text);
}

function verifyNoForbiddenPayload(relative, text) {
  invariant(!text.includes("\0"), `NUL byte appeared in public package file: ${relative}`);
  invariant(!hasCoordinatePayload(text), `Coordinate text appeared in public package file: ${relative}`);
  invariant(!PRIVATE_VAULT_PATH.test(text), `Private vault locator appeared in public package file: ${relative}`);
  invariant(!OBSERVED_LABEL_ASSIGNMENT.test(text), `Observed label assignment appeared in public package file: ${relative}`);

  if (!/\.jsonl?$/u.test(relative)) return;
  const records = relative.endsWith(".jsonl")
    ? text.trimEnd().split("\n").map((line) => JSON.parse(line))
    : [JSON.parse(text)];
  for (const record of records) {
    walkKeys(record, (key, value, trail) => {
      const allowedDockqContract = relative === "endpoint-contract.json"
        && trail.length === 1
        && key === "dockq"
        && value
        && typeof value === "object"
        && !Array.isArray(value);
      invariant(!FORBIDDEN_RESULT_KEYS.test(key) || allowedDockqContract, `Forbidden result field in ${relative}: ${trail.join(".")}`);
      invariant(!FORBIDDEN_PAYLOAD_KEYS.test(key), `Forbidden payload container in ${relative}: ${trail.join(".")}`);
    });
    walkValues(record, (value, trail) => {
      if (typeof value === "string") invariant(!hasCoordinatePayload(value), `Embedded coordinate text appeared in ${relative}: ${trail.join(".")}`);
      if (typeof value === "number") invariant(Number.isFinite(value), `Nonfinite public number in ${relative}: ${trail.join(".")}`);
    });
  }
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected), `${label} has unexpected keys.`);
}

async function readSecurePackageFile(filename, relative, censusReal, seenInodes) {
  const before = await lstat(filename, { bigint: true });
  invariant(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, `Package target must be one direct regular file: ${relative}`);
  const resolved = await realpath(filename);
  invariant(path.dirname(resolved) === censusReal, `Package target escaped the census directory: ${relative}`);

  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    invariant(opened.isFile() && opened.nlink === 1n, `Opened package target is not one regular file: ${relative}`);
    invariant(opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size, `Package target changed while opening: ${relative}`);
    invariant(opened.mtimeNs === before.mtimeNs && opened.ctimeNs === before.ctimeNs, `Package target metadata changed while opening: ${relative}`);
    const inodeKey = `${opened.dev}:${opened.ino}`;
    invariant(!seenInodes.has(inodeKey), `Package targets cannot alias the same inode: ${relative}`);
    seenInodes.add(inodeKey);
    invariant(opened.size <= 4n * 1024n * 1024n, `Public census artifact exceeds 4 MiB: ${relative}`);
    const bytes = await handle.readFile();
    const second = Buffer.alloc(bytes.byteLength);
    const reread = await handle.read(second, 0, second.byteLength, 0);
    const after = await handle.stat({ bigint: true });
    invariant(after.dev === opened.dev && after.ino === opened.ino && after.size === opened.size, `Package target changed while reading: ${relative}`);
    invariant(after.mtimeNs === opened.mtimeNs && after.ctimeNs === opened.ctimeNs, `Package target metadata changed while reading: ${relative}`);
    invariant(reread.bytesRead === bytes.byteLength && bytes.equals(second), `Package target bytes changed during verification: ${relative}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function sha256DirectRepositoryFile(repositoryReal, relative) {
  invariant(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `Unsafe repository path: ${relative}`);
  const filename = path.resolve(repositoryReal, relative);
  const containment = path.relative(repositoryReal, filename);
  invariant(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `Repository path escaped: ${relative}`);
  const before = await lstat(filename, { bigint: true });
  invariant(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, `Repository evidence must be one direct regular file: ${relative}`);
  invariant(await realpath(filename) === filename, `Repository evidence path cannot contain symlinks: ${relative}`);
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    invariant(opened.isFile() && opened.nlink === 1n && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size, `Repository evidence changed while opening: ${relative}`);
    invariant(opened.mtimeNs === before.mtimeNs && opened.ctimeNs === before.ctimeNs, `Repository evidence metadata changed while opening: ${relative}`);
    invariant(opened.size <= 64n * 1024n * 1024n, `Repository evidence exceeds 64 MiB: ${relative}`);
    const bytes = await handle.readFile();
    const second = Buffer.alloc(bytes.byteLength);
    const reread = await handle.read(second, 0, second.byteLength, 0);
    const after = await handle.stat({ bigint: true });
    invariant(after.dev === opened.dev && after.ino === opened.ino && after.size === opened.size, `Repository evidence changed while reading: ${relative}`);
    invariant(after.mtimeNs === opened.mtimeNs && after.ctimeNs === opened.ctimeNs, `Repository evidence metadata changed while reading: ${relative}`);
    invariant(reread.bytesRead === bytes.byteLength && bytes.equals(second), `Repository evidence bytes changed during verification: ${relative}`);
    return createHash("sha256").update(bytes).digest("hex");
  } finally {
    await handle.close();
  }
}

async function verifyChecksumManifest(censusDirectory) {
  const directoryInfo = await lstat(censusDirectory);
  invariant(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(), "Census package path must be a direct directory.");
  const censusReal = await realpath(censusDirectory);
  invariant(censusReal === path.resolve(censusDirectory), "Census package path cannot contain symlinked ancestors.");
  const directoryEntries = await readdir(censusDirectory, { withFileTypes: true });
  const actualNames = directoryEntries.map((entry) => entry.name).sort();
  invariant(JSON.stringify(actualNames) === JSON.stringify(EXPECTED_CENSUS_FILES), "Census directory does not match the exact public-file allowlist.");
  invariant(directoryEntries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), "Every census package entry must be a direct regular file.");

  const filename = path.join(censusDirectory, "checksums.sha256");
  const seenInodes = new Set();
  const manifestBytes = await readSecurePackageFile(filename, "checksums.sha256", censusReal, seenInodes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
  verifyNoForbiddenPayload("checksums.sha256", text);
  invariant(text.endsWith("\n"), "checksums.sha256 must end with LF.");
  const rows = text.trimEnd().split("\n");
  invariant(rows.length === EXPECTED_CENSUS_FILES.length - 1, "Checksum manifest must cover every package file except itself.");
  const seen = new Set();
  const packageTexts = new Map([["checksums.sha256", text]]);
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    invariant(match, `checksums.sha256:${index + 1} has invalid syntax.`);
    const [, expected, relative] = match;
    invariant(relative !== "checksums.sha256", "The checksum manifest cannot checksum itself.");
    invariant(!path.isAbsolute(relative) && !relative.split("/").includes(".."), `Unsafe checksum path: ${relative}`);
    invariant(!seen.has(relative), `Duplicate checksum path: ${relative}`);
    seen.add(relative);
    const absolute = path.join(censusDirectory, relative);
    const bytes = await readSecurePackageFile(absolute, relative, censusReal, seenInodes);
    invariant(createHash("sha256").update(bytes).digest("hex") === expected, `Checksum mismatch: ${relative}`);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    verifyNoForbiddenPayload(relative, decoded);
    packageTexts.set(relative, decoded);
  }
  const expectedCovered = EXPECTED_CENSUS_FILES.filter((relative) => relative !== "checksums.sha256").sort();
  invariant(JSON.stringify([...seen].sort()) === JSON.stringify(expectedCovered), "Checksum manifest coverage drifted from the package allowlist.");
  return { checksumCount: rows.length, packageTexts };
}

export async function verifyCensus(repositoryRoot = DEFAULT_ROOT) {
  const repositoryInfo = await lstat(repositoryRoot);
  invariant(repositoryInfo.isDirectory() && !repositoryInfo.isSymbolicLink(), "Repository root must be a direct directory.");
  const repositoryReal = await realpath(repositoryRoot);
  invariant(repositoryReal === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const censusDirectory = path.join(repositoryReal, CENSUS_RELATIVE);
  const { checksumCount, packageTexts } = await verifyChecksumManifest(censusDirectory);
  const spec = readJsonFromPackage(packageTexts, "benchmark-spec.json");
  const summary = readJsonFromPackage(packageTexts, "census-summary.json");
  const generators = readJsonFromPackage(packageTexts, "generator-contracts.json");
  const scoring = readJsonFromPackage(packageTexts, "scoring-contract.json");
  const endpoints = readJsonFromPackage(packageTexts, "endpoint-contract.json");
  const resources = readJsonFromPackage(packageTexts, "resource-contract.json");
  const development = readJsonFromPackage(packageTexts, "development-registry.json");
  const historical = readJsonFromPackage(packageTexts, "historical-lock.json");
  const attestation = readJsonFromPackage(packageTexts, "census-attestation.json");
  const targets = readJsonlFromPackage(packageTexts, "target-census.jsonl");
  const exclusions = readJsonlFromPackage(packageTexts, "exclusion-ledger.jsonl");
  const lineages = readJsonlFromPackage(packageTexts, "vhh-lineage-census.jsonl");
  const provisionalGroups = new Set(targets.map((target) => target.provisionalGroupId));
  const frozenGroups = new Set(targets.filter((target) => target.frozenEligible).map((target) => target.provisionalGroupId));

  invariant(spec.status === "TARGET_CENSUS_BLOCKED", "Benchmark spec must remain blocked.");
  invariant(SHA256.test(spec.protocolSha256), "Protocol digest is invalid.");
  invariant(spec.protocol === "HARD_DECOY_PROTOCOL_V2.md", "Unexpected version 2 protocol path.");
  invariant(await sha256DirectRepositoryFile(repositoryReal, spec.protocol) === spec.protocolSha256, "Version 2 protocol changed after census attestation.");
  invariant(attestation.protocolSha256 === spec.protocolSha256, "Census protocol attestations drifted.");
  const expectedBlockedState = {
    status: "TARGET_CENSUS_BLOCKED",
    exactFrozenGroupCount: null,
    exactFrozenTargetSetExists: false,
    targetManifestFrozen: false,
    candidateManifestFrozen: false,
    auditManifestFrozen: false,
    prelabelSealCreated: false,
    userApproved: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
    holdoutReadyForApproval: false,
    executionAuthorized: false,
  };
  for (const [label, record] of [["spec", spec], ["summary", summary], ["attestation", attestation]]) {
    for (const field of BLOCKED_STATE_FIELDS) invariant(Object.hasOwn(record, field) && record[field] === expectedBlockedState[field], `${label} blocked-state field drifted: ${field}`);
  }
  invariant(spec.minimumIndependentGroups === 10, "The required independent-group minimum drifted.");
  invariant(Object.values(spec.claimFlags).every((value) => value === false), "Every holdout claim flag must remain false.");

  invariant(summary.requiredIndependentGroups === spec.minimumIndependentGroups, "Required group counts disagree.");
  invariant(summary.screenedCandidateRecordCount === targets.length, "Screened candidate-record count drifted.");
  invariant(summary.screenedExclusionRecordCount === exclusions.length, "Screened exclusion-record count drifted.");
  invariant(summary.screenedProvisionalGroupCount === provisionalGroups.size, "Screened provisional group count drifted.");
  invariant(summary.formallyClearedGroupCount === frozenGroups.size && frozenGroups.size === 0 && summary.finalUsableGroupCount === null, "Blocked screen cannot claim cleared or final groups.");
  invariant(Array.isArray(summary.provisionalGroupsBeforeFormalSequenceAndEpitopeAudit), "Provisional group list is missing.");
  invariant(new Set(summary.provisionalGroupsBeforeFormalSequenceAndEpitopeAudit).size === summary.provisionalGroupsBeforeFormalSequenceAndEpitopeAudit.length, "Provisional group list contains duplicates.");
  invariant(JSON.stringify([...summary.provisionalGroupsBeforeFormalSequenceAndEpitopeAudit].sort()) === JSON.stringify([...provisionalGroups].sort()), "Provisional group list drifted from target records.");
  invariant(summary.screenedProvisionalGroupCount < summary.requiredIndependentGroups, "Blocked screen unexpectedly meets the target minimum.");
  invariant(summary.formalLeakageAuditCompleted === false, "A blocked screen cannot claim a completed formal leakage audit.");
  invariant(summary.candidateDiscoveryExhaustive === false && summary.exclusionDiscoveryComplete === false, "Incomplete candidate discovery must remain explicit.");
  invariant(summary.rawMetadataResponsesArchived === false && summary.sourceCoverage === "PARTIAL-RCSB-CORE-ONLY", "Partial source provenance must remain explicit.");
  invariant(spec.candidateDiscoveryExhaustive === summary.candidateDiscoveryExhaustive, "Candidate-discovery state drifted between spec and summary.");
  invariant(attestation.candidateDiscoveryExhaustive === summary.candidateDiscoveryExhaustive, "Candidate-discovery state drifted.");
  invariant(spec.rawMetadataResponsesArchived === summary.rawMetadataResponsesArchived, "Raw-source archive state drifted between spec and summary.");
  invariant(attestation.rawMetadataResponsesArchived === summary.rawMetadataResponsesArchived, "Raw-source archive state drifted.");
  invariant(spec.sourceCoverage === summary.sourceCoverage && attestation.sourceCoverage === summary.sourceCoverage, "Source-coverage state drifted.");
  const blockerIds = new Set(spec.freezeBlockers.map((blocker) => blocker.id));
  for (const blocker of ["minimum-independent-target-groups", "search-universe-reconciliation", "raw-metadata-response-archive", "substantial-gpu-allocation"]) {
    invariant(blockerIds.has(blocker), `Missing freeze blocker: ${blocker}`);
  }
  invariant(spec.freezeBlockers.every((blocker) => blocker.status === "OPEN"), "Every blocked-census freeze blocker must remain open.");
  const minimumBlocker = spec.freezeBlockers.find((blocker) => blocker.id === "minimum-independent-target-groups");
  invariant(minimumBlocker.required === spec.minimumIndependentGroups, "Minimum-target blocker requirement drifted.");
  invariant(minimumBlocker.formallyClearedGroupCount === frozenGroups.size, "Minimum-target blocker cleared count drifted.");
  invariant(minimumBlocker.screenedProvisionalGroupCount === provisionalGroups.size, "Minimum-target blocker provisional count drifted.");

  invariant(targets.every((target) => target.frozenEligible === false), "No census row may be frozen eligible.");
  invariant(exclusions.length === summary.screenedExclusionRecordCount, "Documented screened exclusions do not reconcile.");

  const targetIds = new Set();
  for (const target of targets) {
    invariant(!targetIds.has(target.recordId), `Duplicate target recordId: ${target.recordId}`);
    targetIds.add(target.recordId);
    invariant(target.directInterfaceAssertion.startsWith("provisional-"), `${target.recordId} overstates direct-interface clearance.`);
    if (target.recordId === "9fte-adgrv1-re02") invariant(target.directInterfaceAssertion === "provisional-metadata-only-unverified-direct-interface-no-coordinate-inspection", "9FTE cannot claim unavailable publication evidence.");
    for (const polymer of [target.receptor, target.vhh]) {
      invariant(typeof polymer.constructSequence === "string" && /^[A-Z]+$/u.test(polymer.constructSequence), `${target.recordId} has an invalid polymer sequence.`);
      invariant(polymer.constructSequence.length === polymer.constructSequenceLength, `${target.recordId} sequence length drifted.`);
      invariant(sha256Text(polymer.constructSequence) === polymer.constructSequenceSha256, `${target.recordId} sequence digest drifted.`);
    }
    invariant(target.receptor.canonical7tmStatus === "REQUIRED-BEFORE-FREEZE", `${target.recordId} improperly claims a frozen 7TM sequence.`);
    invariant(target.vhh.imgtStatus === "REQUIRED-BEFORE-FREEZE", `${target.recordId} improperly claims lineage clearance in the target ledger.`);
    invariant(target.structure.assemblyStatus === "REQUIRED-BEFORE-FREEZE", `${target.recordId} improperly claims frozen assembly metadata.`);
    invariant(Array.isArray(target.sourceArtifacts) && target.sourceArtifacts.length === 3, `${target.recordId} must bind entry/receptor/VHH metadata sources.`);
    for (const source of target.sourceArtifacts) {
      invariant(source.license === "CC0-1.0", `${target.recordId} source license drifted.`);
      invariant(Number.isInteger(source.bytes) && source.bytes > 0, `${target.recordId} has an invalid observed source-byte count.`);
      invariant(SHA256.test(source.sha256), `${target.recordId} has invalid source SHA-256.`);
      invariant(/^2026-08-28T\d{2}:\d{2}:\d{2}Z$/u.test(source.retrievedUtc), `${target.recordId} has an invalid source retrieval timestamp.`);
      invariant(source.url.startsWith("https://data.rcsb.org/rest/v1/core/"), `${target.recordId} has an unexpected metadata source.`);
    }
  }

  invariant(lineages.length === targets.length, "Every target row requires exactly one VHH lineage record.");
  const targetById = new Map(targets.map((target) => [target.recordId, target]));
  for (const lineage of lineages) {
    const target = targetById.get(lineage.recordId);
    invariant(target, `Lineage row has no target: ${lineage.recordId}`);
    invariant(lineage.constructSequenceSha256 === target.vhh.constructSequenceSha256, `Lineage input digest drifted: ${lineage.recordId}`);
    invariant(lineage.engine === "immunum 1.2.0" && lineage.scheme === "IMGT", `Lineage engine drifted: ${lineage.recordId}`);
    invariant(lineage.status === "numbered", `Candidate VHH could not be numbered: ${lineage.recordId}`);
    for (const field of ["frameworkSequenceSha256", "cdr1Sha256", "cdr2Sha256", "cdr3Sha256"]) {
      invariant(SHA256.test(lineage[field]), `${lineage.recordId} has invalid ${field}.`);
    }
    invariant(sha256Text(lineage.frameworkSequence) === lineage.frameworkSequenceSha256, `Framework digest drifted: ${lineage.recordId}`);
    invariant(sha256Text(lineage.cdr1) === lineage.cdr1Sha256, `CDR1 digest drifted: ${lineage.recordId}`);
    invariant(sha256Text(lineage.cdr2) === lineage.cdr2Sha256, `CDR2 digest drifted: ${lineage.recordId}`);
    invariant(sha256Text(lineage.cdr3) === lineage.cdr3Sha256, `CDR3 digest drifted: ${lineage.recordId}`);
  }

  invariant(development.developmentGpcrVhhStructures.length === 17, "Development GPCR-VHH registry must contain 17 structures.");
  invariant(new Set(development.assemblyOnlyParserOracles).size === 4, "Assembly-only oracle registry drifted.");
  invariant(development.completeForFormalLeakageCertification === false, "Development metadata gaps must remain explicit.");

  invariant(generators.generators.length === 2, "Exactly two required generator codebases must be prespecified.");
  invariant(JSON.stringify(generators.generators.map((generator) => generator.id)) === JSON.stringify(spec.requiredGeneratorIds), "Required generator IDs drifted between spec and contracts.");
  invariant(new Set(generators.generators.map((generator) => generator.gitCommit)).size === 2, "Generator implementations are not independent commits.");
  invariant(generators.generators.every((generator) => generator.attemptsPerTarget === 200), "Generator attempt counts drifted.");
  invariant(generators.nativeRelativePoseForbidden && generators.nativeInterfaceResiduesForbidden, "Native-pose isolation must remain enabled.");
  invariant(generators.dockqFeedbackForbidden && generators.confovhhFeedbackForbidden, "Generator feedback barriers must remain enabled.");
  invariant(generators.generators.some((generator) => generator.environmentImageDigestStatus === "BLOCKER-BEFORE-TARGETS-FROZEN"), "Unresolved environment lock must remain a blocker.");

  const expectedOrder = [
    "evidenceBandOrdinal",
    "severeClashResiduePairCount",
    "maximumVdwOverlapAngstrom",
    "imgtNumberingAvailable",
    "cdrContactShare",
    "interfaceResiduePairCount",
    "deltaSasaAngstromSquared",
  ];
  invariant(JSON.stringify(scoring.scientificPreorder.map((field) => field.field)) === JSON.stringify(expectedOrder), "Scientific preorder drifted.");
  invariant(scoring.displayFieldsMayBreakScientificTies === false, "Display hashes cannot break scientific ties.");
  invariant(!scoring.scientificPreorder.some((field) => /sha256|hash|poseId|attemptId/iu.test(field.field)), "A display identifier leaked into the scientific preorder.");
  const baselineIds = new Set(scoring.prespecifiedBaselines.map((baseline) => baseline.id));
  for (const baseline of ["producer-percentile", "delta-sasa", "contact-count", "negative-severe-clashes", "negative-maximum-overlap", "cdr-contact-share", "all-tied", "random-permutation-diagnostic"]) {
    invariant(baselineIds.has(baseline), `Missing baseline: ${baseline}`);
  }

  exactKeys(endpoints, ENDPOINT_TOP_LEVEL_KEYS, "endpoint-contract.json");
  exactKeys(endpoints.dockq, ENDPOINT_DOCKQ_KEYS, "endpoint-contract.json dockq");
  exactKeys(endpoints.dockq.capriBands, ["acceptable", "high", "incorrect", "medium"], "endpoint-contract.json CAPRI bands");
  invariant(endpoints.dockq.package === "DockQ" && endpoints.dockq.version === "2.1.3" && endpoints.dockq.mapping === "AB:AB", "DockQ contract drifted.");
  invariant(endpoints.primaryEndpoints.includes("independent-group-macro-average-precision"), "Primary AP endpoint is missing.");
  invariant(endpoints.bootstrap.replicates === 10000 && endpoints.bootstrap.poseResampling === false, "Bootstrap contract drifted.");
  invariant(endpoints.scientificGate.logic === "intersection-union-all-required", "Scientific gate multiplicity contract drifted.");
  invariant(resources.approvalRequired === true && resources.calibration.holdoutTargetCalibrationForbidden === true, "Resource approval/calibration gate drifted.");

  const publicLedgers = [...targets, ...exclusions, ...lineages];
  for (const record of publicLedgers) {
    walkKeys(record, (key, value, trail) => {
      invariant(!FORBIDDEN_RESULT_KEYS.test(key), `Forbidden label field in public ledger: ${trail.join(".")}`);
      if (typeof value === "number") invariant(Number.isFinite(value), `Nonfinite public number: ${trail.join(".")}`);
    });
    const serialized = JSON.stringify(record);
    invariant(!hasCoordinatePayload(serialized), "Coordinate text appeared in a public ledger.");
    invariant(!PRIVATE_VAULT_PATH.test(serialized), "Private vault path appeared in a public ledger.");
  }

  for (const locked of historical.immutableFiles) {
    invariant(SHA256.test(locked.sha256), `Invalid historical lock digest: ${locked.path}`);
    invariant(await sha256DirectRepositoryFile(repositoryReal, locked.path) === locked.sha256, `Historical artifact changed: ${locked.path}`);
  }

  return {
    status: spec.status,
    requiredIndependentGroups: spec.minimumIndependentGroups,
    screenedProvisionalGroups: provisionalGroups.size,
    frozenEligibleGroups: frozenGroups.size,
    candidateRecords: targets.length,
    exclusionRecords: exclusions.length,
    vhhLineageRecords: lineages.length,
    requiredGenerators: generators.generators.map((generator) => generator.id),
    immutableHistoricalFiles: historical.immutableFiles.length,
    checksumFiles: checksumCount,
    nativeHoldoutCoordinatesAccessed: spec.nativeHoldoutCoordinatesAccessed,
    dockqLabelsAccessed: spec.dockqLabelsAccessed,
    performanceResultsAccessed: spec.performanceResultsAccessed,
    holdoutReadyForApproval: summary.holdoutReadyForApproval,
    executionPermitted: attestation.executionAuthorized,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  try {
    console.log(JSON.stringify(await verifyCensus(root), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
